import { Sinc, SN } from "@tenonhq/sincronia-types";
import { snClient, unwrapSNResponse } from "../snClient";
import { logger } from "../Logger";
import * as ConfigManager from "../config";
import { processScope } from "../allScopesCommands";
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
      key: "apps",
      label: "Selecting ServiceNow applications",
      run: async (context: Sinc.InitContext): Promise<string[] | null> => {
        var baseUrl = instanceBaseUrl(context.env.SN_INSTANCE);
        var client = snClient(baseUrl, context.env.SN_USER, context.env.SN_PASSWORD);

        logger.info("Fetching application list...");
        var apps: SN.App[] = await unwrapSNResponse(client.getAppList());

        if (apps.length === 0) {
          logger.warn("No applications found on this instance.");
          return null;
        }

        // Pre-check scopes that exist in the current config
        var existingScopes = new Set<string>();
        if (context.hasConfig) {
          try {
            var existingConfig = require(path.join(context.rootDir, "sinc.config.js"));
            if (existingConfig.scopes) {
              Object.keys(existingConfig.scopes).forEach(function(s) {
                existingScopes.add(s);
              });
            }
          } catch (e) {
            // ignore — no existing config or malformed
          }
        }

        var choices = apps.map(function(app: SN.App) {
          return {
            name: app.displayName + " (" + app.scope + ")",
            value: app.scope,
            short: app.displayName,
            checked: existingScopes.has(app.scope),
          };
        });

        var answer = await inquirer.prompt([{
          type: "checkbox",
          name: "apps",
          message: "Which apps would you like to work with? (space to select, enter to confirm)",
          choices: choices,
          validate: function(input: string[]) {
            if (input.length === 0) return "Select at least one application.";
            return true;
          },
        }]);

        var selectedScopes: string[] = answer.apps;
        context.answers.selectedScopes = selectedScopes;
        context.answers.selectedScope = selectedScopes[0]; // backward compat
        context.answers.apps = apps;

        // Prompt for source directory per selected scope
        var scopeDirectories: Record<string, string> = {};
        logger.info("");
        logger.info(chalk.bold("  Source directories:"));

        for (var i = 0; i < selectedScopes.length; i++) {
          var scope = selectedScopes[i];
          var app = apps.find(function(a: SN.App) { return a.scope === scope; });
          var displayName = app ? app.displayName : scope;

          // Check if existing config already has a sourceDirectory for this scope
          var existingDir = "";
          if (existingScopes.has(scope)) {
            try {
              var cfgScopes = require(path.join(context.rootDir, "sinc.config.js")).scopes;
              if (cfgScopes && cfgScopes[scope] && cfgScopes[scope].sourceDirectory) {
                existingDir = cfgScopes[scope].sourceDirectory;
              }
            } catch (e) {
              // ignore
            }
          }

          // Suggest a friendly name from displayName, or use existing
          var suggestedDir = existingDir || ("src/" + displayName.replace(/\s+/g, ""));

          var dirAnswer = await inquirer.prompt([{
            type: "input",
            name: "dir",
            message: scope + ":",
            default: suggestedDir,
          }]);

          scopeDirectories[scope] = dirAnswer.dir;
        }

        context.answers.scopeDirectories = scopeDirectories;
        return selectedScopes;
      },
    },
  ],

  initialize: async (context: Sinc.InitContext): Promise<void> => {
    var selectedScopes: string[] = context.answers.selectedScopes || [];
    if (selectedScopes.length === 0) {
      // Backward compat: single scope from old flow
      if (context.answers.selectedScope) {
        selectedScopes = [context.answers.selectedScope];
      } else {
        logger.warn("No applications selected — skipping initialization.");
        return;
      }
    }

    var rootDir = context.rootDir;
    var configPath = path.join(rootDir, "sinc.config.js");
    var scopeDirectories: Record<string, string> = context.answers.scopeDirectories || {};

    // Write or preserve sinc.config.js
    var configAction = context.answers.configAction || "keep";
    var hasExistingConfig = false;
    try {
      fs.accessSync(configPath, fs.constants.F_OK);
      hasExistingConfig = true;
    } catch (e) {
      // No existing config
    }

    if (!hasExistingConfig || configAction === "replace") {
      logger.info("Generating sinc.config.js...");
      var scopeEntries = selectedScopes.map(function(scope) {
        return {
          scope: scope,
          sourceDirectory: scopeDirectories[scope] || ("src/" + scope),
        };
      });
      fs.writeFileSync(configPath, ConfigManager.generateConfigFile({ scopes: scopeEntries }), "utf8");
      logger.success(chalk.green("✓ Generated sinc.config.js with " + selectedScopes.length + " scope(s)"));
    } else {
      logger.info("sinc.config.js already exists — preserving configuration.");
    }

    // Reload configs so ConfigManager picks up the new/existing config
    try {
      await ConfigManager.loadConfigs();
    } catch (e) {
      logger.warn("Config reload incomplete — this is expected during first-time init.");
    }

    // Check which scopes already have manifests
    var scopesWithManifests: string[] = [];
    var scopesToDownload: string[] = [];

    for (var i = 0; i < selectedScopes.length; i++) {
      var scope = selectedScopes[i];
      var manifestPath = path.join(rootDir, "sinc.manifest." + scope + ".json");
      var hasManifest = false;
      try {
        fs.accessSync(manifestPath, fs.constants.F_OK);
        hasManifest = true;
      } catch (e) {
        // No manifest
      }

      if (hasManifest) {
        scopesWithManifests.push(scope);
      } else {
        scopesToDownload.push(scope);
      }
    }

    // Batch prompt for scopes that already have manifests
    if (scopesWithManifests.length > 0) {
      var redownload = await inquirer.prompt([{
        type: "confirm",
        name: "confirmed",
        message: scopesWithManifests.length + " scope(s) already have manifests (" + scopesWithManifests.join(", ") + "). Re-download?",
        default: false,
      }]);
      if (redownload.confirmed) {
        scopesToDownload = scopesToDownload.concat(scopesWithManifests);
      }
    }

    if (scopesToDownload.length === 0) {
      logger.info("No scopes to download — all manifests up to date.");
      return;
    }

    // Download all scopes using the battle-tested processScope pipeline
    logger.info("Downloading " + scopesToDownload.length + " scope(s)...");

    var config = ConfigManager.getConfig();
    var scopePromises = scopesToDownload.map(function(scopeName) {
      var scopeConfig = (config.scopes && config.scopes[scopeName]) || {};
      return processScope(scopeName, scopeConfig as any, 0);
    });

    var results = await Promise.allSettled(scopePromises);

    // Write per-scope manifest files and tally results
    var successCount = 0;
    var failCount = 0;

    for (var r = 0; r < results.length; r++) {
      var result = results[r];
      var scopeName = scopesToDownload[r];

      if (result.status === "fulfilled" && result.value.success) {
        successCount++;
        // Write per-scope manifest
        if (result.value.manifest) {
          var scopeManifestPath = ConfigManager.getScopeManifestPath(scopeName);
          fs.writeFileSync(scopeManifestPath, JSON.stringify(result.value.manifest, null, 2), "utf8");
        }
      } else {
        failCount++;
        var error = result.status === "rejected" ? result.reason : (result.value && result.value.error);
        logger.error("Failed to initialize " + scopeName + ": " + (error && error.message ? error.message : "Unknown error"));
      }
    }

    // Summary
    logger.info("");
    if (failCount === 0) {
      logger.success(chalk.green("✓ ServiceNow configured — " + successCount + " scope(s) initialized"));
    } else {
      logger.warn(successCount + "/" + scopesToDownload.length + " scopes initialized, " + failCount + " failed");
    }
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
  const baseUrl = instanceBaseUrl(instance);

  try {
    const client = snClient(baseUrl, user, password);
    await unwrapSNResponse(client.getAppList());
    context.env.SN_INSTANCE = instanceUrl;
    return true;
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e && e.response && e.response.status;

    if (msg.includes("Invalid URL") || msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
      return "Instance not found — check the URL (got: " + instanceUrl + ")";
    }
    if (status === 401 || msg.includes("401")) {
      return "Invalid username or password.";
    }
    if (status === 403 || msg.includes("403")) {
      return "Access denied — user may lack required roles.";
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET")) {
      return "Could not reach " + instanceUrl + " — check network connectivity.";
    }
    return "Connection failed: " + msg;
  }
}

export function normalizeInstance(instance: string): string {
  let url = instance.trim().replace("https://", "").replace("http://", "");
  if (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  return url;
}

function instanceBaseUrl(instance: string): string {
  return "https://" + normalizeInstance(instance) + "/";
}
