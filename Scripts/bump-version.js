#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

/**
 * Bumps the patch version of a package.json file
 * Usage: node bump-version.js [path-to-package.json]
 */

function bumpVersion(packagePath) {
  try {
    // Read package.json
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

    if (!packageJson.version) {
      console.error("No version field found in package.json");
      process.exit(1);
    }

    // Parse current version
    const currentVersion = packageJson.version;
    const versionParts = currentVersion.split(".");

    if (versionParts.length !== 3) {
      console.error(
        `Invalid version format: ${currentVersion}. Expected format: major.minor.patch`,
      );
      process.exit(1);
    }

    // Increment patch version
    const [major, minor, patch] = versionParts;
    const newPatch = parseInt(patch) + 1;
    const newVersion = `${major}.${minor}.${newPatch}`;

    // Update version
    packageJson.version = newVersion;

    // Write back to file with proper formatting
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");

    console.log(`✓ Version bumped from ${currentVersion} to ${newVersion}`);
    console.log(`  File: ${packagePath}`);

    return { oldVersion: currentVersion, newVersion };
  } catch (error) {
    console.error(`Error bumping version: ${error.message}`);
    process.exit(1);
  }
}

function findPackageJson() {
  // Check if package.json path was provided as argument
  console.log(process.argv[0], process.argv[1], process.argv[2]);
  if (process.argv[2]) {
    return path.resolve(process.argv[2]);
  }

  // Default to package.json in current directory
  const defaultPath = path.join(__dirname, "package.json");

  // Check if sinc.config.js exists for scope-based structure
  const sincConfigPath = path.join(process.cwd(), "sinc.config.js");
  if (fs.existsSync(sincConfigPath)) {
    try {
      const sincConfig = require(sincConfigPath);

      // If running from a scope directory, look for package.json there
      if (sincConfig.scopes) {
        const scopeName =
          process.env.SINC_SCOPE || Object.keys(sincConfig.scopes)[0];
        const scope = sincConfig.scopes[scopeName];

        if (scope && scope.sourceDirectory) {
          const scopePackagePath = path.join(
            process.cwd(),
            scopeName,
            scope.sourceDirectory,
            "package.json",
          );

          if (fs.existsSync(scopePackagePath)) {
            console.log(
              `Using scope-based package.json for scope: ${scopeName}`,
            );
            return scopePackagePath;
          }
        }
      }
    } catch (e) {
      // Fall back to default if config parsing fails
    }
  }

  if (!fs.existsSync(defaultPath)) {
    console.error(
      "No package.json found. Please specify the path as an argument.",
    );
    console.log("Usage: node bump-version.js [path-to-package.json]");
    process.exit(1);
  }

  return defaultPath;
}

// Main execution
const packagePath = findPackageJson();
const result = bumpVersion(packagePath);

// If this script is being required by another script, export the function
if (module.parent) {
  module.exports = { bumpVersion };
}
