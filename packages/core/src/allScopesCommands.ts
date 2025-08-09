import { Sinc, SN } from "@tenonhq/sincronia-types";
import { logger } from "./Logger";
import * as ConfigManager from "./config";
import * as AppUtils from "./appUtils";
import * as fUtils from "./FileUtils";
import { startWizard } from "./wizard";
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
  forceWrite = false
): Promise<void> {
  // Process each table in the manifest
  const tables = manifest.tables || {};
  const tableNames = Object.keys(tables);
  
  for (const tableName of tableNames) {
    const tableRecords = tables[tableName];
    const tablePath = path.join(sourceDirectory, tableName);
    
    // Process each record in the table
    const recordNames = Object.keys(tableRecords.records || {});
    for (const recordName of recordNames) {
      const record = tableRecords.records[recordName];
      
      // Process each file in the record
      for (const file of record.files || []) {
        const filePath = path.join(tablePath, recordName, `${file.name}.${file.type}`);
        const fileContent = file.content || "";
        
        // Create the file
        await fUtils.writeFileForce(filePath, fileContent);
      }
    }
  }
}

async function processScope(scopeName: string, scopeConfig: ScopeConfig | boolean): Promise<ScopeResult> {
  try {
    logger.info(`Processing scope: ${scopeName}`);
    
    // Get the client
    const client = defaultClient();
    
    // Get the config
    const config = ConfigManager.getConfig();
    
    // Determine the source directory for this scope
    let sourceDirectory: string;
    if (typeof scopeConfig === "object" && scopeConfig.sourceDirectory) {
      sourceDirectory = path.resolve(ConfigManager.getRootDir(), scopeConfig.sourceDirectory);
    } else {
      // Default to src/{scope} if no sourceDirectory specified
      sourceDirectory = path.resolve(ConfigManager.getRootDir(), "src", scopeName);
    }
    
    logger.info(`Source directory for ${scopeName}: ${sourceDirectory}`);
    
    // Get apps list for verification
    logger.info(`Getting apps list from ServiceNow...`);
    const apps = await unwrapSNResponse(client.getAppList());
    
    // Check if the scope exists in the apps list
    const scopeApp = apps.find((app: any) => app.scope === scopeName);
    if (!scopeApp) {
      logger.warn(`⚠️ Scope ${scopeName} not found in ServiceNow apps list`);
    } else {
      logger.info(`Found app: ${scopeApp.displayName} (${scopeName})`);
    }
    
    // Get manifest with files for this scope
    logger.info(`Downloading manifest for scope: ${scopeName}`);
    const manifest = await unwrapSNResponse(
      client.getManifest(scopeName, config, true)
    );
    
    // Process the manifest to create local files in the correct directory
    logger.info(`Processing manifest and creating local files for ${scopeName}...`);
    await processManifestForScope(manifest, sourceDirectory, true);
    
    // Create the scope-specific manifest structure
    const scopeManifest = {
      tables: (manifest && manifest.tables) || {},
      scope: scopeName
    };
    
    logger.success(`✅ Successfully processed scope: ${scopeName}`);
    logger.info(`Files saved to: ${sourceDirectory}`);
    
    return {
      scope: scopeName,
      success: true,
      manifest: scopeManifest
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`❌ Failed to process scope ${scopeName}: ${errorMessage}`);
    return {
      scope: scopeName,
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

export async function initScopesCommand(args: Sinc.SharedCmdArgs) {
  setLogLevel(args);
  
  try {
    // First check if we have environment variables set
    if (!process.env.SN_USER || !process.env.SN_PASSWORD || !process.env.SN_INSTANCE) {
      logger.error("Missing ServiceNow credentials. Please ensure SN_USER, SN_PASSWORD, and SN_INSTANCE are set in your .env file");
      throw new Error("ServiceNow credentials not configured");
    }
    
    // Load config
    await ConfigManager.loadConfigs();
    const config = ConfigManager.getConfig();
    
    if (!config.scopes) {
      logger.error("No scopes defined in sinc.config.js");
      throw new Error("No scopes defined in configuration");
    }
    
    const scopes = Object.keys(config.scopes);
    logger.info(`Found ${scopes.length} scopes to process: ${scopes.join(", ")}`);
    
    // Process all scopes in parallel
    logger.info("Starting parallel processing of all scopes...");
    logger.info("This will download manifests and files for each scope from ServiceNow...\n");
    
    const scopePromises = scopes.map(scopeName => 
      processScope(scopeName, config.scopes![scopeName])
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
        const error = result.status === "rejected" ? result.reason : result.value?.error;
        logger.error(`Failed to process ${scopeName}: ${error?.message || "Unknown error"}`);
      }
    });
    
    // Write the combined manifest file with the new structure
    const manifestPath = path.join(ConfigManager.getRootDir(), "sinc.manifest.json");
    await fsp.writeFile(manifestPath, JSON.stringify(manifests, null, 2));
    
    logger.info("=".repeat(50));
    logger.success(`✅ Scope initialization complete!`);
    logger.info(`Successfully processed: ${successCount} scopes`);
    if (failCount > 0) {
      logger.warn(`Failed to process: ${failCount} scopes`);
    }
    logger.info(`Manifest written to: ${manifestPath}`);
    logger.info("\nAll scope files have been downloaded to their respective source directories.");
    logger.success("\nYou can now use 'npx sinc dev' to start development mode!");
    
  } catch (e) {
    logger.error("Error initializing scopes: " + e);
    throw e;
  }
}
