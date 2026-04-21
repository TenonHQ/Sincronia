import { SawmillApiConfig } from "./types";

/**
 * Skeleton Sawmill API. Retrieve/preview/commit behavior lands in US-005.
 */
export interface SawmillApi {
  readonly instance: string;
}

export function createSawmillApi(config: SawmillApiConfig): SawmillApi {
  if (!config || !config.instance || !config.username || !config.password) {
    throw new Error("createSawmillApi requires instance, username, and password");
  }
  return {
    instance: config.instance,
  };
}
