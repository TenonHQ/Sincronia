const express = require("express");
const path = require("path");
const axios = require("axios");
const fs = require("fs");

// Everything resolves from CWD — run this from your Sincronia project directory
const PROJECT_ROOT = process.cwd();
const envPath = path.resolve(PROJECT_ROOT, ".env");
require("dotenv").config({ path: envPath });

const app = express();
app.disable("x-powered-by");
const PORT = process.env.DASHBOARD_PORT || 3456;

const SN_INSTANCE = process.env.SN_INSTANCE || "";
const SN_USER = process.env.SN_USER || "";
const SN_PASSWORD = process.env.SN_PASSWORD || "";
const BASE_URL = `https://${SN_INSTANCE}`;

const UPDATE_SET_CONFIG = path.join(PROJECT_ROOT, ".sinc-update-sets.json");
const SINC_CONFIG_PATH = path.join(PROJECT_ROOT, "sinc.config.js");
const ACTIVE_TASK_FILE = path.join(PROJECT_ROOT, ".sinc-active-task.json");

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN || "";
const CLICKUP_TEAM_ID = process.env.CLICKUP_TEAM_ID || "";

// Rate limiting for ServiceNow API calls (matches core snClient 20 RPS)
// Promise-based queue: delays requests when approaching the limit instead of throwing
var snRequestTimestamps = [];
var MAX_SN_RPS = 20;
var SN_WINDOW_MS = 1000;

function waitForRateLimit() {
  var now = Date.now();
  // Purge timestamps older than the window
  snRequestTimestamps = snRequestTimestamps.filter(function (ts) {
    return now - ts < SN_WINDOW_MS;
  });

  if (snRequestTimestamps.length < MAX_SN_RPS) {
    snRequestTimestamps.push(now);
    return Promise.resolve();
  }

  // Calculate how long to wait until the oldest request falls out of the window
  var oldest = snRequestTimestamps[0];
  var delayMs = SN_WINDOW_MS - (now - oldest) + 10; // +10ms buffer
  return new Promise(function (resolve) {
    setTimeout(function () {
      snRequestTimestamps = snRequestTimestamps.filter(function (ts) {
        return Date.now() - ts < SN_WINDOW_MS;
      });
      snRequestTimestamps.push(Date.now());
      resolve();
    }, delayMs);
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ServiceNow API helper — waits for rate limit clearance before firing
async function snApi(method, endpoint, data) {
  await waitForRateLimit();
  return axios({
    method,
    url: `${BASE_URL}/${endpoint}`,
    auth: { username: SN_USER, password: SN_PASSWORD },
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    data,
  });
}

// ClickUp API helper
function clickupApi(method, endpoint, data) {
  return axios({
    method,
    url: "https://api.clickup.com/api/v2/" + endpoint,
    headers: {
      Authorization: CLICKUP_TOKEN,
      "Content-Type": "application/json",
    },
    data,
  });
}

// Generate update set name from ClickUp task
function generateUpdateSetName(taskId, taskName) {
  var sanitized = taskName.replace(/[^a-zA-Z0-9\s\-_]/g, "").trim();
  var base = "CU-" + taskId + " — " + sanitized;
  return base.substring(0, 80);
}

// Generate update set description from task
function generateUpdateSetDescription(taskName, taskDescription) {
  var desc = taskName;
  if (taskDescription) {
    var firstSentence = taskDescription.split(/[.!\n]/)[0].trim();
    if (firstSentence) {
      desc += " — " + firstSentence.substring(0, 150);
    }
  }
  return desc;
}

// Read active task from persistence file
function readActiveTask() {
  if (fs.existsSync(ACTIVE_TASK_FILE)) {
    return JSON.parse(fs.readFileSync(ACTIVE_TASK_FILE, "utf8"));
  }
  return null;
}

// Write active task to persistence file
function writeActiveTask(task) {
  fs.writeFileSync(ACTIVE_TASK_FILE, JSON.stringify(task, null, 2));
}

// Extract duplicate number from ServiceNow auto-numbered name
// "CU-abc — Name" => -1, "CU-abc — Name 1" => 1, "CU-abc — Name 2" => 2
function extractDuplicateNumber(name, baseName) {
  if (name === baseName) return -1;
  var suffix = name.substring(baseName.length).trim();
  var num = parseInt(suffix, 10);
  return isNaN(num) ? -1 : num;
}

// Find the best matching update set (highest duplicate number)
function findBestMatch(updateSets, baseName) {
  var matches = updateSets.filter(function (us) {
    return us.name === baseName || us.name.indexOf(baseName + " ") === 0;
  });
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  var best = matches[0];
  var bestNum = extractDuplicateNumber(best.name, baseName);
  for (var i = 1; i < matches.length; i++) {
    var num = extractDuplicateNumber(matches[i].name, baseName);
    if (num > bestNum) {
      best = matches[i];
      bestNum = num;
    }
  }
  return best;
}

// GET /api/scopes — read from sinc.config.js + resolve display names
app.get("/api/scopes", async (req, res) => {
  try {
    delete require.cache[require.resolve(SINC_CONFIG_PATH)];
    const config = require(SINC_CONFIG_PATH);
    const scopeKeys = Object.keys(config.scopes || {});

    // Batch query for all scope records
    const scopeQuery = scopeKeys.map((s) => `scope=${s}`).join("^OR");
    const resp = await snApi(
      "get",
      `api/now/table/sys_scope?sysparm_query=${encodeURIComponent(scopeQuery)}&sysparm_fields=sys_id,scope,name&sysparm_limit=50`
    );

    const scopeRecords = resp.data.result || [];
    const scopeMap = {};
    scopeRecords.forEach((r) => {
      scopeMap[r.scope] = { sys_id: r.sys_id, name: r.name, scope: r.scope };
    });

    // Load saved selections
    let saved = {};
    if (fs.existsSync(UPDATE_SET_CONFIG)) {
      saved = JSON.parse(fs.readFileSync(UPDATE_SET_CONFIG, "utf8"));
    }

    const scopes = scopeKeys.map((key) => ({
      scope: key,
      sys_id: scopeMap[key] ? scopeMap[key].sys_id : null,
      display_name: scopeMap[key] ? scopeMap[key].name : key,
      selected_update_set: saved[key] || null,
    }));

    res.json({ scopes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/update-sets/:scope — list in-progress update sets for a scope
app.get("/api/update-sets/:scope", async (req, res) => {
  try {
    const { scope } = req.params;
    const query = `application.scope=${scope}^state=in progress^ORDERBYDESCsys_created_on`;
    const resp = await snApi(
      "get",
      `api/now/table/sys_update_set?sysparm_query=${encodeURIComponent(query)}&sysparm_fields=sys_id,name,state,application,sys_created_on,description&sysparm_limit=50`
    );
    res.json({ update_sets: resp.data.result || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/update-set — create a new update set
app.post("/api/update-set", async (req, res) => {
  try {
    const { name, scope_sys_id, description } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "name is required" });
    }
    if (!scope_sys_id || typeof scope_sys_id !== "string") {
      return res.status(400).json({ error: "scope_sys_id is required" });
    }
    const data = {
      name,
      state: "in progress",
      application: scope_sys_id,
    };
    if (description) data.description = description;

    const resp = await snApi("post", "api/now/table/sys_update_set", data);
    res.json({ update_set: resp.data.result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/update-set/:sysId/close — close an update set
app.patch("/api/update-set/:sysId/close", async (req, res) => {
  try {
    const { sysId } = req.params;
    const resp = await snApi(
      "patch",
      `api/now/table/sys_update_set/${sysId}`,
      { state: "complete" }
    );
    res.json({ update_set: resp.data.result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/select-update-set — save scope->updateSet mapping
app.post("/api/select-update-set", async (req, res) => {
  try {
    const { scope, update_set_sys_id, update_set_name } = req.body;
    if (!scope || typeof scope !== "string") {
      return res.status(400).json({ error: "scope is required" });
    }

    let config = {};
    if (fs.existsSync(UPDATE_SET_CONFIG)) {
      config = JSON.parse(fs.readFileSync(UPDATE_SET_CONFIG, "utf8"));
    }

    if (update_set_sys_id) {
      config[scope] = { sys_id: update_set_sys_id, name: update_set_name };
    } else {
      delete config[scope];
    }

    fs.writeFileSync(UPDATE_SET_CONFIG, JSON.stringify(config, null, 2));
    res.json({ saved: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/config — return current saved config
app.get("/api/config", (req, res) => {
  try {
    let config = {};
    if (fs.existsSync(UPDATE_SET_CONFIG)) {
      config = JSON.parse(fs.readFileSync(UPDATE_SET_CONFIG, "utf8"));
    }
    res.json({ config, instance: SN_INSTANCE });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ClickUp Endpoints ---

// GET /api/clickup/status — check if ClickUp is configured + active task
app.get("/api/clickup/status", function (req, res) {
  try {
    var activeTask = readActiveTask();
    res.json({
      configured: !!(CLICKUP_TOKEN && CLICKUP_TOKEN.length > 0),
      hasTeamId: !!(CLICKUP_TEAM_ID && CLICKUP_TEAM_ID.length > 0),
      activeTask: activeTask,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/clickup/tasks — fetch user's tasks with optional status filter
app.get("/api/clickup/tasks", async function (req, res) {
  try {
    if (!CLICKUP_TOKEN) {
      return res.status(400).json({ error: "CLICKUP_API_TOKEN not configured" });
    }

    var teamId = CLICKUP_TEAM_ID;
    if (!teamId) {
      var teamsResp = await clickupApi("get", "team");
      var teams = teamsResp.data.teams || [];
      if (teams.length === 0) {
        return res.status(400).json({ error: "No ClickUp teams found" });
      }
      teamId = teams[0].id;
    }

    var statuses = req.query.statuses;
    var statusList = statuses ? statuses.split(",") : [];

    var url = "team/" + teamId + "/task?subtasks=true&include_closed=false";
    statusList.forEach(function (s) {
      url += "&statuses[]=" + encodeURIComponent(s.trim());
    });

    var resp = await clickupApi("get", url);
    var tasks = resp.data.tasks || [];

    // Group by status
    var byStatus = {};
    var allStatuses = [];
    tasks.forEach(function (t) {
      var statusName = t.status && t.status.status ? t.status.status : "unknown";
      if (!byStatus[statusName]) {
        byStatus[statusName] = [];
        allStatuses.push(statusName);
      }
      byStatus[statusName].push({
        id: t.id,
        name: t.name,
        description: t.description || "",
        status: statusName,
        statusColor: t.status && t.status.color ? t.status.color : null,
        priority: t.priority ? t.priority.priority : null,
        url: t.url || "",
        customId: t.custom_id || null,
      });
    });

    res.json({ tasks: tasks.length, byStatus: byStatus, statuses: allStatuses });
  } catch (e) {
    var msg = e.message;
    if (e.response && e.response.data) {
      msg = e.response.data.err || e.response.data.error || msg;
    }
    res.status(500).json({ error: msg });
  }
});

// GET /api/clickup/task/:taskId — fetch single task detail
app.get("/api/clickup/task/:taskId", async function (req, res) {
  try {
    if (!CLICKUP_TOKEN) {
      return res.status(400).json({ error: "CLICKUP_API_TOKEN not configured" });
    }
    var resp = await clickupApi("get", "task/" + req.params.taskId);
    var t = resp.data;
    res.json({
      task: {
        id: t.id,
        name: t.name,
        description: t.description || "",
        status: t.status && t.status.status ? t.status.status : "unknown",
        statusColor: t.status && t.status.color ? t.status.color : null,
        priority: t.priority ? t.priority.priority : null,
        url: t.url || "",
        customId: t.custom_id || null,
      },
    });
  } catch (e) {
    var msg = e.message;
    if (e.response && e.response.data) {
      msg = e.response.data.err || e.response.data.error || msg;
    }
    res.status(500).json({ error: msg });
  }
});

// POST /api/clickup/select-task — select a task as active
app.post("/api/clickup/select-task", function (req, res) {
  try {
    var body = req.body;
    if (!body.taskId || !body.taskName) {
      return res.status(400).json({ error: "taskId and taskName are required" });
    }

    var updateSetName = generateUpdateSetName(body.taskId, body.taskName);
    var description = generateUpdateSetDescription(
      body.taskName,
      body.taskDescription || ""
    );

    var activeTask = {
      taskId: body.taskId,
      taskName: body.taskName,
      taskDescription: body.taskDescription || "",
      updateSetName: updateSetName,
      description: description,
      taskUrl: body.taskUrl || "",
      scopes: {},
    };

    writeActiveTask(activeTask);
    res.json({ activeTask: activeTask });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Core logic: find or create update set for a scope given an active task
// Returns { update_set, created }
async function findOrCreateUpdateSet(scope, scopeSysId, activeTask) {
  var baseName = activeTask.updateSetName;
  var taskId = activeTask.taskId;

  // Query ServiceNow for existing update sets matching this task in this scope
  var query =
    "application.scope=" + scope +
    "^nameLIKECU-" + taskId +
    "^state=in progress" +
    "^ORDERBYDESCsys_created_on";
  var searchResp = await snApi(
    "get",
    "api/now/table/sys_update_set?sysparm_query=" +
      encodeURIComponent(query) +
      "&sysparm_fields=sys_id,name,state,application,sys_created_on,description&sysparm_limit=50"
  );
  var existing = searchResp.data.result || [];

  var updateSet = null;

  if (existing.length > 0) {
    updateSet = findBestMatch(existing, baseName);
    if (!updateSet) {
      updateSet = existing[0];
    }
  }

  var created = false;
  if (!updateSet) {
    var createData = {
      name: baseName,
      state: "in progress",
      application: scopeSysId,
    };
    if (activeTask.description) {
      createData.description = activeTask.description;
    }
    var createResp = await snApi("post", "api/now/table/sys_update_set", createData);
    updateSet = createResp.data.result;
    created = true;
  }

  // Change the current update set on the ServiceNow instance
  try {
    await snApi(
      "get",
      "api/cadso/claude/changeUpdateSet?sysId=" + encodeURIComponent(updateSet.sys_id)
    );
  } catch (changeErr) {
    console.error("Warning: Could not auto-switch update set on instance:", changeErr.message);
  }

  return { update_set: updateSet, created: created };
}

// Persist scope activation into both active task file and update set config
function persistScopeActivation(scope, updateSet, activeTask) {
  activeTask.scopes[scope] = {
    sys_id: updateSet.sys_id,
    name: updateSet.name,
  };
  writeActiveTask(activeTask);

  var config = {};
  if (fs.existsSync(UPDATE_SET_CONFIG)) {
    config = JSON.parse(fs.readFileSync(UPDATE_SET_CONFIG, "utf8"));
  }
  config[scope] = {
    sys_id: updateSet.sys_id,
    name: updateSet.name,
  };
  fs.writeFileSync(UPDATE_SET_CONFIG, JSON.stringify(config, null, 2));
}

// POST /api/clickup/activate-scope — find or create update set for a scope
app.post("/api/clickup/activate-scope", async function (req, res) {
  try {
    var body = req.body;
    if (!body.scope || !body.scope_sys_id) {
      return res.status(400).json({ error: "scope and scope_sys_id are required" });
    }

    var activeTask = readActiveTask();
    if (!activeTask) {
      return res.status(400).json({ error: "No active task selected" });
    }

    var result = await findOrCreateUpdateSet(body.scope, body.scope_sys_id, activeTask);
    persistScopeActivation(body.scope, result.update_set, activeTask);

    res.json({
      update_set: result.update_set,
      created: result.created,
      scope: body.scope,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/clickup/activate-all-scopes — find or create update sets for all configured scopes
app.post("/api/clickup/activate-all-scopes", async function (req, res) {
  try {
    var activeTask = readActiveTask();
    if (!activeTask) {
      return res.status(400).json({ error: "No active task selected" });
    }

    // Read scopes from sinc.config.js
    delete require.cache[require.resolve(SINC_CONFIG_PATH)];
    var config = require(SINC_CONFIG_PATH);
    var scopeKeys = Object.keys(config.scopes || {});

    // Resolve scope sys_ids
    var scopeQuery = scopeKeys.map(function (s) { return "scope=" + s; }).join("^OR");
    var scopeResp = await snApi(
      "get",
      "api/now/table/sys_scope?sysparm_query=" +
        encodeURIComponent(scopeQuery) +
        "&sysparm_fields=sys_id,scope,name&sysparm_limit=50"
    );
    var scopeRecords = scopeResp.data.result || [];
    var scopeMap = {};
    scopeRecords.forEach(function (r) {
      scopeMap[r.scope] = r.sys_id;
    });

    // Activate each scope sequentially (respects rate limits)
    var results = [];
    for (var i = 0; i < scopeKeys.length; i++) {
      var scope = scopeKeys[i];
      var scopeSysId = scopeMap[scope];
      if (!scopeSysId) {
        results.push({ scope: scope, error: "scope not found on instance" });
        continue;
      }

      try {
        var result = await findOrCreateUpdateSet(scope, scopeSysId, activeTask);
        persistScopeActivation(scope, result.update_set, activeTask);
        // Re-read active task so subsequent iterations see updated scopes
        activeTask = readActiveTask();
        results.push({
          scope: scope,
          update_set: result.update_set,
          created: result.created,
        });
      } catch (scopeErr) {
        results.push({ scope: scope, error: scopeErr.message });
      }
    }

    res.json({ results: results, activeTask: readActiveTask() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/clickup/deselect-task — clear the active task
app.post("/api/clickup/deselect-task", function (req, res) {
  try {
    if (fs.existsSync(ACTIVE_TASK_FILE)) {
      fs.unlinkSync(ACTIVE_TASK_FILE);
    }
    res.json({ cleared: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log("\n  Sincronia Update Set Dashboard");
  console.log("  Instance:  " + SN_INSTANCE);
  console.log("  Project:   " + PROJECT_ROOT);
  console.log("  Dashboard: http://localhost:" + PORT + "\n");
});
