import { SN, Sinc } from "@tenonhq/sincronia-types";
import path from "path";
import fs from "fs";
import ProgressBar from "progress";
import * as fUtils from "./FileUtils";
import * as ConfigManager from "./config";
import {
  PUSH_RETRY_LIMIT,
  PUSH_RETRY_WAIT,
  CONCURRENCY_TABLES,
  CONCURRENCY_RECORDS,
  CONCURRENCY_FILES,
  CONCURRENCY_PUSH,
  CONCURRENCY_BUILD,
} from "./constants";
import PluginManager from "./PluginManager";
import { fileLogger } from "./FileLogger";
import {
  defaultClient,
  processPushResponse,
  retryOnErr,
  SNClient,
  unwrapSNResponse,
  unwrapTableAPIFirstItem,
} from "./snClient";
import { logger } from "./Logger";
import { aggregateErrorMessages, allSettled, processBatched, allSettledBatched } from "./genericUtils";

interface UpdateSetSelection {
  sys_id: string;
  name: string;
}

type UpdateSetConfig = Record<string, UpdateSetSelection>;

const getUpdateSetConfig = (): UpdateSetConfig => {
  const configPath = path.resolve(process.cwd(), ".sinc-update-sets.json");
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (e) {
    // Ignore parse errors
  }
  return {};
};

const processFilesInManRec = async (
  recPath: string,
  rec: SN.MetaRecord,
  forceWrite: boolean,
) => {
  fileLogger.debug("Processing record: " + rec.name + " (" + rec.files.length + " files)");

  const fileWrite = fUtils.writeSNFileCurry(forceWrite);

  // Create metadata file with current timestamp
  const metadataFile: SN.File = {
    name: "metaData",
    type: "json",
    content: JSON.stringify({
      _lastUpdatedOn: new Date().toISOString()
    }, null, 2)
  };

  await fileWrite(metadataFile, recPath);

  const writeResults = await allSettledBatched(
    rec.files,
    CONCURRENCY_FILES,
    function(file) { return fileWrite(file, recPath); },
  );
  const writeFailures = writeResults.filter(
    (r) => r.status === "rejected",
  );
  if (writeFailures.length > 0) {
    writeFailures.forEach((f) => {
      fileLogger.error("File write failed: " + (f as PromiseRejectedResult).reason);
    });
  }

  // Remove content from ALL files (metadata is not included in manifest)
  rec.files = rec.files.map((file) => {
    const fileCopy = { ...file };
    delete fileCopy.content;
    return fileCopy;
  });
  
};

const processRecsInManTable = async (
  tablePath: string,
  table: SN.TableConfig,
  forceWrite: boolean,
  onRecordProcessed?: () => void,
) => {
  const { records } = table;
  const recKeys = Object.keys(records);
  const recKeyToPath = (key: string) => path.join(tablePath, records[key].name);
  const recPathPromises = recKeys
    .map(recKeyToPath)
    .map(fUtils.createDirRecursively);
  await Promise.all(recPathPromises);

  await processBatched(recKeys, CONCURRENCY_RECORDS, function(recKey) {
    return processFilesInManRec(recKeyToPath(recKey), records[recKey], forceWrite).then(function() {
      if (onRecordProcessed) onRecordProcessed();
    });
  });
};

const countRecordsInTables = (tables: SN.TableMap): number => {
  return Object.keys(tables).reduce(function(sum, tableName) {
    return sum + Object.keys(tables[tableName].records).length;
  }, 0);
};

const processTablesInManifest = async (
  tables: SN.TableMap,
  forceWrite: boolean,
  sourcePath?: string,
  onRecordProcessed?: () => void,
) => {
  var basePath = sourcePath || ConfigManager.getSourcePath();
  const tableNames = Object.keys(tables);
  await processBatched(tableNames, CONCURRENCY_TABLES, function(tableName) {
    return processRecsInManTable(
      path.join(basePath, tableName),
      tables[tableName],
      forceWrite,
      onRecordProcessed,
    );
  });
};

/**
 * Re-keys manifest records from sys_id to record.name (display value).
 * Some ServiceNow tables return records keyed by sys_id instead of display name.
 * This ensures consistent naming for directories and manifest lookups.
 */
export const normalizeManifestKeys = (manifest: SN.AppManifest): SN.AppManifest => {
  var tables = manifest.tables || {};
  var tableNames = Object.keys(tables);
  for (var i = 0; i < tableNames.length; i++) {
    var tableName = tableNames[i];
    var records = tables[tableName].records || {};
    var recordKeys = Object.keys(records);
    var normalized: SN.TableConfigRecords = {};
    for (var j = 0; j < recordKeys.length; j++) {
      var key = recordKeys[j];
      var record = records[key];
      var displayKey = record.name || key;
      // Handle duplicate display names by appending sys_id suffix
      if (normalized[displayKey]) {
        displayKey = displayKey + " (" + record.sys_id.substring(0, 8) + ")";
      }
      normalized[displayKey] = record;
    }
    tables[tableName].records = normalized;
  }
  return manifest;
};

export const processManifest = async (
  manifest: SN.AppManifest,
  forceWrite = false,
  sourcePath?: string,
): Promise<void> => {
  const tableCount = Object.keys(manifest.tables).length;
  fileLogger.debug("Processing manifest: " + (manifest.scope || "legacy") + " (" + tableCount + " tables)");

  var recordCount = countRecordsInTables(manifest.tables);
  var progress = createScopeProgress(logger.getLogLevel(), {
    scope: manifest.scope || "default",
    total: recordCount,
  });

  await processTablesInManifest(manifest.tables, forceWrite, sourcePath, progress.tick);

  if (manifest.scope) {
    await fUtils.writeScopeManifest(manifest.scope, manifest);
  } else {
    await fUtils.writeFileForce(
      ConfigManager.getManifestPath(),
      JSON.stringify(manifest, null, 2),
    );
  }
};

export const syncManifest = async (scope?: string) => {
  try {
    const curManifest = await ConfigManager.getManifest();
    if (!curManifest) throw new Error("No manifest file loaded!");

    // If a specific scope is provided, sync only that scope
    if (scope) {
      logger.info("Refreshing scope: " + scope + "...");
      const client = defaultClient();
      const config = ConfigManager.getConfig();

      // Resolve scope-specific source directory
      var scopeSourcePath = ConfigManager.getSourcePathForScope(scope);

      const newManifest = normalizeManifestKeys(
        await unwrapSNResponse(client.getManifest(scope, config)),
      );

      const refreshTableCount = Object.keys(newManifest.tables).length;
      fileLogger.debug("Refreshed manifest for " + scope + ": " + refreshTableCount + " tables");

      await fUtils.writeScopeManifest(scope, newManifest);
      await processMissingFiles(newManifest, scopeSourcePath);

      // Update the in-memory manifest for this scope
      if (ConfigManager.isMultiScopeManifest(curManifest)) {
        (curManifest as any)[scope] = newManifest;
        ConfigManager.updateManifest(curManifest as any);
      }
    } else {
      // Sync all scopes if manifest has multiple scopes
      if (ConfigManager.isMultiScopeManifest(curManifest)) {
        // Multiple scopes detected
        for (const scopeName of Object.keys(curManifest)) {
          await syncManifest(scopeName);
        }
      } else if (curManifest.scope) {
        // Single scope manifest
        await syncManifest(curManifest.scope);
      }
    }
  } catch (e) {
    let message;
    if (e instanceof Error) message = e.message;
    else message = String(e);
    logger.error("Refresh failed: " + message);
  }
};

const markFileMissing =
  (missingObj: SN.MissingFileTableMap) =>
  (table: string) =>
  (recordId: string) =>
  (file: SN.File) => {
    if (!missingObj[table]) {
      missingObj[table] = {};
    }
    if (!missingObj[table][recordId]) {
      missingObj[table][recordId] = [];
    }
    const { name, type } = file;
    missingObj[table][recordId].push({ name, type });
  };
type MarkTableMissingFunc = ReturnType<typeof markFileMissing>;
type MarkRecordMissingFunc = ReturnType<MarkTableMissingFunc>;
type MarkFileMissingFunc = ReturnType<MarkRecordMissingFunc>;

const markRecordMissing = (
  record: SN.MetaRecord,
  missingFunc: MarkRecordMissingFunc,
) => {
  record.files.forEach((file) => {
    missingFunc(record.sys_id)(file);
  });
};

const markTableMissing = (
  table: SN.TableConfig,
  tableName: string,
  missingFunc: MarkTableMissingFunc,
) => {
  Object.keys(table.records).forEach((recName) => {
    markRecordMissing(table.records[recName], missingFunc(tableName));
  });
};

const checkFilesForMissing = async (
  recPath: string,
  files: SN.File[],
  missingFunc: MarkFileMissingFunc,
) => {
  const checkPromises = files.map(fUtils.SNFileExists(recPath));
  const checks = await Promise.all(checkPromises);
  checks.forEach((check, index) => {
    if (!check) {
      missingFunc(files[index]);
    }
  });
};

const checkRecordsForMissing = async (
  tablePath: string,
  records: SN.TableConfigRecords,
  missingFunc: MarkRecordMissingFunc,
) => {
  const recNames = Object.keys(records);
  const recPaths = recNames.map(fUtils.appendToPath(tablePath));
  const checkPromises = recNames.map((recName, index) =>
    fUtils.pathExists(recPaths[index]),
  );
  const checks = await Promise.all(checkPromises);
  const fileCheckPromises = checks.map(async (check, index) => {
    const recName = recNames[index];
    const record = records[recName];
    if (!check) {
      markRecordMissing(record, missingFunc);
      return;
    }
    await checkFilesForMissing(
      recPaths[index],
      record.files,
      missingFunc(record.sys_id),
    );
  });
  await Promise.all(fileCheckPromises);
};

const checkTablesForMissing = async (
  topPath: string,
  tables: SN.TableMap,
  missingFunc: MarkTableMissingFunc,
) => {
  const tableNames = Object.keys(tables);
  const tablePaths = tableNames.map(fUtils.appendToPath(topPath));
  const checkPromises = tableNames.map((tableName, index) =>
    fUtils.pathExists(tablePaths[index]),
  );
  const checks = await Promise.all(checkPromises);

  const recCheckPromises = checks.map(async (check, index) => {
    const tableName = tableNames[index];
    if (!check) {
      markTableMissing(tables[tableName], tableName, missingFunc);
      return;
    }
    await checkRecordsForMissing(
      tablePaths[index],
      tables[tableName].records,
      missingFunc(tableName),
    );
  });
  await Promise.all(recCheckPromises);
};

export const findMissingFiles = async (
  manifest: SN.AppManifest,
  sourcePath?: string,
): Promise<SN.MissingFileTableMap> => {
  const missing: SN.MissingFileTableMap = {};
  const { tables } = manifest;
  const missingTableFunc = markFileMissing(missing);
  await checkTablesForMissing(
    sourcePath || ConfigManager.getSourcePath(),
    tables,
    missingTableFunc,
  );
  // missing gets mutated along the way as things get processed
  return missing;
};

export const processMissingFiles = async (
  newManifest: SN.AppManifest,
  sourcePath?: string,
): Promise<void> => {
  try {
    const missing = await findMissingFiles(newManifest, sourcePath);
    const missingTableCount = Object.keys(missing).length;
    if (missingTableCount === 0) return;

    fileLogger.debug("Downloading missing files from " + missingTableCount + " tables");

    const { tableOptions = {} } = ConfigManager.getConfig();
    const client = defaultClient();

    const filesToProcess = await unwrapSNResponse(
      client.getMissingFiles(missing, tableOptions),
    );

    var recordCount = countRecordsInTables(filesToProcess);
    var progress = createScopeProgress(logger.getLogLevel(), {
      scope: newManifest.scope || "default",
      total: recordCount,
    });

    await processTablesInManifest(filesToProcess, false, sourcePath, progress.tick);
  } catch (e) {
    throw e;
  }
};

export const groupAppFiles = (fileCtxs: Sinc.FileContext[]) => {
  const combinedFiles = fileCtxs.reduce(
    (groupMap, cur) => {
      const { tableName, targetField, sys_id } = cur;
      const key = `${tableName}-${sys_id}`;
      const entry: Sinc.BuildableRecord = groupMap[key] ?? {
        table: tableName,
        sysId: sys_id,
        fields: {},
      };
      const newEntry: Sinc.BuildableRecord = {
        ...entry,
        fields: { ...entry.fields, [targetField]: cur ?? "" },
      };
      return { ...groupMap, [key]: newEntry };
    },
    {} as Record<string, Sinc.BuildableRecord>,
  );
  return Object.values(combinedFiles);
};

export const getAppFileList = async (
  paths: string | string[],
): Promise<Sinc.BuildableRecord[]> => {
  const validPaths =
    typeof paths === "object"
      ? paths
      : await fUtils.encodedPathsToFilePaths(paths);
  const appFileCtxs = validPaths
    .map(fUtils.getFileContextFromPath)
    .filter((maybeCtx): maybeCtx is Sinc.FileContext => !!maybeCtx);
  return groupAppFiles(appFileCtxs);
};

const buildRec = async (
  rec: Sinc.BuildableRecord,
): Promise<Sinc.RecBuildRes> => {
  const fields = Object.keys(rec.fields);
  const buildPromises = fields.map((field) => {
    return PluginManager.getFinalFileContents(rec.fields[field]);
  });
  const builtFiles = await allSettled(buildPromises);
  const buildSuccess = !builtFiles.find(
    (buildRes) => buildRes.status === "rejected",
  );
  if (!buildSuccess) {
    return {
      success: false,
      message: aggregateErrorMessages(
        builtFiles
          .filter((b): b is Sinc.FailPromiseResult => b.status === "rejected")
          .map((b) => b.reason),
        "Failed to build!",
        (_, index) => `${index}`,
      ),
    };
  }
  const builtRec = builtFiles.reduce(
    (acc, buildRes, index) => {
      const { value: content } = buildRes as Sinc.SuccessPromiseResult<string>;
      const fieldName = fields[index];
      return { ...acc, [fieldName]: content };
    },
    {} as Record<string, string>,
  );
  return {
    success: true,
    builtRec,
  };
};

const pushRec = async (
  client: SNClient,
  table: string,
  sysId: string,
  builtRec: Record<string, string>,
  summary?: string,
  scope?: string,
) => {
  const recSummary = summary ?? `${table} > ${sysId}`;
  try {
    // Check if an update set is configured for this scope
    const updateSetConfig = getUpdateSetConfig();
    const updateSet = scope ? updateSetConfig[scope] : undefined;

    const pushFn = updateSet
      ? () => {
          logger.debug(
            `Pushing ${recSummary} via update set: ${updateSet.name}`,
          );
          return client.pushWithUpdateSet(
            updateSet.sys_id,
            table,
            sysId,
            builtRec,
          );
        }
      : () => client.updateRecord(table, sysId, builtRec);

    const pushRes = await retryOnErr(
      pushFn,
      PUSH_RETRY_LIMIT,
      PUSH_RETRY_WAIT,
      (numTries: number) => {
        logger.debug(
          `Failed to push ${recSummary}! Retrying with ${numTries} left...`,
        );
      },
    );
    return processPushResponse(pushRes, recSummary);
  } catch (e) {
    let message;
    if (e instanceof Error) message = e.message;
    else message = String(e);
    const errMsg = message || "Too many retries";
    return { success: false, message: `${recSummary} : ${errMsg}` };
  }
};

export const pushFiles = async (
  recs: Sinc.BuildableRecord[],
): Promise<Sinc.PushResult[]> => {
  const client = defaultClient();
  const updateSetConfig = getUpdateSetConfig();
  const hasUpdateSets = Object.keys(updateSetConfig).length > 0;
  if (hasUpdateSets) {
    const activeScopes = Object.entries(updateSetConfig)
      .map(([scope, us]) => `${scope} -> ${us.name}`)
      .join(", ");
    logger.info(`Update set routing active: ${activeScopes}`);
  }

  const tick = getProgTick(logger.getLogLevel(), recs.length * 2) || (() => {});
  const results = await allSettledBatched(recs, CONCURRENCY_PUSH, async function(rec) {
    const fieldNames = Object.keys(rec.fields);
    const firstField = rec.fields[fieldNames[0]];
    const recSummary = summarizeRecord(rec.table, firstField.name);
    const scope = firstField.scope;

    const buildRes = await buildRec(rec);
    tick();
    if (!buildRes.success) {
      tick();
      return { success: false, message: `${recSummary} : ${buildRes.message}` };
    }
    const pushRes = await pushRec(
      client,
      rec.table,
      rec.sysId,
      buildRes.builtRec,
      recSummary,
      scope,
    );
    tick();
    return pushRes;
  });
  return results.map(function(result) {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return { success: false, message: `Push failed: ${result.reason}` };
  });
};

export const summarizeRecord = (table: string, recDescriptor: string): string =>
  `${table} > ${recDescriptor}`;

interface ScopeProgressResult {
  tick: () => void;
  setTotal: (n: number) => void;
}

const createScopeProgress = (
  logLevel: string,
  options: { scope: string; total: number },
): ScopeProgressResult => {
  if (logLevel !== "info" || options.total === 0) {
    return { tick: function() {}, setTotal: function() {} };
  }
  var progBar = new ProgressBar(":scope :bar :current/:total (:percent)", {
    total: options.total,
    width: 40,
    complete: "=",
    incomplete: "-",
  });
  return {
    tick: function() {
      progBar.tick({ scope: options.scope });
    },
    setTotal: function(n) {
      progBar.total = n;
    },
  };
};

const getProgTick = (
  logLevel: string,
  total: number,
): (() => void) | undefined => {
  if (logLevel === "info") {
    const progBar = new ProgressBar(":bar (:percent)", {
      total,
      width: 60,
    });
    return () => {
      progBar.tick();
    };
  }
  // no-op at other log levels
  return undefined;
};

const writeBuildFile = async (
  preBuild: Sinc.BuildableRecord,
  buildRes: Sinc.RecBuildSuccess,
  summary?: string,
): Promise<Sinc.BuildResult> => {
  const { fields, table, sysId } = preBuild;
  const recSummary = summary ?? `${table} > ${sysId}`;
  const sourcePath = ConfigManager.getSourcePath();
  const buildPath = ConfigManager.getBuildPath();
  const fieldNames = Object.keys(fields);
  const writePromises = fieldNames.map(async (field) => {
    const fieldCtx = fields[field];
    const srcFilePath = fieldCtx.filePath;
    const relativePath = path.relative(sourcePath, srcFilePath);
    const relPathNoExt = relativePath.split(".").slice(0, -1).join();
    const buildExt = fUtils.getBuildExt(
      fieldCtx.tableName,
      fieldCtx.name,
      fieldCtx.targetField,
      fieldCtx.scope,
    );
    const relPathNewExt = `${relPathNoExt}.${buildExt}`;
    const buildFilePath = path.join(buildPath, relPathNewExt);
    await fUtils.createDirRecursively(path.dirname(buildFilePath));
    const writeResult = await fUtils.writeFileForce(
      buildFilePath,
      buildRes.builtRec[fieldCtx.targetField],
    );
    return writeResult;
  });
  
  try {
    await processBatched(fieldNames, CONCURRENCY_FILES, async function(field) {
      const fieldCtx = fields[field];
      const srcFilePath = fieldCtx.filePath;
      const relativePath = path.relative(sourcePath, srcFilePath);
      const relPathNoExt = relativePath.split(".").slice(0, -1).join();
      const buildExt = fUtils.getBuildExt(
        fieldCtx.tableName,
        fieldCtx.name,
        fieldCtx.targetField,
      );
      const relPathNewExt = `${relPathNoExt}.${buildExt}`;
      const buildFilePath = path.join(buildPath, relPathNewExt);
      await fUtils.createDirRecursively(path.dirname(buildFilePath));
      await fUtils.writeFileForce(
        buildFilePath,
        buildRes.builtRec[fieldCtx.targetField],
      );
    });
    return { success: true, message: `${recSummary} built successfully` };
  } catch (e) {
    return {
      success: false,
      message: `${recSummary} : ${e}`,
    };
  }
};

export const buildFiles = async (
  fileList: Sinc.BuildableRecord[],
): Promise<Sinc.BuildResult[]> => {
  const tick =
    getProgTick(logger.getLogLevel(), fileList.length * 2) || (() => {});
  const results = await allSettledBatched(fileList, CONCURRENCY_BUILD, async function(rec) {
    const { fields, table } = rec;
    const fieldNames = Object.keys(fields);
    const recSummary = summarizeRecord(table, fields[fieldNames[0]].name);
    const buildRes = await buildRec(rec);
    tick();
    if (!buildRes.success) {
      tick();
      return { success: false, message: `${recSummary} : ${buildRes.message}` };
    }
    // writeFile
    const writeRes = await writeBuildFile(rec, buildRes, recSummary);
    tick();
    return writeRes;
  });
  return results.map(function(result) {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return { success: false, message: `Build failed: ${result.reason}` };
  });
};

export const swapScope = async (currentScope: string): Promise<SN.ScopeObj> => {
  try {
    const client = defaultClient();
    const scopeId = await unwrapTableAPIFirstItem(
      client.getScopeId(currentScope),
      "sys_id",
    );
    await swapServerScope(scopeId);
    const scopeObj = await unwrapSNResponse(client.getCurrentScope());
    return scopeObj;
  } catch (e) {
    throw e;
  }
};

const swapServerScope = async (scopeId: string): Promise<void> => {
  try {
    const client = defaultClient();
    const userSysId = await unwrapTableAPIFirstItem(
      client.getUserSysId(),
      "sys_id",
    );
    const curAppUserPrefId =
      (await unwrapTableAPIFirstItem(
        client.getCurrentAppUserPrefSysId(userSysId),
        "sys_id",
      )) || "";
    // If not user pref record exists, create it.
    if (curAppUserPrefId !== "")
      await client.updateCurrentAppUserPref(scopeId, curAppUserPrefId);
    else await client.createCurrentAppUserPref(scopeId, userSysId);
  } catch (e) {
    let message;
    if (e instanceof Error) message = e.message;
    else message = String(e);
    logger.error(message);
    throw e;
  }
};

/**
 * Creates a new update set and assigns it to the current user.
 * @param updateSetName - does not create update set if value is blank
 * @param scope - optional scope name (e.g. x_cadso_work) to create the update set in
 */
export const createAndAssignUpdateSet = async (updateSetName = "", scope?: string) => {
  logger.info(`Update Set Name: ${updateSetName}` + (scope ? ` (scope: ${scope})` : ""));
  const client = defaultClient();
  var scopeSysId: string | undefined;
  if (scope) {
    var scopeResult = await unwrapSNResponse(client.getScopeId(scope));
    if (scopeResult.length > 0) {
      scopeSysId = scopeResult[0].sys_id;
    }
  }
  const { sys_id: updateSetSysId } = await unwrapSNResponse(
    client.createUpdateSet(updateSetName, scopeSysId),
  );
  const userSysId = await unwrapTableAPIFirstItem(
    client.getUserSysId(),
    "sys_id",
  );
  const curUpdateSetUserPrefId = await unwrapTableAPIFirstItem(
    client.getCurrentUpdateSetUserPref(userSysId),
    "sys_id",
  );

  if (curUpdateSetUserPrefId !== "") {
    await client.updateCurrentUpdateSetUserPref(
      updateSetSysId,
      curUpdateSetUserPrefId,
    );
  } else {
    await client.createCurrentUpdateSetUserPref(updateSetSysId, userSysId);
  }
  return {
    name: updateSetName,
    id: updateSetSysId,
  };
};

