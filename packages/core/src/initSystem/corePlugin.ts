import { Sinc, SN } from "@tenonhq/sincronia-types";
import { snClient, unwrapSNResponse, defaultClient } from "../snClient";
import { logger } from "../Logger";
import * as ConfigManager from "../config";
import * as AppUtils from "../appUtils";
import inquirer from "inquirer";
import chalk from "chalk";
import fs from "fs";
import path from "path";

/**
 * @description Core init plugin — handles ServiceNow authentication, app selection, and file download.
 * This plugin is always included in sinc init and sinc login.
 */
export var corePlugin: Sinc.InitPlugin = {
  name: "core",
  displayName: "ServiceNow",
  description: "Connect to a ServiceNow instance and sync application files",

  login: [
    {
      envKey: "SN_INSTANCE",
      prompt: {
        type: "input",
        message: "ServiceNow instance (e.g. mycompany.service-now.com):",
      },
      required: true,
    },
    {
      envKey: "SN_USER",
      prompt: {
        type: "input",
        message: "Username:",
      },
      required: true,
    },
    {
      envKey: "SN_PASSWORD",
      prompt: {
        type: "password",
        message: "Password:",
        mask: "*",
      },
      required: true,
    },
  ],

  configure: [
    {
      key: "app",
      label: "Selecting ServiceNow application",
      run: async function (context: Sinc.InitContext): Promise<any> {
        var instanceUrl = normalizeInstance(context.env.SN_INSTANCE);
        var client = snClient(instanceUrl, context.env.SN_USER, context.env.SN_PASSWORD);

        logger.info("Fetching application list...");
        var apps: SN.App[] = await unwrapSNResponse(client.getAppList());

        if (apps.length === 0) {
          logger.warn("No applications found on this instance.");
          return null;
        }

        var choices = apps.map(function (app: SN.App) {
          return {
            name: app.displayName + " (" + app.scope + ")",
            value: app.scope,
            short: app.displayName,
          };
        });

        var answer = await inquirer.prompt([
          {
            type: "list",
            name: "app",
            message: "Which app would you like to work with?",
            choices: choices,
          },
        ]);

        context.answers.selectedScope = answer.app;
        context.answers.apps = apps;
        return answer.app;
      },
    },
  ],

  initialize: async function (context: Sinc.InitContext): Promise<void> {
    var scope = context.answers.selectedScope;
    if (!scope) {
      logger.warn("No application selected — skipping initialization.");
      return;
    }

    var rootDir = context.rootDir;
    var configPath = path.join(rootDir, "sinc.config.js");

    // Write or merge sinc.config.js
    var hasExistingConfig = false;
    try {
      fs.accessSync(configPath, fs.constants.F_OK);
      hasExistingConfig = true;
    } catch (e) {
      // No existing config
    }

    if (!hasExistingConfig) {
      logger.info("Generating sinc.config.js...");
      fs.writeFileSync(configPath, ConfigManager.getDefaultConfigFile(), "utf8");
    } else {
      logger.info("sinc.config.js already exists — preserving configuration.");
    }

    // Reload configs so ConfigManager picks up the new/existing config
    try {
      await ConfigManager.loadConfigs();
    } catch (e) {
      // Config load may partially fail if manifest is missing — that's expected during init
    }

    // Check if manifest already exists for this scope
    var manifestPath = path.join(rootDir, "sinc.manifest." + scope + ".json");
    var hasManifest = false;
    try {
      fs.accessSync(manifestPath, fs.constants.F_OK);
      hasManifest = true;
    } catch (e) {
      // No existing manifest
    }

    if (hasManifest) {
      var redownload = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmed",
          message: "Manifest for " + scope + " already exists. Re-download?",
          default: false,
        },
      ]);
      if (!redownload.confirmed) {
        logger.info("Skipping download for " + scope);
        return;
      }
    }

    // Download application files
    logger.info("Downloading " + scope + "...");
    try {
      var instanceUrl = normalizeInstance(context.env.SN_INSTANCE);
      var client = snClient(instanceUrl, context.env.SN_USER, context.env.SN_PASSWORD);
      var config = ConfigManager.getConfig();
      var man: any = await unwrapSNResponse(
        client.getManifest(scope, config, true),
      );
      await AppUtils.processManifest(man);

      var tableCount = Object.keys(man.tables || {}).length;
      var recordCount = 0;
      var tableNames = Object.keys(man.tables || {});
      for (var i = 0; i < tableNames.length; i++) {
        recordCount += Object.keys(man.tables[tableNames[i]].records || {}).length;
      }
      logger.success(chalk.green("✓ ServiceNow configured — " + tableCount + " tables, " + recordCount + " records"));
    } catch (e) {
      var message = e instanceof Error ? e.message : String(e);
      logger.error("Failed to download application files: " + message);
    }
  },
};

/**
 * @description Validates ServiceNow credentials by testing the connection.
 * Called by the orchestrator after all core login hooks are collected.
 */
export async function validateCoreLogin(context: Sinc.InitContext): Promise<true | string> {
  var instance = context.env.SN_INSTANCE;
  var user = context.env.SN_USER;
  var password = context.env.SN_PASSWORD;

  if (!instance || !user || !password) {
    return "Missing required credentials";
  }

  var instanceUrl = normalizeInstance(instance);

  try {
    var client = snClient(instanceUrl, user, password);
    await unwrapSNResponse(client.getAppList());
    // Store normalized URL back
    context.env.SN_INSTANCE = instanceUrl;
    return true;
  } catch (e) {
    return "Connection failed — check your instance URL, username, and password.";
  }
}

function normalizeInstance(instance: string): string {
  var url = instance.trim().replace("https://", "").replace("http://", "");
  if (!url.endsWith("/")) {
    url += "/";
  }
  return url;
}
