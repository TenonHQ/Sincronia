#!/usr/bin/env node
import { init } from "./bootstrap";
import { fileLogger } from "./FileLogger";

async function main() {
  // Initialize file logging as early as possible
  fileLogger.info("Starting Sincronia...");
  await init();
}

main().catch(function (e) {
  fileLogger.error("Fatal error: " + String(e));
  process.exit(1);
});
