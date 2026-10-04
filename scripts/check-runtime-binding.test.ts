// Offline credential lifecycle checks using the observed binding API shapes.
// No environment file, account access, real token or deployment is involved.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureRuntimeBinding } from "./lib/runtime-binding";
import { TelnyxApiError, type ApiMethod } from "./lib/telnyx-api";
import type { ResourceApi } from "./lib/resource-upsert";
import type { DeploymentState, DeploymentStateStore } from "./lib/deployment-state";

// Fictional organization binding, distinct from per-function declarations.
const ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const PATH = "/compute/bindings/" + ID;
const BINDING = { binding_id: ID, binding_type: "telnyx-sdk", status: "active", env_name: "TELNYX" };

// Clone-on-read/write repository makes unrelated state preservation observable.
class Store implements DeploymentStateStore {
  state: DeploymentState = { kv_namespace_id: "existing-kv", assistant_id: "existing-assistant", untouched: true };
  // All mutations remain in memory.
  async load() { return structuredClone(this.state); }
  // Persist detached values just like the JSON repository.
  async save(state: DeploymentState) { this.state = structuredClone(state); }
}

// Active metadata does not imply a valid token. The validation action is POST,
// renewal is PUT on the same resource, and no creation endpoint is implemented.
class Registry implements ResourceApi {
  items = [BINDING];
  valid = true;
  reason = "binding token is invalid or expired - use PUT to renew";
  renewWorks = true;
  loseRenewal = false;
  malformedValidation = false;
  readStatus?: number;
  calls: { method: ApiMethod; path: string; body?: unknown }[] = [];

  // Match the real list envelope and validation DTO, including ignored fields.
  async request(method: ApiMethod, path: string, body?: unknown) {
    this.calls.push({ method, path, body });
    if (method === "GET") {
      if (this.readStatus) throw new TelnyxApiError("api_request_rejected", method, path, this.readStatus);
      if (path.startsWith("/compute/bindings?")) return { data: structuredClone(this.items),
        meta: { total_pages: 1, total_results: this.items.length, page_number: 1, page_size: 20 } };
      assert.equal(path, PATH);
      return { data: structuredClone(this.items[0]) };
    }
    if (method === "POST") {
      assert.equal(path, PATH + "/actions/validate");
      if (this.malformedValidation) return { data: { status: "unknown" } };
      return { data: { record_type: "compute_binding_validation", status: this.valid ? "valid" : "invalid",
        message: this.valid ? "Binding validated." : this.reason, compute_binding: BINDING, validation_test: {} } };
    }
    assert.equal(method, "PUT"); assert.equal(path, PATH); assert.equal(body, undefined);
    this.valid = this.renewWorks;
    if (this.loseRenewal) throw new TelnyxApiError("network_result_unknown", method, path);
    return { data: { ...BINDING, token: "synthetic-sensitive-token" } };
  }
}

// Repeated valid preflights must never regenerate credentials.
test("valid binding is reused twice without renewal and preserves deployment ids", async () => {
  const store = new Store(); const api = new Registry();
  assert.deepEqual(await ensureRuntimeBinding(api, store), { action: "reused", id: ID });
  assert.deepEqual(await ensureRuntimeBinding(api, store), { action: "reused", id: ID });
  assert.equal(api.calls.filter((call) => call.method === "PUT").length, 0);
  assert.equal(store.state.runtime_api_binding_id, ID);
  assert.equal(store.state.kv_namespace_id, "existing-kv");
  assert.equal(store.state.assistant_id, "existing-assistant");
  assert.equal(store.state.untouched, true);
});

// HTTP 200 with status invalid requires one renewal and a successful revalidation.
test("expired token renews the existing binding once, then future runs reuse it", async () => {
  const store = new Store(); const api = new Registry(); api.valid = false;
  const first = await ensureRuntimeBinding(api, store);
  const second = await ensureRuntimeBinding(api, store);
  assert.equal(first.action, "renewed"); assert.equal(second.action, "reused");
  assert.equal(first.id, second.id);
  assert.equal(api.calls.filter((call) => call.method === "PUT").length, 1);
  assert.equal(api.items.length, 1);
  assert.ok(!JSON.stringify([first, second, store.state]).includes("synthetic-sensitive-token"));
  assert.ok(api.calls.every((call) => call.method !== "POST" || call.path.endsWith("/actions/validate")));
});

// An unsuccessful renewal is a deployment blocker, not a logged warning.
test("renewal that leaves the token invalid stops deployment", async () => {
  const store = new Store(); const api = new Registry(); api.valid = false; api.renewWorks = false;
  await assert.rejects(ensureRuntimeBinding(api, store), { code: "runtime_binding_renewal_failed" });
  assert.equal(api.calls.filter((call) => call.method === "PUT").length, 1);
});

// Unknown outcomes are reconciled by reads, never a second credential rotation.
test("lost renewal response is reconciled with the same id without another PUT", async () => {
  const store = new Store(); const api = new Registry(); api.valid = false; api.loseRenewal = true;
  assert.deepEqual(await ensureRuntimeBinding(api, store), { action: "renewed", id: ID });
  assert.equal(api.calls.filter((call) => call.method === "PUT").length, 1);
});

// Only the confirmed invalid/expired-token result may trigger renewal.
test("malformed or unrelated validation failures never rotate credentials", async () => {
  const store = new Store(); const api = new Registry(); api.malformedValidation = true;
  await assert.rejects(ensureRuntimeBinding(api, store), { code: "invalid_runtime_binding_validation" });
  api.malformedValidation = false; api.valid = false; api.reason = "The validation service is unavailable.";
  await assert.rejects(ensureRuntimeBinding(api, store), { code: "runtime_binding_validation_failed" });
  assert.equal(api.calls.filter((call) => call.method === "PUT").length, 0);
});

// A denied read is not proof of absence and must never cause resource creation.
test("failed inventory reads stop before validation or renewal", async () => {
  for (const status of [403, 503]) {
    const store = new Store(); const api = new Registry(); api.readStatus = status;
    await assert.rejects(ensureRuntimeBinding(api, store), { http_status: status });
    assert.ok(api.calls.every((call) => call.method === "GET"));
  }
});

// Reject per-function ids, ambiguous SDK resources and missing organization setup.
test("missing, duplicate and conflicting binding identities stop without renewal", async () => {
  const store = new Store(); const api = new Registry(); api.items = [];
  await assert.rejects(ensureRuntimeBinding(api, store), { code: "runtime_binding_missing" });
  api.items = [BINDING, { ...BINDING, binding_id: OTHER_ID }];
  await assert.rejects(ensureRuntimeBinding(api, store), { code: "duplicate_runtime_bindings" });
  api.items = [BINDING]; store.state.runtime_api_binding_id = OTHER_ID;
  await assert.rejects(ensureRuntimeBinding(api, store), { code: "runtime_binding_identity_conflict" });
  assert.ok(api.calls.every((call) => call.method === "GET"));
});
