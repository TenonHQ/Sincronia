# Set Up Sincronia Project

## Task
$ARGUMENTS

## Instructions for Claude

### Directory Context

Sincronia commands can be run from two locations:
- **From `ServiceNow/` directory:** `npx sinc <command>`
- **From Craftsman root:** `npm run sinc:<command>` (proxy scripts)

Available root scripts: `sinc:init`, `sinc:start`, `sinc:dev`, `sinc:build`, `sinc:deploy`, `sinc:push`, `sinc:refresh`, `sinc:status`

When this skill references `npx sinc <command>`, use `npm run sinc:<command>` if working from the Craftsman root. Configuration files (`sinc.config.js`, `.env`, manifests) live in the `ServiceNow/` directory.

---

Help the user set up a new Sincronia project or add a new scope to an existing project.

### Determine the Scenario

1. **New project from scratch** -- No `sinc.config.js` exists yet
2. **Add a new scope to existing project** -- `sinc.config.js` exists, need to add scope config
3. **Re-initialize / reset** -- Project exists but needs fresh download

### Scenario 1: New Project

#### Prerequisites check
- Node.js v20 LTS installed (`node -v`)
- The Sincronia server scoped app is installed on the target ServiceNow instance

#### Initialize the project
```bash
mkdir my-servicenow-app && cd my-servicenow-app
npm init -y
npm i -D @tenonhq/sincronia-core
```

#### Run the init wizard
```bash
npx sinc init
```
Prompts for: instance URL, username, password, and which scoped app to download.

#### Configure the build pipeline
Direct the user to use the `configure-pipeline` skill or help inline.

#### Set up `.env`
```
SN_USER=admin
SN_PASSWORD=your_password
SN_INSTANCE=your-instance.service-now.com
```
- Instance should NOT have `https://` prefix or trailing slash
- Optional: `DASHBOARD_PORT=3456`
- **Never commit `.env` to git**

#### Set up `.gitignore`
```
node_modules/
.env
build/
sinc.manifest*.json
sincronia-debug-*.log
```

#### Start development
```bash
npx sinc dev
```

### Scenario 2: Add a New Scope (Multi-Scope Setup)

#### Add the scope to `sinc.config.js`
```javascript
module.exports = {
  sourceDirectory: "src",
  buildDirectory: "build",
  rules: [ /* ... */ ],
  scopes: {
    x_cadso_core: {
      sourceDirectory: "src/x_cadso_core"
    },
    x_cadso_work: {
      sourceDirectory: "src/x_cadso_work"
    }
  }
};
```

#### Download all scopes
```bash
npx sinc initScopes
```
Creates per-scope manifest files (`sinc.manifest.x_cadso_core.json`, etc.) and downloads files to each scope's source directory.

If hitting rate limits:
```bash
npx sinc initScopes --delay 1000
```

#### Watch all scopes simultaneously
```bash
npx sinc watchAllScopes
```
Watches all scope directories, auto-switches ServiceNow scope context per file, monitors update set status every 2 minutes.

#### Download a single scope
```bash
npx sinc download x_cadso_core
```

### Scenario 3: Reset / Re-download

1. Back up any local changes (commit to git)
2. Run: `npx sinc download <scope>` (destructive -- overwrites local files)
3. Or for all scopes: `npx sinc initScopes`

### File Structure After Setup

```
project/
  .env                              # Credentials (git-ignored)
  sinc.config.js                    # Build pipeline config
  sinc.manifest.json                # Single-scope manifest
  sinc.manifest.x_cadso_core.json   # Multi-scope manifest
  src/
    x_cadso_core/
      sys_script_include/
        MyScriptInclude/
          script.ts
      sys_ui_page/
        MyUIPage/
          html.html
          client_script.js
    x_cadso_work/
      ...
  build/                            # Built output (git-ignored)
  node_modules/                     # Dependencies (git-ignored)
```

### Commands Reference

| Command | Purpose |
|---------|---------|
| `npx sinc init` | Interactive project setup |
| `npx sinc initScopes` | Download all configured scopes |
| `npx sinc download <scope>` | Download a specific scope (destructive) |
| `npx sinc refresh` | Refresh manifest, download new files only |
| `npx sinc dev` | Start single-scope watch mode |
| `npx sinc watchAllScopes` | Start multi-scope watch mode |
| `npx sinc status` | Show connected instance, scope, user |
