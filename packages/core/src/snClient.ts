import { Sinc, SN } from "@tenonhq/sincronia-types";
import axios, { AxiosPromise, AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import rateLimit from "axios-rate-limit";
import { CookieJar } from "tough-cookie";
import { wait } from "./genericUtils";
import { logger } from "./Logger";
import { fileLogger } from "./FileLogger";

// Local helper to strip _ directive keys before sending to ServiceNow API.
// Defined here (not imported from config.ts) to avoid circular dependencies.
function _stripUnderscoreKeys(obj: any): any {
  var result: any = {};
  var keys = Object.keys(obj || {});
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].charAt(0) !== "_") {
      result[keys[i]] = obj[keys[i]];
    }
  }
  return result;
}

export const retryOnErr = async <T>(
  f: () => Promise<T>,
  allowedRetries: number,
  msBetween = 0,
  onRetry?: (retriesLeft: number) => void,
): Promise<T> => {
  try {
    return await f();
  } catch (e) {
    const newRetries = allowedRetries - 1;
    if (newRetries <= 0) {
      throw e;
    }
    if (onRetry) {
      onRetry(newRetries);
    }
    await wait(msBetween);
    return retryOnErr(f, newRetries, msBetween, onRetry);
  }
};

export const processPushResponse = (
  response: AxiosResponse,
  recSummary: string,
): Sinc.PushResult => {
  const { status } = response;
  if (status === 404) {
    return {
      success: false,
      message: `Could not find ${recSummary} on the server.`,
    };
  }
  if (status < 200 || status > 299) {
    return {
      success: false,
      message: `Failed to push ${recSummary}. Recieved an unexpected response (${status})`,
    };
  }
  return {
    success: true,
    message: `${recSummary} pushed successfully!`,
  };
};

export const snClient = (
  baseURL: string,
  username: string,
  password: string,
) => {
  const jar = new CookieJar();
  const client = rateLimit(
    wrapper(
      axios.create({
        withCredentials: true,
        auth: {
          username,
          password,
        },
        headers: {
          "Content-Type": "application/json",
        },
        baseURL,
        jar,
      } as any),
    ),
    { maxRPS: 20 },
  );

  const getAppList = () => {
    const endpoint = "api/sinc/sincronia/getAppList";
    type AppListResponse = Sinc.SNAPIResponse<SN.App[]>;
    return client.get<AppListResponse>(endpoint);
  };

  const updateATFfile = (contents: string, sysId: string) => {
    const endpoint = "api/sinc/sincronia/pushATFfile";
    try {
      return client.post(endpoint, { file: contents, sys_id: sysId });
    } catch (e) {
      throw e;
    }
  };

  const updateRecord = (
    table: string,
    recordId: string,
    fields: Record<string, string>,
  ) => {
    if (table === "sys_atf_step") {
      updateATFfile(fields["inputs.script"], recordId);
    }
    const endpoint = `api/now/table/${table}/${recordId}`;
    return client.patch(endpoint, fields);
  };

  const getScopeId = (scopeName: string) => {
    const endpoint = "api/now/table/sys_scope";
    type ScopeResponse = Sinc.SNAPIResponse<SN.ScopeRecord[]>;
    return client.get<ScopeResponse>(endpoint, {
      params: {
        sysparm_query: `scope=${scopeName}`,
        sysparm_fields: "sys_id",
      },
    });
  };

  const getUserSysId = (userName: string = process.env.SN_USER as string) => {
    const endpoint = "api/now/table/sys_user";
    type UserResponse = Sinc.SNAPIResponse<SN.UserRecord[]>;
    return client.get<UserResponse>(endpoint, {
      params: {
        sysparm_query: `user_name=${userName}`,
        sysparm_fields: "sys_id",
      },
    });
  };

  const getCurrentAppUserPrefSysId = (userSysId: string) => {
    const endpoint = `api/now/table/sys_user_preference`;
    type UserPrefResponse = Sinc.SNAPIResponse<SN.UserPrefRecord[]>;
    return client.get<UserPrefResponse>(endpoint, {
      params: {
        sysparm_query: `user=${userSysId}^name=apps.current_app`,
        sysparm_fields: "sys_id",
      },
    });
  };

  const updateCurrentAppUserPref = (
    appSysId: string,
    userPrefSysId: string,
  ) => {
    const endpoint = `api/now/table/sys_user_preference/${userPrefSysId}`;
    return client.put(endpoint, { value: appSysId });
  };

  const createCurrentAppUserPref = (appSysId: string, userSysId: string) => {
    const endpoint = `api/now/table/sys_user_preference`;
    return client.post(endpoint, {
      value: appSysId,
      name: "apps.current_app",
      type: "string",
      user: userSysId,
    });
  };

  const getCurrentScope = () => {
    const endpoint = "api/sinc/sincronia/getCurrentScope";
    type ScopeResponse = Sinc.SNAPIResponse<SN.ScopeObj>;
    return client.get<ScopeResponse>(endpoint);
  };

  const createUpdateSet = (
    updateSetName: string,
    scopeSysId?: string,
    description?: string,
  ) => {
    const endpoint = `api/now/table/sys_update_set`;
    type UpdateSetCreateResponse = Sinc.SNAPIResponse<SN.UpdateSetRecord>;
    const data: any = {
      name: updateSetName,
      state: "in progress",
    };
    if (scopeSysId) {
      data.application = scopeSysId;
    }
    if (description) {
      data.description = description;
    }
    return client.post<UpdateSetCreateResponse>(endpoint, data);
  };

  const getCurrentUpdateSetUserPref = (userSysId: string) => {
    const endpoint = `api/now/table/sys_user_preference`;
    type CurrentUpdateSetResponse = Sinc.SNAPIResponse<SN.UserPrefRecord[]>;
    return client.get<CurrentUpdateSetResponse>(endpoint, {
      params: {
        sysparm_query: `user=${userSysId}^name=sys_update_set`,
        sysparm_fields: "sys_id",
      },
    });
  };
  const updateCurrentUpdateSetUserPref = (
    updateSetSysId: string,
    userPrefSysId: string,
  ) => {
    const endpoint = `api/now/table/sys_user_preference/${userPrefSysId}`;
    return client.put(endpoint, { value: updateSetSysId });
  };

  const createCurrentUpdateSetUserPref = (
    updateSetSysId: string,
    userSysId: string,
  ) => {
    const endpoint = `api/now/table/sys_user_preference`;
    return client.put(endpoint, {
      value: updateSetSysId,
      name: "sys_update_set",
      type: "string",
      user: userSysId,
    });
  };

  const getMissingFiles = (
    missingFiles: SN.MissingFileTableMap,
    tableOptions: Sinc.ITableOptionsMap,
  ) => {
    const endpoint = `api/sinc/sincronia/bulkDownload`;

    const tableCount = Object.keys(missingFiles).length;
    fileLogger.debug("Bulk downloading files for " + tableCount + " tables");

    type TableMap = Sinc.SNAPIResponse<SN.TableMap>;
    return client.post<TableMap>(endpoint, { missingFiles, tableOptions });
  };

  const getManifest = (
    scope: string,
    config: Sinc.ScopedConfig,
    withFiles = false,
  ) => {
    const endpoint = `api/sinc/sincronia/getManifest/${scope}`;
    const {
      includes = {},
      excludes = {},
      tableOptions = {},
      scopes = {},
    } = config;

    // Strip _ directive keys before sending to ServiceNow API
    var cleanIncludes = _stripUnderscoreKeys(includes);
    var cleanExcludes = _stripUnderscoreKeys(excludes);

    fileLogger.debug("Fetching manifest for scope " + scope + (withFiles ? " (with file contents)" : " (structure only)"));

    type AppResponse = Sinc.SNAPIResponse<SN.AppManifest>;
    return client.post<AppResponse>(endpoint, {
      includes: cleanIncludes,
      excludes: cleanExcludes,
      tableOptions,
      withFiles,
      getContents: withFiles, // ServiceNow expects getContents, not withFiles
    });
  };

  const changeUpdateSet = (params: {
    sysId?: string;
    name?: string;
    scope?: string;
  }) => {
    const endpoint = "api/cadso/claude/changeUpdateSet";
    type ChangeUpdateSetResponse = { message?: string; error?: string };
    return client.get<ChangeUpdateSetResponse>(endpoint, {
      params,
    });
  };

  const getCurrentUpdateSet = (scope?: string) => {
    const endpoint = "api/cadso/claude/currentUpdateSet";
    type CurrentUpdateSetResponse = {
      message?: string;
      sysId?: string;
      name?: string;
      error?: string;
    };
    const params: any = {};
    if (scope) {
      params.scope = scope;
    }
    return client.get<CurrentUpdateSetResponse>(endpoint, {
      params,
    });
  };

  const changeScope = (scope: string) => {
    const endpoint = "api/cadso/claude/changeScope";
    type ChangeScopeResponse = {
      message?: string;
      sysId?: string;
      name?: string;
      error?: string;
    };
    return client.get<ChangeScopeResponse>(endpoint, {
      params: { scope },
    });
  };

  const pushWithUpdateSet = (
    updateSetSysId: string,
    table: string,
    recordSysId: string,
    fields: Record<string, string>,
  ) => {
    const endpoint = "api/cadso/claude/pushWithUpdateSet";
    return client.post(endpoint, {
      update_set_sys_id: updateSetSysId,
      table,
      record_sys_id: recordSysId,
      fields,
    });
  };

  const createRecord = (params: {
    table: string;
    fields: Record<string, string>;
    sys_id?: string;
    scope?: string;
    update_set_sys_id?: string;
  }) => {
    const endpoint = "api/cadso/claude/createRecord";
    type CreateRecordResponse = {
      result: {
        sys_id: string;
        table: string;
        name: string;
        error?: string;
      };
    };
    return client.post<CreateRecordResponse>(endpoint, params);
  };

  const deleteRecord = (params: {
    table: string;
    sys_id: string;
    scope?: string;
  }) => {
    const endpoint = "api/cadso/claude/deleteRecord";
    type DeleteRecordResponse = {
      result: {
        success: boolean;
        sys_id: string;
        table: string;
        name: string;
        error?: string;
      };
    };
    return client.post<DeleteRecordResponse>(endpoint, params);
  };

  return {
    getAppList,
    updateRecord,
    getScopeId,
    getUserSysId,
    getCurrentAppUserPrefSysId,
    updateCurrentAppUserPref,
    createCurrentAppUserPref,
    getCurrentScope,
    createUpdateSet,
    getCurrentUpdateSetUserPref,
    updateCurrentUpdateSetUserPref,
    createCurrentUpdateSetUserPref,
    getMissingFiles,
    getManifest,
    changeUpdateSet,
    getCurrentUpdateSet,
    changeScope,
    pushWithUpdateSet,
    createRecord,
    deleteRecord,
    client, // Expose the axios client for custom queries
  };
};

let internalClient: SNClient | undefined = undefined;
export const defaultClient = () => {
  if (internalClient) {
    return internalClient;
  }
  const { SN_USER = "", SN_PASSWORD = "", SN_INSTANCE = "" } = process.env;
  internalClient = snClient(`https://${SN_INSTANCE}/`, SN_USER, SN_PASSWORD);
  return internalClient;
};

export type SNClient = ReturnType<typeof snClient>;

export const unwrapSNResponse = async <T>(
  clientPromise: AxiosPromise<Sinc.SNAPIResponse<T>>,
): Promise<T> => {
  try {
    const resp = await clientPromise;

    // Log response summary for key endpoints
    if (resp.config && resp.config.url) {
      const url = resp.config.url;
      const result: any = resp.data.result;

      if (url.includes("getManifest") && result && result.tables) {
        const tableCount = Object.keys(result.tables).length;
        fileLogger.debug("Manifest received: " + tableCount + " tables (status " + resp.status + ")");
      } else if (url.includes("bulkDownload") && result) {
        const tableCount = Object.keys(result).length;
        fileLogger.debug("Bulk download received: " + tableCount + " tables (status " + resp.status + ")");
      }
    }

    return resp.data.result;
  } catch (e) {
    let message;
    if (e instanceof Error) message = e.message;
    else message = String(e);
    const instance = process.env.SN_INSTANCE || "unknown";
    logger.error("Error from " + instance + ": " + message);
    throw e;
  }
};

export async function unwrapTableAPIFirstItem<T>(
  clientPromise: AxiosPromise<Sinc.SNAPIResponse<T[]>>,
): Promise<T>;
export async function unwrapTableAPIFirstItem<T>(
  clientPromise: AxiosPromise<Sinc.SNAPIResponse<T[]>>,
  extractField: keyof T,
): Promise<string>;
export async function unwrapTableAPIFirstItem<T extends Record<string, string>>(
  clientPromise: AxiosPromise<Sinc.SNAPIResponse<T[]>>,
  extractField?: keyof T,
): Promise<T | string> {
  try {
    const resp = await unwrapSNResponse(clientPromise);
    if (resp.length === 0) {
      throw new Error("Response was not a populated array!");
    }
    if (!extractField) {
      return resp[0];
    }
    return resp[0][extractField];
  } catch (e) {
    throw e;
  }
}
