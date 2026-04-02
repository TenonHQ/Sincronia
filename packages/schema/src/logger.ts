import chalk from "chalk";

export const logger = {
  info: function(message: string) {
    console.log(chalk.blue(message));
  },
  success: function(message: string) {
    console.log(chalk.green(message));
  },
  warn: function(message: string) {
    console.log(chalk.yellow(message));
  },
  error: function(message: string) {
    console.error(chalk.red(message));
  },
  detail: function(message: string) {
    console.log(chalk.gray("  " + message));
  },
  item: function(message: string) {
    console.log("  " + message);
  },
};
