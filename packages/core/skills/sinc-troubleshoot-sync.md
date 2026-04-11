# Troubleshoot Sincronia Sync Issues

## Task
$ARGUMENTS

## Instructions for Claude

### Directory Context

Sincronia commands can be run from two locations:
- **From `ServiceNow/` directory:** `npx sinc <command>`
- **From Craftsman root:** `npm run sinc:<command>` (proxy scripts)

Available root scripts: `sinc:init`, `sinc:start`, `sinc:dev`, `sinc:build`, `sinc:deploy`, `sinc:push`, `sinc:refresh`, `sinc:status`

When this skill references `npx sinc <command>`, use `npm run sinc:<command>` if working from the Craftsman root. References to "project root" mean the `ServiceNow/` directory (where `sinc.config.js`, `.env`, and manifest files live).

---

Help the user diagnose and fix Sincronia synchronization problems. Follow this systematic diagnostic approach.

### Step 1: Identify the Symptom Category

Ask the user which symptom they are experiencing (if not already clear):

- **A. Files not pushing** -- saves detected but nothing reaches ServiceNow
- **B. Authentication/connection failure** -- errors about credentials or instance
- **C. Scope mismatch** -- "scope check failed" errors
- **D. Build/transform errors** -- plugin pipeline failures
- **E. Missing files** -- files exist in ServiceNow but not locally (or vice versa)
- **F. Manifest corruption** -- strange behavior, duplicate records, wrong sys_ids

### Diagnostic A: Files Not Pushing

1. **Check dev mode is running:** `npx sinc dev` or `npx sinc watchAllScopes`
2. **Check the file is in the manifest:** Look in `sinc.manifest.json` or `sinc.manifest.<scope>.json` for the table/record/field entry. If missing, run `npx sinc refresh`.
3. **Check file extension matches a rule:** The file extension must match a `match` regex in `sinc.config.js` rules. If no rule matches, the file content is pushed as-is (no build).
4. **Check debug logs:** Look for `sincronia-debug-*.log` files in the project root.
5. **Try manual push:** `npx sinc push` to push all files and see errors.

### Diagnostic B: Authentication/Connection Failure

1. **Verify `.env` file exists** in the project root with correct values:
   ```
   SN_USER=your_username
   SN_PASSWORD=your_password
   SN_INSTANCE=your-instance.service-now.com
   ```
   - Instance should NOT have `https://` prefix or trailing slash
   - Credentials must have admin or developer role

2. **Test connection:** `npx sinc status`

3. **Check the Sincronia server scoped app** is installed on the instance. Without it, API endpoints will 404.

4. **Check for MFA/SSO:** If the instance uses MFA or SSO, basic auth may not work. You may need a local ServiceNow account.

### Diagnostic C: Scope Mismatch

Sincronia checks that your local manifest scope matches the active scope on the ServiceNow instance.

1. **Check current scope:** `npx sinc currentScope`
2. **Change scope:** `npx sinc changeScope --scope x_cadso_core`
3. **For multi-scope watch:** `npx sinc watchAllScopes` handles scope switching automatically per file.
4. **Force scope swap on push:** `npx sinc push --scopeSwap`

### Diagnostic D: Build/Transform Errors

1. **Run a local build to see errors:** `npx sinc build`
2. **Common Babel errors:**
   - "Cannot find module '@tenonhq/sincronia-remove-modules'" -- Need `npm i -D @tenonhq/sincronia-babel-plugin-remove-modules`
   - "Cannot find module '@tenonhq/sincronia-servicenow'" -- Need `npm i -D @tenonhq/sincronia-babel-preset-servicenow`
   - Note: Babel package names differ from sinc.config.js names. In Babel config, `@tenonhq/sincronia-remove-modules` refers to npm package `@tenonhq/sincronia-babel-plugin-remove-modules`.

3. **Common TypeScript errors:**
   - Type errors block the build. Fix the types or set `transpile: true` to skip type checking.
   - Missing `tsconfig.json` -- Plugin works without it but may produce unexpected output.

4. **Rhino engine errors (code works locally but fails in ServiceNow):**
   - Missing `@tenonhq/sincronia-servicenow` preset -- `__proto__` references and reserved word property access crash Rhino.
   - Using `useBuiltIns` with `@babel/env` -- Polyfills fail because Rhino locks base class prototypes.
   - Using `for...of`, `Map`, `Set`, `WeakMap` -- These require prototype extensions that Rhino blocks.
   - Using arrow functions in class properties without `@babel/proposal-class-properties`.

### Diagnostic E: Missing Files

1. **Files in ServiceNow but not local:**
   - Run `npx sinc refresh` to update the manifest and download new files.
   - Check `excludes` in `sinc.config.js` -- the table may be excluded.
   - Check `includes` -- some tables need explicit inclusion.

2. **Files local but not in ServiceNow:**
   - Records must be created in ServiceNow first, then `npx sinc refresh` to pick them up.
   - Sincronia does NOT create ServiceNow records from local files.

### Diagnostic F: Manifest Corruption

1. **Symptoms:** Wrong files being pushed, duplicate record folders, sys_id mismatches.
2. **Fix:** Delete the manifest file(s) and re-download:
   ```bash
   rm sinc.manifest*.json
   npx sinc download <scope>
   # or for multi-scope:
   npx sinc initScopes
   ```
3. **Prevention:** Never manually edit `sinc.manifest.json`. Never have duplicate record display values in the same table.

### General Tips

- Always `npx sinc refresh` before starting work to catch new records.
- Use `npx sinc status` to verify connectivity.
- Check `sincronia-debug-*.log` for detailed error information.
- Node.js v20 LTS is required -- check with `node -v`.
