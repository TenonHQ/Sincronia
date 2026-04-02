import dotenv from "dotenv";
import * as ConfigManager from "./config";
import { logger } from "./Logger";

export async function init() {
  try {
    await ConfigManager.loadConfigs();
  } catch (e) {
    logger.error("Failed to load configuration: " + String(e));
  }

  let path = ConfigManager.getEnvPath();
  dotenv.config({
    path,
  });
  (await import("./commander")).initCommands();
}
