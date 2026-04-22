#!/usr/bin/env node
import { init } from "./bootstrap";
import { fileLogger } from "./FileLogger";

// Library exports — consumers can `import { decodeV2Values } from "@tenonhq/sincronia-core"`.
// Keep exports above the CLI entry so bundlers/TS can tree-shake and require() consumers
// never accidentally invoke main().
export { decodeV2Values, encodeV2Values, V2ValueEntry } from "./flowDesigner/values";

async function main() {
  // Initialize file logging as early as possible
  fileLogger.info("Starting Sincronia...");
  await init();
}

// Only run the CLI when this file is executed directly (e.g. `npx sinc`, `node dist/index.js`).
// When imported as a library, require.main !== module and main() is skipped.
if (require.main === module) {
  main().catch(function (e) {
    fileLogger.error("Fatal error: " + String(e));
    process.exit(1);
  });
}
