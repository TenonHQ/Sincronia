import chokidar from "chokidar";
import { logFilePush } from "./logMessages";
import { debounce } from "lodash";
import { getFileContextFromPath } from "./FileUtils";
import { Sinc } from "@tenonhq/sincronia-types";
import { groupAppFiles, pushFiles } from "./appUtils";
import { logger } from "./Logger";
import * as path from "path";
import * as ConfigManager from "./config";

const DEBOUNCE_MS = 300;

interface ScopeWatcher {
  scope: string;
  watcher: chokidar.FSWatcher;
  pushQueue: string[];
  sourceDirectory: string;
}

class MultiScopeWatcherManager {
  private scopeWatchers: Map<string, ScopeWatcher> = new Map();
  private updateSetCheckInterval: NodeJS.Timeout | null = null;

  async startWatchingAllScopes() {
    try {
      // Load configuration
      await ConfigManager.loadConfigs();
      const config = ConfigManager.getConfig();
      
      if (!config.scopes) {
        logger.error("No scopes defined in sinc.config.js");
        throw new Error("No scopes defined in configuration");
      }

      const scopes = Object.keys(config.scopes);
      logger.info(`Starting multi-scope watch for ${scopes.length} scopes: ${scopes.join(", ")}`);

      // Start watching each scope
      for (const scopeName of scopes) {
        const scopeConfig = config.scopes[scopeName];
        let sourceDirectory: string;
        
        if (typeof scopeConfig === "object" && scopeConfig.sourceDirectory) {
          sourceDirectory = path.resolve(ConfigManager.getRootDir(), scopeConfig.sourceDirectory);
        } else {
          // Default to src/{scope} if no sourceDirectory specified
          sourceDirectory = path.resolve(ConfigManager.getRootDir(), "src", scopeName);
        }

        this.startWatchingScope(scopeName, sourceDirectory);
      }

      // Start periodic update set checking
      this.startUpdateSetMonitoring();

      logger.success("✅ Multi-scope watch started successfully!");
      logger.info("Watching for file changes across all scopes...");
      logger.info("Press Ctrl+C to stop watching\n");

    } catch (error) {
      logger.error("Failed to start multi-scope watch: " + error);
      throw error;
    }
  }

  private startWatchingScope(scopeName: string, sourceDirectory: string) {
    logger.info(`Setting up watcher for scope ${scopeName} in ${sourceDirectory}`);

    const watcher = chokidar.watch(sourceDirectory, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    const scopeWatcher: ScopeWatcher = {
      scope: scopeName,
      watcher: watcher,
      pushQueue: [],
      sourceDirectory: sourceDirectory
    };

    // Create a debounced processor for this scope
    const processQueue = debounce(async () => {
      await this.processScopeQueue(scopeWatcher);
    }, DEBOUNCE_MS);

    watcher.on("change", (filePath: string) => {
      logger.info(`[${scopeName}] File changed: ${path.relative(sourceDirectory, filePath)}`);
      scopeWatcher.pushQueue.push(filePath);
      processQueue();
    });

    watcher.on("add", (filePath: string) => {
      logger.info(`[${scopeName}] File added: ${path.relative(sourceDirectory, filePath)}`);
      scopeWatcher.pushQueue.push(filePath);
      processQueue();
    });

    watcher.on("error", (error: Error) => {
      logger.error(`[${scopeName}] Watcher error: ${error.message}`);
    });

    this.scopeWatchers.set(scopeName, scopeWatcher);
  }

  private async processScopeQueue(scopeWatcher: ScopeWatcher) {
    if (scopeWatcher.pushQueue.length === 0) return;

    const toProcess = Array.from(new Set([...scopeWatcher.pushQueue]));
    scopeWatcher.pushQueue = [];

    logger.info(`[${scopeWatcher.scope}] Processing ${toProcess.length} file(s)...`);

    try {
      // First, switch to the correct scope
      await this.switchToScope(scopeWatcher.scope);

      // Load the manifest for this specific scope
      await this.loadScopeManifest(scopeWatcher.scope, scopeWatcher.sourceDirectory);

      // Process the files
      const fileContexts = toProcess
        .map(getFileContextFromPath)
        .filter((ctx): ctx is Sinc.FileContext => !!ctx);

      if (fileContexts.length === 0) {
        logger.warn(`[${scopeWatcher.scope}] No valid file contexts found`);
        return;
      }

      const buildables = groupAppFiles(fileContexts);
      const updateResults = await pushFiles(buildables);
      
      updateResults.forEach((res, index) => {
        if (index < fileContexts.length) {
          logFilePush(fileContexts[index], res);
        }
      });

      logger.success(`[${scopeWatcher.scope}] Successfully pushed ${updateResults.length} file(s)`);
    } catch (error) {
      logger.error(`[${scopeWatcher.scope}] Error processing queue: ${error}`);
    }
  }

  private async loadScopeManifest(scopeName: string, sourceDirectory: string) {
    try {
      // The sourceDirectory is like /path/to/ServiceNow/src/x_cadso_core
      // We need to go up two levels to get to the ServiceNow directory where manifests are stored
      const projectRoot = path.dirname(path.dirname(sourceDirectory)); // Go up from src/scope to project root
      
      const fs = await import("fs");
      
      // First try to load scope-specific manifest file
      const scopeManifestPath = path.join(projectRoot, `sinc.manifest.${scopeName}.json`);
      if (fs.existsSync(scopeManifestPath)) {
        const manifestContent = await fs.promises.readFile(scopeManifestPath, "utf-8");
        const scopeManifest = JSON.parse(manifestContent);
        // Ensure scope field is set
        if (!scopeManifest.scope) {
          scopeManifest.scope = scopeName;
        }
        ConfigManager.updateManifest(scopeManifest);
        logger.debug(`Loaded scope-specific manifest for: ${scopeName}`);
        return;
      }
      
      // Fall back to checking legacy single manifest file
      const manifestPath = path.join(projectRoot, "sinc.manifest.json");
      if (fs.existsSync(manifestPath)) {
        const manifestContent = await fs.promises.readFile(manifestPath, "utf-8");
        const fullManifest = JSON.parse(manifestContent);
        
        // Check if this is a multi-scope manifest (has scopes as top-level keys)
        if (fullManifest[scopeName]) {
          // Multi-scope manifest - extract the specific scope's data
          const scopeManifest = fullManifest[scopeName];
          // Add the scope field for compatibility
          scopeManifest.scope = scopeName;
          ConfigManager.updateManifest(scopeManifest);
          logger.debug(`Loaded manifest for scope: ${scopeName} from legacy multi-scope manifest`);
        } else if (fullManifest.scope === scopeName) {
          // Single-scope manifest for the correct scope
          ConfigManager.updateManifest(fullManifest);
          logger.debug(`Loaded single-scope manifest for scope: ${scopeName}`);
        } else if (fullManifest.tables) {
          // Old-style single-scope manifest without scope field - assume it's for this scope
          fullManifest.scope = scopeName;
          ConfigManager.updateManifest(fullManifest);
          logger.debug(`Loaded manifest for scope: ${scopeName} (legacy format)`);
        } else {
          logger.warn(`[${scopeName}] Scope not found in manifest`);
        }
      } else {
        logger.warn(`[${scopeName}] No manifest found at ${scopeManifestPath} or ${manifestPath}`);
      }
    } catch (error) {
      logger.error(`Failed to load manifest for scope ${scopeName}: ${error}`);
    }
  }

  private async switchToScope(scopeName: string) {
    try {
      const { defaultClient, unwrapSNResponse } = await import("./snClient");
      const client = defaultClient();
      
      // Get the scope ID
      const scopeResponse = await unwrapSNResponse(client.getScopeId(scopeName));
      if (!scopeResponse || !Array.isArray(scopeResponse) || scopeResponse.length === 0 || !scopeResponse[0].sys_id) {
        throw new Error(`Scope ${scopeName} not found`);
      }

      // Get user sys_id
      const userResponse = await unwrapSNResponse(client.getUserSysId());
      if (!userResponse || !Array.isArray(userResponse) || userResponse.length === 0 || !userResponse[0].sys_id) {
        throw new Error("Could not get user sys_id");
      }

      // Get current app preference
      const prefResponse = await unwrapSNResponse(
        client.getCurrentAppUserPrefSysId(userResponse[0].sys_id)
      );

      if (prefResponse && Array.isArray(prefResponse) && prefResponse.length > 0 && prefResponse[0].sys_id) {
        // Update existing preference
        await client.updateCurrentAppUserPref(scopeResponse[0].sys_id, prefResponse[0].sys_id);
      } else {
        // Create new preference
        await client.createCurrentAppUserPref(scopeResponse[0].sys_id, userResponse[0].sys_id);
      }

      logger.debug(`Switched to scope: ${scopeName}`);
    } catch (error) {
      logger.error(`Failed to switch to scope ${scopeName}: ${error}`);
      throw error;
    }
  }

  private async startUpdateSetMonitoring() {
    // Check update sets immediately on start
    await this.checkAllUpdateSets();

    // Then check every 30 seconds
    this.updateSetCheckInterval = setInterval(async () => {
      await this.checkAllUpdateSets();
    }, 30000);
  }

  private async checkAllUpdateSets() {
    try {
      const { defaultClient, unwrapSNResponse } = await import("./snClient");
      const client = defaultClient();
      const config = ConfigManager.getConfig();
      
      if (!config.scopes) return;

      const scopes = Object.keys(config.scopes);
      logger.info("\n" + "=".repeat(60));
      logger.info("Update Set Status Check");
      logger.info("=".repeat(60));

      for (const scopeName of scopes) {
        try {
          // Switch to scope to check its update set
          await this.switchToScope(scopeName);

          // Get user sys_id
          const userResponse = await unwrapSNResponse(client.getUserSysId());
          if (!userResponse || !Array.isArray(userResponse) || userResponse.length === 0 || !userResponse[0].sys_id) {
            logger.warn(`[${scopeName}] Could not get user information`);
            continue;
          }

          // Get current update set preference
          const updateSetPref = await unwrapSNResponse(
            client.getCurrentUpdateSetUserPref(userResponse[0].sys_id)
          );

          if (updateSetPref && Array.isArray(updateSetPref) && updateSetPref.length > 0 && (updateSetPref[0] as any).value) {
            // Get update set details
            const updateSetId = (updateSetPref[0] as any).value;
            const updateSetDetails = await this.getUpdateSetDetails(updateSetId);
            
            if (updateSetDetails) {
              const isDefault = updateSetDetails.name === "Default" || 
                               updateSetDetails.name.toLowerCase().includes("default");
              
              if (isDefault) {
                logger.warn(`⚠️  [${scopeName}] Currently in DEFAULT update set!`);
              } else {
                logger.info(`✅ [${scopeName}] Update Set: ${updateSetDetails.name}`);
              }
            } else {
              logger.info(`[${scopeName}] Update Set ID: ${updateSetId}`);
            }
          } else {
            logger.warn(`⚠️  [${scopeName}] No update set selected or in DEFAULT`);
          }
        } catch (error) {
          logger.error(`[${scopeName}] Error checking update set: ${error}`);
        }
      }

      logger.info("=".repeat(60) + "\n");
    } catch (error) {
      logger.error(`Error during update set monitoring: ${error}`);
    }
  }

  private async getUpdateSetDetails(updateSetId: string) {
    try {
      const { defaultClient } = await import("./snClient");
      const client = defaultClient();
      
      // Create axios client directly to get update set details
      const axios = (await import("axios")).default;
      const { SN_USER = "", SN_PASSWORD = "", SN_INSTANCE = "" } = process.env;
      
      const axiosClient = axios.create({
        auth: {
          username: SN_USER,
          password: SN_PASSWORD
        },
        baseURL: SN_INSTANCE
      });

      const response = await axiosClient.get(`/api/now/table/sys_update_set/${updateSetId}`, {
        params: {
          sysparm_fields: "name,state,sys_id"
        }
      });

      if (response.data && response.data.result) {
        return response.data.result;
      }
      return null;
    } catch (error) {
      logger.debug(`Could not get update set details: ${error}`);
      return null;
    }
  }

  stopWatching() {
    // Stop all scope watchers
    for (const [scopeName, scopeWatcher] of this.scopeWatchers) {
      logger.info(`Stopping watcher for scope: ${scopeName}`);
      scopeWatcher.watcher.close();
    }
    this.scopeWatchers.clear();

    // Stop update set monitoring
    if (this.updateSetCheckInterval) {
      clearInterval(this.updateSetCheckInterval);
      this.updateSetCheckInterval = null;
    }

    logger.info("All watchers stopped");
  }
}

export const multiScopeWatcher = new MultiScopeWatcherManager();

export function startMultiScopeWatching() {
  return multiScopeWatcher.startWatchingAllScopes();
}

export function stopMultiScopeWatching() {
  multiScopeWatcher.stopWatching();
}