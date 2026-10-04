// Shared reconciliation algorithm for MCP and library tools. Read fully before
// creating, checkpoint POSTs, update by id, read back, and stop on ambiguity.

import { createHash, randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { TelnyxApiError, type ApiMethod } from "./telnyx-api";
import { validateDeploymentState, type CreationCheckpoint, type DeploymentState, type DeploymentStateStore } from "./deployment-state";

// Small transport interface also usable by offline registry doubles.
export interface ResourceApi {
  request(method: ApiMethod, path: string, body?: unknown, idempotencyKey?: string): Promise<unknown>;
}

// Resource-specific schema, ownership, desired fields, and state tracking.
export interface ResourceAdapter<T> {
  kind: string; collection: string; updateMethod: "PUT" | "PATCH"; body: unknown; updateBody?: unknown;
  parse(value: unknown): T; id(resource: T): string;
  matches(resource: T): boolean; owns(resource: T): boolean; compliant(resource: T): boolean;
  storedId(state: DeploymentState): unknown;
  remember(state: DeploymentState, resource: T): void;
  pending(state: DeploymentState): unknown;
  checkpoint(state: DeploymentState, value: CreationCheckpoint | undefined): void;
}
export interface UpsertResult<T> {
  action: "created" | "reused" | "recovered" | "updated";
  resource: T; matching_count: 1;
}

// Validate pagination and persisted replay keys before relying on them.
const MetaSchema = z.object({ total_pages: z.number().int().nonnegative(), total_results: z.number().int().nonnegative(),
  page_number: z.number().int().min(1), page_size: z.number().int().min(1) });
const PendingSchema = z.object({ idempotency_key: z.uuid(), request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  started_at: z.iso.datetime(), rejected_status: z.number().int().min(400).max(499).optional() });

// Canonicalize object key order for fingerprints and equality. Arrays retain
// order because tool-variable lists and response mappings have defined meaning.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

// Compare owned fields while accepting server-added defaults. Arrays are exact;
// model input properties are also exact, so identity cannot become an argument.
export function matchesDesired(actual: unknown, desired: unknown, exactObject = false, field = ""): boolean {
  if (Array.isArray(desired)) {
    if (!Array.isArray(actual) || actual.length !== desired.length) return false;
    // Security allowlists/mappings are sets. API normalization of their order
    // must not cause endless PATCHes, while extra entries still fail comparison.
    const unordered = ["updatable_variables", "store_fields_as_variables", "required", "allowed_tools"].includes(field);
    return desired.every((item, index) => unordered
      ? actual.some((entry) => matchesDesired(entry, item)) : matchesDesired(actual[index], item));
  }
  if (desired !== null && typeof desired === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    const wanted = desired as Record<string, unknown>;
    const existing = actual as Record<string, unknown>;
    if (exactObject && Object.keys(existing).length !== Object.keys(wanted).length) return false;
    return Object.keys(wanted).every((key) => matchesDesired(existing[key], wanted[key], key === "properties", key));
  }
  return actual === desired;
}

// Read all pages, supporting the documented bare MCP list and observed gateway
// envelopes. Failed, repeated, or inconsistent reads never establish absence.
async function listMatches<T>(api: ResourceApi, adapter: ResourceAdapter<T>): Promise<T[]> {
  const seen = new Set<string>();
  const matches: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const value = await api.request("GET", adapter.collection + "?" + new URLSearchParams({ "page[size]": "100", "page[number]": String(page) }));
    let items: unknown[];
    let meta: z.infer<typeof MetaSchema> | undefined;
    if (Array.isArray(value)) items = value;
    else if (value !== null && typeof value === "object" && "data" in value && "meta" in value && Array.isArray(value.data)) {
      const parsed = MetaSchema.safeParse(value.meta);
      if (!parsed.success) throw new TelnyxApiError(`invalid_${adapter.kind}_list`);
      items = value.data;
      meta = parsed.data;
      if (meta.page_number !== page) throw new TelnyxApiError(`unstable_${adapter.kind}_pagination`);
    } else throw new TelnyxApiError(`invalid_${adapter.kind}_list`);
    for (const item of items) {
      const resource = adapter.parse(item);
      const id = adapter.id(resource);
      if (seen.has(id)) throw new TelnyxApiError(`unstable_${adapter.kind}_pagination`);
      seen.add(id);
      if (adapter.matches(resource)) matches.push(resource);
    }
    if (meta && page >= Math.max(1, meta.total_pages)) {
      if (seen.size !== meta.total_results) throw new TelnyxApiError(`inconsistent_${adapter.kind}_result_count`);
      return matches;
    }
    if (!meta && items.length < 100) return matches;
    if (items.length === 0) throw new TelnyxApiError(`invalid_${adapter.kind}_page`);
  }
  throw new TelnyxApiError(`${adapter.kind}_list_limit_reached`);
}

// Select the sole owned match. A conflicting label or duplicate is a diagnostic.
function uniqueMatch<T>(matches: T[], adapter: ResourceAdapter<T>): T | undefined {
  if (matches.length > 1) throw new TelnyxApiError(`duplicate_${adapter.kind}_matches`);
  if (matches[0] && !adapter.owns(matches[0])) throw new TelnyxApiError(`${adapter.kind}_identity_conflict`);
  return matches[0];
}

// Persist before verification, so even a later read failure cannot lose the id.
async function remember<T>(store: DeploymentStateStore, state: DeploymentState, adapter: ResourceAdapter<T>, resource: T): Promise<void> {
  adapter.remember(state, resource);
  await store.save(state);
}

// Verify exact id and desired fields against read-back and the full registry.
async function verify<T>(api: ResourceApi, store: DeploymentStateStore, state: DeploymentState,
  adapter: ResourceAdapter<T>, resource: T): Promise<T> {
  const saved = adapter.parse(await api.request("GET", adapter.collection + "/" + encodeURIComponent(adapter.id(resource))));
  const listed = uniqueMatch(await listMatches(api, adapter), adapter);
  if (!listed || adapter.id(listed) !== adapter.id(saved) || adapter.id(saved) !== adapter.id(resource) ||
    !adapter.owns(saved) || !adapter.compliant(saved)) throw new TelnyxApiError(`${adapter.kind}_readback_mismatch`);
  adapter.checkpoint(state, undefined);
  await remember(store, state, adapter, saved);
  return saved;
}

// Reconcile one resource. Optional updates let the standalone registration
// check remain non-mutating for existing entries, while deploy sends PUT/PATCH.
export async function upsertResource<T>(api: ResourceApi, store: DeploymentStateStore,
  adapter: ResourceAdapter<T>, updateExisting = true): Promise<UpsertResult<T>> {
  const state = validateDeploymentState(await store.load());
  const storedId = adapter.storedId(state);
  let stored: T | undefined;
  if (storedId !== undefined) {
    if (typeof storedId !== "string" || !storedId) throw new TelnyxApiError(`invalid_stored_${adapter.kind}_id`);
    try { stored = adapter.parse(await api.request("GET", adapter.collection + "/" + encodeURIComponent(storedId))); }
    catch (error) { if (!(error instanceof TelnyxApiError) || error.http_status !== 404) throw error; }
    if (stored && adapter.id(stored) !== storedId) throw new TelnyxApiError(`stored_${adapter.kind}_conflict`);
    if (stored && !adapter.owns(stored)) throw new TelnyxApiError(`stored_${adapter.kind}_conflict`);
  }
  const existing = uniqueMatch(await listMatches(api, adapter), adapter);
  if (stored && (!existing || adapter.id(stored) !== adapter.id(existing))) throw new TelnyxApiError(`stored_${adapter.kind}_conflict`);
  if (existing) {
    await remember(store, state, adapter, existing);
    if (updateExisting && !adapter.compliant(existing)) {
      const updated = adapter.parse(await api.request(adapter.updateMethod,
        adapter.collection + "/" + encodeURIComponent(adapter.id(existing)), adapter.updateBody ?? adapter.body));
      if (adapter.id(updated) !== adapter.id(existing)) throw new TelnyxApiError(`${adapter.kind}_update_changed_id`);
      return { action: "updated", resource: await verify(api, store, state, adapter, updated), matching_count: 1 };
    }
    return { action: "reused", resource: await verify(api, store, state, adapter, existing), matching_count: 1 };
  }

  const requestHash = createHash("sha256").update(canonicalJson(adapter.body)).digest("hex");
  let pending: CreationCheckpoint | undefined;
  const previous = adapter.pending(state);
  if (previous !== undefined) {
    const parsed = PendingSchema.safeParse(previous);
    if (!parsed.success) throw new TelnyxApiError("invalid_pending_registration");
    pending = parsed.data;
    if (pending.request_hash !== requestHash) {
      if (pending.rejected_status !== 400 && pending.rejected_status !== 422) throw new TelnyxApiError("pending_request_changed");
      pending = undefined;
    } else if (Date.now() - Date.parse(pending.started_at) > 24 * 60 * 60 * 1000) throw new TelnyxApiError("pending_replay_window_expired");
  }
  pending ??= { idempotency_key: randomUUID(), request_hash: requestHash, started_at: new Date().toISOString() };
  adapter.checkpoint(state, pending);
  await store.save(state);
  let resource: T;
  let action: "created" | "recovered" = "created";
  try { resource = adapter.parse(await api.request("POST", adapter.collection, adapter.body, pending.idempotency_key)); }
  catch (error) {
    const recovered = uniqueMatch(await listMatches(api, adapter), adapter);
    if (!recovered) {
      if (error instanceof TelnyxApiError && (error.http_status === 400 || error.http_status === 422)) {
        pending.rejected_status = error.http_status;
        adapter.checkpoint(state, pending);
        await store.save(state);
      }
      throw error;
    }
    resource = recovered;
    action = "recovered";
  }
  await remember(store, state, adapter, resource);
  return { action, resource: await verify(api, store, state, adapter, resource), matching_count: 1 };
}
