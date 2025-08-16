import dotenv from "dotenv";
import * as ConfigManager from "./config";
import { fileLogger } from "./FileLogger";

export async function init() {
  try {
    await ConfigManager.loadConfigs();
  } catch (e) {
    fileLogger.error(String(e));
  }

  let path = ConfigManager.getEnvPath();
  dotenv.config({
    path,
  });
  (await import("./commander")).initCommands();
}
