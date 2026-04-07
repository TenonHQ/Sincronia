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
  successFunc: () => void | Promise<void>,
  swapScopes: boolean = false,
) {
  try {
    const scopeCheck = await AppUtils.checkScope(swapScopes);
    if (!scopeCheck.match) {
      scopeCheckMessage(scopeCheck);
      // Throw exception to register this as an error
      throw new Error();
    } else {
      await successFunc();
    }
  } catch (e) {
    logger.error(
      "Scope check failed. Verify your project configuration or run `npx sinc init`",
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
  await scopeCheck(async () => {
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
  await scopeCheck(async () => {
    try {
      if (!log) setLogLevel({ logLevel: "warn" });
      fileLogger.debug("Syncing manifest from instance");
      await AppUtils.syncManifest();
      logger.success("Refresh complete!");
      setLogLevel(args);
    } catch (e) {
      throw e;
    }
  });
}
export async function pushCommand(args: Sinc.PushCmdArgs): Promise<void> {
  setLogLevel(args);
  await scopeCheck(async () => {
    try {
      const { updateSet, ci: skipPrompt, target, diff } = args;
      let encodedPaths;
      if (target !== undefined && target !== "") encodedPaths = target;
      else encodedPaths = await gitDiffToEncodedPaths(diff);

      const fileList = await AppUtils.getAppFileList(encodedPaths);
      const instance = process.env.SN_INSTANCE || "unknown";
      logger.info(fileList.length + " files to push to " + instance);

      if (!skipPrompt) {
        const targetServer = process.env.SN_INSTANCE;
        if (!targetServer) {
          logger.error("No SN_INSTANCE configured. Set it in your .env file.");
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
    const instance = process.env.SN_INSTANCE || "unknown";
    logger.info("Downloading from " + instance + " (scope: " + (args.scope || "default") + ")...");

    const client = defaultClient();
    const config = ConfigManager.getConfig();

    // Resolve config for this scope (strips _ directives for API, provides table whitelist)
    var resolved = ConfigManager.resolveConfigForScope(args.scope);
    var apiConfig = Object.assign({}, config, {
      includes: resolved.apiIncludes,
      excludes: resolved.apiExcludes,
    });

    const man = await unwrapSNResponse(
      client.getManifest(args.scope, apiConfig, true),
    );

    // Client-side table filtering — only keep tables in the _tables whitelist
    if (resolved.tables && resolved.tables.length > 0) {
      var allTableNames = Object.keys(man.tables || {});
      var filtered: any = {};
      for (var i = 0; i < allTableNames.length; i++) {
        if (resolved.tables.indexOf(allTableNames[i]) !== -1) {
          filtered[allTableNames[i]] = man.tables[allTableNames[i]];
        }
      }
      var filteredOut = allTableNames.length - Object.keys(filtered).length;
      if (filteredOut > 0) {
        logger.info("Filtered " + filteredOut + " tables not in _tables whitelist");
      }
      man.tables = filtered;
    }

    const tableCount = Object.keys(man.tables).length;
    var recordCount = 0;
    Object.keys(man.tables).forEach(function(tableName) {
      recordCount += Object.keys(man.tables[tableName].records).length;
    });
    logger.info("Received " + tableCount + " tables, " + recordCount + " records");
    fileLogger.debug("Download manifest: " + tableCount + " tables, " + recordCount + " records");

    logger.info("Writing files to disk...");
    await AppUtils.processManifest(man, true);
    logger.success("Download complete — " + recordCount + " records written");
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
  await scopeCheck(async () => {
    try {
      const targetServer = process.env.SN_INSTANCE || "";
      if (!targetServer) {
        logger.error("No SN_INSTANCE configured. Set it in your .env file.");
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
    logger.info("Instance:  " + (process.env.SN_INSTANCE || "not set"));
    logger.info("Scope:     " + scopeObj.scope);
    logger.info("User:      " + (process.env.SN_USER || "not set"));
  } catch (e) {
    throw e;
  }
}
