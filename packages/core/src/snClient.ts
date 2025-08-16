import { Sinc, SN } from "@tenonhq/sincronia-types";
import axios, { AxiosPromise, AxiosResponse } from "axios";
import rateLimit from "axios-rate-limit";
import { wait } from "./genericUtils";
import { logger } from "./Logger";
import { fileLogger } from "./FileLogger";

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
  const client = rateLimit(
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
    }),
    { maxRPS: 20 },
  );

  const getAppList = () => {
    const endpoint = "api/x_nuvo_sinc/sinc/getAppList";
    type AppListResponse = Sinc.SNAPIResponse<SN.App[]>;
    return client.get<AppListResponse>(endpoint);
  };

  const updateATFfile = (contents: string, sysId: string) => {
    const endpoint = "api/x_nuvo_sinc/pushATFfile";
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
    const endpoint = "api/x_nuvo_sinc/sinc/getCurrentScope";
    type ScopeResponse = Sinc.SNAPIResponse<SN.ScopeObj>;
    return client.get<ScopeResponse>(endpoint);
  };

  const createUpdateSet = (updateSetName: string, scopeSysId?: string, description?: string) => {
    const endpoint = `api/now/table/sys_update_set`;
    type UpdateSetCreateResponse = Sinc.SNAPIResponse<SN.UpdateSetRecord>;
    const data: any = {
      name: updateSetName,
      state: "in progress"
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
    const endpoint = `api/x_nuvo_sinc/sinc/bulkDownload`;
    
    fileLogger.debug('\n=== getMissingFiles DEBUG ===');
    fileLogger.debug('Fetching missing files from ServiceNow');
    fileLogger.debug('Endpoint:', endpoint);
    fileLogger.debug('Missing files request:', JSON.stringify(missingFiles, null, 2));
    fileLogger.debug('Table options:', JSON.stringify(tableOptions, null, 2));
    fileLogger.debug('=== getMissingFiles DEBUG END ===\n');
    
    type TableMap = Sinc.SNAPIResponse<SN.TableMap>;
    return client.post<TableMap>(endpoint, { missingFiles, tableOptions });
  };

  const getManifest = (
    scope: string,
    config: Sinc.ScopedConfig,
    withFiles = false,
  ) => {
    const endpoint = `api/x_nuvo_sinc/sinc/getManifest/${scope}`;
    const {
      includes = {},
      excludes = {},
      tableOptions = {},
      scopes = {},
    } = config;
    
    fileLogger.debug('\n=== getManifest DEBUG ===');
    fileLogger.debug('Fetching manifest from ServiceNow');
    fileLogger.debug('Endpoint:', endpoint);
    fileLogger.debug('Scope:', scope);
    fileLogger.debug('With files (should download file contents):', withFiles);
    fileLogger.debug('Request body:', JSON.stringify({
      includes,
      excludes,
      tableOptions,
      withFiles,
      getContents: withFiles
    }, null, 2));
    fileLogger.debug('IMPORTANT: withFiles=' + withFiles + ' means', withFiles ? 'DOWNLOAD file contents' : 'NO file contents (manifest only)');
    fileLogger.debug('=== getManifest DEBUG END ===\n');
    
    type AppResponse = Sinc.SNAPIResponse<SN.AppManifest>;
    return client.post<AppResponse>(endpoint, {
      includes,
      excludes,
      tableOptions,
      withFiles,
      getContents: withFiles,  // ServiceNow expects getContents, not withFiles
    });
  };

  const changeUpdateSet = (params: { sysId?: string; name?: string; scope?: string }) => {
    const endpoint = "api/cadso/claude/changeUpdateSet";
    type ChangeUpdateSetResponse = { message?: string; error?: string };
    return client.get<ChangeUpdateSetResponse>(endpoint, {
      params,
    });
  };

  const getCurrentUpdateSet = (scope?: string) => {
    const endpoint = "api/cadso/claude/currentUpdateSet";
    type CurrentUpdateSetResponse = { message?: string; sysId?: string; name?: string; error?: string };
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
    type ChangeScopeResponse = { message?: string; sysId?: string; name?: string; error?: string };
    return client.get<ChangeScopeResponse>(endpoint, {
      params: { scope },
    });
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
    
    // Debug logging for manifest responses
    if (resp.config && resp.config.url && resp.config.url.includes('getManifest')) {
      fileLogger.debug('\n=== unwrapSNResponse DEBUG (Manifest) ===');
      fileLogger.debug('Response status:', resp.status);
      fileLogger.debug('Response URL:', resp.config.url);
      
      // Check structure of manifest response
      const result: any = resp.data.result;
      if (result && result.tables) {
        const tables = result.tables;
        fileLogger.debug('Tables in manifest:', Object.keys(tables));
        
        // Sample first table and record to see file structure
        const firstTable = Object.keys(tables)[0];
        if (firstTable) {
          const table = tables[firstTable];
          const firstRecord = Object.keys(table.records)[0];
          if (firstRecord) {
            const record = table.records[firstRecord];
            fileLogger.debug(`Sample record from ${firstTable}:`, {
              name: record.name,
              sys_id: record.sys_id,
              files: record.files.map((f: any) => ({
                name: f.name,
                type: f.type,
                hasContent: !!f.content
              }))
            });
          }
        }
      }
      fileLogger.debug('=== unwrapSNResponse DEBUG END ===\n');
    }
    
    // Debug logging for bulkDownload responses
    if (resp.config && resp.config.url && resp.config.url.includes('bulkDownload')) {
      fileLogger.debug('\n=== unwrapSNResponse DEBUG (BulkDownload) ===');
      fileLogger.debug('Response status:', resp.status);
      fileLogger.debug('Response URL:', resp.config.url);
      
      const result: any = resp.data.result;
      if (result) {
        const tables = result;
        fileLogger.debug('Tables in bulk download:', Object.keys(tables || {}));
        
        // Log details of files received
        if (tables) {
          Object.keys(tables).forEach((tableName: string) => {
            const table = tables[tableName];
            fileLogger.debug(`Table: ${tableName}`);
            if (table && table.records) {
              Object.keys(table.records).forEach((recordName: string) => {
                const record = table.records[recordName];
                fileLogger.debug(`  Record: ${recordName}`);
                if (record && record.files) {
                  record.files.forEach((file: any) => {
                    fileLogger.debug(`    File: ${file.name}.${file.type} (content: ${file.content ? file.content.length + ' chars' : 'null'})`);
                  });
                }
              });
            }
          });
        }
      }
      fileLogger.debug('=== unwrapSNResponse DEBUG END ===\n');
    }
    
    return resp.data.result;
  } catch (e) {
    let message;
    if (e instanceof Error) message = e.message;
    else message = String(e);
    logger.error("Error processing server response");
    logger.error(message);
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
