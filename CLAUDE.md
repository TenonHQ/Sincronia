# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sincronia is a powerful development tool that enables modern ServiceNow development workflows. It provides bidirectional synchronization between your local development environment and ServiceNow instances, allowing developers to use modern tools like Git, TypeScript, Babel, and Webpack while working with ServiceNow code.

## Essential Commands

### Installation and Setup

```bash
# Node.js v20 LTS required
nvm use 20

# Create project and install as dev dependency
mkdir my-sincronia-project && cd my-sincronia-project
npm init
npm i -D @tenonhq/sincronia-core

# Initialize project (creates sinc.config.js)
npx sinc init

# Configure ServiceNow instance (creates .env — do not commit)
npx sinc configure
```

### Development Commands

```bash
# Watch all scopes for changes and sync automatically
npx sinc watch               # Multi-scope watch (aliases: w, watchAllScopes)
npx sinc watch --port 3457   # Custom dashboard port (for multiple sessions)
npx sinc watch --noDashboard # Watch without launching the dashboard

# Manual sync operations
npx sinc push                # Push local changes to ServiceNow
npx sinc refresh             # Refresh manifest and download new files
npx sinc download <scope>    # Download a full scope from ServiceNow

# Build and deploy
npx sinc build               # Build application files locally
npx sinc deploy              # Deploy local build to ServiceNow

# Status and debugging
npx sinc status              # Check sync status and instance info

# Scope and update set management
npx sinc initScopes          # Initialize all scopes from config
npx sinc createUpdateSet     # Create a new update set
npx sinc switchUpdateSet     # Switch to an existing update set
npx sinc listUpdateSets      # List in-progress update sets
npx sinc currentUpdateSet    # Show the current active update set
npx sinc changeScope         # Change to a different scope
npx sinc currentScope        # Show the current active scope

# Record management
npx sinc create <table>      # Create a new record
npx sinc delete <table>      # Delete a record

# Tools
npx sinc dashboard           # Launch the Update Set Dashboard web UI
npx sinc dashboard --port 3457  # Dashboard on custom port
npx sinc schema pull         # Pull ServiceNow table schemas
npx sinc init-claude         # Install Claude Code skills
npx sinc clickup             # ClickUp task management (subcommands: tasks, task, create, update, comment, teams, setup, spaces, lists)
```

## Architecture

### Core Components

Sincronia is a Lerna monorepo with 13 packages (all published under `@tenonhq/sincronia-*`):

- **sincronia-core** — CLI + core synchronization logic (the `sinc` binary)
- **sincronia-types** — TypeScript type definitions
- **sincronia-babel-plugin** — Babel plugin
- **sincronia-babel-plugin-remove-modules** — Strips imports/exports for ServiceNow
- **sincronia-babel-preset-servicenow** — ServiceNow sanitizer preset
- **sincronia-typescript-plugin** — TypeScript compilation plugin
- **sincronia-webpack-plugin** — Webpack module bundling
- **sincronia-sass-plugin** — SASS/SCSS compilation
- **sincronia-eslint-plugin** — ESLint code quality
- **sincronia-prettier-plugin** — Prettier formatting
- **sincronia-clickup** — ClickUp API client for task management
- **sincronia-dashboard** — Update Set Dashboard web UI
- **sincronia-schema** — ServiceNow table schema fetcher

### How It Works

1. **File Watching**: Monitors local files for changes
2. **Transformation**: Applies build pipelines (TypeScript, Babel)
3. **Synchronization**: Pushes/pulls changes to/from ServiceNow
4. **Manifest Management**: Tracks file mappings and configurations

## File Organization

```
Sincronia/
├── packages/                          # Lerna packages (13 packages)
│   ├── core/                          # CLI + core sync logic
│   ├── types/                         # TypeScript definitions
│   ├── babel-plugin/                  # Babel plugin
│   ├── babel-plugin-remove-modules/   # Import/export removal
│   ├── babel-preset-servicenow/       # ServiceNow sanitizer
│   ├── typescript-plugin/             # TypeScript plugin
│   ├── webpack-plugin/                # Webpack plugin
│   ├── sass-plugin/                   # SASS/SCSS plugin
│   ├── eslint-plugin/                 # ESLint plugin
│   ├── prettier-plugin/               # Prettier plugin
│   ├── clickup/                       # ClickUp API client
│   ├── dashboard/                     # Update Set Dashboard UI
│   └── schema/                        # ServiceNow schema fetcher
├── docs/                              # QA documentation
├── skills/                            # Claude Code skills for Sincronia workflows
├── Scripts/                           # Version bump scripts
├── CHANGELOG.md                       # Release history
├── tsconfig.json                      # TypeScript configuration
├── lerna.json                         # Lerna configuration
├── package.json                       # Root package
└── README.md                          # Main documentation
```

## Config Architecture

**`sinc.config.js` is the single source of truth.** There are no hidden defaults.

- `defaultOptions.ts` exports empty objects — it was intentionally cleared. Do not add defaults back.
- The `_` prefix convention: keys starting with `_` are config directives, not table names.
  - `includes._tables` — whitelist of tables to sync (only these get written to disk)
  - `includes._scopes` — per-scope overrides (additional tables, field type overrides)
  - `excludes._tables` — tables to explicitly exclude
- Non-prefixed keys in `includes` are table names with field type overrides (e.g. `sys_ux_macroponent: { composition: { type: "json" } }`)
- Client-side filtering enforces the whitelist — ServiceNow returns all tables in a scope, but only `_tables` entries get written to disk
- Legacy default excludes (26 tables removed during overhaul) are preserved in Claude memory for reference

## Development Guidelines

### Configuration Files

#### sinc.config.js

```javascript
module.exports = {
  sourceDirectory: "src",
  buildDirectory: "build",
  includes: {
    _tables: ["sys_script_include", "sys_script", ...],
    sys_ux_macroponent: { composition: { type: "json" } },
    _scopes: {
      x_cadso_automate: {
        _tables: ["x_cadso_core_setting"],  // additional tables for this scope
      }
    }
  },
  excludes: { _tables: [] },
  scopes: {
    x_cadso_core: { sourceDirectory: "src/x_cadso_core" },
  }
};
```

#### sinc.manifest.json

```json
{
  "version": "1.0.0",
  "files": {
    "sys_script_include/FileName.js": {
      "table": "sys_script_include",
      "sysId": "abc123def456",
      "field": "script"
    }
  }
}
```

### Synced Table Types

Sincronia synchronizes 12 ServiceNow table types:

`sys_script_include`, `sys_script`, `sys_ui_script`, `sys_ui_page`, `sys_ux_client_script`, `sys_processor`, `sys_ws_operation`, `sys_rest_message_fn`, `sys_ui_action`, `sys_security_acl`, `sysevent_script_action`, `sys_ux_macroponent`

See [ServiceNow/CLAUDE.md](../ServiceNow/CLAUDE.md) for the full table inventory.

### Build Pipeline Configuration

Sincronia supports modern JavaScript tooling via dedicated plugin packages:

- **TypeScript**: Full type checking and transpilation (`@tenonhq/sincronia-typescript-plugin`)
- **Babel**: Modern JavaScript syntax support (`@tenonhq/sincronia-babel-plugin`)
- **Babel Remove Modules**: Strips imports/exports for ServiceNow compatibility (`@tenonhq/sincronia-babel-plugin-remove-modules`)
- **Babel Preset ServiceNow**: Sanitizes code for the ServiceNow platform (`@tenonhq/sincronia-babel-preset-servicenow`)
- **Webpack**: Module bundling and optimization (`@tenonhq/sincronia-webpack-plugin`)
- **SASS**: SASS/SCSS stylesheet compilation (`@tenonhq/sincronia-sass-plugin`)
- **ESLint**: Code quality enforcement (`@tenonhq/sincronia-eslint-plugin`)
- **Prettier**: Code formatting (`@tenonhq/sincronia-prettier-plugin`)

### Plugin System

Create custom plugins for build transformations:

```javascript
module.exports = {
  name: "my-plugin",
  transform: async (source, path) => {
    // Transform source code
    return transformedSource;
  }
};
```

## Integration Points

### ServiceNow Connection

- Uses REST API for synchronization
- Supports multiple instance configurations
- Handles authentication securely
- Manages scope-based permissions

### Server-Side REST API ("Claude")

Sincronia's server-side operations are exposed via a **global-scoped Scripted REST API** named **"Claude"** on ServiceNow.

- **Base path:** `/api/cadso/claude/`
- **Web service definition sys_id:** `b8a9db8d33d7a6107b18bc534d5c7b7b`
- **Scope:** Global
- **Auth:** Requires authentication + `snc_internal_role`

#### Operations

| Method | Path | Name | Description |
|--------|------|------|-------------|
| `GET` | `/changeScope` | Change Scope | Switches current application scope. Query param: `scope` (scope name, e.g. `x_cadso_core`). |
| `GET` | `/currentUpdateSet` | Current Update Set | Returns the current update set. Optional query param: `scope` (temporarily switches scope before reading). |
| `GET` | `/changeUpdateSet` | Change Update Set | Switches the active update set. Query params: `sysId` (direct), or `name` + `scope` (lookup by name within scope, most recent in-progress). |
| `POST` | `/pushWithUpdateSet` | Push with Update Set | Updates a record within a specified update set. Body: `{ update_set_sys_id, table, record_sys_id, fields }`. Saves/restores the previous update set around the operation. |
| `POST` | `/createRecord` | Sinc - Create Record | Creates a new record. Body: `{ table, fields }` (required), `{ sys_id, scope, update_set_sys_id }` (optional). Supports cross-instance moves via explicit `sys_id` and scope targeting. |
| `POST` | `/deleteRecord` | Sinc - Delete Record | Deletes a record. Body: `{ table, sys_id }`. Returns the display name of the deleted record on success. |

#### Notes

- All POST operations accept and return `application/json`.
- Update set operations save and restore the previous update set to avoid side effects.
- The `createRecord` endpoint supports setting a specific `sys_id` via `setNewGuidValue()` for cross-instance record moves.
- Source XML export is stored at: `Downloads/sys_ws_operation (web_service_definition=b8a9db8d33d7a6107b18bc534d5c7b7b)*.xml`

### Related Directories

- **ServiceNow/** - Main application code synced by Sincronia
- **ServiceNowTypes/** - TypeScript definitions for ServiceNow APIs
- **Tables/** - Database schema definitions

## Common Tasks

### Setting Up New Project

1. Install as dev dependency: `npm i -D @tenonhq/sincronia-core`
2. Initialize configuration: `npx sinc init`
3. Configure instance: `npx sinc configure`
4. Set up manifest: `npx sinc pull --scope x_cadso_core`
5. Start development: `npx sinc watch` (watches all configured scopes)

### Managing Multiple Scopes

```bash
# Watch all scopes simultaneously
npx sinc watch

# Work with specific scope
npx sinc push --scope x_cadso_work

# Refresh specific scope
npx sinc refresh --scope x_cadso_core
```

### Debugging Sync Issues

1. Check debug logs: `sincronia-debug-*.log`
2. Verify manifest: `npx sinc status`
3. Test connection: `npx sinc test-connection`
4. Review diffs: `npx sinc diff`

### Handling Conflicts

- Use `npx sinc diff` to review changes
- Back up before major operations
- Use `--force` flag carefully
- Maintain clean Git history

## Best Practices

### Development Workflow

1. **Pull First**: Always `npx sinc refresh` before starting work
2. **Watch Mode**: Use `npx sinc watch` during development
3. **Commit Often**: Regular Git commits for version control
4. **Test Locally**: Validate changes before pushing
5. **Document Changes**: Update manifests and documentation

### Performance Optimization

- Use selective scope watching
- Configure ignore patterns
- Optimize build plugins
- Cache ServiceNow responses

### Security Considerations

- Never commit credentials
- Use environment variables
- Rotate passwords regularly
- Limit scope permissions

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify credentials in environment variables
   - Check instance URL format
   - Confirm user permissions

2. **Sync Conflicts**
   - Review `sinc.manifest.json`
   - Check for concurrent edits
   - Use `npx sinc diff` to investigate

3. **Build Errors**
   - Verify Node.js version (20 LTS)
   - Check plugin configurations
   - Review TypeScript settings

4. **Performance Issues**
   - Reduce watched scopes
   - Optimize build pipeline
   - Clear cache if needed

## Design Document

The comprehensive Sincronia design document lives at [`Development/docs/sincronia-design-doc.md`](../../docs/sincronia-design-doc.md). It covers:

- **What Sincronia is** — Integration platform and Claude Code's action layer (not just a SN dev tool)
- **What we built** — Detailed breakdown of all 16 packages, APIs, and usage
- **What we intend to build** — Automated deployment pipeline, ATF test execution, app certification prep, cross-environment code movement
- **Design principles** — Package pattern, read+write with gates, npm-first distribution
- **Technical debt** — Lerna upgrade, Node 22, test coverage, typing gaps

Read this before making architectural decisions or adding new packages.

## Notes

- **Version Requirement**: Node.js v20 LTS required
- **Instance Access**: Requires admin or developer role
- **Manifest Files**: Critical for tracking synchronization
- **Async Nature**: All operations are asynchronous
- **Rate Limiting**: Respect ServiceNow API limits