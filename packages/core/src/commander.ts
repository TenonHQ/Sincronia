import { Sinc, TSFIXME } from "@tenonhq/sincronia-types";
import {
  devCommand,
  refreshCommand,
  pushCommand,
  downloadCommand,
  initCommand,
  buildCommand,
  deployCommand,
  statusCommand,
} from "./commands";
import { initScopesCommand, watchAllScopesCommand } from "./allScopesCommands";
import {
  createUpdateSetCommand,
  switchUpdateSetCommand,
  listUpdateSetsCommand,
  showCurrentUpdateSetCommand,
  changeScopeCommand,
  showCurrentScopeCommand,
} from "./updateSetCommands";
import { dashboardCommand } from "./dashboardCommand";
import { schemaPullCommand } from "./schemaCommand";
import { initClaudeCommand } from "./claudeCommand";
import yargs from "yargs";
export async function initCommands() {
  const sharedOptions = {
    logLevel: {
      default: "info",
    },
  };

  yargs
    .command(["dev", "d"], "Start Development Mode", sharedOptions, devCommand)
    .command(
      ["refresh", "r"],
      "Refresh Manifest and download new files since last refresh",
      sharedOptions,
      refreshCommand,
    )
    .command(
      ["push [target]"],
      "[DESTRUCTIVE] Push all files from current local files to ServiceNow instance.",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          diff: {
            alias: "d",
            type: "string",
            default: "",
            describe: "Specify branch to do git diff against",
          },
          scopeSwap: {
            alias: "ss",
            type: "boolean",
            default: false,
            describe:
              "Will auto-swap to the correct scope for the files being pushed",
          },
          updateSet: {
            alias: "us",
            type: "string",
            default: "",
            describe:
              "Will create a new update set with the provided anme to store all changes into",
          },
          ci: {
            type: "boolean",
            default: false,
            describe: "Will skip confirmation prompts during the push process",
          },
        });
        return cmdArgs;
      },
      (args: TSFIXME) => {
        pushCommand(args as Sinc.PushCmdArgs);
      },
    )
    .command(
      "download <scope>",
      "Downloads a scoped application's files from ServiceNow. Must specify a scope prefix for a scoped app.",
      sharedOptions,
      (args: TSFIXME) => {
        downloadCommand(args as Sinc.CmdDownloadArgs);
      },
    )
    .command(
      "init",
      "Provisions an initial project for you",
      sharedOptions,
      initCommand,
    )
    .command(
      "initScopes",
      "Provisions an initial project for the scopes defined in the config",
      {
        ...sharedOptions,
        delay: {
          alias: "d",
          type: "number",
          default: 0,
          describe: "Delay in milliseconds between API calls (to prevent server overload)",
        },
      },
      initScopesCommand,
    )
    .command(
      "watchAllScopes",
      "Watch all scopes for file changes and display update set status",
      sharedOptions,
      watchAllScopesCommand,
    )
    .command(
      "build",
      "Build application files locally",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          diff: {
            alias: "d",
            type: "string",
            default: "",
            describe: "Specify branch to do git diff against",
          },
        });
        return cmdArgs;
      },
      (args: TSFIXME) => {
        buildCommand(args);
      },
    )
    .command(
      "deploy",
      "Deploy local build files to the scoped application",
      sharedOptions,
      deployCommand,
    )
    .command(
      "status",
      "Get information about the connected instance",
      sharedOptions,
      statusCommand,
    )
    .command(
      "createUpdateSet",
      "Create a new update set and switch to it",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          name: {
            alias: "n",
            type: "string",
            describe: "Name of the update set to create",
          },
          description: {
            alias: "d",
            type: "string",
            describe: "Description of the update set",
          },
          scope: {
            alias: "s",
            type: "string",
            describe: "Scope for the update set (e.g., x_company_app)",
          },
          skipDescription: {
            type: "boolean",
            default: false,
            describe: "Skip prompting for description",
          },
          skipScope: {
            type: "boolean",
            default: false,
            describe: "Skip prompting for scope",
          },
        });
        return cmdArgs;
      },
      createUpdateSetCommand,
    )
    .command(
      "switchUpdateSet",
      "Switch to an existing update set",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          name: {
            alias: "n",
            type: "string",
            describe: "Name or partial name of the update set to switch to",
          },
          scope: {
            alias: "s",
            type: "string",
            describe: "Filter update sets by scope",
          },
        });
        return cmdArgs;
      },
      switchUpdateSetCommand,
    )
    .command(
      "listUpdateSets",
      "List all in-progress update sets",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          scope: {
            alias: "s",
            type: "string",
            describe: "Filter update sets by scope",
          },
        });
        return cmdArgs;
      },
      listUpdateSetsCommand,
    )
    .command(
      "currentUpdateSet",
      "Show the current active update set",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          scope: {
            alias: "s",
            type: "string",
            describe: "Scope to check update set for",
          },
        });
        return cmdArgs;
      },
      showCurrentUpdateSetCommand,
    )
    .command(
      "changeScope",
      "Change to a different scope",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          scope: {
            alias: "s",
            type: "string",
            describe: "Scope to switch to (e.g., x_cadso_core)",
          },
        });
        return cmdArgs;
      },
      changeScopeCommand,
    )
    .command(
      "currentScope",
      "Show the current active scope",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
        });
        return cmdArgs;
      },
      showCurrentScopeCommand,
    )
    .command(
      "dashboard",
      "Launch the Update Set Dashboard web UI",
      sharedOptions,
      dashboardCommand,
    )
    .command(
      "schema <subcommand>",
      "Manage ServiceNow table schemas (subcommands: pull)",
      (cmdArgs: TSFIXME) => {
        cmdArgs.positional("subcommand", {
          describe: "Schema subcommand to run",
          choices: ["pull"],
        });
        cmdArgs.options({
          ...sharedOptions,
          output: {
            alias: "o",
            type: "string",
            describe: "Output directory for schema files (default: schema/)",
          },
          scope: {
            alias: "s",
            type: "string",
            describe: "Pull schema for a single scope (default: all scopes from sinc.config.js)",
          },
        });
        return cmdArgs;
      },
      (args: TSFIXME) => {
        if (args.subcommand === "pull") {
          schemaPullCommand(args);
        }
      },
    )
    .command(
      "init-claude",
      "Install Sincronia Claude Code skills to .claude/commands/",
      (cmdArgs) => {
        cmdArgs.options({
          ...sharedOptions,
          force: {
            alias: "f",
            type: "boolean",
            default: false,
            describe: "Overwrite existing skill files",
          },
        });
        return cmdArgs;
      },
      (args: TSFIXME) => {
        initClaudeCommand(args);
      },
    )
    .help().argv;
}
