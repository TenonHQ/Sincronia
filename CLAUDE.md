# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sincronia is a powerful development tool that enables modern ServiceNow development workflows. It provides bidirectional synchronization between your local development environment and ServiceNow instances, allowing developers to use modern tools like Git, TypeScript, Babel, and Webpack while working with ServiceNow code.

## Essential Commands

### Installation and Setup

```bash
# Node.js v20 LTS required
nvm use 20

# Install Sincronia globally
npm install -g @sincronia/cli

# Initialize a new project
sinc init

# Configure ServiceNow instance
sinc configure
```

### Development Commands

```bash
# Watch for changes and sync automatically
sinc watch
sinc watchAllScopes      # Watch all configured scopes

# Manual sync operations
sinc push                # Push local changes to ServiceNow
sinc pull                # Pull changes from ServiceNow
sinc refresh             # Full refresh from ServiceNow

# Development workflow
sinc dev                 # Start development mode
sinc build               # Build for production
sinc deploy              # Deploy to ServiceNow

# Status and debugging
sinc status              # Check sync status
sinc diff                # Show differences
```

## Architecture

### Core Components

Sincronia is a Lerna monorepo with multiple packages:

- **@sincronia/cli** - Command-line interface
- **@sincronia/core** - Core synchronization logic
- **@sincronia/types** - TypeScript type definitions
- **Build plugins** - Webpack, Babel, TypeScript support

### How It Works

1. **File Watching**: Monitors local files for changes
2. **Transformation**: Applies build pipelines (TypeScript, Babel)
3. **Synchronization**: Pushes/pulls changes to/from ServiceNow
4. **Manifest Management**: Tracks file mappings and configurations

## File Organization

```
Sincronia/
├── packages/              # Lerna packages
│   ├── cli/              # CLI implementation
│   ├── core/             # Core sync logic
│   └── types/            # TypeScript definitions
├── docs/                 # Documentation
├── examples/             # Example configurations
├── lerna.json           # Lerna configuration
├── package.json         # Root package
└── README.md            # Main documentation
```

## Development Guidelines

### Configuration Files

#### sinc.config.js

```javascript
module.exports = {
  instance: "your-instance.service-now.com",
  username: process.env.SN_USERNAME,
  password: process.env.SN_PASSWORD,
  scopes: ["x_cadso_core", "x_cadso_work"],
  plugins: [
    // Add build plugins here
  ]
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

Sincronia supports modern JavaScript tooling:

- **TypeScript**: Full type checking and transpilation
- **Babel**: Modern JavaScript syntax support
- **Webpack**: Module bundling and optimization
- **ESLint**: Code quality enforcement
- **Prettier**: Code formatting

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

1. Initialize configuration: `sinc init`
2. Configure instance: `sinc configure`
3. Set up manifest: `sinc pull --scope x_cadso_core`
4. Start development: `sinc watch`

### Managing Multiple Scopes

```bash
# Work with specific scope
sinc push --scope x_cadso_work

# Watch multiple scopes
sinc watchAllScopes

# Refresh specific scope
sinc refresh --scope x_cadso_core
```

### Debugging Sync Issues

1. Check debug logs: `sincronia-debug-*.log`
2. Verify manifest: `sinc status`
3. Test connection: `sinc test-connection`
4. Review diffs: `sinc diff`

### Handling Conflicts

- Use `sinc diff` to review changes
- Back up before major operations
- Use `--force` flag carefully
- Maintain clean Git history

## Best Practices

### Development Workflow

1. **Pull First**: Always `sinc refresh` before starting work
2. **Watch Mode**: Use `sinc watch` during development
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
   - Use `sinc diff` to investigate

3. **Build Errors**
   - Verify Node.js version (20 LTS)
   - Check plugin configurations
   - Review TypeScript settings

4. **Performance Issues**
   - Reduce watched scopes
   - Optimize build pipeline
   - Clear cache if needed

## Notes

- **Version Requirement**: Node.js v20 LTS required
- **Instance Access**: Requires admin or developer role
- **Manifest Files**: Critical for tracking synchronization
- **Async Nature**: All operations are asynchronous
- **Rate Limiting**: Respect ServiceNow API limits