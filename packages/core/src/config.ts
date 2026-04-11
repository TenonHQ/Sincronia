import { SN, Sinc } from "@tenonhq/sincronia-types";
import path from "path";
import { promises as fsp } from "fs";
import { logger } from "./Logger";
import { includes, excludes, tableOptions, scopes } from "./defaultOptions";

const DEFAULT_CONFIG: Sinc.ScopedConfig = {
  sourceDirectory: "src",
  buildDirectory: "build",
  rules: [],
  includes,
  excludes,
  tableOptions: {},
  refreshInterval: 30,
  scopes: {},
};

let root_dir: string | undefined;
let config: Sinc.ScopedConfig | undefined;
let manifest: SN.AppManifest | undefined;
let config_path: string | undefined;
let source_path: string | undefined;
let build_path: string | undefined;
let env_path: string | undefined;
let manifest_path: string | undefined;
let diff_path: string | undefined;
let diff_file: Sinc.DiffFile | undefined;
let refresh_interval: number | undefined;

export const loadConfigs = async () => {
  try {
    let noConfigPath = false; //Prevents logging error messages during init
    const path = await loadConfigPath();
    if (path) config_path = path;
    else noConfigPath = true;

    await loadRootDir(noConfigPath);

    const cfg = await loadConfig(noConfigPath);
    if (cfg) config = cfg;

    await loadEnvPath();
    await loadSourcePath();
    await loadBuildPath();
    await loadManifestPath();
    await loadManifest();
    await loadDiffPath();
    await loadDiffFile();
    await loadRefresh();
  } catch (e) {
    throw e;
  }
};

export function getConfig() {
  if (config) return config;
  throw new Error("Error getting config");
}

export function getConfigPath() {
  if (config_path) return config_path;
  throw new Error("Error getting config path");
}

export function checkConfigPath() {
  if (config_path) return config_path;
  return false;
}

export function getRootDir() {
  if (root_dir) return root_dir;
  throw new Error("Error getting root directory");
}

export function getManifest(setup = false) {
  if (manifest) return manifest;
  if (!setup) throw new Error("Error getting manifest");
}

export function getManifestPath(scope?: string) {
  if (scope) {
    const rootDir = getRootDir();
    return path.join(rootDir, `sinc.manifest.${scope}.json`);
  }
  if (manifest_path) return manifest_path;
  throw new Error("Error getting manifest path");
}

export function getScopeManifestPath(scope: string) {
  const rootDir = getRootDir();
  return path.join(rootDir, `sinc.manifest.${scope}.json`);
}

export function getSourcePath() {
  if (source_path) return source_path;
  throw new Error("Error getting source path");
}

export function getSourcePathForScope(scopeName: string): string {
  var cfg = getConfig();
  var scopeConfig = cfg.scopes && cfg.scopes[scopeName];
  if (scopeConfig && typeof scopeConfig === "object" && (scopeConfig as any).sourceDirectory) {
    return path.resolve(getRootDir(), (scopeConfig as any).sourceDirectory);
  }
  return getSourcePath();
}

export function getBuildPath() {
  if (build_path) return build_path;
  throw new Error("Error getting build path");
}

export function getEnvPath() {
  if (env_path) return env_path;
  throw new Error("Error getting env path");
}

export function getDiffPath() {
  if (diff_path) return diff_path;
  throw new Error("Error getting diff path");
}

export function getDiffFile() {
  if (diff_file) return diff_file;
  throw new Error("Error getting diff file");
}

export function getRefresh() {
  if (refresh_interval) return refresh_interval;
  throw new Error("Error getting refresh interval");
}

export function getDefaultConfigFile(): string {
  return `
    module.exports = {
      sourceDirectory: "src",
      buildDirectory: "build",
      rules: [],
      excludes:{},
      includes:{},
      tableOptions:{},
      refreshInterval:30
    };
    `.trim();
}

/**
 * @description Generates a full sinc.config.js with multi-scope support, table whitelist,
 * field type overrides, and plugin rules. Used by sinc init when creating a new config.
 * @param {Object} params - Configuration parameters
 * @param {Array<{scope: string, sourceDirectory: string}>} params.scopes - Selected scopes with source directories
 * @returns {string} Complete sinc.config.js file content
 */
export function generateConfigFile(params: {
  scopes: Array<{ scope: string; sourceDirectory: string }>;
}): string {
  var scopeEntries = params.scopes.map(function(s) {
    return "\t\t" + s.scope + ": {\n\t\t\tsourceDirectory: \"" + s.sourceDirectory + "\",\n\t\t},";
  }).join("\n");

  return "module.exports = {\n" +
    "\tsourceDirectory: \"src\",\n" +
    "\tbuildDirectory: \"build\",\n" +
    "\n" +
    "\t// Plugin Rules Configuration\n" +
    "\trules: [\n" +
    "\t\t{\n" +
    "\t\t\tmatch: /sys_script_include.*\\.ts$/,\n" +
    "\t\t\tplugins: [\n" +
    "\t\t\t\t{\n" +
    "\t\t\t\t\tname: \"@tenonhq/sincronia-typescript-plugin\",\n" +
    "\t\t\t\t\toptions: {\n" +
    "\t\t\t\t\t\ttranspile: true,\n" +
    "\t\t\t\t\t\ttypeCheck: true,\n" +
    "\t\t\t\t\t\ttsconfig: \"./tsconfig.servicenow.json\",\n" +
    "\t\t\t\t\t},\n" +
    "\t\t\t\t},\n" +
    "\t\t\t\t{\n" +
    "\t\t\t\t\tname: \"@tenonhq/sincronia-eslint-plugin\",\n" +
    "\t\t\t\t\toptions: {\n" +
    "\t\t\t\t\t\tconfigFile: \"./.eslintrc.js\",\n" +
    "\t\t\t\t\t\tfix: false,\n" +
    "\t\t\t\t\t\tcache: true,\n" +
    "\t\t\t\t\t},\n" +
    "\t\t\t\t},\n" +
    "\t\t\t\t{\n" +
    "\t\t\t\t\tname: \"@tenonhq/sincronia-babel-plugin\",\n" +
    "\t\t\t\t\toptions: {\n" +
    "\t\t\t\t\t\tconfigFile: \"./.babelrc\",\n" +
    "\t\t\t\t\t},\n" +
    "\t\t\t\t},\n" +
    "\t\t\t\t{\n" +
    "\t\t\t\t\tname: \"@tenonhq/sincronia-prettier-plugin\",\n" +
    "\t\t\t\t\toptions: {\n" +
    "\t\t\t\t\t\tconfigFile: \"./.prettierrc.js\",\n" +
    "\t\t\t\t\t},\n" +
    "\t\t\t\t},\n" +
    "\t\t\t],\n" +
    "\t\t},\n" +
    "\t],\n" +
    "\n" +
    "\tincludes: {\n" +
    "\t\t_tables: [\n" +
    "\t\t\t\"sys_script_include\",\n" +
    "\t\t\t\"sys_script\",\n" +
    "\t\t\t\"sys_ui_script\",\n" +
    "\t\t\t\"sys_ui_page\",\n" +
    "\t\t\t\"sys_ux_client_script\",\n" +
    "\t\t\t\"sys_processor\",\n" +
    "\t\t\t\"sys_ws_operation\",\n" +
    "\t\t\t\"sys_rest_message_fn\",\n" +
    "\t\t\t\"sys_ui_action\",\n" +
    "\t\t\t\"sys_security_acl\",\n" +
    "\t\t\t\"sysevent_script_action\",\n" +
    "\t\t\t\"sys_ux_macroponent\",\n" +
    "\t\t\t\"sys_ux_event\",\n" +
    "\t\t\t\"sys_ux_client_script_include\",\n" +
    "\t\t\t\"sys_ux_screen\",\n" +
    "\t\t\t\"sys_script_fix\",\n" +
    "\t\t],\n" +
    "\t\tsys_script_include: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_script: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ui_script: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ui_page: {\n" +
    "\t\t\tprocessing_script: { type: \"js\" },\n" +
    "\t\t\tclient_script: { type: \"js\" },\n" +
    "\t\t\thtml: { type: \"html\" },\n" +
    "\t\t},\n" +
    "\t\tsys_processor: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ws_operation: {\n" +
    "\t\t\toperation_script: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_rest_message_fn: {\n" +
    "\t\t\tcontent: { type: \"txt\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ui_action: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t\tclient_script_v2: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_security_acl: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsysevent_script_action: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_script_fix: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ux_macroponent: {\n" +
    "\t\t\tcomposition: { type: \"json\" },\n" +
    "\t\t\tprops: { type: \"json\" },\n" +
    "\t\t\tdata: { type: \"json\" },\n" +
    "\t\t\trequired_translations: { type: \"json\" },\n" +
    "\t\t\troot_component_definition: { type: \"json\" },\n" +
    "\t\t\tstate_properties: { type: \"json\" },\n" +
    "\t\t\troot_component_config: { type: \"json\" },\n" +
    "\t\t\tinternal_event_mappings: { type: \"json\" },\n" +
    "\t\t\tstate_persistence_config: { type: \"json\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ux_event: {\n" +
    "\t\t\tdescription: { type: \"txt\" },\n" +
    "\t\t\tevent_name: { type: \"txt\" },\n" +
    "\t\t\tlabel: { type: \"txt\" },\n" +
    "\t\t\tprops: { type: \"json\" },\n" +
    "\t\t\trequired_translations: { type: \"json\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ux_client_script: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t\tname: { type: \"txt\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ux_client_script_include: {\n" +
    "\t\t\tscript: { type: \"js\" },\n" +
    "\t\t\tname: { type: \"txt\" },\n" +
    "\t\t},\n" +
    "\t\tsys_ux_screen: {\n" +
    "\t\t\tmacroponent_config: { type: \"json\" },\n" +
    "\t\t\tevent_mappings: { type: \"json\" },\n" +
    "\t\t},\n" +
    "\t\t_scopes: {},\n" +
    "\t},\n" +
    "\n" +
    "\texcludes: {\n" +
    "\t\t_tables: [],\n" +
    "\t},\n" +
    "\n" +
    "\tmanifestOptions: {\n" +
    "\t\tupdateFields: true,\n" +
    "\t\tupdateDependencies: true,\n" +
    "\t},\n" +
    "\n" +
    "\tserver: {\n" +
    "\t\twatchPath: \"./src\",\n" +
    "\t},\n" +
    "\n" +
    "\tscopes: {\n" +
    scopeEntries + "\n" +
    "\t},\n" +
    "};\n";
}

async function loadConfig(skipConfigPath = false): Promise<Sinc.ScopedConfig> {
  if (skipConfigPath) {
    logger.warn("Couldn't find config file. Loading default...");
    return DEFAULT_CONFIG;
  }
  try {
    let configPath = getConfigPath();
    if (configPath) {
      let projectConfig: Sinc.ScopedConfig = (await import(configPath)).default;
      // Config is king — no merging with defaults. sinc.config.js is the single source of truth.
      var {
        includes: pIncludes = {},
        excludes: pExcludes = {},
        tableOptions: pTableOptions = {},
        scopes: pScopes = {},
      } = projectConfig;
      projectConfig.includes = pIncludes;
      projectConfig.excludes = pExcludes;
      projectConfig.tableOptions = pTableOptions;
      projectConfig.scopes = pScopes;
      return projectConfig;
    } else {
      logger.warn("Couldn't find config file. Loading default...");
      return DEFAULT_CONFIG;
    }
  } catch (e) {
    let message;
    if (e instanceof Error) message = e.message;
    else message = String(e);
    logger.warn(message);
    logger.warn("Couldn't find config file. Loading default...");
    return DEFAULT_CONFIG;
  }
}

async function loadManifest() {
  try {
    // Try to load legacy single manifest first
    let manifestString = await fsp.readFile(getManifestPath(), "utf-8");
    manifest = JSON.parse(manifestString);
  } catch (e) {
    // If no single manifest, try to load all scope-specific manifests
    manifest = await loadAllScopeManifests();
  }
}

async function loadAllScopeManifests(): Promise<SN.AppManifest | undefined> {
  try {
    const rootDir = getRootDir();
    const files = await fsp.readdir(rootDir);
    const manifestFiles = files.filter(f => f.startsWith('sinc.manifest.') && f.endsWith('.json') && f !== 'sinc.manifest.json');
    
    if (manifestFiles.length === 0) {
      return undefined;
    }
    
    // Combine all scope manifests into a single structure for backward compatibility
    const combinedManifest: any = {};
    
    for (const file of manifestFiles) {
      const scope = file.replace('sinc.manifest.', '').replace('.json', '');
      const manifestPath = path.join(rootDir, file);
      try {
        const content = await fsp.readFile(manifestPath, "utf-8");
        const scopeManifest = JSON.parse(content);
        
        // If the manifest already has the scope at root level, use it directly
        if (scopeManifest.scope && scopeManifest.tables) {
          combinedManifest[scope] = scopeManifest;
        } else {
          // Otherwise wrap it
          combinedManifest[scope] = scopeManifest;
        }
      } catch (e) {
        logger.warn(`Failed to load manifest for scope ${scope}: ${e}`);
      }
    }
    
    return Object.keys(combinedManifest).length > 0 ? combinedManifest : undefined;
  } catch (e) {
    return undefined;
  }
}

export async function loadScopeManifest(scope: string): Promise<SN.AppManifest | undefined> {
  try {
    const manifestPath = getScopeManifestPath(scope);
    const content = await fsp.readFile(manifestPath, "utf-8");
    return JSON.parse(content);
  } catch (e) {
    return undefined;
  }
}

export function updateManifest(man: SN.AppManifest) {
  manifest = man;
}

export function isMultiScopeManifest(man: any): boolean {
  return typeof man === "object" && man !== null && !man.scope && !man.tables;
}

export function resolveManifestForScope(man: any, scope: string): SN.AppManifest | undefined {
  if (!isMultiScopeManifest(man)) {
    if (!scope || man.scope === scope) {
      return man;
    }
    return undefined;
  }
  var scopeMan = man[scope];
  if (scopeMan && scopeMan.tables) {
    return scopeMan;
  }
  return undefined;
}

export function resolveScopeFromPath(filePath: string): string | undefined {
  var cfg = getConfig();
  if (!cfg.scopes) return undefined;
  var scopeNames = Object.keys(cfg.scopes);
  for (var i = 0; i < scopeNames.length; i++) {
    var scopeSourcePath = getSourcePathForScope(scopeNames[i]);
    if (filePath.indexOf(scopeSourcePath) === 0) {
      return scopeNames[i];
    }
  }
  return undefined;
}

async function loadConfigPath(pth?: string): Promise<string | false> {
  if (!pth) {
    pth = process.cwd();
  }
  // check to see if config is found
  let files = await fsp.readdir(pth);
  if (files.includes("sinc.config.js")) {
    return path.join(pth, "sinc.config.js");
  } else {
    if (isRoot(pth)) {
      return false;
    }
    return loadConfigPath(path.dirname(pth));
  }
  function isRoot(pth: string) {
    return path.parse(pth).root === pth;
  }
}

async function loadRefresh() {
  let { refreshInterval = 30 } = getConfig();
  refresh_interval = refreshInterval;
}

async function loadSourcePath() {
  let rootDir = getRootDir();
  let { sourceDirectory = "src" } = getConfig();
  source_path = path.join(rootDir, sourceDirectory);
}

async function loadBuildPath() {
  let rootDir = getRootDir();
  let { buildDirectory = "build" } = getConfig();
  build_path = path.join(rootDir, buildDirectory);
}

async function loadEnvPath() {
  let rootDir = getRootDir();
  env_path = path.join(rootDir, ".env");
}

async function loadManifestPath() {
  let rootDir = getRootDir();
  manifest_path = path.join(rootDir, "sinc.manifest.json");
}

async function loadDiffPath() {
  let rootDir = getRootDir();
  diff_path = path.join(rootDir, "sinc.diff.manifest.json");
}

async function loadDiffFile() {
  try {
    let diffString = await fsp.readFile(getDiffPath(), "utf-8");
    diff_file = JSON.parse(diffString);
  } catch (e) {
    diff_file = undefined;
  }
}

async function loadRootDir(skip?: boolean) {
  if (skip) {
    root_dir = process.cwd();
    return;
  }
  let configPath = getConfigPath();
  if (configPath) root_dir = path.dirname(configPath);
  else root_dir = process.cwd();
}

// ============================================================================
// Config Resolution Engine
// Keys prefixed with "_" are config directives (e.g. _tables, _scopes).
// Everything else is a table name with field type overrides.
// ============================================================================

export interface ResolvedScopeConfig {
  tables: string[];
  fieldOverrides: Sinc.TablePropMap;
  apiIncludes: Sinc.TablePropMap;
  apiExcludes: Sinc.TablePropMap;
}

export function isDirectiveKey(key: string): boolean {
  return key.charAt(0) === "_";
}

export function stripDirectiveKeys(obj: Sinc.TablePropMap): Sinc.TablePropMap {
  var result: Sinc.TablePropMap = {};
  var keys = Object.keys(obj || {});
  for (var i = 0; i < keys.length; i++) {
    if (!isDirectiveKey(keys[i])) {
      result[keys[i]] = obj[keys[i]];
    }
  }
  return result;
}

export function resolveConfigForScope(scopeName: string): ResolvedScopeConfig {
  var cfg = getConfig();
  var cfgIncludes: any = cfg.includes || {};
  var cfgExcludes: any = cfg.excludes || {};

  // Backward compat: support old "table" key (no underscore)
  var globalTables: string[] = cfgIncludes._tables || [];
  if (!cfgIncludes._tables && Array.isArray(cfgIncludes.table)) {
    logger.warn("Deprecation: 'table' key in includes is deprecated. Use '_tables' instead.");
    globalTables = cfgIncludes.table;
  }

  // Resolve scope-specific overrides
  var scopesDirective: any = cfgIncludes._scopes || {};
  var scopeOverride: any = scopesDirective[scopeName] || {};
  var scopeTables: string[] = scopeOverride._tables || [];

  // Deduplicated union of global + scope tables
  var tableSet: { [key: string]: boolean } = {};
  var i: number;
  for (i = 0; i < globalTables.length; i++) {
    tableSet[globalTables[i]] = true;
  }
  for (i = 0; i < scopeTables.length; i++) {
    tableSet[scopeTables[i]] = true;
  }
  // Field overrides: global non-_ keys and scope-specific non-_ keys
  var globalFieldOverrides = stripDirectiveKeys(cfgIncludes);
  var scopeFieldOverrides = stripDirectiveKeys(scopeOverride);

  // Implicitly add tables that have field overrides to the whitelist
  var globalOverrideTables = Object.keys(globalFieldOverrides);
  for (i = 0; i < globalOverrideTables.length; i++) {
    if (!tableSet[globalOverrideTables[i]]) {
      tableSet[globalOverrideTables[i]] = true;
    }
  }
  var scopeOverrideTables = Object.keys(scopeFieldOverrides);
  for (i = 0; i < scopeOverrideTables.length; i++) {
    if (!tableSet[scopeOverrideTables[i]]) {
      tableSet[scopeOverrideTables[i]] = true;
    }
  }

  var resolvedTables = Object.keys(tableSet);

  // Resolve excludes _tables
  var excludeTables: string[] = cfgExcludes._tables || [];
  if (!cfgExcludes._tables && Array.isArray(cfgExcludes.table)) {
    excludeTables = cfgExcludes.table;
  }

  // Remove excluded tables from the resolved list
  if (excludeTables.length > 0) {
    var excludeSet: { [key: string]: boolean } = {};
    for (i = 0; i < excludeTables.length; i++) {
      excludeSet[excludeTables[i]] = true;
    }
    resolvedTables = resolvedTables.filter(function(t) {
      return !excludeSet[t];
    });
  }

  // Deep merge field overrides: global + scope, scope wins on conflicts per field
  var fieldOverrides: Sinc.TablePropMap = {};
  var allTableKeys: { [key: string]: boolean } = {};
  var gKeys = Object.keys(globalFieldOverrides);
  var sKeys = Object.keys(scopeFieldOverrides);
  for (i = 0; i < gKeys.length; i++) { allTableKeys[gKeys[i]] = true; }
  for (i = 0; i < sKeys.length; i++) { allTableKeys[sKeys[i]] = true; }

  for (var tblKey in allTableKeys) {
    var globalEntry = globalFieldOverrides[tblKey];
    var scopeEntry = scopeFieldOverrides[tblKey];
    if (globalEntry && scopeEntry && typeof globalEntry === "object" && typeof scopeEntry === "object") {
      fieldOverrides[tblKey] = Object.assign({}, globalEntry, scopeEntry);
    } else {
      fieldOverrides[tblKey] = scopeEntry || globalEntry;
    }
  }

  // API includes: merged field overrides (no _ keys)
  var apiIncludes: Sinc.TablePropMap = Object.assign({}, fieldOverrides);

  // API excludes: strip _ keys
  var apiExcludes: Sinc.TablePropMap = stripDirectiveKeys(cfgExcludes);

  return {
    tables: resolvedTables,
    fieldOverrides: fieldOverrides,
    apiIncludes: apiIncludes,
    apiExcludes: apiExcludes,
  };
}
