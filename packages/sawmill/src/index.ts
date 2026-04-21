/**
 * @tenonhq/sincronia-sawmill
 *
 * ServiceNow update set promotion client for Sincronia.
 * Wraps the Sawmill Scripted REST API (POST /api/cadso/sawmill/promote).
 */

export { createSawmillApi } from "./client";
export type { SawmillApi } from "./client";
export type { SawmillApiConfig } from "./types";
export * from "./formatter";
