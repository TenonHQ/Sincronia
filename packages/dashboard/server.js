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

// Rate limiting for ServiceNow API calls (matches core snClient 20 RPS)
let snRequestCount = 0;
let snRequestResetTime = Date.now();
const MAX_SN_RPS = 20;

function checkSNRateLimit() {
  const now = Date.now();
  if (now - snRequestResetTime > 1000) {
    snRequestCount = 0;
    snRequestResetTime = now;
  }
  if (snRequestCount >= MAX_SN_RPS) {
    throw new Error("Rate limit exceeded for ServiceNow API calls");
  }
  snRequestCount++;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ServiceNow API helper
function snApi(method, endpoint, data) {
  checkSNRateLimit();
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

app.listen(PORT, () => {
  console.log(`\n  Sincronia Update Set Dashboard`);
  console.log(`  Project:  ${PROJECT_ROOT}`);
  console.log(`  Instance: ${SN_INSTANCE}`);
  console.log(`  Config:   ${SINC_CONFIG_PATH}`);
  console.log(`  http://localhost:${PORT}\n`);
});
