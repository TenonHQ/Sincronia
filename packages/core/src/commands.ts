import { Sinc } from "@tenonhq/sincronia-types";
import * as ConfigManager from "./config";
import { startWatching } from "./Watcher";
import * as AppUtils from "./appUtils";
import { startWizard } from "./wizard";
import { logger } from "./Logger";
import { fileLogger } from "./FileLogger";
import {
  scopeCheckMessage,
  devModeLog,
  logPushResults,
  logBuildResults,
} from "./logMessages";
import { defaultClient, unwrapSNResponse } from "./snClient";
import inquirer from "inquirer";
import { gitDiffToEncodedPaths } from "./gitUtils";
import { encodedPathsToFilePaths } from "./FileUtils";

async function scopeCheck(
  successFunc: () => void,
  swapScopes: boolean = false,
) {
  try {
    const scopeCheck = await AppUtils.checkScope(swapScopes);
    if (!scopeCheck.match) {
      scopeCheckMessage(scopeCheck);
      // Throw exception to register this as an error
      throw new Error();
    } else {
      successFunc();
    }
  } catch (e) {
    logger.error(
      "Failed to check your scope! You may want to make sure your project is configured correctly or run `npx sinc init`",
    );
    // Throw exception to register this as an error
    process.exit(1);
  }
}

export function setLogLevel(args: Sinc.SharedCmdArgs) {
  logger.setLogLevel(args.logLevel);
}

export async function devCommand(args: Sinc.SharedCmdArgs) {
  setLogLevel(args);
  scopeCheck(async () => {
    startWatching(ConfigManager.getSourcePath());
    devModeLog();

    let refresher = () => {
      refreshCommand(args, false);
    };
    let interval = ConfigManager.getRefresh();
    if (interval && interval > 0) {
      logger.info(`Checking for new manifest files every ${interval} seconds`);
      setInterval(refresher, interval * 1000);
    }
  });
}
export async function refreshCommand(
  args: Sinc.SharedCmdArgs,
  log: boolean = true,
) {
  setLogLevel(args);
  fileLogger.debug('\n=== refreshCommand DEBUG START ===');
  fileLogger.debug('Log parameter:', log);
  fileLogger.debug('Args:', args);
  
  scopeCheck(async () => {
    try {
      if (!log) setLogLevel({ logLevel: "warn" });
      fileLogger.debug('Calling syncManifest (no scope parameter - will sync all)');
      await AppUtils.syncManifest();
      logger.success("Refresh complete! ✅");
      setLogLevel(args);
      fileLogger.debug('=== refreshCommand DEBUG END ===\n');
    } catch (e) {
      throw e;
    }
  });
}
export async function pushCommand(args: Sinc.PushCmdArgs): Promise<void> {
  setLogLevel(args);
  scopeCheck(async () => {
    try {
      const { updateSet, ci: skipPrompt, target, diff } = args;
      let encodedPaths;
      if (target !== undefined && target !== "") encodedPaths = target;
      else encodedPaths = await gitDiffToEncodedPaths(diff);

      const fileList = await AppUtils.getAppFileList(encodedPaths);
      logger.info(`${fileList.length} files to push.`);

      if (!skipPrompt) {
        const targetServer = process.env.SN_INSTANCE;
        if (!targetServer) {
          logger.error("No server configured for push!");
          return;
        }
        const answers: { confirmed: boolean } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirmed",
            message:
              "Pushing will overwrite code in your instance. Are you sure?",
            default: false,
          },
        ]);
        if (!answers["confirmed"]) return;
      }

      // Handle --clickup flag: resolve ClickUp task into an update set name
      let resolvedUpdateSet = updateSet;
      if (!resolvedUpdateSet && (args as any).clickup) {
        try {
          const { resolveClickUpForPush } = await import("./clickupPushHelper");
          resolvedUpdateSet = await resolveClickUpForPush((args as any).clickup);
        } catch (cuErr) {
          if (cuErr instanceof Error) logger.error(cuErr.message);
          process.exit(1);
        }
      }

      // Does not create update set if updateSetName is blank
      if (resolvedUpdateSet) {
        if (!skipPrompt) {
          let answers: { confirmed: boolean } = await inquirer.prompt([
            {
              type: "confirm",
              name: "confirmed",
              message: `A new Update Set "${resolvedUpdateSet}" will be created for these pushed changes. Do you want to proceed?`,
              default: false,
            },
          ]);
          if (!answers["confirmed"]) {
            process.exit(0);
          }
        }

        const newUpdateSet = await AppUtils.createAndAssignUpdateSet(resolvedUpdateSet);
        logger.debug(
          `New Update Set Created(${newUpdateSet.name}) sys_id:${newUpdateSet.id}`,
        );
      }
      const pushResults = await AppUtils.pushFiles(fileList);
      logPushResults(pushResults);
    } catch (e) {
      logger.getInternalLogger().error(e);
      process.exit(1);
    }
  }, args.scopeSwap);
}
export async function downloadCommand(args: Sinc.CmdDownloadArgs) {
  setLogLevel(args);
  try {
    fileLogger.debug('\n=== downloadCommand DEBUG START ===');
    fileLogger.debug('Command arguments:', args);
    
    let answers: { confirmed: boolean } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: "Downloading will overwrite manifest and files. Are you sure?",
        default: false,
      },
    ]);
    if (!answers["confirmed"]) {
      return;
    }
    logger.info("Downloading manifest and files...");
    fileLogger.debug('Scope to download:', args.scope);
    fileLogger.debug('Getting manifest WITH FILES (third param = true)');
    
    const client = defaultClient();
    const config = ConfigManager.getConfig();
    
    fileLogger.debug('Calling getManifest with withFiles=true');
    const man = await unwrapSNResponse(
      client.getManifest(args.scope, config, true),
    );
    
    fileLogger.debug('Manifest received from ServiceNow');
    fileLogger.debug('Manifest has', Object.keys(man.tables).length, 'tables');
    
    // Check for metadata files in the manifest
    let metadataFileCount = 0;
    Object.keys(man.tables).forEach(tableName => {
      const table = man.tables[tableName];
      Object.keys(table.records).forEach(recordName => {
        const record = table.records[recordName];
        const metaFile = record.files.find((f: any) => 
          f.name.toLowerCase().includes('metadata') || 
          f.name.toLowerCase().includes('meta')
        );
        if (metaFile) {
          metadataFileCount++;
          fileLogger.debug(`Found metadata file in ${tableName}/${recordName}:`, metaFile);
        }
      });
    });
    fileLogger.debug('Total metadata files found in manifest:', metadataFileCount);
    
    logger.info("Creating local files from manifest...");
    fileLogger.debug('Calling processManifest with forceWrite=true');
    await AppUtils.processManifest(man, true);
    logger.success("Download complete ✅");
    fileLogger.debug('=== downloadCommand DEBUG END ===\n');
  } catch (e) {
    throw e;
  }
}
export async function initCommand(args: Sinc.SharedCmdArgs) {
  setLogLevel(args);
  try {
    await startWizard();
  } catch (e) {
    throw e;
  }
}

export async function buildCommand(args: Sinc.BuildCmdArgs) {
  setLogLevel(args);
  try {
    const encodedPaths = await gitDiffToEncodedPaths(args.diff);
    const fileList = await AppUtils.getAppFileList(encodedPaths);
    logger.info(`${fileList.length} files to build.`);
    const results = await AppUtils.buildFiles(fileList);
    logBuildResults(results);
  } catch (e) {
    process.exit(1);
  }
}

async function getDeployPaths(): Promise<string[]> {
  let changedPaths: string[] = [];
  try {
    changedPaths = ConfigManager.getDiffFile().changed || [];
  } catch (e) {}
  if (changedPaths.length > 0) {
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      {
        type: "confirm",
        name: "confirmed",
        message:
          "Would you like to deploy only files changed in your diff file?",
        default: false,
      },
    ]);
    if (confirmed) return changedPaths;
  }
  return encodedPathsToFilePaths(ConfigManager.getBuildPath());
}

export async function deployCommand(args: Sinc.SharedCmdArgs): Promise<void> {
  setLogLevel(args);
  scopeCheck(async () => {
    try {
      const targetServer = process.env.SN_INSTANCE || "";
      if (!targetServer) {
        logger.error("No server configured for deploy!");
        return;
      }
      const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: "confirm",
          name: "confirmed",
          message:
            "Deploying will overwrite code in your instance. Are you sure?",
          default: false,
        },
      ]);
      if (!confirmed) {
        return;
      }
      const paths = await getDeployPaths();
      logger.silly(`${paths.length} paths found...`);
      logger.silly(JSON.stringify(paths, null, 2));
      const appFileList = await AppUtils.getAppFileList(paths);
      const pushResults = await AppUtils.pushFiles(appFileList);
      logPushResults(pushResults);
    } catch (e) {
      throw e;
    }
  });
}

export async function statusCommand() {
  try {
    const client = defaultClient();
    let scopeObj = await unwrapSNResponse(client.getCurrentScope());
    logger.info(`Instance: ${process.env.SN_INSTANCE}`);
    logger.info(`Scope: ${scopeObj.scope}`);
    logger.info(`User: ${process.env.SN_USER}`);
  } catch (e) {
    throw e;
  }
}
