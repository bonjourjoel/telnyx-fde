// Sequential offline checks of account-registration safety before the real
// API experiment. All credentials and resources here are synthetic. No .env,
// account, or disk deployment state is accessed by these tests.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMcpRegistryApi, ensureMcpRegistration, McpRegistrationError,
  type McpDeploymentState, type McpRegistryApi, type McpRegistrationConfig,
  type McpServerResource, type McpStateStore,
} from "./lib/mcp-registration";

// Desired public connection, with the explicitly tested candidate type.
const CONFIG: McpRegistrationConfig = {
  name: "synthetic-faq", url: "https://local.invalid/mcp", candidate_type: "http",
  allowed_tools: ["list_topics", "read_short_answer", "read_long_answer"],
};

// Detached snapshots model persisted state and expose missing checkpoints.
class TestStore implements McpStateStore {
  state: McpDeploymentState = { func_id: "existing-function", kv_namespace_id: "existing-kv" };
  saves = 0;
  // Read a fresh persisted snapshot rather than a shared live object.
  async load(): Promise<McpDeploymentState> { return structuredClone(this.state); }
  // Persist exactly the supplied state and retain unrelated deployment fields.
  async save(state: McpDeploymentState): Promise<void> { this.state = structuredClone(state); this.saves += 1; }
}

// Synthetic registry with controllable uncertain POSTs and failed reads.
class TestApi implements McpRegistryApi {
  items: McpServerResource[] = [];
  posts: { key: string | undefined; body: unknown }[] = [];
  failList = false;
  failStoredRead = false;
  failNextPost = false;
  loseNextResponse = false;
  pagedResponses = false;
  rejectNextPost = false;
  // Share the store solely to assert POST is preceded by a durable key save.
  constructor(private readonly store: TestStore) {}

  // Emulate only the fixed registry operations used by the implementation.
  async request(method: "GET" | "POST", path: string, body?: unknown, key?: string): Promise<unknown> {
    if (method === "GET" && path.includes("?")) {
      if (this.failList) throw new McpRegistrationError("api_request_rejected", method, path, 403);
      const items = structuredClone(this.items);
      return this.pagedResponses ? { data: items, meta: { total_pages: items.length ? 1 : 0,
        total_results: items.length, page_number: 1, page_size: 100 } } : items;
    }
    if (method === "GET") {
      if (this.failStoredRead) throw new McpRegistrationError("api_request_rejected", method, path, 503);
      const id = decodeURIComponent(path.split("/").at(-1)!);
      const item = this.items.find((entry) => entry.id === id);
      if (!item) throw new McpRegistrationError("api_request_rejected", method, path, 404);
      return this.pagedResponses ? { data: structuredClone(item) } : structuredClone(item);
    }
    assert.equal(path, "/ai/mcp_servers");
    assert.equal(this.store.state.mcp_registration_pending?.idempotency_key, key);
    this.posts.push({ key, body: structuredClone(body) });
    if (this.rejectNextPost) {
      this.rejectNextPost = false;
      throw new McpRegistrationError("api_request_rejected", method, path, 400, "Validation rejected.");
    }
    if (this.failNextPost) {
      this.failNextPost = false;
      throw new McpRegistrationError("network_result_unknown", method, path);
    }
    const resource = { ...(body as Omit<McpServerResource, "id">), id: "synthetic-created-id" };
    this.items.push(resource);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new McpRegistrationError("network_result_unknown", method, path);
    }
    return this.pagedResponses ? { data: structuredClone(resource) } : structuredClone(resource);
  }
}

// First creation becomes the sole reusable connection; a second run only reads.
test("create once, persist id, verify uniqueness, and reuse without another POST", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  const first = await ensureMcpRegistration(api, store, CONFIG);
  assert.equal(first.action, "created");
  assert.equal(first.matching_count, 1);
  assert.equal(store.state.mcp_server_id, first.server.id);
  assert.equal(store.state.mcp_registration_pending, undefined);
  assert.equal(store.state.func_id, "existing-function");
  assert.equal(store.state.kv_namespace_id, "existing-kv");
  const second = await ensureMcpRegistration(api, store, CONFIG);
  assert.equal(second.action, "reused");
  assert.equal(second.server.id, first.server.id);
  assert.equal(api.posts.length, 1);
  assert.equal(api.items.length, 1);
});

// A connection found by name/URL is adopted and checkpointed, not recreated.
test("recover an existing intended resource even when its id is not stored", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  api.items = [{ id: "existing-connection", name: CONFIG.name, type: "accepted-existing-type",
    url: CONFIG.url, allowed_tools: CONFIG.allowed_tools }];
  const result = await ensureMcpRegistration(api, store, CONFIG);
  assert.equal(result.action, "reused");
  assert.equal(store.state.mcp_server_type, "accepted-existing-type");
  assert.equal(api.posts.length, 0);
});

// Reproduce the data/meta envelope actually observed on the authenticated API.
test("real gateway envelopes are parsed and an empty paged result permits one creation", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  api.pagedResponses = true;
  const first = await ensureMcpRegistration(api, store, CONFIG);
  const second = await ensureMcpRegistration(api, store, CONFIG);
  assert.equal(first.action, "created");
  assert.equal(second.action, "reused");
  assert.equal(first.server.id, second.server.id);
  assert.equal(api.posts.length, 1);
});

// Failed reads must never be interpreted as permission to create something.
test("403 list and 503 stored-id reads stop before creation", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  api.failList = true;
  await assert.rejects(ensureMcpRegistration(api, store, CONFIG), { http_status: 403 });
  assert.equal(store.saves, 0);
  api.failList = false;
  api.failStoredRead = true;
  store.state.mcp_server_id = "stored-id";
  await assert.rejects(ensureMcpRegistration(api, store, CONFIG), { http_status: 503 });
  assert.equal(api.posts.length, 0);
});

// Ambiguity or same-URL foreign naming requires review, never arbitrary reuse.
test("duplicate and conflicting matches stop without resource mutations", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  const item = { id: "one", name: CONFIG.name, type: "http", url: CONFIG.url, allowed_tools: CONFIG.allowed_tools };
  api.items = [item, { ...item, id: "two" }];
  await assert.rejects(ensureMcpRegistration(api, store, CONFIG), { code: "duplicate_mcp_matches" });
  api.items = [{ ...item, name: "another-project" }];
  await assert.rejects(ensureMcpRegistration(api, store, CONFIG), { code: "mcp_identity_conflict" });
  assert.equal(api.posts.length, 0);
  assert.equal(store.saves, 0);
});

// Lost response after creation is reconciled by reads and retains the one id.
test("a lost POST response is recovered without sending another POST", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  api.loseNextResponse = true;
  const result = await ensureMcpRegistration(api, store, CONFIG);
  assert.equal(result.action, "recovered");
  assert.equal(api.posts.length, 1);
  assert.equal(api.items.length, 1);
  assert.equal(store.state.mcp_server_id, result.server.id);
});

// A failed POST before creation preserves its key across a later invocation.
test("uncertain empty result retains the exact key and prevents changed-payload retries", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  api.failNextPost = true;
  await assert.rejects(ensureMcpRegistration(api, store, CONFIG), { code: "network_result_unknown" });
  const pending = structuredClone(store.state.mcp_registration_pending!);
  await assert.rejects(ensureMcpRegistration(api, store, { ...CONFIG, candidate_type: "changed" }), { code: "pending_request_changed" });
  const result = await ensureMcpRegistration(api, store, CONFIG);
  assert.equal(result.action, "created");
  assert.equal(api.posts.length, 2);
  assert.equal(api.posts[0].key, pending.idempotency_key);
  assert.equal(api.posts[1].key, pending.idempotency_key);
  assert.deepEqual(api.posts[0].body, api.posts[1].body);
  assert.equal(api.items.length, 1);
});

// Only a documented read-only mismatch is reported; the resource id stays known.
test("read-back mismatch preserves the created id instead of losing ownership", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  api.items = [{ id: "existing-id", name: CONFIG.name, type: "http", url: CONFIG.url, allowed_tools: [] }];
  await assert.rejects(ensureMcpRegistration(api, store, CONFIG), { code: "mcp_readback_mismatch" });
  assert.equal(store.state.mcp_server_id, "existing-id");
  assert.equal(api.posts.length, 0);
});

// A proven rejection is recorded, and a deliberate correction gets a new key.
test("confirmed validation rejection permits a corrected request without key reuse", async () => {
  const store = new TestStore();
  const api = new TestApi(store);
  api.rejectNextPost = true;
  await assert.rejects(ensureMcpRegistration(api, store, CONFIG), { http_status: 400 });
  assert.equal(store.state.mcp_registration_pending?.rejected_status, 400);
  assert.equal(api.items.length, 0);
  const oldKey = api.posts[0].key;
  await ensureMcpRegistration(api, store, { ...CONFIG, candidate_type: "corrected-type" });
  assert.notEqual(api.posts[1].key, oldKey);
  assert.equal(api.items.length, 1);
});

// Diagnostic scrubbing must work before any real credential is used.
test("API diagnostics contain endpoint/status but no credentials or personal data", async () => {
  const secret = "synthetic-api-key-never-print";
  const api = createMcpRegistryApi(secret, async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer " + secret);
    assert.equal(init?.redirect, "error");
    return Response.json({ detail: [{ msg: `Rejected ${secret} +12025550123 person@example.invalid` }] }, { status: 422 });
  });
  try {
    await api.request("POST", "/ai/mcp_servers", {});
    assert.fail("API rejection must throw");
  } catch (error) {
    assert.ok(error instanceof McpRegistrationError);
    assert.equal(error.http_status, 422);
    assert.equal(error.endpoint, "/ai/mcp_servers");
    assert.ok(!error.detail?.includes(secret));
    assert.ok(!error.detail?.includes("+12025550123"));
    assert.ok(!error.detail?.includes("person@example.invalid"));
  }
});
