# Debug Logging for metaData.json Generation

## Overview
Comprehensive console.log statements have been added to debug why metaData.json files are not being generated in the Sincronia application.

## Files Modified

### 1. `/src/AppUtils.ts`
- **processFilesInManRec()**: Logs all incoming files, checks for metadata files, tracks metadata file creation and writing
- **processManifest()**: Logs manifest scope, table counts, and processing flow
- **processMissingFiles()**: Logs missing files found and files fetched from ServiceNow
- **syncManifest()**: Logs the sync process including scope and manifest fetching

### 2. `/src/FileUtils.ts`
- **writeSNFileCurry()**: Logs every file write operation with special detection for metadata files
- **writeManifestFile()**: Logs manifest file writing operations
- **writeScopeManifest()**: Logs scope-specific manifest writes

### 3. `/src/snClient.ts`
- **getManifest()**: Logs the API request to ServiceNow including whether files should be downloaded
- **getMissingFiles()**: Logs the bulk download request details
- **unwrapSNResponse()**: Logs the response structure for manifest and bulk download operations

### 4. `/src/commands.ts`
- **downloadCommand()**: Logs the entire download flow and checks for metadata files in the manifest
- **refreshCommand()**: Logs the refresh process

## Key Debug Points

### 1. Incoming Data from ServiceNow
The logs will show:
- Whether metadata files are included in the ServiceNow manifest response
- The structure and content of files received from ServiceNow
- File names, types, and content presence

### 2. File Processing
The logs will track:
- When metadata files are created programmatically
- The exact path where files are written
- Success/failure of file write operations
- Verification that metadata files exist on disk after writing

### 3. Special Metadata Detection
Any file with:
- Name containing "metadata" or "meta" (case-insensitive)
- Name exactly "metaData" with type "json"
Will trigger special logging marked with `*** METADATA FILE ***`

## How to Use the Debug Logs

### Running a Download Command
```bash
npx sinc download --scope [scope_name]
```

Look for these key log sections:
1. `=== downloadCommand DEBUG START ===` - Shows the command initiation
2. `=== getManifest DEBUG ===` - Shows the API request to ServiceNow
3. `=== unwrapSNResponse DEBUG (Manifest) ===` - Shows what ServiceNow returned
4. `=== processManifest DEBUG START ===` - Shows manifest processing
5. `=== processFilesInManRec DEBUG START ===` - Shows individual record processing
6. `*** METADATA FILE DETECTED ***` - Special marker for metadata files

### Running a Refresh Command
```bash
npx sinc refresh
```

Look for:
1. `=== refreshCommand DEBUG START ===`
2. `=== syncManifest DEBUG START ===`
3. `=== processMissingFiles DEBUG START ===` - Shows missing file detection and fetching

## What to Check

### Scenario 1: Metadata files not coming from ServiceNow
Look for:
- "Metadata file found in incoming files? NO" in processFilesInManRec
- "Total metadata files found in manifest: 0" in downloadCommand

This means ServiceNow is not sending metadata files and they need to be created locally.

### Scenario 2: Metadata files created but not written
Look for:
- "Creating metadata file:" followed by the file details
- "Writing metadata file to:" with the path
- Check if "✓ File written successfully:" appears for metaData.json

### Scenario 3: Metadata files written but disappearing
Look for:
- "*** METADATA FILE VERIFICATION: File exists on disk = false ***"
This would indicate the file was written but immediately deleted or couldn't be verified.

## Expected Behavior

Based on the current code, the system should:
1. Create a metaData.json file for EVERY record processed
2. The file should contain: `{ "_lastUpdatedOn": "<ISO timestamp>" }`
3. The file should be written before regular files
4. The metadata file is NOT included in the manifest (only regular files are)

## Troubleshooting Steps

1. Run the command with debug logs enabled
2. Search the console output for "METADATA" to find all metadata-related logs
3. Check if metadata files are:
   - Coming from ServiceNow (unlikely based on code review)
   - Being created programmatically (should happen always)
   - Being written to disk successfully
   - Existing after the command completes

4. If files are not being created, check:
   - Is processFilesInManRec being called?
   - Are there any errors in the write operation?
   - Is the forceWrite parameter affecting the behavior?

## Next Steps

After running with these debug logs:
1. Share the console output focusing on sections with "METADATA" or "metaData"
2. Check if metaData.json files exist in the expected directories
3. If files are missing, the logs will pinpoint exactly where in the flow the issue occurs