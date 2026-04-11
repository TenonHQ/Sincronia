import { multiScopeWatcher } from "../MultiScopeWatcher";

// Track API calls
var apiCalls: string[] = [];

jest.mock("../snClient", function () {
  return {
    defaultClient: function () {
      return {
        getScopeId: function (scope: string) {
          apiCalls.push("getScopeId:" + scope);
          return Promise.resolve({ data: { result: [{ sys_id: "scope_" + scope }] } });
        },
        getUserSysId: function () {
          apiCalls.push("getUserSysId");
          return Promise.resolve({ data: { result: [{ sys_id: "user_abc123" }] } });
        },
        getCurrentAppUserPrefSysId: function (userSysId: string) {
          apiCalls.push("getCurrentAppUserPrefSysId");
          return Promise.resolve({ data: { result: [{ sys_id: "pref_123" }] } });
        },
        updateCurrentAppUserPref: function (scopeSysId: string, prefSysId: string) {
          apiCalls.push("updateCurrentAppUserPref");
          return Promise.resolve({});
        },
        createCurrentAppUserPref: function (scopeSysId: string, userSysId: string) {
          apiCalls.push("createCurrentAppUserPref");
          return Promise.resolve({});
        }
      };
    },
    unwrapSNResponse: function (resp: any) {
      return resp.then(function (r: any) { return r.data.result; });
    }
  };
});

jest.mock("../Logger", function () {
  return {
    logger: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      success: jest.fn()
    }
  };
});

jest.mock("../config", function () {
  return {
    loadConfigs: jest.fn().mockResolvedValue(undefined),
    getConfig: jest.fn().mockReturnValue({ scopes: {} }),
    getRootDir: jest.fn().mockReturnValue("/tmp"),
    updateManifest: jest.fn()
  };
});

describe("Scope Caching (US-013)", function () {
  beforeEach(function () {
    apiCalls = [];
    // Reset cached state
    (multiScopeWatcher as any).cachedScope = null;
    (multiScopeWatcher as any).cachedUserSysId = null;
  });

  it("should make API calls on first switch to a scope", async function () {
    await (multiScopeWatcher as any).switchToScope("x_cadso_core");

    expect(apiCalls).toContain("getScopeId:x_cadso_core");
    expect(apiCalls).toContain("getUserSysId");
    expect(apiCalls).toContain("getCurrentAppUserPrefSysId");
    expect(apiCalls).toContain("updateCurrentAppUserPref");
  });

  it("should skip API calls when switching to the same scope (cache hit)", async function () {
    await (multiScopeWatcher as any).switchToScope("x_cadso_core");
    apiCalls = [];

    await (multiScopeWatcher as any).switchToScope("x_cadso_core");

    expect(apiCalls).toEqual([]);
  });

  it("should make API calls when switching to a different scope (cache miss)", async function () {
    await (multiScopeWatcher as any).switchToScope("x_cadso_core");
    apiCalls = [];

    await (multiScopeWatcher as any).switchToScope("x_cadso_automate");

    expect(apiCalls).toContain("getScopeId:x_cadso_automate");
    expect(apiCalls).toContain("getCurrentAppUserPrefSysId");
    expect(apiCalls).toContain("updateCurrentAppUserPref");
  });

  it("should cache getUserSysId and call it at most once across multiple scope switches", async function () {
    await (multiScopeWatcher as any).switchToScope("x_cadso_core");
    apiCalls = [];

    await (multiScopeWatcher as any).switchToScope("x_cadso_automate");

    var userCalls = apiCalls.filter(function (c) { return c === "getUserSysId"; });
    expect(userCalls).toHaveLength(0);
    expect((multiScopeWatcher as any).cachedUserSysId).toBe("user_abc123");
  });

  it("should update cachedScope after a successful switch", async function () {
    expect((multiScopeWatcher as any).cachedScope).toBeNull();

    await (multiScopeWatcher as any).switchToScope("x_cadso_core");
    expect((multiScopeWatcher as any).cachedScope).toBe("x_cadso_core");

    await (multiScopeWatcher as any).switchToScope("x_cadso_automate");
    expect((multiScopeWatcher as any).cachedScope).toBe("x_cadso_automate");
  });

  it("should invalidate cachedScope on failure", async function () {
    // First successful switch
    await (multiScopeWatcher as any).switchToScope("x_cadso_core");
    expect((multiScopeWatcher as any).cachedScope).toBe("x_cadso_core");

    // Mock getScopeId to fail for a bad scope
    var snClient = require("../snClient");
    var origDefault = snClient.defaultClient;
    snClient.defaultClient = function () {
      var client = origDefault();
      client.getScopeId = function () {
        apiCalls.push("getScopeId:bad_scope");
        return Promise.resolve({ data: { result: [] } });
      };
      return client;
    };

    try {
      await (multiScopeWatcher as any).switchToScope("bad_scope");
    } catch (e) {
      // Expected
    }

    expect((multiScopeWatcher as any).cachedScope).toBeNull();

    // Restore
    snClient.defaultClient = origDefault;
  });
});
