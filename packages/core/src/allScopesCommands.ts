import { Sinc, SN } from "@tenonhq/sincronia-types";
import { logger } from "./Logger";
import { fileLogger } from "./FileLogger";
import * as ConfigManager from "./config";
import * as AppUtils from "./appUtils";
import * as fUtils from "./FileUtils";
import { setupDotEnv, getLoginInfo } from "./wizard";
import { scopeCheckMessage } from "./logMessages";
import { defaultClient, unwrapSNResponse } from "./snClient";
import { setLogLevel } from "./commands";
import * as path from "path";
import * as fs from "fs";

const fsp = fs.promises;

interface ScopeConfig {
  sourceDirectory?: string;
  buildDirectory?: string;
  refreshInterval?: number;
  tableOptions?: any;
}

interface ScopeResult {
  scope: string;
  success: boolean;
  manifest?: any;
  error?: Error;
}

// Custom function to process manifest with specific source directory
async function processManifestForScope(
  manifest: SN.AppManifest,
  sourceDirectory: string,
  forceWrite = false,
): Promise<void> {
  try {
    // Ensure the source directory exists
    try {
      await fsp.mkdir(sourceDirectory, { recursive: true });
    } catch (dirError) {
      logger.error("Failed to create directory: " + sourceDirectory);
      throw dirError;
    }

    const tables = manifest.tables || {};
    const tableNames = Object.keys(tables);
    logger.info("Processing " + tableNames.length + " tables for " + sourceDirectory);

    for (const tableName of tableNames) {
      const tableRecords = tables[tableName];
      const tablePath = path.join(sourceDirectory, tableName);

      // Process each record in the table
      const recordNames = Object.keys(tableRecords.records || {});

      fileLogger.debug("Table " + tableName + ": " + recordNames.length + " records");

      for (const recordName of recordNames) {
        const record = tableRecords.records[recordName];
        // Use the record's name property instead of the key for the directory name
        const recordDirName = record.name || recordName;
        const recordPath = path.join(tablePath, recordDirName);

        // Check if metadata file exists in the files from server
        const hasMetadataFromServer = record.files?.some(
          (f: any) => f.name === 'metaData' && f.type === 'json'
        );

        // Ensure the record directory exists
        await fsp.mkdir(recordPath, { recursive: true });

        // Process each file in the record
        for (const file of record.files || []) {
          const filePath = path.join(recordPath, `${file.name}.${file.type}`);
          const fileContent = file.content || "";
          
          const fileDir = path.dirname(filePath);
          await fsp.mkdir(fileDir, { recursive: true });

          try {
            await fsp.writeFile(filePath, fileContent, "utf8");
          } catch (writeError) {
            logger.error("Failed to write: " + filePath);
            throw writeError;
          }
        }
        
        // If no metadata from server, create a basic one
        if (!hasMetadataFromServer) {
          const metadataFilePath = path.join(recordPath, "metaData.json");
          const metadataContent = {
            _generatedAt: new Date().toISOString(),
            _note: "Generated locally - metadata not provided by server"
          };
          
          try {
            await fsp.writeFile(metadataFilePath, JSON.stringify(metadataContent, null, 2), "utf8");
          } catch (metaError) {
            logger.error("Failed to write metadata: " + metadataFilePath);
          }
        }
      }
    }

    logger.info("Files written to " + sourceDirectory);
  } catch (error) {
    logger.error("Error processing files for " + sourceDirectory + ": " + error);
    throw error;
  }
}

async function processScope(
  scopeName: string,
  scopeConfig: ScopeConfig | boolean,
  apiDelay: number = 0,
): Promise<ScopeResult> {
  try {
    const instance = process.env.SN_INSTANCE || "unknown";
    logger.info("Processing scope: " + scopeName + " (" + instance + ")");

    // Get the client
    const client = defaultClient();

    // Get the config
    const config = ConfigManager.getConfig();

    // Determine the source directory for this scope
    let sourceDirectory: string;
    if (typeof scopeConfig === "object" && scopeConfig.sourceDirectory) {
      sourceDirectory = path.resolve(
        ConfigManager.getRootDir(),
        scopeConfig.sourceDirectory,
      );
    } else {
      // Default to src/{scope} if no sourceDirectory specified
      sourceDirectory = path.resolve(
        ConfigManager.getRootDir(),
        "src",
        scopeName,
      );
    }

    fileLogger.debug("Source directory for " + scopeName + ": " + sourceDirectory);

    const apps = await unwrapSNResponse(client.getAppList());

    const scopeApp = apps.find((app: any) => app.scope === scopeName);
    if (!scopeApp) {
      logger.warn("Scope " + scopeName + " not found in ServiceNow apps list");
    } else {
      logger.info("Found app: " + scopeApp.displayName);
    }

    logger.info("Downloading manifest for " + scopeName + "...");
    if (apiDelay > 0) {
      await delay(apiDelay);
    }
    const manifest = await unwrapSNResponse(
      client.getManifest(scopeName, config, false), // Get structure first
    );

    logger.info("Downloading file contents for " + scopeName + "...");
    const missingFiles: any = {};

    // Build the missing files structure from the manifest
    for (const tableName in manifest?.tables || {}) {
      const table = manifest.tables[tableName];
      missingFiles[tableName] = {};

      for (const recordName in table.records || {}) {
        const record = table.records[recordName];
        missingFiles[tableName][record.sys_id] = record.files.map((f: any) => ({
          name: f.name,
          type: f.type,
        }));
      }
    }

    // Get the actual file contents
    if (apiDelay > 0) {
      await delay(apiDelay);
    }
    const filesWithContent = await unwrapSNResponse(
      client.getMissingFiles(missingFiles, config.tableOptions || {}),
    );

    // Merge the content back into the manifest
    for (const tableName in filesWithContent || {}) {
      if (manifest.tables[tableName]) {
        for (const recordName in filesWithContent[tableName].records || {}) {
          const recordWithContent =
            filesWithContent[tableName].records[recordName];
          
              const manifestRecord = Object.values(
            manifest.tables[tableName].records,
          ).find((r: any) => r.sys_id === recordWithContent.sys_id);
          if (manifestRecord) {
            manifestRecord.files = recordWithContent.files;
          }
        }
      }
    }

    const tableCount = Object.keys(manifest?.tables || {}).length;
    logger.info("Writing " + tableCount + " tables for " + scopeName + "...");
    await processManifestForScope(manifest, sourceDirectory, true);

    // Create the scope-specific manifest structure
    const scopeManifest = {
      tables: (manifest && manifest.tables) || {},
      scope: scopeName,
    };

    logger.success("Scope " + scopeName + " complete — files saved to " + sourceDirectory);

    return {
      scope: scopeName,
      success: true,
      manifest: scopeManifest,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to process scope " + scopeName + ": " + errorMessage);
    return {
      scope: scopeName,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

// Helper function to add delay between API calls
async function delay(ms: number): Promise<void> {
  if (ms > 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export async function initScopesCommand(args: Sinc.SharedCmdArgs & { delay?: number }) {
  setLogLevel(args);
  
  // Get API delay from args, default to 0ms (no delay)
  const apiDelay = args.delay || 0;
  if (apiDelay > 0) {
    logger.info(`Using ${apiDelay}ms delay between API calls to prevent server overload`);
  }

  try {
    // First check if we have environment variables set
    if (
      !process.env.SN_USER ||
      !process.env.SN_PASSWORD ||
      !process.env.SN_INSTANCE
    ) {
      try {
        let loginAnswers = await getLoginInfo();
        await setupDotEnv(loginAnswers);
      } catch (error) {
        logger.error("Error getting ServiceNow credentials: " + error);
        throw error;
      }
      if (
        !process.env.SN_USER ||
        !process.env.SN_PASSWORD ||
        !process.env.SN_INSTANCE
      ) {
        logger.error(
          "Missing ServiceNow credentials. Please ensure SN_USER, SN_PASSWORD, and SN_INSTANCE are set in your .env file",
        );
        throw new Error("ServiceNow credentials not configured");
      }
    }

    // Load config
    await ConfigManager.loadConfigs();
    const config = ConfigManager.getConfig();

    if (!config.scopes) {
      logger.error("No scopes defined in sinc.config.js");
      throw new Error("No scopes defined in configuration");
    }

    const scopes = Object.keys(config.scopes);
    const instance = process.env.SN_INSTANCE || "unknown";
    logger.info("Initializing " + scopes.length + " scopes from " + instance + ": " + scopes.join(", "));

    const scopePromises = scopes.map((scopeName) =>
      processScope(scopeName, config.scopes![scopeName], apiDelay),
    );

    const results = await Promise.allSettled(scopePromises);

    // Collect successful manifests
    const manifests: { [key: string]: any } = {};
    let successCount = 0;
    let failCount = 0;

    results.forEach((result, index) => {
      const scopeName = scopes[index];
      if (result.status === "fulfilled" && result.value.success) {
        manifests[scopeName] = result.value.manifest;
        successCount++;
      } else {
        failCount++;
        const error =
          result.status === "rejected" ? result.reason : result.value?.error;
        logger.error(
          `Failed to process ${scopeName}: ${
            error?.message || "Unknown error"
          }`,
        );
      }
    });

    // Write per-scope manifest files instead of a single combined one
    for (const [scopeName, scopeData] of Object.entries(manifests)) {
      const scopeManifestPath = ConfigManager.getScopeManifestPath(scopeName);
      await fsp.writeFile(
        scopeManifestPath,
        JSON.stringify(scopeData, null, 2),
      );
      logger.info(`Wrote manifest for ${scopeName} to: ${scopeManifestPath}`);
    }

    logger.info("─".repeat(50));
    logger.success("Scope initialization complete — " + successCount + "/" + scopes.length + " scopes processed");
    if (failCount > 0) {
      logger.warn(failCount + " scope(s) failed — check errors above");
    }
    logger.info("Manifests: sinc.manifest.<scope>.json");
    logger.success("Run 'npx sinc watchAllScopes' to start development");
  } catch (e) {
    logger.error("Error initializing scopes: " + e);
    throw e;
  }
}

export async function watchAllScopesCommand(args: Sinc.SharedCmdArgs) {
  setLogLevel(args);

  try {
    // First check if we have environment variables set
    if (
      !process.env.SN_USER ||
      !process.env.SN_PASSWORD ||
      !process.env.SN_INSTANCE
    ) {
      let loginAnswers = await getLoginInfo();
      logger.error(
        "Missing ServiceNow credentials. Please ensure SN_USER, SN_PASSWORD, and SN_INSTANCE are set in your .env file",
      );
      throw new Error("ServiceNow credentials not configured");
    }

    // Import and start the multi-scope watcher
    const { startMultiScopeWatching } = await import("./MultiScopeWatcher");

    // Start watching all scopes
    await startMultiScopeWatching();

    // Keep the process running
    process.on("SIGINT", async () => {
      logger.info("\nStopping multi-scope watch...");
      const { stopMultiScopeWatching } = await import("./MultiScopeWatcher");
      stopMultiScopeWatching();
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start multi-scope watch: " + error);
    throw error;
  }
}
