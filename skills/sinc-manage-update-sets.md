# Manage ServiceNow Update Sets

## Task
$ARGUMENTS

## Instructions for Claude

Help the user manage ServiceNow update sets through Sincronia's CLI commands and dashboard.

### Available Commands

| Command | Purpose |
|---------|---------|
| `npx sinc listUpdateSets` | List all in-progress update sets |
| `npx sinc listUpdateSets --scope x_cadso_core` | List update sets for a specific scope |
| `npx sinc createUpdateSet --name "FEAT-123 New Feature"` | Create and activate a new update set |
| `npx sinc createUpdateSet --name "FEAT-123" --scope x_cadso_core --description "Feature description"` | Create with scope and description |
| `npx sinc switchUpdateSet --name "FEAT-123"` | Switch to an existing update set (partial name match) |
| `npx sinc switchUpdateSet --scope x_cadso_core` | Browse and select from a scope's update sets |
| `npx sinc currentUpdateSet` | Show the currently active update set |
| `npx sinc currentScope` | Show the currently active scope |
| `npx sinc changeScope --scope x_cadso_work` | Switch to a different scope |

### Push with Update Set

Create a new update set as part of a push operation:

```bash
npx sinc push --updateSet "FEAT-123 My Changes"
# or short form:
npx sinc push --us "FEAT-123 My Changes"
```

This creates the update set, assigns it as current, and pushes all files into it.

### Web Dashboard

Sincronia includes a web dashboard for visual update set management:

```bash
npx sinc dashboard
```

Launches at `http://localhost:3456` (configurable via `DASHBOARD_PORT` in `.env`). Features:
- All configured scopes with display names
- In-progress update sets per scope
- Create new update sets
- Close (complete) update sets
- Select active update set per scope

The dashboard reads scopes from `sinc.config.js` and stores selections in `.sinc-update-sets.json`.

### Multi-Scope Update Set Monitoring

When using `npx sinc watchAllScopes`, update set status is automatically checked every 2 minutes. It warns if any scope is using the DEFAULT update set (a common mistake that puts changes in the wrong place).

### Recommended Workflow

1. **Before starting work:** Create a named update set for your feature/ticket:
   ```bash
   npx sinc createUpdateSet --name "FEAT-123 Add User Dashboard" --scope x_cadso_core
   ```

2. **During development:** Use `npx sinc dev` or `npx sinc watchAllScopes`. Changes go into the active update set.

3. **Check status:** `npx sinc currentUpdateSet` to verify you are in the right update set.

4. **When done:** Complete the update set in ServiceNow or via the dashboard.

5. **For deployment:** Use `npx sinc push --us "RELEASE-1.0"` to push all changes into a clean update set.

### Common Issues

- **"No update set selected"** -- You are using the Default update set. Create or switch to a named one.
- **Changes going to wrong scope** -- In multi-scope mode, use `npx sinc watchAllScopes` which auto-switches scopes. Single-scope `npx sinc dev` only works for one scope.
- **Update set not found** -- Check the scope filter. Update sets are scope-specific.
