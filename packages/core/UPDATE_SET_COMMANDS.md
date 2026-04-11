# Update Set Management Commands for Sincronia

This document describes the new update set management commands added to the Sincronia core package.

## Commands Overview

Three new commands have been added to manage ServiceNow update sets directly from the command line:

1. **`createUpdateSet`** - Create a new update set and automatically switch to it
2. **`switchUpdateSet`** - Switch to an existing update set
3. **`listUpdateSets`** - List all in-progress update sets

## Installation

These commands are included in the `@tenonhq/sincronia-core` package. Ensure you have the latest version installed.

## Prerequisites

- Node.js v20 LTS or higher (use `nvm use 20`)
- ServiceNow instance credentials configured in environment variables:
  - `SN_INSTANCE` - Your ServiceNow instance URL
  - `SN_USER` - Your ServiceNow username
  - `SN_PASSWORD` - Your ServiceNow password

## Command Usage

### Create Update Set

Create a new update set and automatically switch to it:

```bash
npx sinc createUpdateSet
```

#### Options:
- `-n, --name <name>` - Name of the update set to create
- `-d, --description <description>` - Description of the update set
- `-s, --scope <scope>` - Scope for the update set (e.g., x_company_app)
- `--skipDescription` - Skip prompting for description
- `--skipScope` - Skip prompting for scope
- `--logLevel <level>` - Set log level (default: info)

#### Examples:

Interactive mode (prompts for details):
```bash
npx sinc createUpdateSet
```

Create with all parameters:
```bash
npx sinc createUpdateSet -n "Feature XYZ Updates" -d "Adding new functionality for XYZ" -s x_company_app
```

Create with just a name:
```bash
npx sinc createUpdateSet -n "Quick Fix" --skipDescription --skipScope
```

### Switch Update Set

Switch to an existing update set:

```bash
npx sinc switchUpdateSet
```

#### Options:
- `-n, --name <name>` - Name or partial name of the update set to switch to
- `-s, --scope <scope>` - Filter update sets by scope
- `--logLevel <level>` - Set log level (default: info)

#### Examples:

Interactive mode (shows list to select from):
```bash
npx sinc switchUpdateSet
```

Switch by partial name match:
```bash
npx sinc switchUpdateSet -n "Feature XYZ"
```

Switch to update set in specific scope:
```bash
npx sinc switchUpdateSet -s x_company_app
```

### List Update Sets

List all in-progress update sets:

```bash
npx sinc listUpdateSets
```

#### Options:
- `-s, --scope <scope>` - Filter update sets by scope
- `--logLevel <level>` - Set log level (default: info)

#### Examples:

List all in-progress update sets:
```bash
npx sinc listUpdateSets
```

List update sets for a specific scope:
```bash
npx sinc listUpdateSets -s x_company_app
```

## Features

### Smart Name Matching
The `switchUpdateSet` command supports partial name matching:
- If an exact match is found, it's selected automatically
- If only one partial match exists, it's selected automatically
- If multiple matches exist, you'll be prompted to select from a list

### Current Update Set Indicator
When listing update sets, the currently active update set is highlighted with a green arrow (►) indicator.

### Multi-Scope Support
All commands support filtering by scope, making it easy to manage update sets across different applications.

### Error Handling
- Clear error messages when scopes or update sets are not found
- Graceful handling of authentication issues
- Validation of required parameters

## Integration with Existing Commands

The update set commands integrate seamlessly with existing Sincronia commands:

### Push Command with Update Set
The existing `push` command already supports creating an update set:
```bash
npx sinc push --updateSet "My Changes"
```

### Workflow Example

1. Create a new update set for your feature:
```bash
npx sinc createUpdateSet -n "Feature ABC Implementation"
```

2. Make your code changes locally

3. Push changes to ServiceNow (they'll be captured in the active update set):
```bash
npx sinc push
```

4. Switch to a different update set for a quick fix:
```bash
npx sinc switchUpdateSet -n "Emergency Fix"
```

5. List all your in-progress work:
```bash
npx sinc listUpdateSets
```

## Technical Implementation

### Files Modified/Created:
- `src/updateSetCommands.ts` - New file containing all update set command implementations
- `src/commander.ts` - Updated to register the new commands
- `src/snClient.ts` - Updated to expose the axios client for custom API calls

### API Endpoints Used:
- `api/now/table/sys_update_set` - Update set CRUD operations
- `api/now/table/sys_user_preference` - User preference management for current update set
- `api/now/table/sys_scope` - Scope lookups
- `api/now/table/sys_user` - User lookups

### Key Functions:
- `createUpdateSetCommand()` - Main command handler for creating update sets
- `switchUpdateSetCommand()` - Main command handler for switching update sets
- `listUpdateSetsCommand()` - Main command handler for listing update sets
- `getUpdateSets()` - Helper to query update sets from ServiceNow
- `getCurrentUpdateSetId()` - Helper to get the current active update set
- `switchToUpdateSet()` - Helper to switch the active update set

## Troubleshooting

### "No server configured" Error
Ensure your environment variables are set:
```bash
export SN_INSTANCE=your-instance.service-now.com
export SN_USER=your.username
export SN_PASSWORD=your-password
```

### "Scope not found" Error
Verify the scope name is correct. Use the full scope name (e.g., `x_company_app`), not the display name.

### Authentication Issues
- Verify your credentials are correct
- Check if your account has the necessary permissions to manage update sets
- Ensure your ServiceNow instance is accessible

## Future Enhancements

Potential future improvements could include:
- Support for completing/closing update sets
- Batch operations on multiple update sets
- Update set conflict detection
- Export/import update set functionality
- Integration with Git commits to auto-create update sets