#!/usr/bin/env node
"use strict";

/**
 * Deploy global-scope ServiceNow source files (Sincronia REST API backing
 * records) to the configured instance. Reads from the sibling source folders
 * in this directory.
 *
 * Usage:
 *   node scripts/deploy.js                 # push all files
 *   node scripts/deploy.js --dry-run       # show what would change, no writes
 *   node scripts/deploy.js SincUtilsMS     # push a single record by name
 *
 * Reads SN_INSTANCE / SN_USER / SN_PASSWORD from env (loads ../.env if present
 * or falls back to the ServiceNow repo's .env).
 */

var fs = require("fs");
var path = require("path");
var https = require("https");

var ROOT = path.join(__dirname, "..");
var SCRIPT_INCLUDE_DIR = path.join(ROOT, "sys_script_include");
var WS_OPERATION_DIR = path.join(ROOT, "sys_ws_operation");

// Map local file basename → live record sys_id. Operation sys_ids come from
// the workstudio inventory pulled 2026-04-01.
var SCRIPT_INCLUDE_RECORDS = {
  "SincUtils": { sys_id: "b9aa2facc30cc710d4ddf1db0501317a", field: "script" },
  "SincUtilsMS": { sys_id: "884a272c334887107b18bc534d5c7b97", field: "script" }
};
var WS_OPERATION_RECORDS = {
  "getAppList": { sys_id: "6bbaefacc30cc710d4ddf1db050131ac", field: "operation_script" },
  "getCurrentScope": { sys_id: "98ca23ecc30cc710d4ddf1db05013120", field: "operation_script" },
  "getManifest": { sys_id: "78ca23ecc30cc710d4ddf1db050131c6", field: "operation_script" },
  "bulkDownload": { sys_id: "e5ca236c334887107b18bc534d5c7b75", field: "operation_script" },
  "pushATFfile": { sys_id: "deca2fe8334887107b18bc534d5c7be3", field: "operation_script" }
};

function loadEnv() {
  var candidates = [
    path.join(ROOT, ".env"),
    path.join(ROOT, "..", ".env"),
    path.join(ROOT, "..", "..", "ServiceNow", ".env")
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      var text = fs.readFileSync(candidates[i], "utf8");
      var env = {};
      text.split(/\r?\n/).forEach(function(line) {
        var m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      });
      Object.keys(env).forEach(function(k) {
        if (!process.env[k]) process.env[k] = env[k];
      });
      return candidates[i];
    }
  }
  return null;
}

function buildClient() {
  var instance = process.env.SN_INSTANCE;
  var user = process.env.SN_USER;
  var pass = process.env.SN_PASSWORD;
  if (!instance || !user || !pass) {
    console.error("Missing SN_INSTANCE / SN_USER / SN_PASSWORD in env");
    process.exit(1);
  }
  var host = instance.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host.includes(".")) host = host + ".service-now.com";
  var auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");
  return { host: host, auth: auth };
}

function request(client, opts) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: client.host,
      path: opts.path,
      method: opts.method,
      headers: Object.assign({
        Authorization: client.auth,
        Accept: "application/json"
      }, opts.headers || {})
    }, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        var body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: body });
        } else {
          reject(new Error("HTTP " + res.statusCode + ": " + body.slice(0, 500)));
        }
      });
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function fetchRemote(client, table, sysId, field) {
  return request(client, {
    method: "GET",
    path: "/api/now/table/" + table + "/" + sysId +
      "?sysparm_fields=" + field + "&sysparm_display_value=value&sysparm_exclude_reference_link=true"
  }).then(function(r) {
    return JSON.parse(r.body).result[field] || "";
  });
}

function pushRemote(client, table, sysId, field, value) {
  var body = JSON.stringify({ [field]: value });
  return request(client, {
    method: "PATCH",
    path: "/api/now/table/" + table + "/" + sysId,
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    body: body
  });
}

async function main() {
  var args = process.argv.slice(2);
  var dryRun = args.indexOf("--dry-run") !== -1;
  var nameFilter = args.filter(function(a) { return !a.startsWith("--"); })[0];

  var envPath = loadEnv();
  console.log("Env: " + (envPath || "none — using process.env"));
  var client = buildClient();
  console.log("Instance: " + client.host);
  console.log("Mode: " + (dryRun ? "DRY RUN" : "WRITE"));
  if (nameFilter) console.log("Filter: " + nameFilter);
  console.log("");

  var jobs = [];
  Object.keys(SCRIPT_INCLUDE_RECORDS).forEach(function(name) {
    if (nameFilter && nameFilter !== name) return;
    var local = path.join(SCRIPT_INCLUDE_DIR, name + ".js");
    if (!fs.existsSync(local)) return;
    jobs.push({
      label: name + " (sys_script_include)",
      table: "sys_script_include",
      sys_id: SCRIPT_INCLUDE_RECORDS[name].sys_id,
      field: SCRIPT_INCLUDE_RECORDS[name].field,
      file: local
    });
  });
  Object.keys(WS_OPERATION_RECORDS).forEach(function(name) {
    if (nameFilter && nameFilter !== name) return;
    var local = path.join(WS_OPERATION_DIR, name + ".js");
    if (!fs.existsSync(local)) return;
    jobs.push({
      label: name + " (sys_ws_operation)",
      table: "sys_ws_operation",
      sys_id: WS_OPERATION_RECORDS[name].sys_id,
      field: WS_OPERATION_RECORDS[name].field,
      file: local
    });
  });

  if (jobs.length === 0) {
    console.error("No matching records.");
    process.exit(1);
  }

  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    var local = fs.readFileSync(job.file, "utf8");
    var remote = await fetchRemote(client, job.table, job.sys_id, job.field);
    var diff = local !== remote;
    console.log((diff ? "✱ " : "  ") + job.label + " — " + (diff ? "WILL UPDATE" : "in sync") +
      "  (local " + local.length + " ch / remote " + remote.length + " ch)");
    if (diff && !dryRun) {
      await pushRemote(client, job.table, job.sys_id, job.field, local);
      console.log("    pushed");
    }
  }

  if (dryRun) {
    console.log("\nDry run — no changes pushed. Re-run without --dry-run to apply.");
  }
}

main().catch(function(err) {
  console.error("Error: " + err.message);
  process.exit(1);
});
