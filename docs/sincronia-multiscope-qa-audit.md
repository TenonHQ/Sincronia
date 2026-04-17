---
rfc: RFC-0004
title: "Sincronia Multi-Scope Sync: QA/UAT Audit and Remediation Plan"
author: Daniel
status: draft
created: 2026-04-10
review-deadline: 2026-04-17
approvers:
  - Daniel
clickup-task:
supersedes:
superseded-by:
---

# RFC-0004: Sincronia Multi-Scope Sync — QA/UAT Audit and Remediation Plan

## Summary

Sincronia was converted from single-scope to multi-scope synchronization and gained a web-based Update Set Dashboard with ClickUp task integration. A deep code audit across the core push pipeline, ServiceNow REST client, update set management, dashboard server, and documentation uncovered 10 categories of defects. The most severe: files can silently push to the wrong ServiceNow scope or default update set, API errors trigger blind retries instead of intelligent backoff, and concurrent multi-scope saves can lose update set mappings due to race conditions. This RFC documents each defect with severity, root cause, affected code, and proposed fix, then phases them into a 4-sprint remediation roadmap with acceptance criteria and a testing strategy.

---

## Motivation

### What Sincronia Must Do (The Contract)

These are the behavioral guarantees that every developer relying on Sincronia expects:

1. **Scope correctness** — When a developer saves a file belonging to scope `x_cadso_core`, the push must land in `x_cadso_core`'s update set on ServiceNow. Never in Default. Never in another scope's update set.
2. **Update set integrity** — When a ClickUp task is active and scopes are activated, every push must be captured in the task's update set. If no update set exists, the system must surface a clear warning — not silently push to Default.
3. **API resilience** — When ServiceNow returns a transient error (429, 500, 503), the tool must retry with exponential backoff and eventually surface a clear failure. Auth errors (401/403) must fail immediately. Not-found errors (404) must not retry.
4. **Concurrency safety** — When multiple scopes save files within the same second, each scope's changes must land in the correct scope-specific update set independently. No mapping should be lost.
5. **Feedback** — When files are skipped (not in manifest, table not configured), the developer must see which files were skipped and why. Not "0 files to push."
6. **Security** — The dashboard must not expose unauthenticated mutation endpoints to the network.
7. **Documentation accuracy** — Package counts, Node versions, npm scopes, and command references must match reality.

### What Actually Happens (The Gap)

| Category | Contract Violation | User-Visible Impact |
|----------|-------------------|---------------------|
| Push scope routing | Files can push to wrong scope in batch operations | Code in wrong update set, discovered days later |
| Update set creation | Changes silently go to Default when no task is active | Untracked changes pollute Default update set |
| API error handling | All HTTP errors retried identically at fixed 3s intervals | 500s cascade, 429s not respected, auth errors retry uselessly |
| Config race condition | Concurrent scope saves can overwrite each other's update set mapping | One scope's update set mapping lost, pushes go to Default |
| File filtering | Files not in manifest silently dropped | Developer thinks push succeeded, but files were skipped |
| Dashboard security | Express server binds to 0.0.0.0 with no auth | Any network process can mutate update sets |
| Task ID handling | Assumes "CU-{id}" naming, no validation on empty taskId | Broken ServiceNow queries, stale task data persists forever |
| Rate coordination | Dashboard and core each enforce 20 RPS independently | Combined 40 RPS triggers ServiceNow throttling |
| Scope switching | Not idempotent, polls every 2 minutes for all scopes | Unnecessary API calls waste rate limit budget |
| Documentation | Wrong package count, Node version, npm scope | Developer confusion during setup and troubleshooting |

### What Happens If We Don't Fix This

- Developers push code to the wrong ServiceNow update set without knowing it, causing deployment errors discovered days or weeks later during QA or UAT.
- ServiceNow rate limiting causes cascading 500 errors with no intelligent recovery, forcing developers to restart the watch process.
- The tool becomes unreliable enough that developers fall back to manual editing in ServiceNow Studio, defeating the purpose of Sincronia.
- The dashboard exposes mutation endpoints to the local network, creating a security liability.

---

## Severity Definitions

| Severity | Definition | SLA |
|----------|-----------|-----|
| **P0 — Critical** | Data lands in wrong place silently. Data loss or corruption risk. | Must fix before next release. |
| **P1 — High** | Feature broken under realistic conditions. No workaround. | Fix in next sprint. |
| **P2 — Medium** | Degraded behavior, workaround exists. Performance or security. | Fix within 2 sprints. |
| **P3 — Low** | Cosmetic, documentation, or minor UX. | Fix opportunistically. |

---

## Detailed Design

### 3.1 Multi-Scope Push Routes to Wrong Scope (P0)

**Severity:** P0 — Critical

**Affected Code:**
- `packages/core/src/appUtils.ts` — `pushFiles()` (lines 509-552), `pushRec()` (lines 461-507)
- `packages/core/src/FileUtils.ts` — `getFileContextFromPath()` (lines 157-210)
- `packages/core/src/MultiScopeWatcher.ts` — file context filtering (line 280)

**Root Cause:**
`pushRec()` calls `getUpdateSetConfig()` on every invocation, re-reading `.sinc-update-sets.json` from disk each time. If the config file is being written by another scope's `ensureUpdateSetForScope()` simultaneously, it may read a partial or stale config, causing the push to use the wrong update set or fall back to Default.

Additionally, `getFileContextFromPath()` returns `undefined` silently when a file is not in the manifest. The caller filters these out with `.filter((ctx) => !!ctx)` but logs nothing about which files were dropped or why. The user sees "0 files to push" instead of "3 files were not in the manifest."

**Proposed Fix:**
1. Cache the update set config at the start of a push batch and pass it through to `pushRec()`, rather than re-reading from disk per record.
2. Log a warning per file that returns `undefined` from `getFileContextFromPath()`, including the file path and the reason (not in manifest, scope not found, table not configured).
3. Add scope validation: if the record's scope does not match the scope watcher that queued it, log an error and skip rather than pushing to the wrong scope.

**Acceptance Criteria:**
- [ ] Push 3 files across 2 scopes simultaneously; each lands in the correct scope's update set
- [ ] A file not in the manifest produces a visible warning with the file path
- [ ] No silent cross-scope contamination under concurrent saves

---

### 3.2 No HTTP Status Code Differentiation in Retry Logic (P1)

**Severity:** P1 — High

**Affected Code:**
- `packages/core/src/snClient.ts` — `retryOnErr()` (lines 23-41), `processPushResponse()` (lines 44-65)
- `packages/core/src/constants.ts` — `PUSH_RETRY_WAIT = 3000`, `PUSH_RETRIES = 3`

**Root Cause:**
`retryOnErr()` catches all errors identically and retries with a fixed 3000ms wait. `processPushResponse()` treats all non-2xx status codes the same after a successful HTTP round-trip. There is no handling for:
- **429 (Too Many Requests)** — should honor `Retry-After` header, wait longer
- **401/403 (Auth failure)** — should fail immediately, no retry
- **500/502/503 (Server error)** — should retry with exponential backoff
- **404 (Not found)** — should fail immediately, no retry

The rate limiter (`maxRPS: 20` via `axios-rate-limit`) only throttles outgoing requests. It cannot handle server-side rate limiting responses.

**Proposed Fix:**
1. Classify HTTP errors into categories:
   - **Retryable with backoff:** 429, 500, 502, 503
   - **Not retryable:** 401, 403, 404
   - **Unknown:** everything else (retry once, then fail)
2. Replace fixed 3000ms wait with exponential backoff: 1s → 2s → 4s (capped at 8s).
3. For 429 responses, honor the `Retry-After` header if present.
4. For 401/403 responses, fail immediately with a clear auth error message suggesting credential verification.

**Acceptance Criteria:**
- [ ] A 429 response triggers a longer wait (not a blind 3s retry)
- [ ] A 401 response fails immediately without retrying
- [ ] A 500 response retries with increasing delay (1s, 2s, 4s)
- [ ] A 404 response fails immediately with "record not found" message

---

### 3.3 Update Set Creation Race Condition in Multi-Scope (P1)

**Severity:** P1 — High

**Affected Code:**
- `packages/core/src/MultiScopeWatcher.ts` — `ensureUpdateSetForScope()` (lines 171-257), `getUpdateSetConfig()` (lines 142-152), `saveUpdateSetConfig()` (lines 166-169)
- `packages/core/src/appUtils.ts` — `getUpdateSetConfig()` (line ~42)

**Root Cause:**
Two scopes saving files simultaneously both call `ensureUpdateSetForScope()`. Each reads `.sinc-update-sets.json`, decides the other scope has no mapping yet, modifies its own entry, and writes back. The last writer wins, potentially overwriting the first scope's mapping. The re-read on line 240 mitigates this partially but does not eliminate the race because the read-modify-write cycle is not atomic.

Additionally: if `readActiveTask()` returns null (no `.sinc-active-task.json` or malformed JSON), the function logs a debug-level warning and returns without creating an update set. The push then silently goes to Default.

Additionally: the scope sys_id lookup (line 197) can fail silently. If the scope doesn't exist on the instance, `scopeSysId` is `undefined`, and the update set gets created in the **global scope** instead of the target scope.

**Proposed Fix:**
1. Serialize `ensureUpdateSetForScope()` calls under the existing `scopeLock` mutex (it already serializes `processScopeQueue`, extend it to cover the config write).
2. After writing the config, verify the written data by re-reading and confirming the scope's mapping is present.
3. When no active task exists and no update set is configured, surface a **prominent warning** (not debug-level) or block the push with a clear message: "No update set configured for scope {X}. Changes will go to Default. Use `sinc createUpdateSet` or activate a task in the dashboard."
4. Validate `scopeSysId` before creating the update set. If null/undefined, log an error with the scope name and skip creation.

**Acceptance Criteria:**
- [ ] Save files in 3 scopes within 1 second; all 3 scopes have correct update set mappings persisted in `.sinc-update-sets.json`
- [ ] No mapping is lost due to concurrent writes
- [ ] Pushing without an active task or update set produces a clear, non-debug-level warning
- [ ] Invalid scope name produces a clear error, not a global-scope update set

---

### 3.4 Update Set Not Loaded After Creation (P1)

**Severity:** P1 — High

**Affected Code:**
- `packages/core/src/updateSetCommands.ts` — `createUpdateSetCommand()` (lines 183-272), `switchToUpdateSet()` (lines 437-474)
- `packages/core/src/MultiScopeWatcher.ts` — `ensureUpdateSetForScope()` (line 226)

**Root Cause:**
After creating an update set, `switchToUpdateSet()` is called to make it the active update set on the ServiceNow instance. This call is wrapped in a try/catch. If the switch fails (network timeout, scope mismatch, etc.), the update set exists on ServiceNow but the user's session remains on the previous (or Default) update set. Subsequent pushes go to the wrong update set with no error surfaced.

The dashboard's `findOrCreateUpdateSet()` has the same pattern: creates the update set, then calls the `changeUpdateSet` API. If the change call fails, the dashboard reports success (update set was created) but the instance is not actually using it.

**Proposed Fix:**
1. After `switchToUpdateSet()`, verify the switch by calling `getCurrentUpdateSet()` and comparing the returned sys_id with the expected one.
2. If verification fails, retry the switch once, then surface an error: "Update set '{name}' was created but could not be activated. Current update set is '{actual}'."
3. In the dashboard, add the same verification step after `changeUpdateSet`.

**Acceptance Criteria:**
- [ ] After creating an update set, verify it is the active one by querying `currentUpdateSet`
- [ ] If the switch fails, the user/dashboard sees an explicit error
- [ ] No scenario where creation reports success but pushes go to a different update set

---

### 3.5 Dashboard Has No Authentication (P2)

**Severity:** P2 — Medium

**Affected Code:**
- `packages/dashboard/server.js` — all Express routes (no middleware for auth)

**Root Cause:**
The Express server binds to `0.0.0.0` (Express default) with no authentication. Any process on the local network can hit mutation endpoints:
- `POST /api/update-set` — create update sets
- `POST /api/select-update-set` — change the active update set for a scope
- `POST /api/clickup/select-task` — change the active ClickUp task
- `PATCH /api/update-set/:sysId/close` — close an update set

**Proposed Fix:**
1. Bind the Express server to `127.0.0.1` only (localhost). This is the minimum viable fix.
2. Optionally: generate a session token at startup, print it to the console, and require it as an `X-Dashboard-Token` header on all mutation endpoints. The dashboard UI would read the token from a `<meta>` tag injected at page load.

**Acceptance Criteria:**
- [ ] Dashboard server binds to `127.0.0.1`, not `0.0.0.0`
- [ ] Requests from non-localhost addresses are refused
- [ ] Existing localhost workflows (browser, CLI) work unchanged

---

### 3.6 Dashboard and Core Rate Limiters Are Independent (P2)

**Severity:** P2 — Medium

**Affected Code:**
- `packages/dashboard/server.js` — `waitForRateLimit()` function (custom 20 RPS queue)
- `packages/core/src/snClient.ts` — `rateLimit(..., { maxRPS: 20 })` (line 88)

**Root Cause:**
The dashboard and core each enforce their own 20 RPS limit against the same ServiceNow instance. When both are active simultaneously (watch mode with dashboard open — the primary use case), the combined rate can reach 40 RPS, triggering ServiceNow's server-side throttling (resulting in 429 or 500 responses).

Additionally, the update set monitoring in `MultiScopeWatcher.ts` polls every 120 seconds, calling `switchToScope()` and `getCurrentUpdateSet()` for every configured scope. With 11 scopes, that's ~33 API calls every 2 minutes in the background, consuming rate limit budget.

**Proposed Fix:**
1. **Short-term:** Reduce the dashboard's rate limit to 10 RPS so the combined total stays under 20.
2. **Medium-term:** Share a single rate limiter between core and dashboard. Options:
   - Have the dashboard proxy ServiceNow calls through core's client (IPC or shared module)
   - Use a shared token bucket via a local file or named pipe
3. Make the update set monitoring interval configurable (default 120s, allow disabling with `--noMonitoring`).

**Acceptance Criteria:**
- [ ] Combined core + dashboard API calls do not exceed 20 RPS to ServiceNow
- [ ] Update set monitoring interval is configurable or can be disabled
- [ ] Background polling does not consume more than 5% of the rate limit budget per cycle

---

### 3.7 Task ID Handling Is Fragile (P2)

**Severity:** P2 — Medium

**Affected Code:**
- `packages/core/src/MultiScopeWatcher.ts` — `readActiveTask()` (lines 154-164), update set query construction (line 201-205)
- `packages/dashboard/server.js` — `findOrCreateUpdateSet()` (lines 518-522), `generateUpdateSetName()` (line 483)

**Root Cause:**
The update set lookup query `nameLIKECU-{taskId}` assumes update set names follow the `CU-{id} — {name}` convention. This fails when:
- A user manually creates an update set with a different naming pattern
- The `taskId` field is undefined or empty (produces `nameLIKECU-undefined`)
- Multiple update sets match the pattern (takes the first, which may not be correct)

The active task file (`.sinc-active-task.json`) persists indefinitely with no TTL. There is no `sinc task clear` command to deselect the active task from the CLI. A developer who finished a task weeks ago will continue pushing to that task's update set.

`readActiveTask()` performs no validation — if required fields are missing, it returns the partial object, and downstream code breaks when accessing `.taskId`.

**Proposed Fix:**
1. Validate that `taskId` is a non-empty string before constructing the query. If empty/undefined, log an error and skip update set lookup.
2. Add a `sinc task clear` command that removes `.sinc-active-task.json` and clears the in-memory active task state.
3. Add a staleness check: if the active task file is older than 7 days, log a warning suggesting the developer verify they're still working on that task.
4. Validate required fields (`taskId`, `updateSetName`) in `readActiveTask()` and return null if either is missing.
5. Document the naming convention (`CU-{id} — {sanitized_name}`) in CLAUDE.md so developers know what to expect.

**Acceptance Criteria:**
- [ ] An empty/undefined taskId does not produce a broken ServiceNow query
- [ ] `sinc task clear` command exists and removes `.sinc-active-task.json`
- [ ] Active task older than 7 days produces a staleness warning
- [ ] Missing required fields in active task file produce a clear error, not a crash

---

### 3.8 Scope Lock Serializes Independent Scopes (P2)

**Severity:** P2 — Medium (performance, not correctness)

**Affected Code:**
- `packages/core/src/MultiScopeWatcher.ts` — `withScopeLock()` (lines 129-140), `processScopeQueue()` (line 268)

**Root Cause:**
A single `scopeLock` promise serializes all scope pushes. If scope A and scope B both have pending files, scope B waits for scope A to finish completely (including API calls to switch scope, push files, and verify). With the 300ms debounce per scope and 3+ scopes active, the latency from file save to push completion can exceed 2 seconds.

However, this serialization is **architecturally necessary** given the single-session ServiceNow model. ServiceNow's session tracks one "current scope" and one "current update set" at a time. Parallel pushes to different scopes would cause scope/update-set corruption on the server side.

**Proposed Fix:**
1. **Document the constraint**: The single-session model requires sequential scope processing. This is not a bug to fix but a constraint to optimize within.
2. **Reduce time-in-lock** by:
   - Caching the current scope locally; skip `switchToScope()` API calls when already on the correct scope (see 3.4 overlap)
   - Caching `getUserSysId()` result (never changes within a session)
   - Pre-computing the update set config once before entering the lock
3. **Reduce debounce overhead**: Use a single global debounce (300ms) instead of per-scope debounce, since the lock serializes them anyway.

**Acceptance Criteria:**
- [ ] Time from file save to push completion is under 1.5 seconds for a single file in a 3-scope configuration
- [ ] Scope switching makes 0 API calls when already on the correct scope
- [ ] `getUserSysId()` is called at most once per session, not per push

---

### 3.9 Error Handling Swallows Failures Silently (P2)

**Severity:** P2 — Medium

**Affected Code (multiple locations):**
- `packages/core/src/appUtils.ts` — `getUpdateSetConfig()` (~line 42): catches JSON parse errors, returns `{}`
- `packages/core/src/FileUtils.ts` — `getFileContextFromPath()` (line 207): catches all errors, returns `undefined`
- `packages/core/src/MultiScopeWatcher.ts` — `getUpdateSetDetails()` (~line 499): returns `null` on error; `processScopeQueue()` (~line 302): catches error, logs at debug level, continues
- `packages/core/src/MultiScopeWatcher.ts` — `ensureUpdateSetForScope()` (lines 253-256): catches error, logs, continues

**Root Cause:**
Defensive catch blocks that log at debug level or swallow errors entirely. The pattern is consistent: catch → log at debug → return fallback (null, undefined, `{}`). The result is that errors are invisible unless the user runs with `--logLevel debug`, which produces overwhelming output (the debug log from today's session is 691,527 lines).

The `status` command (`commands.ts` lines 279-304) doesn't show the current update set per scope, so developers can't easily verify which update set will receive their changes.

**Proposed Fix:**
1. **Push summary**: After every push batch, print a summary: "Pushed 5/8 files to x_cadso_core. 3 files skipped: [file1 (not in manifest), file2 (table not configured), file3 (scope mismatch)]."
2. **Error escalation**: Distinguish between expected missing data (file not in manifest → info level) and unexpected errors (JSON parse failure → warn level, API failure → error level).
3. **Status enhancement**: Add current update set per scope to `sinc status` output.
4. **Corrupt config recovery**: When `.sinc-update-sets.json` has corrupt JSON, log a warning with the error and the file path, then treat as empty config (current behavior) but make the warning visible.

**Acceptance Criteria:**
- [ ] A push that skips files reports how many were skipped and why (at default log level)
- [ ] A corrupt `.sinc-update-sets.json` produces a visible warning, not silent fallback
- [ ] `sinc status` shows the current update set for each configured scope
- [ ] No errors are logged at debug-only level when they affect push correctness

---

### 3.10 Documentation Inaccuracies (P3)

**Severity:** P3 — Low

**Affected Files:**
- `Sincronia/CLAUDE.md` line 74: says "13 packages" — actual count is 16 (includes `google-auth`, `google-calendar`, `gmail`)
- `Sincronia/README.md`: still references `@sincronia/core` in some places — should be `@tenonhq/sincronia-core`
- `ServiceNow/CLAUDE.md`: references Node 16 in several places — should be Node 20 LTS
- `Sincronia/docs/sincronia-platform-spec.md`: says "16 packages" which is correct but package list may be incomplete
- `Sincronia/CLAUDE.md` "Synced Table Types" section lists 12 tables but `sinc.config.js` configures 15+ with `_tables`

**Proposed Fix:**
1. Audit all `.md` files in `Sincronia/` and `ServiceNow/` for:
   - Package count (should match `ls packages/ | wc -l`)
   - Node version references (should all say Node 20 LTS)
   - npm scope references (should all say `@tenonhq/sincronia-*`, not `@sincronia/*`)
   - Table count (should match `sinc.config.js` `_tables` array length)
2. Update the "Synced Table Types" section in CLAUDE.md to match the actual `_tables` config.
3. Add the `sinc task clear` command to CLAUDE.md once implemented (from fix 3.7).

**Acceptance Criteria:**
- [ ] Package count in all docs matches `ls packages/ | wc -l`
- [ ] All docs reference Node 20, not Node 16
- [ ] All docs reference `@tenonhq/sincronia-*`, not `@sincronia/*`
- [ ] Table list in CLAUDE.md matches `sinc.config.js` `includes._tables`

---

## Drawbacks

1. **Scope of changes**: This touches the core push path (`appUtils.ts`, `snClient.ts`), the watcher (`MultiScopeWatcher.ts`), and the dashboard (`server.js`). These are the most critical code paths in Sincronia. Risk of regression is real.

2. **Testing burden**: Many of these issues involve ServiceNow API interaction, which requires a live instance to integration-test. Unit tests with mocked responses can cover retry logic and error classification, but push-to-correct-scope requires end-to-end validation.

3. **Behavioral changes**: Adding authentication to the dashboard, changing retry timing, or surfacing warnings where there were none could break workflows that depend on current (silent) behavior. Developers may need to adapt.

4. **Time investment**: Estimated 7-10 sprint days across all 4 phases. This is time not spent on new features. However, the alternative — unreliable sync tool — costs more in developer time and deployment errors over the next quarter.

---

## Alternatives Considered

### 1. Separate ServiceNow Sessions Per Scope
Eliminate the scope lock by opening one authenticated session per scope, allowing truly parallel pushes. **Rejected**: ServiceNow may throttle or reject multiple sessions from the same user. Adds significant complexity (session management, credential handling per scope). The single-session model works correctly when serialized properly.

### 2. Queue-Based Architecture (bull/bullmq)
Replace the file-based config and lock with a proper job queue. Would solve concurrency, retry, and audit trail cleanly. **Rejected**: Over-engineered for the current team size and use case. Adds infrastructure dependency (Redis). The file-based approach works when the race conditions are fixed.

### 3. Do Nothing, Document Known Limitations
Document the issues and let developers work around them. **Rejected**: Issue 3.1 (push to wrong scope) is a data correctness problem with no workaround. Developers cannot verify which update set received their push without checking ServiceNow manually after every save.

### 4. Replace Dashboard with VS Code Extension
Would solve the auth problem natively (runs in VS Code's trusted environment). **Deferred**: Good idea for a future RFC, but doesn't address the core sync issues (3.1-3.4) which exist independent of the dashboard.

---

## Implementation Plan

### Phase 1: Critical Path Fixes (Sprint 1, ~3 days)

| Fix | Issue | Priority | Estimated Effort |
|-----|-------|----------|-----------------|
| 3.1 | Multi-scope push routes to wrong scope | P0 | 4 hours |
| 3.2 | No HTTP status differentiation in retry | P1 | 4 hours |
| 3.3 | Update set creation race condition | P1 | 4 hours |
| 3.4 | Update set not loaded after creation | P1 | 3 hours |

**Goal**: After Phase 1, pushes are correct and resilient. This is the minimum viable fix set.

**Validation**: Save files across 3 scopes simultaneously with an active ClickUp task. Verify all files land in the correct scope's update set. Trigger a 500 error (by temporarily rate limiting) and verify exponential backoff recovery.

### Phase 2: Resilience and Security (Sprint 2, ~2 days)

| Fix | Issue | Priority | Estimated Effort |
|-----|-------|----------|-----------------|
| 3.5 | Dashboard has no authentication | P2 | 2 hours |
| 3.6 | Dashboard/core rate limiters independent | P2 | 3 hours |
| 3.7 | Task ID handling fragility | P2 | 4 hours |

**Goal**: After Phase 2, the dashboard is secure and rate limiting is coordinated. Task lifecycle is managed.

**Validation**: Attempt to access dashboard from a non-localhost IP. Verify combined RPS stays under 20 with dashboard + watch active. Run `sinc task clear` and verify cleanup.

### Phase 3: Performance and UX (Sprint 3, ~2 days)

| Fix | Issue | Priority | Estimated Effort |
|-----|-------|----------|-----------------|
| 3.8 | Scope lock serializes independent scopes | P2 | 3 hours |
| 3.9 | Error handling swallows failures silently | P2 | 4 hours |

**Goal**: After Phase 3, push latency is optimized and errors are visible. `sinc status` shows full picture.

**Validation**: Measure time from file save to push completion in a 3-scope configuration. Verify push summary shows skipped files. Verify `sinc status` shows update sets per scope.

### Phase 4: Documentation (Anytime, ~0.5 days)

| Fix | Issue | Priority | Estimated Effort |
|-----|-------|----------|-----------------|
| 3.10 | Documentation inaccuracies | P3 | 2 hours |

**Goal**: All documentation matches reality.

**Validation**: Grep all `.md` files for "Node 16", "@sincronia/", "13 packages" — zero matches.

---

## Testing Strategy

### Unit Tests

| Test | Target | Validates |
|------|--------|-----------|
| `retryOnErr` with mocked 429 response | `snClient.ts` | Longer wait, honors Retry-After |
| `retryOnErr` with mocked 401 response | `snClient.ts` | Immediate failure, no retry |
| `retryOnErr` with mocked 500 response | `snClient.ts` | Exponential backoff (1s, 2s, 4s) |
| `retryOnErr` with mocked 404 response | `snClient.ts` | Immediate failure, no retry |
| `getFileContextFromPath` with missing manifest entry | `FileUtils.ts` | Warning logged with file path |
| `getUpdateSetConfig` with corrupt JSON | `appUtils.ts` | Warning logged, returns `{}` |
| `readActiveTask` with empty taskId | `MultiScopeWatcher.ts` | Returns null, not partial object |
| `readActiveTask` with 7+ day old file | `MultiScopeWatcher.ts` | Staleness warning logged |
| `generateUpdateSetName` with special characters | `server.js` | Sanitized name, no query injection |

### Integration Tests (Require ServiceNow Dev Instance)

| Test | Validates |
|------|-----------|
| Save files in 2 scopes simultaneously, query `sys_update_xml` | Each file in correct scope's update set |
| Trigger 429 from ServiceNow (exceed rate limit intentionally) | Retry with backoff, eventual success |
| Run dashboard + watch simultaneously for 5 minutes | Combined RPS never exceeds 20 |
| Create update set via dashboard, then push a file | Push lands in the dashboard-created update set |
| Create update set, kill network, restart — push a file | Verify update set is re-discovered or re-created |

### Manual QA Scenarios

| # | Scenario | Expected Result |
|---|----------|----------------|
| 1 | Start watch with 3 scopes, save a file in each scope within 2 seconds | All 3 files in correct scope-specific update sets |
| 2 | Start watch with no active task and no update set, save a file | Prominent warning displayed, file pushes to Default with explicit notice |
| 3 | Open dashboard from another machine on the network | Connection refused (localhost-only binding) |
| 4 | Run `sinc task clear`, then `sinc status` | No active task shown, `.sinc-active-task.json` removed |
| 5 | Save a file that is NOT in the manifest | Warning shows file path and reason (not in manifest) |
| 6 | Push with a corrupt `.sinc-update-sets.json` | Warning about corrupt file, pushes to Default with notice |
| 7 | Create an update set with a non-standard name (not CU- prefix) | System handles gracefully, does not crash or return wrong set |
| 8 | `sinc status` with 3 configured scopes | Shows scope name + current update set for each |
| 9 | Push a TypeScript file in `sys_script_include` — verify build pipeline | File compiled and pushed successfully, build output correct |
| 10 | Save 10 files rapidly in one scope | All 10 pushed within one debounce cycle, no duplicates |

### Regression Checklist

- [ ] Single-scope watch still works (backward compatibility)
- [ ] CLI `sinc push` works without watch mode active
- [ ] CLI `sinc push --scope x_cadso_core` targets the correct scope
- [ ] Dashboard loads and displays update sets for all configured scopes
- [ ] ClickUp task selection in dashboard creates update sets correctly
- [ ] Build pipeline (TypeScript → Babel → ESLint → Prettier) unaffected
- [ ] `sinc download <scope>` still downloads all configured tables
- [ ] `sinc refresh` still updates manifests correctly
- [ ] `sinc status` shows at least: instance URL, user, scopes

---

## Unresolved Questions

1. **What should happen when no active task and no update set exists?**
   - Option A: Block the push entirely, require explicit update set selection
   - Option B: Push to Default with a prominent warning (current behavior, but make warning visible)
   - Option C: Auto-create a timestamped update set (e.g., "Sincronia Auto — 2026-04-10")
   - **Recommendation**: Option B for now. Blocking pushes (Option A) would frustrate developers doing quick ad-hoc work. Revisit after the team has used the warning-based approach for one sprint.

2. **Should we support multiple ServiceNow sessions (one per scope)?**
   - Would eliminate the scope lock and enable true parallel pushes. Requires understanding ServiceNow's per-user session/rate-limit policy. **Deferred to a future RFC** once the single-session model is stabilized.

3. **Should the update set monitoring interval be configurable?**
   - Current: 120 seconds, not configurable. With 11 scopes, that's ~33 API calls every 2 minutes.
   - **Recommendation**: Make it configurable via `sinc.config.js` with a reasonable default (300s). Allow disabling entirely with `--noMonitoring` flag.

4. **Should the dashboard be replaced with a VS Code extension?**
   - Would solve auth natively, provide better UX, and integrate with the editor. Significant development effort.
   - **Deferred to a future RFC**. Fix the Express dashboard for now.

5. **Should push results be persisted for audit trail?**
   - A `.sinc-push-history.json` or SQLite database could track what was pushed, when, to which update set. Useful for debugging deployment issues days later.
   - **Recommendation**: Add to Phase 3 if time permits, otherwise defer.

---

## Future Possibilities

- **`sinc doctor` command**: Validates config, manifest, update set state, API connectivity, and rate limit headroom in one pass. Would catch most of the issues in this RFC before they cause problems.
- **WebSocket dashboard**: Replace polling-based update set monitoring with WebSocket events from the watcher process. Eliminates the 2-minute polling cycle entirely.
- **Per-scope rate limiting**: If ServiceNow adds per-scope rate limits in a future release, the rate limiter architecture would need to account for scope-specific budgets.
- **Push audit trail**: Persist push results to a local database for post-hoc debugging and deployment verification.
- **Automated rollback**: If a push fails after partial success (3 of 5 files pushed), offer to roll back the successful pushes to maintain atomic update behavior.

---

## Appendix A: File Reference

| File | Package | Key Functions |
|------|---------|---------------|
| `packages/core/src/appUtils.ts` | core | `pushFiles()`, `pushRec()`, `getUpdateSetConfig()`, `createAndAssignUpdateSet()` |
| `packages/core/src/snClient.ts` | core | `retryOnErr()`, `processPushResponse()`, `snClient()` factory, all ServiceNow API methods |
| `packages/core/src/MultiScopeWatcher.ts` | core | `ensureUpdateSetForScope()`, `processScopeQueue()`, `withScopeLock()`, `readActiveTask()`, `startUpdateSetMonitoring()` |
| `packages/core/src/FileUtils.ts` | core | `getFileContextFromPath()` |
| `packages/core/src/constants.ts` | core | `CONCURRENCY_PUSH`, `PUSH_RETRY_WAIT`, `PUSH_RETRIES`, `DEBOUNCE_MS` |
| `packages/core/src/updateSetCommands.ts` | core | `createUpdateSetCommand()`, `switchToUpdateSet()`, `listUpdateSetsCommand()` |
| `packages/core/src/commands.ts` | core | `statusCommand()`, `pushCommand()` |
| `packages/dashboard/server.js` | dashboard | All Express routes, `findOrCreateUpdateSet()`, `waitForRateLimit()`, `generateUpdateSetName()` |
| `packages/dashboard/public/app.js` | dashboard | Dashboard UI client |

## Appendix B: Configuration Files

| File | Location | Purpose |
|------|----------|---------|
| `sinc.config.js` | ServiceNow project root | Tables, scopes, plugins, field overrides |
| `.sinc-update-sets.json` | ServiceNow project root | Scope → update set sys_id mapping (auto-managed) |
| `.sinc-active-task.json` | ServiceNow project root | Active ClickUp task + generated update set name (auto-managed) |
| `.sinc-recent-edits.json` | ServiceNow project root | Recent file pushes for dashboard display (auto-managed) |
| `sinc.manifest.{scope}.json` | ServiceNow project root | Per-scope file manifest (auto-managed) |
| `.env` | ServiceNow project root | ServiceNow credentials (never commit) |

## Appendix C: ServiceNow REST API Endpoints Used

| Method | Endpoint | Called By | Purpose |
|--------|----------|-----------|---------|
| `GET` | `/api/cadso/claude/changeScope` | Core + Dashboard | Switch application scope |
| `GET` | `/api/cadso/claude/currentUpdateSet` | Core + Dashboard | Get current update set (optionally for a scope) |
| `GET` | `/api/cadso/claude/changeUpdateSet` | Core + Dashboard | Switch active update set |
| `POST` | `/api/cadso/claude/pushWithUpdateSet` | Core | Push record within specified update set |
| `POST` | `/api/cadso/claude/createRecord` | Core | Create new record with optional scope/update set targeting |
| `POST` | `/api/cadso/claude/deleteRecord` | Core | Delete a record |
| `GET` | `/api/sinc/sincronia/getAppList` | Core | List available application scopes |
| `GET` | `/api/sinc/sincronia/getManifest` | Core | Get file manifest for a scope |
| Various | `/api/now/table/*` | Core + Dashboard | Standard Table API for update set queries |

---

*Last updated: 2026-04-10*
*Author: Daniel (CTO) + Claude (Code Audit)*
*Status: Draft — pending review*
