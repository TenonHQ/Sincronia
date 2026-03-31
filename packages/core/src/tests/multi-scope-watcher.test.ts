import { Sinc } from "@tenonhq/sincronia-types";

// --- Mock setup ---

type EventHandler = (...args: any[]) => void;
interface MockWatcher {
  on: jest.Mock;
  close: jest.Mock;
  _handlers: Record<string, EventHandler[]>;
  _emit: (event: string, ...args: any[]) => void;
}

function createMockWatcher(): MockWatcher {
  const handlers: Record<string, EventHandler[]> = {};
  const mock: MockWatcher = {
    _handlers: handlers,
    on: jest.fn((event: string, handler: EventHandler) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return mock;
    }),
    close: jest.fn(),
    _emit: (event: string, ...args: any[]) => {
      (handlers[event] || []).forEach((h) => h(...args));
    },
  };
  return mock;
}

const mockWatchers: MockWatcher[] = [];

jest.mock("chokidar", () => ({
  watch: jest.fn(() => {
    const w = createMockWatcher();
    mockWatchers.push(w);
    return w;
  }),
}));

// Debounce: capture per-scope processors, tests trigger manually
const capturedDebounceFns: Function[] = [];

jest.mock("lodash", () => {
  const actual = jest.requireActual("lodash");
  return {
    ...actual,
    debounce: jest.fn((fn: Function) => {
      capturedDebounceFns.push(fn);
      const wrapper = jest.fn();
      (wrapper as any).cancel = jest.fn();
      (wrapper as any).flush = jest.fn(() => fn());
      return wrapper;
    }),
  };
});

const mockSNClient = {
  getScopeId: jest.fn(),
  getUserSysId: jest.fn(),
  getCurrentAppUserPrefSysId: jest.fn(),
  updateCurrentAppUserPref: jest.fn(),
  createCurrentAppUserPref: jest.fn(),
  getCurrentUpdateSetUserPref: jest.fn(),
};

jest.mock("../snClient", () => ({
  defaultClient: jest.fn(() => mockSNClient),
  unwrapSNResponse: jest.fn((val: any) => val),
}));

jest.mock("../FileUtils", () => ({
  getFileContextFromPath: jest.fn(),
}));

jest.mock("../appUtils", () => ({
  groupAppFiles: jest.fn(),
  pushFiles: jest.fn(),
}));

jest.mock("../logMessages", () => ({
  logFilePush: jest.fn(),
}));

jest.mock("../Logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
    getLogLevel: jest.fn().mockReturnValue("info"),
  },
}));

jest.mock("../config", () => ({
  loadConfigs: jest.fn().mockResolvedValue(undefined),
  getConfig: jest.fn(),
  getRootDir: jest.fn().mockReturnValue("/project"),
  updateManifest: jest.fn(),
  getManifest: jest.fn(),
  getSourcePath: jest.fn().mockReturnValue("/project/src"),
  getScopeManifestPath: jest.fn((scope: string) => `/project/sinc.manifest.${scope}.json`),
  getManifestPath: jest.fn().mockReturnValue("/project/sinc.manifest.json"),
}));

// Mock fs for manifest loading (dynamic import in MultiScopeWatcher)
jest.mock("fs", () => ({
  existsSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    readdir: jest.fn(),
    mkdir: jest.fn(),
    access: jest.fn(),
    stat: jest.fn(),
  },
}));

// Also mock axios for getUpdateSetDetails
jest.mock("axios", () => ({
  default: {
    create: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ data: { result: null } }),
    })),
  },
}));

// --- Imports ---
import chokidar from "chokidar";
import fs from "fs";
import * as ConfigManager from "../config";
import { getFileContextFromPath } from "../FileUtils";
import { groupAppFiles, pushFiles } from "../appUtils";
import { logFilePush } from "../logMessages";
import { logger } from "../Logger";
import { multiScopeWatcher, startMultiScopeWatching, stopMultiScopeWatching } from "../MultiScopeWatcher";

// Helper to flush microtask queue (for async code in setInterval callbacks)
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

// --- Fixtures ---

const makeFileContext = (overrides: Partial<Sinc.FileContext> = {}): Sinc.FileContext => ({
  filePath: "/project/src/x_test_core/sys_script_include/TestScript/script.js",
  ext: ".js",
  sys_id: "abc123",
  name: "TestScript",
  scope: "x_test_core",
  tableName: "sys_script_include",
  targetField: "script",
  ...overrides,
});

const MOCK_CONFIG_TWO_SCOPES = {
  sourceDirectory: "src",
  buildDirectory: "build",
  rules: [],
  includes: {},
  excludes: {},
  tableOptions: {},
  refreshInterval: 30,
  scopes: {
    x_test_core: { sourceDirectory: "src/x_test_core" },
    x_test_work: {},
  },
};

const MOCK_CONFIG_CUSTOM_DIR = {
  ...MOCK_CONFIG_TWO_SCOPES,
  scopes: {
    x_custom: { sourceDirectory: "custom/path" },
  },
};

const MOCK_CONFIG_NO_SCOPES = {
  sourceDirectory: "src",
};

// --- Tests ---

describe("MultiScopeWatcherManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWatchers.length = 0;
    capturedDebounceFns.length = 0;
    // Reset the internal state by stopping any previous watchers
    stopMultiScopeWatching();

    // Default: scope switching succeeds
    mockSNClient.getScopeId.mockResolvedValue([{ sys_id: "scope_sys_id" }]);
    mockSNClient.getUserSysId.mockResolvedValue([{ sys_id: "user_sys_id" }]);
    mockSNClient.getCurrentAppUserPrefSysId.mockResolvedValue([{ sys_id: "pref_sys_id" }]);
    mockSNClient.updateCurrentAppUserPref.mockResolvedValue({});
    mockSNClient.createCurrentAppUserPref.mockResolvedValue({});
    mockSNClient.getCurrentUpdateSetUserPref.mockResolvedValue([]);
  });

  afterEach(() => {
    stopMultiScopeWatching();
    jest.useRealTimers();
  });

  describe("startWatchingAllScopes", () => {
    it("loads config and creates a watcher per scope", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue(MOCK_CONFIG_TWO_SCOPES);

      await startMultiScopeWatching();

      expect(ConfigManager.loadConfigs).toHaveBeenCalled();
      expect(chokidar.watch).toHaveBeenCalledTimes(2);
    });

    it("throws when config has no scopes", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue(MOCK_CONFIG_NO_SCOPES);

      await expect(startMultiScopeWatching()).rejects.toThrow("No scopes defined in configuration");
    });

    it("uses custom sourceDirectory from scope config", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue(MOCK_CONFIG_CUSTOM_DIR);

      await startMultiScopeWatching();

      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.stringContaining("custom/path"),
        expect.any(Object),
      );
    });

    it("uses default src/{scopeName} when no sourceDirectory", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_default_scope: {} },
      });

      await startMultiScopeWatching();

      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.stringContaining("/src/x_default_scope"),
        expect.any(Object),
      );
    });

    it("configures chokidar with correct options", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_test: {} },
      });

      await startMultiScopeWatching();

      expect(chokidar.watch).toHaveBeenCalledWith(expect.any(String), {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });
    });

    it("registers change, add, and error handlers on each watcher", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_test: {} },
      });

      await startMultiScopeWatching();

      const watcher = mockWatchers[0];
      const registeredEvents = watcher.on.mock.calls.map((c: any[]) => c[0]);
      expect(registeredEvents).toContain("change");
      expect(registeredEvents).toContain("add");
      expect(registeredEvents).toContain("error");
    });
  });

  describe("file change in scope", () => {
    beforeEach(async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_test_core: { sourceDirectory: "src/x_test_core" } },
      });

      // fs mock for loadScopeManifest
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await startMultiScopeWatching();
    });

    it("processes file change through scope switch and push pipeline", async () => {
      const ctx = makeFileContext();
      (getFileContextFromPath as jest.Mock).mockReturnValue(ctx);
      (groupAppFiles as jest.Mock).mockReturnValue([{ table: "sys_script_include", sysId: "abc123", fields: {} }]);
      (pushFiles as jest.Mock).mockResolvedValue([{ success: true, message: "ok" }]);

      // Emit change on the scope's watcher
      mockWatchers[0]._emit("change", ctx.filePath);

      // Trigger the debounced processor for this scope
      await capturedDebounceFns[0]();

      expect(getFileContextFromPath).toHaveBeenCalled();
      expect(groupAppFiles).toHaveBeenCalled();
      expect(pushFiles).toHaveBeenCalled();
    });

    it("processes file add through the same pipeline", async () => {
      const ctx = makeFileContext();
      (getFileContextFromPath as jest.Mock).mockReturnValue(ctx);
      (groupAppFiles as jest.Mock).mockReturnValue([{ table: "sys_script_include", sysId: "abc123", fields: {} }]);
      (pushFiles as jest.Mock).mockResolvedValue([{ success: true, message: "ok" }]);

      mockWatchers[0]._emit("add", ctx.filePath);
      await capturedDebounceFns[0]();

      expect(pushFiles).toHaveBeenCalled();
    });

    it("warns when no valid file contexts found", async () => {
      (getFileContextFromPath as jest.Mock).mockReturnValue(undefined);

      mockWatchers[0]._emit("change", "/project/src/x_test_core/unknown/file.txt");
      await capturedDebounceFns[0]();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("No valid file contexts found"),
      );
      expect(pushFiles).not.toHaveBeenCalled();
    });

    it("logs error on watcher error event", () => {
      mockWatchers[0]._emit("error", new Error("FS error"));
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Watcher error: FS error"),
      );
    });
  });

  describe("processScopeQueue - empty queue", () => {
    it("returns early when queue is empty", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_test_core: {} },
      });
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await startMultiScopeWatching();

      // Don't emit any events, just trigger processQueue
      await capturedDebounceFns[0]();

      // switchToScope should NOT have been called
      expect(mockSNClient.getScopeId).not.toHaveBeenCalled();
      expect(getFileContextFromPath).not.toHaveBeenCalled();
    });
  });

  describe("switchToScope", () => {
    it("updates existing preference when one exists", async () => {
      mockSNClient.getCurrentAppUserPrefSysId.mockResolvedValue([{ sys_id: "existing_pref" }]);

      // Access private method
      await (multiScopeWatcher as any).switchToScope("x_test_core");

      expect(mockSNClient.getScopeId).toHaveBeenCalledWith("x_test_core");
      expect(mockSNClient.getUserSysId).toHaveBeenCalled();
      expect(mockSNClient.updateCurrentAppUserPref).toHaveBeenCalledWith("scope_sys_id", "existing_pref");
      expect(mockSNClient.createCurrentAppUserPref).not.toHaveBeenCalled();
    });

    it("creates new preference when none exists", async () => {
      mockSNClient.getCurrentAppUserPrefSysId.mockResolvedValue([]);

      await (multiScopeWatcher as any).switchToScope("x_test_core");

      expect(mockSNClient.createCurrentAppUserPref).toHaveBeenCalledWith("scope_sys_id", "user_sys_id");
      expect(mockSNClient.updateCurrentAppUserPref).not.toHaveBeenCalled();
    });

    it("throws when scope not found", async () => {
      mockSNClient.getScopeId.mockResolvedValue([]);

      await expect(
        (multiScopeWatcher as any).switchToScope("x_missing"),
      ).rejects.toThrow("Scope x_missing not found");
    });

    it("throws when user sys_id cannot be retrieved", async () => {
      mockSNClient.getUserSysId.mockResolvedValue([]);

      await expect(
        (multiScopeWatcher as any).switchToScope("x_test_core"),
      ).rejects.toThrow("Could not get user sys_id");
    });
  });

  describe("loadScopeManifest", () => {
    it("loads scope-specific manifest when it exists", async () => {
      const manifest = { tables: {}, scope: "x_test_core" };
      (fs.existsSync as jest.Mock).mockImplementation((p: string) =>
        p.includes("sinc.manifest.x_test_core.json"),
      );
      (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(manifest));

      await (multiScopeWatcher as any).loadScopeManifest("x_test_core", "/project/src/x_test_core");

      expect(ConfigManager.updateManifest).toHaveBeenCalledWith(manifest);
    });

    it("sets scope field on manifest if missing", async () => {
      const manifest = { tables: {} };
      (fs.existsSync as jest.Mock).mockImplementation((p: string) =>
        p.includes("sinc.manifest.x_test_core.json"),
      );
      (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(manifest));

      await (multiScopeWatcher as any).loadScopeManifest("x_test_core", "/project/src/x_test_core");

      expect(ConfigManager.updateManifest).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "x_test_core" }),
      );
    });

    it("falls back to legacy multi-scope manifest", async () => {
      const legacyManifest = {
        x_test_core: { tables: { sys_script_include: {} } },
        x_test_work: { tables: {} },
      };

      // Scope-specific file doesn't exist, legacy does
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes("sinc.manifest.x_test_core.json")) return false;
        if (p.includes("sinc.manifest.json")) return true;
        return false;
      });
      (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(legacyManifest));

      await (multiScopeWatcher as any).loadScopeManifest("x_test_core", "/project/src/x_test_core");

      expect(ConfigManager.updateManifest).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "x_test_core", tables: { sys_script_include: {} } }),
      );
    });

    it("loads single-scope manifest matching the scope", async () => {
      const manifest = { tables: {}, scope: "x_test_core" };

      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes("sinc.manifest.x_test_core.json")) return false;
        if (p.includes("sinc.manifest.json")) return true;
        return false;
      });
      (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(manifest));

      await (multiScopeWatcher as any).loadScopeManifest("x_test_core", "/project/src/x_test_core");

      expect(ConfigManager.updateManifest).toHaveBeenCalledWith(manifest);
    });

    it("handles legacy format with tables but no scope field", async () => {
      const manifest = { tables: { sys_script_include: {} } };

      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes("sinc.manifest.x_test_core.json")) return false;
        if (p.includes("sinc.manifest.json")) return true;
        return false;
      });
      (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(manifest));

      await (multiScopeWatcher as any).loadScopeManifest("x_test_core", "/project/src/x_test_core");

      expect(ConfigManager.updateManifest).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "x_test_core", tables: { sys_script_include: {} } }),
      );
    });

    it("warns when scope not found in legacy manifest", async () => {
      const manifest = { other_scope: { tables: {} } };

      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.includes("sinc.manifest.x_test_core.json")) return false;
        if (p.includes("sinc.manifest.json")) return true;
        return false;
      });
      (fs.promises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(manifest));

      await (multiScopeWatcher as any).loadScopeManifest("x_test_core", "/project/src/x_test_core");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Scope not found in manifest"),
      );
    });

    it("warns when no manifest files exist", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await (multiScopeWatcher as any).loadScopeManifest("x_test_core", "/project/src/x_test_core");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("No manifest found"),
      );
    });
  });

  describe("stopWatching", () => {
    it("closes all scope watchers", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue(MOCK_CONFIG_TWO_SCOPES);

      await startMultiScopeWatching();
      expect(mockWatchers.length).toBe(2);

      stopMultiScopeWatching();

      mockWatchers.forEach((w) => {
        expect(w.close).toHaveBeenCalled();
      });
    });

    it("logs stop message", async () => {
      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_test: {} },
      });

      await startMultiScopeWatching();
      jest.clearAllMocks();
      stopMultiScopeWatching();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Stopping watcher"));
      expect(logger.info).toHaveBeenCalledWith("All watchers stopped");
    });
  });

  describe("update set monitoring", () => {
    it("sets up a 2-minute interval via setInterval", async () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");

      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_test: {} },
      });

      await startMultiScopeWatching();

      // startUpdateSetMonitoring runs async — wait for it to set the interval
      await new Promise((r) => setTimeout(r, 50));

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 120000);
      setIntervalSpy.mockRestore();
    });

    it("clears interval on stopWatching", async () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      (ConfigManager.getConfig as jest.Mock).mockReturnValue({
        ...MOCK_CONFIG_TWO_SCOPES,
        scopes: { x_test: {} },
      });

      await startMultiScopeWatching();
      // Wait for startUpdateSetMonitoring to complete and set the interval
      await new Promise((r) => setTimeout(r, 50));

      stopMultiScopeWatching();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
