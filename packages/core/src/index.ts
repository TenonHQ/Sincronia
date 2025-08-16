#!/usr/bin/env node
import { init } from "./bootstrap";
import { fileLogger } from "./FileLogger";

function main() {
  // Initialize file logging as early as possible
  fileLogger.info("Starting Sincronia...");
  init();
}

main();
