/**
 * ServiceNow REST client for @tenonhq/sincronia-servicenow.
 *
 * Provides two entry points:
 *   - `table.*`       — read-only GETs against the native Table API
 *   - `claude.*`      — writes via the Sincronia "Claude" Scripted REST API
 *                       (/api/cadso/claude/*), which handles update-set + scope
 *                       switching atomically so every write lands in the right
 *                       update set without touching sys_user_preference.
 *
 * Env fallbacks mirror scripts/sinch-dashboard-fetch/sn-client.js so dev setups
 * that already have SN_INSTANCE/SN_USER/SN_PASSWORD work without reconfiguration.
 */

import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import type { ServiceNowClientConfig } from "./types";

/**
 * Env precedence for instance/auth: explicit cfg > SN_* > SN_DEV_* > SN_PROD_*.
 * SN_DEV_* / SN_PROD_* fallbacks match the names documented in Craftsman/CLAUDE.local.md
 * so existing developer setups work without re-exporting variables. SN_DEV_INSTANCE
 * may be a bare instance name (e.g. "TenonWorkStudio") — `.service-now.com` is
 * appended when it isn't already part of the host.
 */
function normalizeHost(raw: string): string {
  var host = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (host && host.indexOf(".") === -1) {
    host = host.toLowerCase() + ".service-now.com";
  }
  return host;
}

function resolveInstance(cfg: ServiceNowClientConfig): string {
  var raw = cfg.instance
    || process.env.SN_INSTANCE
    || process.env.SN_DEV_INSTANCE
    || process.env.SN_PROD_INSTANCE
    || "";
  if (!raw) {
    throw new Error(
      "ServiceNow instance not configured. Set SN_INSTANCE (preferred) or SN_DEV_INSTANCE / SN_PROD_INSTANCE, or pass { instance }."
    );
  }
  return normalizeHost(raw);
}

function resolveAuth(cfg: ServiceNowClientConfig): { user: string; password: string } {
  var user = cfg.user
    || process.env.SN_USER
    || process.env.SN_DEV_USERNAME
    || process.env.SN_PROD_USERNAME
    || "";
  var password = cfg.password
    || process.env.SN_PASSWORD
    || process.env.SN_DEV_PASSWORD
    || process.env.SN_PROD_PASSWORD
    || "";
  if (!user || !password) {
    throw new Error(
      "ServiceNow credentials missing — set SN_USER/SN_PASSWORD (preferred) " +
      "or SN_DEV_USERNAME/SN_DEV_PASSWORD (or SN_PROD_*)."
    );
  }
  return { user: user, password: password };
}

function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

export interface TableSchemaField {
  name: string;
  type: string;
  mandatory: boolean;
  reference_table: string | null;
}

export interface TableSchema {
  fields: Array<TableSchemaField>;
  primary_key: string;
}

export interface ServiceNowClient {
  table: {
    /** GET /api/now/table/<t>?sysparm_query=...&sysparm_limit=N — returns result array. */
    query: <T = Record<string, any>>(table: string, query: string, limit?: number) => Promise<Array<T>>;
  };
  buildAgent: {
    /**
     * GET /api/sn_build_agent/build_agent_api/runQuery/table/<t>/query/<encoded q>.
     * Same shape as table.query. Falls back to table.query on 403/404 so the skill
     * works on instances where sn_build_agent is not deployed or the caller lacks
     * the Build Agent role. The fallback is transparent to the caller.
     */
    runQuery: <T = Record<string, any>>(params: { table: string; query: string; limit?: number }) => Promise<Array<T>>;
    /**
     * GET /api/sn_build_agent/build_agent_api/getTableSchema/<t>.
     * On 403/404 falls back to a sys_dictionary query that synthesizes the same
     * shape from element/internal_type/mandatory/reference_table fields.
     */
    getTableSchema: (table: string) => Promise<TableSchema>;
  };
  claude: {
    /** POST /api/cadso/claude/createRecord. */
    createRecord: (params: {
      table: string;
      fields: Record<string, any>;
      scope?: string;
      update_set_sys_id?: string;
      sys_id?: string;
    }) => Promise<{ sys_id: string; [k: string]: any }>;
    /** POST /api/cadso/claude/pushWithUpdateSet. */
    pushWithUpdateSet: (params: {
      update_set_sys_id: string;
      table: string;
      record_sys_id: string;
      fields: Record<string, any>;
    }) => Promise<{ sys_id: string; [k: string]: any }>;
    /** GET /api/cadso/claude/currentUpdateSet?scope=... */
    currentUpdateSet: (scope?: string) => Promise<{ sys_id: string; name: string }>;
  };
}

/**
 * Match a thrown error message against the 403/404 patterns produced by request().
 * buildAgent.* uses this to decide when to fall back to the plain Table API.
 */
function isAccessOrMissing(err: any): boolean {
  var msg = err && err.message ? String(err.message) : "";
  if (msg.indexOf("auth error 403") >= 0) return true;
  if (msg.indexOf("SN 404") >= 0) return true;
  return false;
}

export function createClient(config: ServiceNowClientConfig = {}): ServiceNowClient {
  var host = resolveInstance(config);
  var creds = resolveAuth(config);
  var intervalMs = config.requestIntervalMs != null
    ? config.requestIntervalMs
    : Number(process.env.SN_REQUEST_INTERVAL_MS) || 20;
  var max429 = config.maxRetries429 != null
    ? config.maxRetries429
    : Number(process.env.SN_MAX_RETRIES_429) || 5;
  var max5xx = config.maxRetries5xx != null
    ? config.maxRetries5xx
    : Number(process.env.SN_MAX_RETRIES_5XX) || 3;

  var http: AxiosInstance = axios.create({
    baseURL: "https://" + host,
    auth: { username: creds.user, password: creds.password },
    headers: { accept: "application/json", "content-type": "application/json" },
    validateStatus: function () { return true; }
  });

  var lastAt = 0;

  async function request<T = any>(cfg: AxiosRequestConfig, ctx: string): Promise<T> {
    var attempt429 = 0;
    var attempt5xx = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      var elapsed = Date.now() - lastAt;
      if (elapsed < intervalMs) {
        await sleep(intervalMs - elapsed);
      }
      lastAt = Date.now();

      var res;
      try {
        res = await http.request(cfg);
      } catch (netErr: any) {
        if (attempt5xx >= max5xx) {
          throw new Error("SN network error on " + ctx + ": " + (netErr && netErr.message));
        }
        attempt5xx += 1;
        await sleep(Math.pow(2, attempt5xx) * 1000);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error("SN auth error " + res.status + " on " + ctx + " — check SN_USER/SN_PASSWORD and ACLs.");
      }
      if (res.status === 404) {
        throw new Error("SN 404 on " + ctx + " — endpoint or record not found.");
      }
      if (res.status === 429) {
        if (attempt429 >= max429) {
          throw new Error("SN 429 rate limit — retries exhausted on " + ctx);
        }
        attempt429 += 1;
        await sleep(Math.min(60000, Math.pow(2, attempt429) * 1000));
        continue;
      }
      if (res.status >= 500) {
        if (attempt5xx >= max5xx) {
          throw new Error("SN " + res.status + " on " + ctx + " — retries exhausted.");
        }
        attempt5xx += 1;
        await sleep(Math.pow(2, attempt5xx) * 1000);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        var body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        throw new Error("SN " + res.status + " on " + ctx + ": " + body.substring(0, 400));
      }
      return res.data as T;
    }
  }

  async function tableQueryHelper<T = Record<string, any>>(table: string, query: string, limit: number = 100): Promise<Array<T>> {
    var data = await request<{ result: Array<T> }>(
      {
        method: "GET",
        url: "/api/now/table/" + encodeURIComponent(table),
        params: { sysparm_query: query, sysparm_limit: limit, sysparm_display_value: false }
      },
      "table.query(" + table + ")"
    );
    return data.result || [];
  }

  async function buildAgentRunQuery<T = Record<string, any>>(params: { table: string; query: string; limit?: number }): Promise<Array<T>> {
    var lim = params.limit != null ? params.limit : 100;
    var ctx = "buildAgent.runQuery(" + params.table + ")";
    try {
      var data = await request<any>(
        {
          method: "GET",
          url: "/api/sn_build_agent/build_agent_api/runQuery/table/"
            + encodeURIComponent(params.table)
            + "/query/" + encodeURIComponent(params.query),
          params: { sysparm_limit: lim }
        },
        ctx
      );
      // build_agent endpoints may return { result: [...] } or [...] directly.
      if (Array.isArray(data)) return data as Array<T>;
      if (data && Array.isArray(data.result)) return data.result as Array<T>;
      return [] as Array<T>;
    } catch (err: any) {
      if (!isAccessOrMissing(err)) throw err;
      return await tableQueryHelper<T>(params.table, params.query, lim);
    }
  }

  async function buildAgentGetTableSchema(table: string): Promise<TableSchema> {
    var ctx = "buildAgent.getTableSchema(" + table + ")";
    try {
      var data = await request<any>(
        {
          method: "GET",
          url: "/api/sn_build_agent/build_agent_api/getTableSchema/" + encodeURIComponent(table)
        },
        ctx
      );
      var payload = data && data.result ? data.result : data;
      if (payload && Array.isArray(payload.fields)) {
        return {
          fields: payload.fields,
          primary_key: payload.primary_key || "sys_id"
        };
      }
    } catch (err: any) {
      if (!isAccessOrMissing(err)) throw err;
    }
    // Fallback: derive from sys_dictionary.
    var rows = await tableQueryHelper<any>(
      "sys_dictionary",
      "name=" + table + "^element!=NULL",
      500
    );
    var fields: Array<TableSchemaField> = rows.map(function (r: any) {
      return {
        name: r.element,
        type: r.internal_type,
        mandatory: r.mandatory === "true" || r.mandatory === true,
        reference_table: r.reference_table || null
      };
    });
    return { fields: fields, primary_key: "sys_id" };
  }

  return {
    table: {
      query: tableQueryHelper
    },
    buildAgent: {
      runQuery: buildAgentRunQuery,
      getTableSchema: buildAgentGetTableSchema
    },
    claude: {
      createRecord: async function (params) {
        var data = await request<{ result: any }>(
          { method: "POST", url: "/api/cadso/claude/createRecord", data: params },
          "claude.createRecord(" + params.table + ")"
        );
        return data.result || data;
      },
      pushWithUpdateSet: async function (params) {
        var data = await request<{ result: any }>(
          { method: "POST", url: "/api/cadso/claude/pushWithUpdateSet", data: params },
          "claude.pushWithUpdateSet(" + params.table + ")"
        );
        return data.result || data;
      },
      currentUpdateSet: async function (scope) {
        var data = await request<{ result: any }>(
          {
            method: "GET",
            url: "/api/cadso/claude/currentUpdateSet",
            params: scope ? { scope: scope } : {}
          },
          "claude.currentUpdateSet"
        );
        return data.result || data;
      }
    }
  };
}
