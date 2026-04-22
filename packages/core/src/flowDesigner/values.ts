import { gunzipSync, gzipSync } from "zlib";

/**
 * Shape of a single entry inside a decoded V2 `values` payload.
 * Documented via reverse engineering of sys_hub_action_instance_v2 blobs;
 * ServiceNow does not publish a schema for this structure.
 */
export interface V2ValueEntry {
  actionInstanceSysId?: string;
  id?: string;
  name?: string;
  value?: unknown;
  parameter?: {
    type?: string;
    labels?: unknown;
    validation?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Decode a ServiceNow V2 Flow Designer `values` blob.
 *
 * Source tables:
 *   - sys_hub_action_instance_v2.values
 *   - sys_hub_trigger_instance_v2.values
 *   - sys_hub_flow_logic_instance_v2.values
 *
 * Storage format: base64-encoded gzipped JSON.
 * Mirrors `GlideStringUtil.base64DecodeAsBytes()` + `GlideCompressionUtil.expandToString()`
 * + `JSON.parse` on the ServiceNow platform.
 *
 * Throws with a clear message if the blob is empty, not base64, or not gzip.
 */
export function decodeV2Values<T = V2ValueEntry[]>(blob: string): T {
  if (typeof blob !== "string" || blob.trim().length === 0) {
    throw new Error("decodeV2Values: blob must be a non-empty string");
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(blob.trim(), "base64");
  } catch (err) {
    throw new Error("decodeV2Values: blob is not valid base64");
  }
  let json: string;
  try {
    json = gunzipSync(buf).toString("utf8");
  } catch (err) {
    throw new Error(
      "decodeV2Values: decompression failed (input is not valid gzip after base64 decode)",
    );
  }
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    throw new Error("decodeV2Values: decompressed body is not valid JSON");
  }
}

/**
 * Encode a V2 values payload back to ServiceNow's storage format.
 *
 * Inverse of decodeV2Values. Provided for symmetry, diagnostic round-trip
 * tests, and any future write path. Current Craftsman sync treats sys_hub_*
 * as _readOnlyTables, so this is not invoked on the push path today.
 */
export function encodeV2Values(value: unknown): string {
  const json = JSON.stringify(value);
  return gzipSync(Buffer.from(json, "utf8")).toString("base64");
}
