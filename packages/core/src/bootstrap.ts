import dotenv from "dotenv";
import * as ConfigManager from "./config";
import { logger } from "./Logger";

export async function init() {
  let configLoaded = false;
  try {
    await ConfigManager.loadConfigs();
    configLoaded = true;
  } catch (e) {
    logger.error("Failed to load configuration: " + String(e));
  }

  if (configLoaded) {
    try {
      let path = ConfigManager.getEnvPath();
      dotenv.config({ path });
    } catch (e) {
      logger.error("Failed to load environment: " + String(e));
    }
  }

  (await import("./commander")).initCommands();
}
