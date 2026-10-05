// Read or set the technician_available flag in the existing support/config KV key.
// This module exposes pure parsing/configuration helpers plus a narrow bounded KV
// transport; importing it performs no I/O and never reads .env or account state.
//
// The CLI entry (scripts/technician-flag.ts) wraps these helpers with strict mode
// parsing before .env/state load, deployment-state lookup, and Telnyx API setup.
// Tests use the helpers directly against in-memory doubles; no network is used.

import { isDeepStrictEqual } from "node:util";
import { TelnyxApiError, type TelnyxApi } from "./telnyx-api";
import { SUPPORT_CONFIG_KEY } from "../../src/support-config";

// Strict command mode accepted by the CLI. Anything that is not exactly one of
// get/true/false is rejected before the environment or any account resource loads.
export type TechnicianFlagMode = "get" | "true" | "false";

// Reject any extra/unknown argument before any .env load or account access. The
// caller has to name exactly one of get/true/false; a missing/multiple/unknown
// value surfaces the same explicit error and never reaches the network.
export function parseTechnicianMode(args: readonly string[]): TechnicianFlagMode {
  if (args.length !== 1) throw new TelnyxApiError("technician_flag_mode_required");
  const value = args[0];
  if (value === "get" || value === "true" || value === "false") return value;
  throw new TelnyxApiError("technician_flag_mode_required");
}

// Project only the boolean value the CLI reports. The flag must be a primitive
// boolean; any missing/non-boolean value fails instead of being converted to a
// default. No identity, fingerprint, phone, or raw error text is returned.
export function reportFlag(config: unknown): boolean {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TelnyxApiError("technician_flag_config_invalid");
  }
  const record = config as Record<string, unknown>;
  if (typeof record.technician_available !== "boolean") {
    throw new TelnyxApiError("technician_flag_config_invalid");
  }
  return record.technician_available;
}

// Reuse reportFlag for the boolean validation instead of duplicating the shape
// checks here. Returns the already-stringified body so the caller never has to
// parse the existing value twice.
export function setFlag(config: unknown, desired: boolean): { body: string; already: boolean } {
  // reportFlag rejects null/array/non-object and a non-boolean flag with the
  // same invalid_configuration code used everywhere else in this module.
  const current = reportFlag(config);
  const record = config as Record<string, unknown>;
  if (current === desired) return { body: JSON.stringify(record), already: true };
  // Preserve every other field (web_demo_identity, portal_demo_target_sha256, any
  // unrelated or nested key) by spreading the existing record first. Property key
  // order is not significant; isDeepStrictEqual below treats objects as unordered.
  const next: Record<string, unknown> = { ...record, technician_available: desired };
  return { body: JSON.stringify(next), already: false };
}

// Narrow bounded transport over the documented KV REST raw key endpoints, used by
// both the CLI and the offline tests. Carrying only status and the raw text body
// keeps the CLI path free of SDK envelope assumptions and never surfaces the
// stored configuration on a write failure.
export interface RawKvClient {
  get(path: string): Promise<{ status: number; body: string }>;
  put(path: string, body: string): Promise<{ status: number }>;
}

// Adapt a TelnyxApi into the narrow client; status and raw body are exposed, the
// Authorization header and any response details are never persisted or logged.
export function createRawKvClient(api: TelnyxApi): RawKvClient {
  return {
    async get(path) {
      const res = await api.fetch(path);
      const body = await res.text();
      return { status: res.status, body };
    },
    async put(path, body) {
      const res = await api.fetch(path, { method: "PUT", body });
      // Drain the response so any error text is consumed; only the status matters.
      await res.text().catch(() => undefined);
      return { status: res.status };
    },
  };
}

// Stable raw key path used for both reads and writes on the configured namespace.
// Refuses empty ids before building the URL so a missing namespace fails cleanly.
// rather than producing a malformed path or substituting a default.
export function supportConfigPath(namespaceId: string, key: string = SUPPORT_CONFIG_KEY): string {
  if (typeof namespaceId !== "string" || !namespaceId.trim()) {
    throw new TelnyxApiError("technician_flag_namespace_missing");
  }
  return `/v2/storage/kvs/${encodeURIComponent(namespaceId)}/keys/${encodeURIComponent(key)}`;
}

// Closed failure categories distinguished from a missing key. Auth/permission and
// upstream failures never become a default boolean; a missing key is its own code.
function classifyRead(status: number, path: string): TelnyxApiError {
  if (status === 404) return new TelnyxApiError("technician_flag_config_missing", "GET", path, 404);
  if (status === 401 || status === 403) return new TelnyxApiError("technician_flag_read_unauthorized", "GET", path, status);
  return new TelnyxApiError("technician_flag_read_failed", "GET", path, status);
}

// Closed failure categories for the write path. No retry, no second PUT on a
// uncertain response; the caller surfaces the error and stops.
function classifyWrite(status: number, path: string): TelnyxApiError {
  if (status === 401 || status === 403) return new TelnyxApiError("technician_flag_write_unauthorized", "PUT", path, status);
  return new TelnyxApiError("technician_flag_write_failed", "PUT", path, status);
}

// Read and JSON-parse the existing config from KV. A missing key (real HTTP 404),
// a JSON body returned on HTTP 200 but invalid, or a non-boolean flag fails; the
// CLI never silently substitutes false or a default configuration, and never
// triggers a PUT after a missing read.
export async function readRawConfig(client: RawKvClient, namespaceId: string, key: string = SUPPORT_CONFIG_KEY): Promise<unknown> {
  const path = supportConfigPath(namespaceId, key);
  const { status, body } = await client.get(path);
  if (status !== 200) throw classifyRead(status, path);
  // An empty body on a real 200 is an invalid configuration with the actual status;
  // do not invent a 404 here, since the GET actually returned 200.
  if (body === null || body === "") throw new TelnyxApiError("technician_flag_config_invalid", "GET", path, status);
  let value: unknown;
  try { value = JSON.parse(body); }
  catch { throw new TelnyxApiError("technician_flag_config_invalid", "GET", path, status); }
  return value;
}

// Run the get mode. The CLI prints only the returned boolean; raw configuration,
// credentials, identity/fingerprint, phones, and raw errors are never displayed.
export async function getTechnicianFlag(client: RawKvClient, namespaceId: string): Promise<boolean> {
  return reportFlag(await readRawConfig(client, namespaceId));
}

// Run the set mode. After the PUT, read back the FULL stored object and verify it
// deep-equals the expected configuration (every unrelated/nested field preserved,
// only technician_available changed). A boolean-only check would silently accept
// a write that dropped web_demo_identity, the Portal fingerprint, or any future
// field. No automatic retry; an uncertain write or a mismatched readback fails
// instead of claiming a successful update. The `already` fast path skips the PUT
// entirely. KV whole-object updates have no documented atomic compare-and-swap,
// so the CLI never invents one; run administrative flag edits sequentially.
export async function setTechnicianFlag(client: RawKvClient, namespaceId: string, desired: boolean): Promise<boolean> {
  const existing = await readRawConfig(client, namespaceId);
  const prepared = setFlag(existing, desired);
  if (prepared.already) return desired;
  const path = supportConfigPath(namespaceId);
  const write = await client.put(path, prepared.body);
  if (write.status < 200 || write.status >= 300) throw classifyWrite(write.status, path);
  // Read back the full stored object and confirm it deep-equals the prepared
  // body. The CLI never claims success on an uncertain write, a partial write,
  // or a stored object that lost an unrelated field.
  const expected: unknown = JSON.parse(prepared.body);
  const actual = await readRawConfig(client, namespaceId);
  if (!isDeepStrictEqual(actual, expected)) {
    throw new TelnyxApiError("technician_flag_readback_mismatch", "GET", path, undefined);
  }
  return reportFlag(actual);
}
