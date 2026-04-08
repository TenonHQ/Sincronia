import { Sinc } from "@tenonhq/sincronia-types";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../Logger";

const SKIP_PACKAGES = new Set(["sincronia-core", "sincronia-types"]);
const MAX_PARENT_DEPTH = 3;

/**
 * @description Scans node_modules for @tenonhq/sincronia-* packages that export a sincPlugin.
 * @returns {Sinc.InitPlugin[]} Array of discovered init plugins.
 */
export function discoverPlugins(): Sinc.InitPlugin[] {
  const plugins: Sinc.InitPlugin[] = [];
  const seen = new Set<string>();

  const searchPaths = [
    path.resolve(process.cwd(), "node_modules", "@tenonhq"),
    path.resolve(__dirname, "..", "..", "..", "@tenonhq"),
  ];

  // Check parent directories for monorepo hoisted node_modules (capped depth)
  let current = process.cwd();
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    const hoisted = path.join(parent, "node_modules", "@tenonhq");
    if (!searchPaths.includes(hoisted)) {
      searchPaths.push(hoisted);
    }
    current = parent;
  }

  for (const searchPath of searchPaths) {
    let dirs: string[];
    try {
      dirs = fs.readdirSync(searchPath);
    } catch (e) {
      continue;
    }

    dirs
      .filter(name => name.startsWith("sincronia-") && !SKIP_PACKAGES.has(name) && !seen.has(name))
      .forEach(dirName => {
        seen.add(dirName);

        try {
          const pkg = require("@tenonhq/" + dirName);
          if (pkg && pkg.sincPlugin && pkg.sincPlugin.name && pkg.sincPlugin.displayName) {
            plugins.push(pkg.sincPlugin);
            logger.debug("Discovered init plugin: " + pkg.sincPlugin.displayName + " (" + dirName + ")");
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logger.warn("Failed to load plugin " + dirName + ": " + message);
        }
      });
  }

  return plugins;
}
