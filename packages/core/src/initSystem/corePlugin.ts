import { Sinc, SN } from "@tenonhq/sincronia-types";
import { snClient, unwrapSNResponse } from "../snClient";
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
export const corePlugin: Sinc.InitPlugin = {
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
      run: async (context: Sinc.InitContext): Promise<string | null> => {
        const instanceUrl = normalizeInstance(context.env.SN_INSTANCE);
        const client = snClient(instanceUrl, context.env.SN_USER, context.env.SN_PASSWORD);

        logger.info("Fetching application list...");
        const apps: SN.App[] = await unwrapSNResponse(client.getAppList());

        if (apps.length === 0) {
          logger.warn("No applications found on this instance.");
          return null;
        }

        const choices = apps.map((app: SN.App) => ({
          name: app.displayName + " (" + app.scope + ")",
          value: app.scope,
          short: app.displayName,
        }));

        const answer = await inquirer.prompt([{
          type: "list",
          name: "app",
          message: "Which app would you like to work with?",
          choices,
        }]);

        context.answers.selectedScope = answer.app;
        context.answers.apps = apps;
        return answer.app;
      },
    },
  ],

  initialize: async (context: Sinc.InitContext): Promise<void> => {
    const scope = context.answers.selectedScope;
    if (!scope) {
      logger.warn("No application selected — skipping initialization.");
      return;
    }

    const rootDir = context.rootDir;
    const configPath = path.join(rootDir, "sinc.config.js");

    // Write or merge sinc.config.js
    let hasExistingConfig = false;
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
      logger.warn("Config reload incomplete — this is expected during first-time init.");
    }

    // Check if manifest already exists for this scope
    const manifestPath = path.join(rootDir, "sinc.manifest." + scope + ".json");
    let hasManifest = false;
    try {
      fs.accessSync(manifestPath, fs.constants.F_OK);
      hasManifest = true;
    } catch (e) {
      // No existing manifest
    }

    if (hasManifest) {
      const redownload = await inquirer.prompt([{
        type: "confirm",
        name: "confirmed",
        message: "Manifest for " + scope + " already exists. Re-download?",
        default: false,
      }]);
      if (!redownload.confirmed) {
        logger.info("Skipping download for " + scope);
        return;
      }
    }

    // Download application files — errors propagate to orchestrator
    logger.info("Downloading " + scope + "...");
    const instanceUrl = normalizeInstance(context.env.SN_INSTANCE);
    const client = snClient(instanceUrl, context.env.SN_USER, context.env.SN_PASSWORD);
    const config = ConfigManager.getConfig();
    const man: SN.AppManifest = await unwrapSNResponse(
      client.getManifest(scope, config, true),
    );
    await AppUtils.processManifest(man);

    const tableNames = Object.keys(man.tables || {});
    const recordCount = tableNames.reduce((sum, t) => {
      return sum + Object.keys(man.tables[t].records || {}).length;
    }, 0);
    logger.success(chalk.green("✓ ServiceNow configured — " + tableNames.length + " tables, " + recordCount + " records"));
  },
};

/**
 * @description Validates ServiceNow credentials by testing the connection.
 * Called by the orchestrator after all core login hooks are collected.
 */
export async function validateCoreLogin(context: Sinc.InitContext): Promise<true | string> {
  const instance = context.env.SN_INSTANCE;
  const user = context.env.SN_USER;
  const password = context.env.SN_PASSWORD;

  if (!instance || !user || !password) {
    return "Missing required credentials";
  }

  const instanceUrl = normalizeInstance(instance);

  try {
    const client = snClient(instanceUrl, user, password);
    await unwrapSNResponse(client.getAppList());
    context.env.SN_INSTANCE = instanceUrl;
    return true;
  } catch (e) {
    return "Connection failed — check your instance URL, username, and password.";
  }
}

export function normalizeInstance(instance: string): string {
  let url = instance.trim().replace("https://", "").replace("http://", "");
  if (!url.endsWith("/")) {
    url += "/";
  }
  return url;
}
