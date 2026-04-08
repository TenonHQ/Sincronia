import { Sinc } from "@tenonhq/sincronia-types";
import inquirer from "inquirer";
import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { logger } from "../Logger";
import { writeEnvVars } from "../FileUtils";
import { discoverPlugins } from "./discovery";
import { corePlugin, validateCoreLogin } from "./corePlugin";

// ============================================================================
// Init Context
// ============================================================================

/**
 * @description Builds an InitContext from the current environment.
 * Reads existing .env if present, resolves rootDir from cwd.
 */
function buildInitContext(): Sinc.InitContext {
  var rootDir = process.cwd();
  var envPath = path.resolve(rootDir, ".env");
  var env: Record<string, string> = {};

  // Load existing .env values
  try {
    var parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
    var keys = Object.keys(parsed);
    for (var i = 0; i < keys.length; i++) {
      env[keys[i]] = parsed[keys[i]];
    }
  } catch (e) {
    // No .env yet — starting fresh
  }

  // Also pull from process.env for values set outside .env
  var envKeys = ["SN_INSTANCE", "SN_USER", "SN_PASSWORD", "CLICKUP_API_TOKEN", "CLICKUP_TEAM_ID", "DASHBOARD_PORT"];
  for (var j = 0; j < envKeys.length; j++) {
    if (process.env[envKeys[j]] && !env[envKeys[j]]) {
      env[envKeys[j]] = process.env[envKeys[j]] as string;
    }
  }

  var hasConfig = false;
  try {
    fs.accessSync(path.join(rootDir, "sinc.config.js"), fs.constants.F_OK);
    hasConfig = true;
  } catch (e) {
    // No config yet
  }

  return {
    env: env,
    answers: {},
    rootDir: rootDir,
    hasConfig: hasConfig,
  };
}

// ============================================================================
// Plugin Selection
// ============================================================================

/**
 * @description Prompts the user to select which plugins to configure.
 * Core is always selected and cannot be deselected.
 */
async function promptPluginSelection(externalPlugins: Sinc.InitPlugin[]): Promise<Sinc.InitPlugin[]> {
  if (externalPlugins.length === 0) {
    return [corePlugin];
  }

  var choices = externalPlugins.map(function (plugin: Sinc.InitPlugin) {
    return {
      name: plugin.displayName + " — " + plugin.description,
      value: plugin.name,
      checked: false,
    };
  });

  var answer = await inquirer.prompt([
    {
      type: "checkbox",
      name: "plugins",
      message: "Which integrations would you like to configure?",
      choices: choices,
    },
  ]);

  var selectedNames: Record<string, boolean> = {};
  var selected: string[] = answer.plugins;
  for (var i = 0; i < selected.length; i++) {
    selectedNames[selected[i]] = true;
  }

  var result: Sinc.InitPlugin[] = [corePlugin];
  for (var j = 0; j < externalPlugins.length; j++) {
    if (selectedNames[externalPlugins[j].name]) {
      result.push(externalPlugins[j]);
    }
  }

  return result;
}

// ============================================================================
// Phase Runners
// ============================================================================

/**
 * @description Runs the login phase for a single plugin.
 * Iterates through declarative login hooks, prompts for values, validates.
 */
async function runLoginPhase(plugin: Sinc.InitPlugin, context: Sinc.InitContext): Promise<void> {
  var hooks = plugin.login;
  if (!hooks || hooks.length === 0) return;

  for (var i = 0; i < hooks.length; i++) {
    var hook = hooks[i];
    var existingValue = context.env[hook.envKey] || "";

    // Show instructions if provided
    if (hook.instructions && hook.instructions.length > 0) {
      logger.info("");
      for (var j = 0; j < hook.instructions.length; j++) {
        logger.info(hook.instructions[j]);
      }
      logger.info("");
    }

    // Build the prompt
    var promptConfig: any = {
      type: hook.prompt.type,
      name: "value",
      message: hook.prompt.message,
    };

    if (hook.prompt.mask) {
      promptConfig.mask = hook.prompt.mask;
    }

    // Show existing value as default for non-password fields
    if (existingValue && hook.prompt.type !== "password") {
      promptConfig.default = existingValue;
    }

    // Add basic validation for required fields
    var isRequired = hook.required !== false;
    if (isRequired) {
      promptConfig.validate = function (input: string) {
        if (!input || input.trim() === "") return "This field is required";
        return true;
      };
    }

    var answer = await inquirer.prompt([promptConfig]);
    context.env[hook.envKey] = answer.value.trim();
  }

  // Run per-hook validation if defined
  for (var k = 0; k < hooks.length; k++) {
    if (hooks[k].validate) {
      var result = await hooks[k].validate!(context.env[hooks[k].envKey], context);
      if (result !== true) {
        logger.error(chalk.red("✗ " + result));
        throw new Error("Validation failed for " + hooks[k].envKey);
      }
    }
  }

  // Core plugin gets special post-login validation (all 3 credentials at once)
  if (plugin.name === "core") {
    logger.info("Validating credentials...");
    var coreResult = await validateCoreLogin(context);
    if (coreResult !== true) {
      logger.error(chalk.red("✗ " + coreResult));
      throw new Error("ServiceNow login failed");
    }
    logger.success(chalk.green("✓ Connected to " + context.env.SN_INSTANCE));
  }
}

/**
 * @description Runs the configure phase for a single plugin.
 * Calls each hook's run() function with the current context.
 */
async function runConfigurePhase(plugin: Sinc.InitPlugin, context: Sinc.InitContext): Promise<void> {
  var hooks = plugin.configure;
  if (!hooks || hooks.length === 0) return;

  for (var i = 0; i < hooks.length; i++) {
    var hook = hooks[i];
    logger.debug("Running configure hook: " + hook.label);
    var result = await hook.run(context);
    if (result !== null && result !== undefined) {
      context.answers[hook.key] = result;
    }
  }
}

/**
 * @description Saves all collected env vars to .env (merge-style).
 * Also sets them on process.env for immediate use.
 */
function saveEnvVars(context: Sinc.InitContext): void {
  var vars: Array<{ key: string; value: string }> = [];
  var envKeys = Object.keys(context.env);

  for (var i = 0; i < envKeys.length; i++) {
    var key = envKeys[i];
    // Skip internal/temporary keys (prefixed with _)
    if (key.charAt(0) === "_") continue;
    vars.push({ key: key, value: context.env[key] });
    // Also set on process.env for immediate use
    process.env[key] = context.env[key];
  }

  if (vars.length > 0) {
    writeEnvVars({ vars: vars });
    logger.success(chalk.green("✓ Saved to .env (existing values preserved)"));
  }
}

// ============================================================================
// Public API
// ============================================================================

export interface RunInitOptions {
  logLevel?: string;
}

export interface RunLoginOptions {
  logLevel?: string;
  pluginName?: string;
  all?: boolean;
  instance?: string;
  user?: string;
  password?: string;
}

/**
 * @description Runs the full init flow: discover → select → login → configure → initialize.
 */
export async function runInit(options?: RunInitOptions): Promise<void> {
  try {
    logger.info("");
    logger.info(chalk.bold("  Sincronia Setup"));
    logger.info("  " + "═".repeat(40));
    logger.info("");

    // 1. Discover plugins
    var externalPlugins = discoverPlugins();

    if (externalPlugins.length > 0) {
      logger.info("  Detected packages:");
      logger.info("    ● sincronia-core (" + chalk.cyan("ServiceNow") + ")");
      for (var i = 0; i < externalPlugins.length; i++) {
        logger.info("    ● sincronia-" + externalPlugins[i].name + " (" + chalk.cyan(externalPlugins[i].displayName) + ")");
      }
      logger.info("");
    }

    // 2. Select plugins
    var selectedPlugins = await promptPluginSelection(externalPlugins);

    // 3. Build context
    var context = buildInitContext();

    // 4. Login phase
    logger.info("");
    logger.info(chalk.bold("  ── Login " + "─".repeat(30)));
    logger.info("");

    for (var lp = 0; lp < selectedPlugins.length; lp++) {
      await runLoginPhase(selectedPlugins[lp], context);
    }

    // 5. Save env vars after login
    saveEnvVars(context);

    // 6. Configure phase
    logger.info("");
    logger.info(chalk.bold("  ── Configure " + "─".repeat(26)));
    logger.info("");

    for (var cp = 0; cp < selectedPlugins.length; cp++) {
      await runConfigurePhase(selectedPlugins[cp], context);
    }

    // 7. Initialize phase
    logger.info("");
    logger.info(chalk.bold("  ── Initialize " + "─".repeat(25)));
    logger.info("");

    for (var ip = 0; ip < selectedPlugins.length; ip++) {
      if (selectedPlugins[ip].initialize) {
        await selectedPlugins[ip].initialize!(context);
      }
    }

    // 8. Summary
    logger.info("");
    logger.info("  " + "═".repeat(40));
    logger.success(chalk.green("  Setup complete!") + " Run " + chalk.cyan("sinc watch") + " to start.");
    logger.info("");
  } catch (e) {
    var message = e instanceof Error ? e.message : String(e);
    logger.error("Init failed: " + message);
  }
}

/**
 * @description Runs only the login phase. Used by `sinc login`.
 * Supports targeting a specific plugin or all plugins.
 */
export async function runLogin(options?: RunLoginOptions): Promise<void> {
  try {
    var opts = options || {};
    var context = buildInitContext();

    // Apply CLI flag overrides for non-interactive mode
    if (opts.instance) context.env.SN_INSTANCE = opts.instance;
    if (opts.user) context.env.SN_USER = opts.user;
    if (opts.password) context.env.SN_PASSWORD = opts.password;

    // Check if all core credentials provided via flags (non-interactive mode)
    var hasAllCoreFlags = opts.instance && opts.user && opts.password;

    // Determine which plugins to log in to
    var pluginsToLogin: Sinc.InitPlugin[] = [];

    if (opts.pluginName) {
      // Specific plugin requested
      if (opts.pluginName === "core" || opts.pluginName === "servicenow" || opts.pluginName === "sn") {
        pluginsToLogin = [corePlugin];
      } else {
        var externalPlugins = discoverPlugins();
        var found = false;
        for (var i = 0; i < externalPlugins.length; i++) {
          if (externalPlugins[i].name === opts.pluginName) {
            pluginsToLogin = [externalPlugins[i]];
            found = true;
            break;
          }
        }
        if (!found) {
          logger.error("Plugin '" + opts.pluginName + "' not found. Available plugins:");
          for (var j = 0; j < externalPlugins.length; j++) {
            logger.info("  - " + externalPlugins[j].name + " (" + externalPlugins[j].displayName + ")");
          }
          return;
        }
      }
    } else if (opts.all) {
      // All plugins
      pluginsToLogin = [corePlugin].concat(discoverPlugins());
    } else {
      // Default: core only
      pluginsToLogin = [corePlugin];
    }

    logger.info("");
    logger.info(chalk.bold("  ServiceNow Login"));
    logger.info("  " + "─".repeat(40));
    logger.info("");

    if (hasAllCoreFlags && pluginsToLogin.length === 1 && pluginsToLogin[0].name === "core") {
      // Non-interactive mode — validate and save directly
      logger.info("Validating credentials...");
      var result = await validateCoreLogin(context);
      if (result !== true) {
        logger.error(chalk.red("✗ " + result));
        return;
      }
      logger.success(chalk.green("✓ Connected to " + context.env.SN_INSTANCE));
    } else {
      // Interactive mode — run login phases
      for (var lp = 0; lp < pluginsToLogin.length; lp++) {
        await runLoginPhase(pluginsToLogin[lp], context);
      }
    }

    // Save env vars
    saveEnvVars(context);

    logger.info("");
    logger.info("You can now use:");
    logger.info("  sinc init              — Initialize a new project");
    logger.info("  sinc watch             — Watch for changes");
    logger.info("  sinc status            — Check instance connection");
    logger.info("");
  } catch (e) {
    var message = e instanceof Error ? e.message : String(e);
    logger.error("Login failed: " + message);
  }
}
