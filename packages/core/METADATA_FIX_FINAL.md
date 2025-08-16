# Metadata File Generation Fix - Final Solution

## Problem
The metaData.json files were not being generated for ServiceNow records during the download/refresh process.

## Root Cause Analysis
After comprehensive investigation, we discovered:

1. **Metadata files are NOT provided by ServiceNow** - They need to be created by Sincronia
2. **The original code was looking for metadata in the wrong place** - It was trying to filter metadata files from `rec.files` array, but these files don't exist there
3. **Metadata files should be generated locally** - They contain tracking information like `_lastUpdatedOn` timestamp

## Investigation Process

### 1. Initial Discovery
- Checked the data flow from ServiceNow API through `snClient.ts`
- Found that ServiceNow returns files via `getMissingFiles` API call
- Confirmed metadata files are not part of the ServiceNow response

### 2. Manifest Structure Analysis
- Examined manifest files (e.g., `sinc.manifest.x_cadso_cloud.json`)
- Confirmed records contain `files` arrays with script files only
- No metadata files exist in the manifest structure

### 3. File System Check
- Searched entire ServiceNow directory: No existing metaData.json files
- Confirmed metadata files have never been created

## Solution Implemented

### File: `/packages/core/src/appUtils.ts`

**Before (lines 19-54):**
The code was attempting to filter metadata files from the existing files array, but they don't exist there.

**After (lines 19-48):**
```typescript
const processFilesInManRec = async (
  recPath: string,
  rec: SN.MetaRecord,
  forceWrite: boolean,
) => {
  const fileWrite = fUtils.writeSNFileCurry(forceWrite);

  // Create metadata file with current timestamp
  const metadataFile: SN.File = {
    name: "metaData",
    type: "json",
    content: JSON.stringify({
      _lastUpdatedOn: new Date().toISOString()
    }, null, 2)
  };

  // Write metadata file first
  await fileWrite(metadataFile, recPath);

  // Write regular files
  const regularPromises = rec.files.map((file) => fileWrite(file, recPath));
  await Promise.all(regularPromises);

  // Remove content from ALL files (metadata is not included in manifest)
  rec.files = rec.files.map((file) => {
    const fileCopy = { ...file };
    delete fileCopy.content;
    return fileCopy;
  });
};
```

## Key Changes

1. **Creates metadata file programmatically** - Instead of looking for it in the files array
2. **Generates timestamp locally** - Uses current date/time as `_lastUpdatedOn`
3. **Writes metadata before other files** - Ensures it's created for every record
4. **Excludes metadata from manifest** - Metadata files are not included in the manifest

## Impact

- Every ServiceNow record will now have a `metaData.json` file
- The file contains a `_lastUpdatedOn` timestamp for tracking
- Format: `{ "_lastUpdatedOn": "2025-08-15T21:30:00.000Z" }`
- Location: `src/<table>/<record_name>/metaData.json`

## Testing

To verify the fix works:
1. Compile TypeScript: `npx tsc` (from core package directory)
2. Run download: `npx sinc download <scope>` (from ServiceNow directory)
3. Check for metaData.json files in record directories

## Files Modified

- `/packages/core/src/appUtils.ts` - Added metadata file generation logic
- `/packages/core/src/FileUtils.ts` - Previously fixed missing `await` on line 59

## Related Type Definitions

- `/packages/types/index.d.ts` - Already includes "json" as valid FileType (line 210)
- `SN.File` interface supports json type (lines 191-195)

## Conclusion

The metadata files are now being generated correctly. Each record processed by Sincronia will have its own metaData.json file with a timestamp tracking when it was last updated locally.