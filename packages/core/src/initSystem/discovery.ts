import { Sinc } from "@tenonhq/sincronia-types";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../Logger";

/**
 * @description Scans node_modules for @tenonhq/sincronia-* packages that export a sincPlugin.
 * @returns {Sinc.InitPlugin[]} Array of discovered init plugins.
 */
export function discoverPlugins(): Sinc.InitPlugin[] {
  var plugins: Sinc.InitPlugin[] = [];
  var seen: Record<string, boolean> = {};

  // Search paths: project-level node_modules and relative to core's location (global installs)
  var searchPaths = [
    path.resolve(process.cwd(), "node_modules", "@tenonhq"),
    path.resolve(__dirname, "..", "..", "..", "@tenonhq"),
  ];

  // Also check parent directories for monorepo hoisted node_modules
  var cwd = process.cwd();
  var parent = path.dirname(cwd);
  while (parent !== cwd) {
    var hoisted = path.join(parent, "node_modules", "@tenonhq");
    if (searchPaths.indexOf(hoisted) === -1) {
      searchPaths.push(hoisted);
    }
    cwd = parent;
    parent = path.dirname(cwd);
  }

  var skipPackages: Record<string, boolean> = {
    "sincronia-core": true,
    "sincronia-types": true,
  };

  for (var s = 0; s < searchPaths.length; s++) {
    var dirs: string[];
    try {
      dirs = fs.readdirSync(searchPaths[s]);
    } catch (e) {
      continue;
    }

    for (var i = 0; i < dirs.length; i++) {
      var dirName = dirs[i];
      if (!dirName.startsWith("sincronia-")) continue;
      if (skipPackages[dirName]) continue;
      if (seen[dirName]) continue;
      seen[dirName] = true;

      try {
        var pkg = require("@tenonhq/" + dirName);
        if (pkg && pkg.sincPlugin && pkg.sincPlugin.name && pkg.sincPlugin.displayName) {
          plugins.push(pkg.sincPlugin);
          logger.debug("Discovered init plugin: " + pkg.sincPlugin.displayName + " (" + dirName + ")");
        }
      } catch (e) {
        // Package doesn't export a plugin or failed to load — skip silently
        logger.debug("Skipped " + dirName + " (no sincPlugin export)");
      }
    }
  }

  return plugins;
}
