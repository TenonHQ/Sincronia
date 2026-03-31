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