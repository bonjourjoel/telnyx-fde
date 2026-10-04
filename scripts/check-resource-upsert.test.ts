// Sequential offline deployment checks: native tool payloads, MCP PUT, tool
// PATCH, creation checkpoints, interrupted runs, duplicate detection, and error
// redaction. No environment file, account, Function deploy, or phone call.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSharedTools, SUPPORT_TOOL_NAMES } from "../config/tools";
import { TELNYX_PHONE_NUMBER, TECHNICIAN_PHONE_NUMBER } from "../config/telephony";
import { WRITABLE_DYNAMIC_VARIABLE_KEYS } from "../src/contracts";
import { ensureMcpRegistration } from "./lib/mcp-registration";
import { syncSharedTools, upsertSharedTool } from "./lib/shared-tools";
import { createTelnyxApi, TelnyxApiError, type ApiMethod } from "./lib/telnyx-api";
import type { DeploymentState, DeploymentStateStore } from "./lib/deployment-state";
import type { ResourceApi } from "./lib/resource-upsert";

// Desired synthetic deployment. Only telephony.ts contains the real constants.
const URL = "https://function.example.invalid";
const DEFINITIONS = buildSharedTools(URL, "telnyx-fde");
const MCP_CONFIG = { name: "telnyx-fde-faq", candidate_type: "http", url: URL + "/mcp",
  allowed_tools: ["list_topics", "read_short_answer", "read_long_answer"] };

// Persist detached snapshots and unrelated fields, without touching real state.
class Store implements DeploymentStateStore {
  state: DeploymentState = { func_id: "original-function", kv_namespace_id: "original-kv", untouched: true };
  // New snapshots make forgotten persistence observable.
  async load(): Promise<DeploymentState> { return structuredClone(this.state); }
  // A creation checkpoint must exist before the fake API sees POST.
  async save(state: DeploymentState): Promise<void> { this.state = structuredClone(state); }
}

// Account double with actual response envelopes and harmless GET-only metadata.
class Registry implements ResourceApi {
  readonly tools = new Map<string, Record<string, unknown>>();
  mcp: Record<string, unknown> | undefined;
  calls: { method: ApiMethod; path: string; body?: unknown; key?: string }[] = [];
  failRole: string | undefined;
  loseRole: string | undefined;
  denyLists = false;
  constructor(private readonly store: Store) {}

  // Match the observed library response: root type and flat native configuration.
  private tool(body: Record<string, unknown>, id: string): Record<string, unknown> {
    const type = String(body.type);
    return { id, type, display_name: body.display_name, timeout_ms: body.timeout_ms,
      tool_definition: structuredClone(body[type]), created_at: "2026-10-04T00:00:00.000Z" };
  }

  // Emulate CRUD only for MCP/tools. Every unexpected endpoint is an assertion.
  async request(method: ApiMethod, path: string, value?: unknown, key?: string): Promise<unknown> {
    this.calls.push({ method, path, body: structuredClone(value), key });
    const collection = path.split("?")[0];
    const isMcp = collection.startsWith("/ai/mcp_servers");
    assert.ok(isMcp || collection.startsWith("/ai/tools"));
    if (method === "GET" && path.includes("?")) {
      if (this.denyLists) throw new TelnyxApiError("api_request_rejected", method, path, 403);
      const items = isMcp ? (this.mcp ? [this.mcp] : []) : [...this.tools.values()];
      return { data: structuredClone(items), meta: { total_pages: items.length ? 1 : 0,
        total_results: items.length, page_number: 1, page_size: 100 } };
    }
    if (method === "GET") {
      const id = decodeURIComponent(collection.split("/").at(-1)!);
      const item = isMcp && this.mcp?.id === id ? this.mcp : this.tools.get(id);
      if (!item) throw new TelnyxApiError("api_request_rejected", method, path, 404);
      return { data: structuredClone(item) };
    }
    const body = value as Record<string, unknown>;
    if (isMcp) {
      if (method === "POST") {
        assert.equal(key, this.store.state.mcp_registration_pending?.idempotency_key);
        this.mcp = { ...structuredClone(body), id: "mcp-id" };
      } else {
        assert.equal(method, "PUT");
        this.mcp = { ...structuredClone(body), id: this.mcp!.id };
      }
      return { data: structuredClone(this.mcp) };
    }
    const role = String(body.display_name).split(": ").at(-1)!;
    if (method === "POST") {
      assert.equal(key, this.store.state.shared_tool_pending?.[role]?.idempotency_key);
      if (this.failRole === role) {
        this.failRole = undefined;
        throw new TelnyxApiError("network_result_unknown", method, path);
      }
      const result = this.tool(body, "tool-" + role);
      this.tools.set(String(result.id), result);
      if (this.loseRole === role) {
        this.loseRole = undefined;
        throw new TelnyxApiError("network_result_unknown", method, path);
      }
      return { data: structuredClone(result) };
    }
    assert.equal(method, "PATCH");
    const id = collection.split("/").at(-1)!;
    assert.ok(!("shared" in body) && !("id" in body) && !("tool_definition" in body));
    const result = this.tool(body, id);
    this.tools.set(id, result);
    return { data: structuredClone(result) };
  }
}

// Payload checks target privileges/identity and response mapping, not formatting.
test("four tools have exact writable fields, presets, response paths and one transfer destination", () => {
  assert.deepEqual(Object.keys(DEFINITIONS), [...SUPPORT_TOOL_NAMES]);
  const variables = DEFINITIONS.SET_SUPPORT_VARIABLES.update_dynamic_variables!.updatable_variables as { name: string }[];
  assert.deepEqual(variables.map((variable) => variable.name), [...WRITABLE_DYNAMIC_VARIABLE_KEYS]);
  const webhook = DEFINITIONS.CREATE_TICKET.webhook!;
  assert.equal(webhook.async, false);
  assert.equal(webhook.method, "POST");
  assert.equal(webhook.url, URL + "/tickets/create");
  assert.deepEqual(Object.keys((webhook.body_parameters as Record<string, unknown>).properties as object).sort(),
    ["ticket_description", "ticket_subject"]);
  assert.deepEqual(webhook.preset_body_fields, { conversation_channel: "{{telnyx_conversation_channel}}",
    caller_phone: "{{telnyx_end_user_target}}", operation_id: "{{operation_id}}" });
  assert.deepEqual(webhook.store_fields_as_variables, [
    { name: "created_ticket_id", value_path: "ticket_id" }, { name: "created_ticket_reference", value_path: "ticket_reference" },
  ]);
  const transfer = DEFINITIONS.TRANSFER.transfer!;
  const targets = transfer.targets as { to: string }[];
  assert.equal(targets.length, 1);
  assert.ok(targets[0].to === TECHNICIAN_PHONE_NUMBER);
  assert.ok(transfer.from === TELNYX_PHONE_NUMBER);
  assert.throws(() => buildSharedTools("http://unsafe.invalid", "telnyx-fde"));
});

// Two executions have identical ids and no writes on the second execution.
test("two resource synchronizations retain one MCP and four tools without duplicate creation", async () => {
  const store = new Store();
  const api = new Registry(store);
  await ensureMcpRegistration(api, store, MCP_CONFIG, true);
  const first = await syncSharedTools(api, store, DEFINITIONS);
  const ids = structuredClone(store.state.shared_tool_ids);
  const writes = api.calls.filter((call) => call.method !== "GET").length;
  await ensureMcpRegistration(api, store, MCP_CONFIG, true);
  const second = await syncSharedTools(api, store, DEFINITIONS);
  assert.deepEqual(store.state.shared_tool_ids, ids);
  assert.deepEqual(first.map((tool) => tool.id), second.map((tool) => tool.id));
  assert.ok(second.every((tool) => tool.action === "reused"));
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, writes);
  assert.equal(api.tools.size, 4);
  assert.equal(store.state.untouched, true);
  assert.equal(store.state.kv_namespace_id, "original-kv");
  assert.equal(store.state.mcp_registration_pending, undefined);
  assert.equal(store.state.shared_tool_pending, undefined);
  assert.ok(!JSON.stringify(store.state).includes(TELNYX_PHONE_NUMBER));
  assert.ok(!JSON.stringify(store.state).includes(TECHNICIAN_PHONE_NUMBER));
});

// Reproduce the observed response independently of the request builder. A saved
// id and pending checkpoint from the failed read-back must resume using GET only.
test("observed flat tool definition resumes failed verification without POST or PATCH", async () => {
  const store = new Store();
  const api = new Registry(store);
  const id = "tool-observed-support";
  const observed = {
    id, type: "update_dynamic_variables", display_name: "telnyx-fde: SET_SUPPORT_VARIABLES",
    timeout_ms: 5000, created_at: "2026-10-04T00:00:00.000Z",
    tool_definition: {
      name: "SET_SUPPORT_VARIABLES", description: "Update only the listed support conversation inputs.",
      updatable_variables: [
        { name: "selected_ticket_status_text", type: "string", description: "Copy the selected ticket's exact backend status_text, including its reference and status." },
        { name: "faq_topic_id", type: "string", description: "Store the catalogue topic id returned by list_topics." },
        { name: "faq_long_text", type: "string", description: "Copy the exact long answer returned by the MCP reading tool." },
        { name: "ticket_subject", type: "string", description: "Collect a concise ticket subject without credentials." },
        { name: "ticket_description", type: "string", description: "Collect a concise support description without credentials." },
      ],
    },
  };
  api.tools.set(id, observed);
  store.state.shared_tool_ids = { SET_SUPPORT_VARIABLES: id };
  store.state.shared_tool_pending = { SET_SUPPORT_VARIABLES: {
    idempotency_key: "00000000-0000-4000-8000-000000000001",
    request_hash: "0".repeat(64), started_at: new Date().toISOString(),
  } };

  // Successful read-back clears only the pending checkpoint and keeps the id.
  const first = await upsertSharedTool(api, store, "SET_SUPPORT_VARIABLES", DEFINITIONS.SET_SUPPORT_VARIABLES);
  const second = await upsertSharedTool(api, store, "SET_SUPPORT_VARIABLES", DEFINITIONS.SET_SUPPORT_VARIABLES);
  assert.equal(first.action, "reused");
  assert.equal(second.action, "reused");
  assert.equal(first.resource.id, id);
  assert.equal(second.resource.id, id);
  assert.equal(store.state.shared_tool_ids.SET_SUPPORT_VARIABLES, id);
  assert.equal(store.state.shared_tool_pending, undefined);
  assert.ok(api.calls.every((call) => call.method === "GET"));
  assert.equal(api.tools.size, 1);
});

// URL/instruction changes update the existing resource, never a new connection.
test("changed MCP URL uses PUT and changed tool uses PATCH with the same ids", async () => {
  const store = new Store();
  const api = new Registry(store);
  const mcp = await ensureMcpRegistration(api, store, MCP_CONFIG, true);
  await syncSharedTools(api, store, DEFINITIONS);
  const toolId = store.state.shared_tool_ids!.CREATE_TICKET;
  const updatedMcp = await ensureMcpRegistration(api, store, { ...MCP_CONFIG, url: "https://changed.example.invalid/mcp" }, true);
  const changed = buildSharedTools("https://changed.example.invalid", "telnyx-fde");
  const updatedTool = await upsertSharedTool(api, store, "CREATE_TICKET", changed.CREATE_TICKET);
  assert.equal(updatedMcp.server.id, mcp.server.id);
  assert.equal(updatedMcp.action, "updated");
  assert.equal(updatedTool.resource.id, toolId);
  assert.equal(updatedTool.action, "updated");
  assert.ok(api.calls.some((call) => call.method === "PUT"));
  assert.ok(api.calls.some((call) => call.method === "PATCH"));
  assert.equal(api.tools.size, 4);
});

// Earlier tool ids survive a later failure, and the pending POST key is reused.
test("partial deployment resumes with existing ids and the same creation key", async () => {
  const store = new Store();
  const api = new Registry(store);
  api.failRole = "CREATE_TICKET";
  await assert.rejects(syncSharedTools(api, store, DEFINITIONS), { code: "network_result_unknown" });
  assert.ok(store.state.shared_tool_ids!.SET_SUPPORT_VARIABLES);
  const previousKey = store.state.shared_tool_pending!.CREATE_TICKET.idempotency_key;
  await syncSharedTools(api, store, DEFINITIONS);
  const attempts = api.calls.filter((call) => call.method === "POST" &&
    (call.body as Record<string, unknown>).display_name === DEFINITIONS.CREATE_TICKET.display_name);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].key, previousKey);
  assert.equal(attempts[1].key, previousKey);
  assert.equal(api.tools.size, 4);
});

// A lost successful response is discovered and saved, with only one POST.
test("lost tool response is reconciled without another creation", async () => {
  const store = new Store();
  const api = new Registry(store);
  api.loseRole = "CREATE_TICKET";
  const result = await upsertSharedTool(api, store, "CREATE_TICKET", DEFINITIONS.CREATE_TICKET);
  assert.equal(result.action, "recovered");
  assert.equal(api.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(api.tools.size, 1);
});

// Existing collisions and denied reads fail before any POST/PATCH.
test("duplicates and permission errors never trigger resource creation", async () => {
  const store = new Store();
  const api = new Registry(store);
  await upsertSharedTool(api, store, "HANGUP", DEFINITIONS.HANGUP);
  const duplicate = structuredClone([...api.tools.values()][0]);
  duplicate.id = "duplicate";
  api.tools.set("duplicate", duplicate);
  const writes = api.calls.filter((call) => call.method !== "GET").length;
  await assert.rejects(upsertSharedTool(api, store, "HANGUP", DEFINITIONS.HANGUP), { code: "duplicate_shared_tool_matches" });
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, writes);
  api.denyLists = true;
  await assert.rejects(upsertSharedTool(api, store, "TRANSFER", DEFINITIONS.TRANSFER), { http_status: 403 });
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, writes);
});

// Full REST errors and telemetry must not reveal the versioned numbers or key.
test("shared REST diagnostics scrub phone constants, credentials and API payloads", async () => {
  const key = "synthetic-key-marker";
  const events: unknown[] = [];
  const api = createTelnyxApi(key, async () => Response.json({ errors: [{ code: "10015",
    title: "Rejected", detail: key + " " + TELNYX_PHONE_NUMBER + " " + TECHNICIAN_PHONE_NUMBER }] }, { status: 400 }),
    (event) => events.push(event), [TELNYX_PHONE_NUMBER, TECHNICIAN_PHONE_NUMBER]);
  try {
    await api.request("POST", "/ai/tools", DEFINITIONS.TRANSFER);
    assert.fail("rejection must throw");
  } catch (error) {
    assert.ok(error instanceof TelnyxApiError);
    const diagnostic = JSON.stringify({ code: error.code, status: error.http_status, detail: error.detail, events });
    assert.ok(!diagnostic.includes(key));
    assert.ok(!diagnostic.includes(TELNYX_PHONE_NUMBER));
    assert.ok(!diagnostic.includes(TECHNICIAN_PHONE_NUMBER));
    assert.ok(!diagnostic.includes("tool_definition"));
  }
});

// A damaged local map must not cause fresh resources to be provisioned.
test("malformed persisted tool maps stop before any API call", async () => {
  const store = new Store();
  store.state.shared_tool_ids = [] as unknown as Record<string, string>;
  const api = new Registry(store);
  await assert.rejects(upsertSharedTool(api, store, "HANGUP", DEFINITIONS.HANGUP), { code: "invalid_deployment_state" });
  assert.equal(api.calls.length, 0);
});

// Normalized set order remains equivalent, but expanded privileges require PATCH.
test("reordered writable variables are reused and an extra variable is removed by update", async () => {
  const store = new Store();
  const api = new Registry(store);
  const first = await upsertSharedTool(api, store, "SET_SUPPORT_VARIABLES", DEFINITIONS.SET_SUPPORT_VARIABLES);
  const resource = api.tools.get(first.resource.id)!;
  const definition = resource.tool_definition as Record<string, unknown>;
  const variables = definition.updatable_variables as Record<string, unknown>[];
  variables.reverse();
  const unchanged = await upsertSharedTool(api, store, "SET_SUPPORT_VARIABLES", DEFINITIONS.SET_SUPPORT_VARIABLES);
  assert.equal(unchanged.action, "reused");
  variables.push({ name: "operation_id", type: "string" });
  const corrected = await upsertSharedTool(api, store, "SET_SUPPORT_VARIABLES", DEFINITIONS.SET_SUPPORT_VARIABLES);
  assert.equal(corrected.action, "updated");
  assert.equal(corrected.resource.id, first.resource.id);
});

// Inaccessible ids are not absence; only a 404 plus a full scan can adopt a match.
test("a stale saved tool id is reconciled by its unique owned name", async () => {
  const store = new Store();
  const api = new Registry(store);
  const first = await upsertSharedTool(api, store, "HANGUP", DEFINITIONS.HANGUP);
  store.state.shared_tool_ids!.HANGUP = "missing-old-id";
  const posts = api.calls.filter((call) => call.method === "POST").length;
  const recovered = await upsertSharedTool(api, store, "HANGUP", DEFINITIONS.HANGUP);
  assert.equal(recovered.resource.id, first.resource.id);
  assert.equal(api.calls.filter((call) => call.method === "POST").length, posts);
});
