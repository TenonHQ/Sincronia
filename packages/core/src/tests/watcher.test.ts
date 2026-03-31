import { Sinc } from "@tenonhq/sincronia-types";

// --- Mock setup (must be before imports) ---

// Controllable chokidar mock
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

let latestMockWatcher: MockWatcher;

jest.mock("chokidar", () => ({
  watch: jest.fn(() => {
    latestMockWatcher = createMockWatcher();
    return latestMockWatcher;
  }),
}));

// Controllable debounce — captures fn, tests trigger manually
let capturedProcessQueue: Function;

jest.mock("lodash", () => {
  const actual = jest.requireActual("lodash");
  return {
    ...actual,
    debounce: jest.fn((fn: Function) => {
      capturedProcessQueue = fn;
      const wrapper = jest.fn((...args: any[]) => {
        // Don't call automatically — tests call capturedProcessQueue()
      });
      (wrapper as any).cancel = jest.fn();
      (wrapper as any).flush = jest.fn(() => fn());
      return wrapper;
    }),
  };
});

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
  },
}));

// --- Imports (after mocks) ---
import chokidar from "chokidar";
import { startWatching, stopWatching } from "../Watcher";
import { getFileContextFromPath } from "../FileUtils";
import { groupAppFiles, pushFiles } from "../appUtils";
import { logFilePush } from "../logMessages";
import { logger } from "../Logger";

// --- Test Fixtures ---

const MOCK_FILE_PATH = "/project/src/sys_script_include/TestScript/script.js";
const MOCK_FILE_PATH_2 = "/project/src/sys_script_include/OtherScript/script.js";

const makeFileContext = (overrides: Partial<Sinc.FileContext> = {}): Sinc.FileContext => ({
  filePath: MOCK_FILE_PATH,
  ext: ".js",
  sys_id: "abc123",
  name: "TestScript",
  scope: "x_test",
  tableName: "sys_script_include",
  targetField: "script",
  ...overrides,
});

const MOCK_BUILDABLE: Sinc.BuildableRecord = {
  table: "sys_script_include",
  sysId: "abc123",
  fields: {},
};

const MOCK_PUSH_SUCCESS: Sinc.PushResult = {
  success: true,
  message: "Pushed successfully",
};

// --- Tests ---

describe("Watcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    stopWatching();
  });

  describe("startWatching", () => {
    it("calls chokidar.watch with the given directory", () => {
      startWatching("/project/src");
      expect(chokidar.watch).toHaveBeenCalledWith("/project/src");
    });

    it("registers change event handler", () => {
      startWatching("/project/src");
      expect(latestMockWatcher.on).toHaveBeenCalledWith("change", expect.any(Function));
    });

    it("registers error event handler", () => {
      startWatching("/project/src");
      expect(latestMockWatcher.on).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  describe("file change processing", () => {
    it("processes a changed file through the full pipeline", async () => {
      const ctx = makeFileContext();
      (getFileContextFromPath as jest.Mock).mockReturnValue(ctx);
      (groupAppFiles as jest.Mock).mockReturnValue([MOCK_BUILDABLE]);
      (pushFiles as jest.Mock).mockResolvedValue([MOCK_PUSH_SUCCESS]);

      startWatching("/project/src");
      latestMockWatcher._emit("change", MOCK_FILE_PATH);

      // Manually trigger the debounced processQueue
      await capturedProcessQueue();

      expect(getFileContextFromPath).toHaveBeenCalledWith(MOCK_FILE_PATH, 0, [MOCK_FILE_PATH]);
      expect(groupAppFiles).toHaveBeenCalledWith([ctx]);
      expect(pushFiles).toHaveBeenCalledWith([MOCK_BUILDABLE]);
      expect(logFilePush).toHaveBeenCalledWith(ctx, MOCK_PUSH_SUCCESS);
    });

    it("deduplicates multiple changes to the same file", async () => {
      const ctx = makeFileContext();
      (getFileContextFromPath as jest.Mock).mockReturnValue(ctx);
      (groupAppFiles as jest.Mock).mockReturnValue([MOCK_BUILDABLE]);
      (pushFiles as jest.Mock).mockResolvedValue([MOCK_PUSH_SUCCESS]);

      startWatching("/project/src");

      // Emit the same file path three times before processing
      latestMockWatcher._emit("change", MOCK_FILE_PATH);
      latestMockWatcher._emit("change", MOCK_FILE_PATH);
      latestMockWatcher._emit("change", MOCK_FILE_PATH);

      await capturedProcessQueue();

      // Should only process the file once due to Set dedup
      expect(getFileContextFromPath).toHaveBeenCalledTimes(1);
    });

    it("batches changes to multiple files", async () => {
      const ctx1 = makeFileContext();
      const ctx2 = makeFileContext({
        filePath: MOCK_FILE_PATH_2,
        sys_id: "def456",
        name: "OtherScript",
      });

      (getFileContextFromPath as jest.Mock)
        .mockReturnValueOnce(ctx1)
        .mockReturnValueOnce(ctx2);
      (groupAppFiles as jest.Mock).mockReturnValue([MOCK_BUILDABLE]);
      (pushFiles as jest.Mock).mockResolvedValue([MOCK_PUSH_SUCCESS]);

      startWatching("/project/src");
      latestMockWatcher._emit("change", MOCK_FILE_PATH);
      latestMockWatcher._emit("change", MOCK_FILE_PATH_2);

      await capturedProcessQueue();

      expect(getFileContextFromPath).toHaveBeenCalledTimes(2);
      expect(groupAppFiles).toHaveBeenCalledWith([ctx1, ctx2]);
    });

    it("filters out files where getFileContextFromPath returns undefined", async () => {
      const ctx = makeFileContext();
      (getFileContextFromPath as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(ctx);
      (groupAppFiles as jest.Mock).mockReturnValue([MOCK_BUILDABLE]);
      (pushFiles as jest.Mock).mockResolvedValue([MOCK_PUSH_SUCCESS]);

      startWatching("/project/src");
      latestMockWatcher._emit("change", "/project/src/unknown/file.txt");
      latestMockWatcher._emit("change", MOCK_FILE_PATH);

      await capturedProcessQueue();

      // groupAppFiles should only receive the valid context
      expect(groupAppFiles).toHaveBeenCalledWith([ctx]);
    });

    it("does not process when queue is empty", async () => {
      startWatching("/project/src");

      // Trigger processQueue without emitting any events
      await capturedProcessQueue();

      expect(getFileContextFromPath).not.toHaveBeenCalled();
      expect(groupAppFiles).not.toHaveBeenCalled();
      expect(pushFiles).not.toHaveBeenCalled();
    });

    it("calls logFilePush for each result paired with its file context", async () => {
      const ctx1 = makeFileContext();
      const ctx2 = makeFileContext({
        filePath: MOCK_FILE_PATH_2,
        sys_id: "def456",
        name: "OtherScript",
      });
      const result1: Sinc.PushResult = { success: true, message: "ok" };
      const result2: Sinc.PushResult = { success: false, message: "failed" };

      (getFileContextFromPath as jest.Mock)
        .mockReturnValueOnce(ctx1)
        .mockReturnValueOnce(ctx2);
      (groupAppFiles as jest.Mock).mockReturnValue([MOCK_BUILDABLE, MOCK_BUILDABLE]);
      (pushFiles as jest.Mock).mockResolvedValue([result1, result2]);

      startWatching("/project/src");
      latestMockWatcher._emit("change", MOCK_FILE_PATH);
      latestMockWatcher._emit("change", MOCK_FILE_PATH_2);

      await capturedProcessQueue();

      expect(logFilePush).toHaveBeenCalledTimes(2);
      expect(logFilePush).toHaveBeenCalledWith(ctx1, result1);
      expect(logFilePush).toHaveBeenCalledWith(ctx2, result2);
    });
  });

  describe("error handling", () => {
    it("logs error when chokidar emits error event", () => {
      startWatching("/project/src");
      const error = new Error("Watch failed");
      latestMockWatcher._emit("error", error);

      expect(logger.error).toHaveBeenCalledWith("Watcher error: Watch failed");
    });
  });

  describe("stopWatching", () => {
    it("calls watcher.close() when watcher exists", () => {
      startWatching("/project/src");
      stopWatching();
      expect(latestMockWatcher.close).toHaveBeenCalled();
    });

    it("does not throw when called before startWatching", () => {
      expect(() => stopWatching()).not.toThrow();
    });
  });
});
