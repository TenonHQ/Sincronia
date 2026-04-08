import { createClickUpApi } from "./client";
import type { ClickUpTeam } from "./types";

/**
 * @description ClickUp init plugin for Sincronia.
 * Discovered automatically by sincronia-core when this package is installed.
 * Adds ClickUp API token login and workspace selection to `sinc init`.
 */
export var sincPlugin = {
  name: "clickup",
  displayName: "ClickUp",
  description: "Task management and PR linking",

  login: [
    {
      envKey: "CLICKUP_API_TOKEN",
      prompt: {
        type: "password" as const,
        message: "ClickUp API Token:",
        mask: "*",
      },
      instructions: [
        "To get your ClickUp API token:",
        "  1. Go to ClickUp → Settings (bottom-left) → Apps",
        '  2. Under "API Token", click Generate',
        "  3. Copy the token and paste it below",
      ],
      required: true,
      validate: async function (value: string, context: any): Promise<true | string> {
        var api = createClickUpApi({ token: value });
        try {
          var teams = await api.getTeams();
          if (teams.length === 0) {
            return "Token is valid but no workspaces found. Check your ClickUp permissions.";
          }
          // Stash teams in context for the configure phase
          context.answers._clickup_teams = teams;
          return true;
        } catch (e) {
          return "Invalid ClickUp API token — could not connect.";
        }
      },
    },
  ],

  configure: [
    {
      key: "CLICKUP_TEAM_ID",
      label: "Selecting ClickUp workspace",
      run: async function (context: any): Promise<any> {
        var teams: ClickUpTeam[] = context.answers._clickup_teams;
        if (!teams || teams.length === 0) {
          return null;
        }

        // Auto-select if only one workspace
        if (teams.length === 1) {
          context.env.CLICKUP_TEAM_ID = teams[0].id;
          // Use dynamic require — inquirer is provided by sincronia-core at runtime
          try {
            var chalk = require("chalk");
            console.log(chalk.green("✓ ClickUp workspace auto-selected: " + teams[0].name));
          } catch (e) {
            console.log("ClickUp workspace auto-selected: " + teams[0].name);
          }
          return teams[0].id;
        }

        // Multiple workspaces — prompt user to select
        var inquirer = require("inquirer");
        var promptFn = inquirer.prompt || (inquirer.default && inquirer.default.prompt);

        var choices = teams.map(function (t: ClickUpTeam) {
          var memberCount = t.members ? t.members.length : 0;
          return {
            name: t.name + " (" + memberCount + " members)",
            value: t.id,
          };
        });

        var answer = await promptFn([
          {
            type: "list",
            name: "teamId",
            message: "Select a ClickUp workspace:",
            choices: choices,
          },
        ]);

        context.env.CLICKUP_TEAM_ID = answer.teamId;
        return answer.teamId;
      },
    },
  ],
};
