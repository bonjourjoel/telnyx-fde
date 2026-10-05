// Offline assistant checks: follow-up graph, native request shape, model preflight,
// flat/merged assistant responses, resumable creation and idempotent updates.
// No environment file, account, real deployment state or phone call is used.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAssistant, ASSISTANT_MODEL, ASSISTANT_INSTRUCTIONS, INIT_WEBHOOK_TIMEOUT_MS } from "../config/assistant";
import { buildSupportWorkflow, validateConversationFlow, ORIENTATION_PROMPT, GOODBYE_MESSAGE, END_CONVERSATION_CONDITION, type ConversationFlow } from "../config/workflow";
import { FAQ_SHORT_PROMPT } from "../config/faq-prompts";
import { TICKET_INTAKE_PROMPT } from "../config/ticket-prompts";
import { buildSharedTools } from "../config/tools";
import { DEFAULT_INIT_DYNAMIC_VARIABLES, WRITABLE_DYNAMIC_VARIABLE_KEYS, CREATED_TICKET_VARIABLE_KEYS } from "../src/contracts";
import { assertAssistantModelAvailable, upsertAssistant } from "./lib/assistant";
import { TelnyxApiError, type ApiMethod } from "./lib/telnyx-api";
import type { DeploymentState, DeploymentStateStore } from "./lib/deployment-state";
import type { ResourceApi } from "./lib/resource-upsert";

// Fictional resource identities keep fixtures independent of the live account.
const TOOL_IDS = { hangup: "tool-hangup", set_support_variables: "tool-updater", create_ticket: "tool-create-ticket" };
const DEFINITION = buildAssistant("https://function.example.invalid", "telnyx-fde", "mcp-example", TOOL_IDS);

// Interpret only deterministic guards from the actual JSON for negative cases.
// This does not exercise the hosted model or Telnyx's runtime edge evaluator.
type Expression = Extract<ConversationFlow["edges"][number]["condition"], { type: "expression" }>["expression"];
function evaluate(expression: Expression, values: Record<string, unknown>): boolean {
  if (expression.type === "bool_op") return expression.operands.every(item => evaluate(item, values));
  const actual = values[expression.left.name];
  return expression.op === "==" ? actual === expression.right.value : actual !== expression.right.value;
}

// Defaults are considered only after every deterministic guard has failed.
function expressionTarget(source: string, values: Record<string, unknown>): string | undefined {
  const edges = DEFINITION.conversation_flow.edges.filter(edge => edge.start_node_id === source);
  return edges.find(edge => edge.condition.type === "expression" && evaluate(edge.condition.expression, values))?.target.node_id
    ?? edges.find(edge => edge.condition.type === "default")?.target.node_id;
}

// Snapshotting store exposes checkpoint loss and preserves previous step ids.
class Store implements DeploymentStateStore {
  state: DeploymentState = { kv_namespace_id: "kv-existing", mcp_server_id: "mcp-example",
    shared_tool_ids: { HANGUP: "tool-hangup", SET_SUPPORT_VARIABLES: "tool-updater", CREATE_TICKET: "tool-create-ticket" }, untouched: true };
  // Read detached state as the JSON repository does.
  async load(): Promise<DeploymentState> { return structuredClone(this.state); }
  // No file is written by this double.
  async save(state: DeploymentState): Promise<void> { this.state = structuredClone(state); }
}

// Match observed API shapes: the list omits MCP/tools/flow configuration, while
// GET by id returns the complete assistant, including resolved shared tools.
class Registry implements ResourceApi {
  items = new Map<string, Record<string, unknown>>();
  calls: { method: ApiMethod; path: string; body?: unknown; key?: string }[] = [];
  loseCreation = false;
  failCreation = false;
  denyRead = false;
  badReadback = false;
  wrappedResource = false;
  constructor(private readonly store: Store) {}

  // GET representation differs from request fields: tool_ids is not required
  // in reads, and the merged shared tool must never be resent as inline input.
  private resource(value: unknown, id: string): Record<string, unknown> {
    const body = structuredClone(value) as Record<string, unknown>;
    delete body.tool_ids;
    return { ...body, id, version_id: "version-example", created_at: "2026-10-04T00:00:00Z",
      tools: [{ type: "update_dynamic_variables", shared: true, update_dynamic_variables: { name: "SET_SUPPORT_VARIABLES",
          description: "Update only the listed support conversation inputs.", updatable_variables: WRITABLE_DYNAMIC_VARIABLE_KEYS.map(name => ({ name, type: "string" })) } }],
      external_llm: null, llm_api_key_ref: null,
      telephony_settings: { default_texml_app_id: "texml-auto-example" },
      conversation_flow: { ...DEFINITION.conversation_flow,
        ...(body.conversation_flow as object),
        nodes: (body.conversation_flow as typeof DEFINITION.conversation_flow).nodes.map((node) =>
          node.type === "prompt" ? { ...node, tools: [], model: null, external_llm: null } : node) },
    };
  }

  // Only assistant CRUD is supported; creating other resources fails the check.
  async request(method: ApiMethod, path: string, body?: unknown, key?: string): Promise<unknown> {
    this.calls.push({ method, path, body: structuredClone(body), key });
    assert.ok(path.startsWith("/ai/assistants"));
    if (method === "GET") {
      if (this.denyRead) throw new TelnyxApiError("api_request_rejected", method, path, 403);
      if (path === "/ai/assistants") return { data: [...this.items.values()].map((item) => ({
        ...structuredClone(item), mcp_servers: [], tools: [], conversation_flow: null,
      })) };
      const id = decodeURIComponent(path.slice("/ai/assistants/".length));
      const item = structuredClone(this.items.get(id));
      if (!item) throw new TelnyxApiError("api_request_rejected", method, path, 404);
      if (this.badReadback) item.greeting = "Unexpected second greeting.";
      return this.wrappedResource ? { data: item } : item;
    }
    assert.equal(method, "POST");
    const input = body as typeof DEFINITION;
    assert.ok(!("id" in input) && !("version_id" in input) && !("created_at" in input));
    assert.deepEqual(input.tools, []);
    assert.deepEqual(input.tool_ids, ["tool-updater"]);
    assert.ok(input.conversation_flow.nodes.every((node) => !("tools" in node) && !("model" in node)));
    if (path === "/ai/assistants") {
      assert.equal(key, this.store.state.assistant_creation_pending?.idempotency_key);
      if (this.failCreation) { this.failCreation = false; throw new TelnyxApiError("network_result_unknown", method, path); }
      const item = this.resource(body, "assistant-created");
      this.items.set(String(item.id), item);
      if (this.loseCreation) { this.loseCreation = false; throw new TelnyxApiError("network_result_unknown", method, path); }
      return item;
    }
    const id = decodeURIComponent(path.slice("/ai/assistants/".length));
    assert.ok(this.items.has(id));
    const item = this.resource(body, id);
    this.items.set(id, item);
    return item;
  }
}

// Approved wording, safe defaults and graph references are checked together.
test("support assistant keeps ticket context and scopes model tools for MCP FAQ", () => {
  assert.equal(DEFINITION.instructions, ASSISTANT_INSTRUCTIONS);
  assert.equal(DEFINITION.greeting, "");
  assert.equal(DEFINITION.dynamic_variables_webhook_url, "https://function.example.invalid/init");
  assert.equal(DEFINITION.dynamic_variables_webhook_timeout_ms, INIT_WEBHOOK_TIMEOUT_MS);
  assert.equal(INIT_WEBHOOK_TIMEOUT_MS, 8000);
  for (const [key, value] of Object.entries(DEFAULT_INIT_DYNAMIC_VARIABLES)) assert.equal(DEFINITION.dynamic_variables[key], value);
  for (const key of [...WRITABLE_DYNAMIC_VARIABLE_KEYS, ...CREATED_TICKET_VARIABLE_KEYS]) assert.equal(DEFINITION.dynamic_variables[key], "");
  assert.deepEqual(DEFINITION.enabled_features, ["telephony"]);
  assert.deepEqual(DEFINITION.mcp_servers, [{ id: "mcp-example", allowed_tools: ["list_topics", "read_short_answer", "read_long_answer"] }]);
  assert.equal(DEFINITION.conversation_flow.nodes.length, 15);
  const prompt = DEFINITION.conversation_flow.nodes.find((node) => node.type === "prompt" && node.id === "faq_short")!;
  assert.ok(prompt.type === "prompt");
  assert.equal(prompt.instructions, FAQ_SHORT_PROMPT);
  assert.equal(prompt.instructions_mode, "append");
  assert.deepEqual(prompt.shared_tool_ids, []);
  assert.equal(prompt.tools_mode, "append");
  assert.deepEqual(DEFINITION.tool_ids, ["tool-updater"]);
  const terminal = DEFINITION.conversation_flow.nodes.find(node => node.id === "hangup")!;
  assert.ok(terminal.type === "tool"); assert.equal(terminal.shared_tool_id, "tool-hangup");
  assert.equal(DEFINITION.conversation_flow.nodes[0].type === "speak" && DEFINITION.conversation_flow.nodes[0].message, "{{greeting_text}}");
  const goodbye = DEFINITION.conversation_flow.nodes.find(node => node.id === "goodbye")!;
  assert.equal(goodbye.type === "speak" && goodbye.message, GOODBYE_MESSAGE);
  const end = DEFINITION.conversation_flow.edges.find(edge => edge.id === "orientation_to_goodbye")!;
  assert.equal(end.condition.type === "llm" && end.condition.prompt, END_CONVERSATION_CONDITION);
  const orientation = DEFINITION.conversation_flow.nodes.find(node => node.id === "orientation")!;
  assert.equal(orientation.type === "prompt" && orientation.instructions, ORIENTATION_PROMPT);
  assert.deepEqual(orientation.type === "prompt" && orientation.shared_tool_ids, ["tool-updater"]);
  assert.ok(!DEFINITION.tool_ids.includes("tool-create-ticket"));
  assert.throws(() => buildAssistant("http://unsafe.invalid", "telnyx-fde", "mcp", TOOL_IDS));
  assert.throws(() => buildAssistant("https://safe.invalid", "telnyx-fde", "", TOOL_IDS));
  assert.throws(() => buildSupportWorkflow({ ...TOOL_IDS, set_support_variables: "tool-hangup" }));
});

// Invalid graphs fail locally, before an API request or any provisioning write.
test("graph validation rejects missing/duplicate ids, invalid routing and unknown tools", () => {
  const mutate = (change: (flow: ReturnType<typeof buildSupportWorkflow>) => void) => {
    const flow = buildSupportWorkflow(TOOL_IDS); change(flow);
    assert.throws(() => validateConversationFlow(flow, Object.values(TOOL_IDS)));
  };
  mutate((flow) => { flow.start_node_id = "missing"; });
  mutate((flow) => { flow.nodes[1].id = flow.nodes[0].id; });
  mutate((flow) => { flow.edges[1].id = flow.edges[0].id; });
  mutate((flow) => { flow.edges[0].target.node_id = "missing"; });
  mutate((flow) => { flow.edges[1].condition = { type: "default" }; });
  mutate((flow) => { flow.edges.shift(); });
  mutate((flow) => { flow.edges.pop(); });
  mutate((flow) => { const node = flow.nodes.find(node => node.id === "hangup")!; if (node.type === "tool") node.shared_tool_id = "unknown"; });
  mutate((flow) => { const edge = flow.edges.find(edge => edge.condition.type === "expression")!;
    if (edge.condition.type === "expression" && edge.condition.expression.type === "comparison") edge.condition.expression.left.name = "unknown_variable"; });
  mutate((flow) => { const edge = flow.edges.find(edge => edge.id === "ticket_creation_succeeded")!;
    if (edge.condition.type === "expression" && edge.condition.expression.type === "bool_op") edge.condition.expression.operands[1].left.name = "unknown_variable"; });
  mutate((flow) => { const edge = flow.edges.find(edge => edge.id === "ticket_creation_succeeded")!;
    if (edge.condition.type === "expression" && edge.condition.expression.type === "bool_op") edge.condition.expression.operands = []; });
});

// Assert routing precedence from the actual graph, not a mirrored builder. These
// cases prove conditions, not the hosted model's choice or native tool execution.
test("context and status guards prevent empty or failed-context status delivery", () => {
  const next = (values: Record<string, unknown>) => expressionTarget("orientation", values);
  assert.equal(next({ init_ok: false, tickets_count: 0, selected_ticket_status_text: "" }), "context_unavailable");
  assert.equal(next({ init_ok: false, tickets_count: 2, selected_ticket_status_text: "stale" }), "context_unavailable");
  assert.equal(next({ init_ok: true, tickets_count: 0, selected_ticket_status_text: "stale" }), "faq_short");
  assert.equal(next({ init_ok: true, tickets_count: 2, selected_ticket_status_text: "" }), undefined);
  assert.equal(next({ init_ok: true, tickets_count: 2, selected_ticket_status_text: "Backend status." }), "ticket_status");
  for (const source of ["ticket_status", "ticket_status_error", "faq_error", "ticket_created", "ticket_error", "ticket_unavailable"]) {
    const edge = DEFINITION.conversation_flow.edges.find(edge => edge.start_node_id === source)!;
    assert.equal(edge.condition.type, "default"); assert.equal(edge.target.node_id, "hangup");
    const node = DEFINITION.conversation_flow.nodes.find(node => node.id === source)!;
    assert.ok(node.type === "speak");
    assert.ok(node.message.endsWith(GOODBYE_MESSAGE));
    assert.equal(node.message.split(GOODBYE_MESSAGE).length, 2);
    if (source === "ticket_status") assert.equal(node.message, `{{selected_ticket_status_text}} ${GOODBYE_MESSAGE}`);
  }
});

// The immutable capability is checked before the single offer; filled fields
// alone never authorize creation without explicit agreement and storage.
test("ticket preparation guards fail closed and preserve cancellation paths", () => {
  for (const capability of [false, undefined, null, "true", 1]) {
    assert.equal(expressionTarget("ticket_intake", { can_create_ticket: capability,
      ticket_subject: "Subject", ticket_description: "Description" }), "ticket_unavailable");
  }
  // No automatic field-readiness transition: filled fields alone do not route.
  assert.equal(expressionTarget("ticket_intake", { can_create_ticket: true, ticket_subject: "Subject", ticket_description: "Description" }), undefined);

  const flow = DEFINITION.conversation_flow;
  // Exactly one edge targets create_ticket, an LLM condition from ticket_intake.
  const entry = flow.edges.filter(edge => edge.target.node_id === "create_ticket");
  assert.equal(entry.length, 1); assert.equal(entry[0].start_node_id, "ticket_intake");
  assert.ok(entry[0].condition.type === "llm");
  assert.match(entry[0].condition.prompt, /explicitly agreed to that question/);
  assert.match(entry[0].condition.prompt, /SET_SUPPORT_VARIABLES call successfully stored both/);
  assert.match(entry[0].condition.prompt, /already-filled variables do not authorize creation/);
  // No confirmation node or its edges survive.
  assert.ok(!flow.nodes.some(node => node.id === "ticket_confirm"));
  assert.ok(!flow.edges.some(edge => edge.id.startsWith("ticket_confirm_")));
  // No return-to-intake edges except resolution_to_intake.
  const backToIntake = flow.edges.filter(edge => edge.target.node_id === "ticket_intake").map(edge => edge.id).sort();
  assert.deepEqual(backToIntake, ["resolution_to_intake"]);
  // Capability, error and cancel transitions remain.
  const paths = { ticket_intake_cancel: "goodbye", ticket_intake_failed: "ticket_error" };
  for (const [id, target] of Object.entries(paths)) assert.equal(flow.edges.find(edge => edge.id === id)!.target.node_id, target);
});

// Status has the documented voice string type, and both mapped fields must be
// present. A timeout or incomplete result is never a creation announcement.
test("creation result needs HTTP string 200 plus id and reference without automatic retries", () => {
  const results: [Record<string, unknown>, string][] = [
    [{ telnyx_last_tool_status_code: "200", created_ticket_id: "ticket-id", created_ticket_reference: "T-0001" }, "ticket_created"],
    [{ telnyx_last_tool_status_code: 200, created_ticket_id: "ticket-id", created_ticket_reference: "T-0001" }, "ticket_error"],
    [{ telnyx_last_tool_status_code: "500", created_ticket_id: "ticket-id", created_ticket_reference: "T-0001" }, "ticket_error"],
    [{ telnyx_last_tool_status_code: "200", created_ticket_id: "", created_ticket_reference: "T-0001" }, "ticket_error"],
    [{ telnyx_last_tool_status_code: "200", created_ticket_id: "ticket-id", created_ticket_reference: "" }, "ticket_error"],
    [{ telnyx_last_tool_status_code: "", created_ticket_id: "", created_ticket_reference: "" }, "ticket_error"],
  ];
  for (const [values, target] of results) assert.equal(expressionTarget("create_ticket", values), target);
  const flow = DEFINITION.conversation_flow;
  for (const source of ["ticket_created", "ticket_error", "ticket_unavailable"]) {
    const edges = flow.edges.filter(edge => edge.start_node_id === source);
    assert.equal(edges.length, 1); assert.equal(edges[0].target.node_id, "hangup");
    assert.equal(edges[0].condition.type, "default");
  }
});

// Prompt scopes exclude the business webhook and hangup. Tool-node arguments
// match the shared webhook schema and the initialized writable variables.
test("ticket tools remain scoped and bind exact business variables", () => {
  const flow = DEFINITION.conversation_flow;
  const intake = flow.nodes.find(node => node.id === "ticket_intake")!;
  assert.ok(intake.type === "prompt");
  assert.equal(intake.instructions, TICKET_INTAKE_PROMPT);
  assert.equal(intake.tools_mode, "replace"); assert.deepEqual(intake.shared_tool_ids, [TOOL_IDS.set_support_variables]);
  for (const node of flow.nodes) if (node.type === "prompt") {
    assert.ok(!node.shared_tool_ids.includes(TOOL_IDS.create_ticket));
    assert.ok(!node.shared_tool_ids.includes(TOOL_IDS.hangup));
  }
  const create = flow.nodes.find(node => node.id === "create_ticket")!;
  assert.ok(create.type === "tool"); assert.equal(create.shared_tool_id, TOOL_IDS.create_ticket);
  const webhook = buildSharedTools("https://function.example.invalid", "telnyx-fde").CREATE_TICKET.webhook!;
  const parameters = webhook.body_parameters as { required: string[] };
  assert.deepEqual(parameters.required, ["ticket_subject", "ticket_description"]);
  for (const key of parameters.required) assert.equal(DEFINITION.dynamic_variables[key], "");
  assert.equal(webhook.async, false);
  const routes = [...intake.instructions.matchAll(/transition__([a-z_]+)/g)].map(match => match[1]);
  assert.deepEqual(routes.sort(), flow.edges.filter(edge => edge.start_node_id === intake.id && edge.condition.type === "llm").map(edge => edge.id).sort());
});

// A successful title lookup closes through the existing goodbye Speak. There
// is no long branch or writable FAQ state, while the public MCP still has tools.
test("title-only FAQ closes through goodbye without a long-answer branch", () => {
  const flow = DEFINITION.conversation_flow;
  const shorts = flow.edges.filter(edge => edge.start_node_id === "faq_short");
  assert.ok(shorts.every(edge => edge.condition.type === "llm"));
  assert.deepEqual(shorts.map(edge => edge.target.node_id).sort(), ["faq_error", "goodbye", "resolution"]);
  const finished = shorts.find(edge => edge.target.node_id === "goodbye")!;
  assert.ok(finished.condition.type === "llm"); assert.match(finished.condition.prompt, /announced the exact page title/);
  const short = flow.nodes.find(node => node.id === "faq_short")!;
  assert.ok(short.type === "prompt");
  // Each documented routing call must exist on the current node, not be a
  // fabricated tool or an automatic comparison that preempts preparation.
  const calls = [...new Set([...short.instructions.matchAll(/transition__([a-z_]+)/g)].map(match => match[1]))];
  assert.deepEqual(calls.sort(), shorts.map(edge => edge.id).sort());
  const goodbye = flow.nodes.find(node => node.id === "goodbye")!;
  assert.ok(goodbye.type === "speak"); assert.equal(goodbye.message, GOODBYE_MESSAGE);
  const exit = flow.edges.find(edge => edge.start_node_id === "goodbye")!;
  assert.equal(exit.condition.type, "default"); assert.equal(exit.target.node_id, "hangup");
  assert.ok(!flow.nodes.some(node => node.id.startsWith("faq_long")));
  assert.ok(!Object.keys(DEFINITION.dynamic_variables).some(key => key.startsWith("faq_")));
  assert.ok(!flow.nodes.some(node => node.type === "prompt" && node.shared_tool_ids.includes(TOOL_IDS.hangup)));
  const noMatch = flow.nodes.find(node => node.id === "resolution")!;
  const error = flow.nodes.find(node => node.id === "faq_error")!;
  assert.ok(noMatch.type === "speak" && error.type === "speak");
  assert.equal(noMatch.message, "The FAQ doesn't cover this question."); assert.match(error.message, /couldn't retrieve/);
  assert.equal(flow.edges.find(edge => edge.start_node_id === "resolution")!.target.node_id, "ticket_intake");
  assert.ok(!flow.nodes.some(node => node.id === "conversation"));
});

// Account availability is a GET; failure never silently picks another model.
test("model preflight accepts the chosen id and rejects missing/malformed catalogues", async () => {
  const api: ResourceApi = { async request(method, path) {
    assert.equal(method, "GET"); assert.equal(path, "/ai/openai/models");
    return { data: [{ id: ASSISTANT_MODEL }] };
  } };
  await assertAssistantModelAvailable(api, ASSISTANT_MODEL);
  await assert.rejects(assertAssistantModelAvailable({ async request() { return { data: [] }; } }, ASSISTANT_MODEL), { code: "assistant_model_unavailable" });
  await assert.rejects(assertAssistantModelAvailable({ async request() { return {}; } }, ASSISTANT_MODEL), { code: "invalid_model_catalogue" });
});

// Match documented flat and data-wrapped resources without a second creation.
test("two deployments reuse one assistant and preserve previous ids and auto TeXML metadata", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  api.wrappedResource = true;
  const second = await upsertAssistant(api, store, DEFINITION);
  assert.equal(first.action, "created"); assert.equal(second.action, "reused");
  assert.equal(first.resource.id, second.resource.id);
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, 1);
  assert.equal(store.state.assistant_id, first.resource.id);
  assert.equal(store.state.assistant_creation_pending, undefined);
  assert.equal(store.state.assistant_default_texml_app_id, "texml-auto-example");
  assert.equal(store.state.kv_namespace_id, "kv-existing");
  assert.equal(store.state.mcp_server_id, "mcp-example");
  assert.equal(store.state.untouched, true);
});

// Shared response definitions remain read-only; one missing or unsafe updater
// causes repair by update on the same assistant, never another creation.
test("merged updater reads preserve ids and reject an expanded variable allowlist", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  const resource = api.items.get(first.resource.id)!;
  const updater = (resource.tools as Record<string, unknown>[]).find(tool => tool.type === "update_dynamic_variables")!;
  const fields = updater.update_dynamic_variables as { updatable_variables: { name: string; type: string }[] };
  fields.updatable_variables.reverse(); (resource.tools as unknown[]).reverse();
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "reused");
  fields.updatable_variables.push({ name: "technician_available", type: "string" });
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "updated");
  const current = api.items.get(first.resource.id)!;
  (current.tools as unknown[]).push({ type: "hangup", shared: true, hangup: { description: "Unexpected model hangup" } });
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "updated");
  assert.equal(api.items.size, 1);
  assert.equal(api.calls.filter(call => call.method === "POST" && call.path === "/ai/assistants").length, 1);
});

// Changing a FAQ node to replace mode could drop inherited MCP tools. It is
// configuration drift and must be repaired rather than silently reused.
test("FAQ tool inheritance and MCP allowlist drift update the same assistant", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  const resource = api.items.get(first.resource.id)!;
  const flow = resource.conversation_flow as typeof DEFINITION.conversation_flow;
  const short = flow.nodes.find(node => node.id === "faq_short")!;
  assert.ok(short.type === "prompt"); short.tools_mode = "replace";
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "updated");
  // A stale model-visible HANGUP would allow early cutoff before the Speak.
  const repairedFlow = api.items.get(first.resource.id)!.conversation_flow as typeof DEFINITION.conversation_flow;
  const repairedShort = repairedFlow.nodes.find(node => node.id === "faq_short")!;
  assert.ok(repairedShort.type === "prompt"); repairedShort.shared_tool_ids = [TOOL_IDS.hangup];
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "updated");
  const current = api.items.get(first.resource.id)!;
  (current.mcp_servers as { allowed_tools: string[] }[])[0].allowed_tools.push("unapproved-tool");
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "updated");
  assert.equal(api.items.size, 1);
});

// Creation references and typed result checks are owned configuration too.
test("ticket creation readback drift is repaired on the same assistant", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  const flow = api.items.get(first.resource.id)!.conversation_flow as ConversationFlow;
  const create = flow.nodes.find(node => node.id === "create_ticket")!;
  assert.ok(create.type === "tool"); create.shared_tool_id = "tool-unexpected";
  const result = flow.edges.find(edge => edge.id === "ticket_creation_succeeded")!;
  assert.ok(result.condition.type === "expression" && result.condition.expression.type === "bool_op");
  result.condition.expression.operands[0].right = { type: "number_literal", value: 200 };
  const repaired = await upsertAssistant(api, store, DEFINITION);
  assert.equal(repaired.action, "updated"); assert.equal(repaired.resource.id, first.resource.id);
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "reused");
  assert.equal(store.state.shared_tool_ids!.CREATE_TICKET, TOOL_IDS.create_ticket);
  assert.equal(api.items.size, 1);
  assert.equal(api.calls.filter(call => call.method === "POST" && call.path === "/ai/assistants").length, 1);
});

// A deployed assistant still carrying the removed confirmation branch is
// reconciled by a complete graph update on the same id, not a new creation.
// This proves the migration from the two-step collection/confirmation flow to
// the approved single-offer flow without orphaning the existing assistant.
test("removed confirmation branch is reconciled on the same assistant", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  const resource = api.items.get(first.resource.id)!;
  // Simulate the previously deployed graph with the confirmation prompt node
  // and the legacy edges that routed intake into it and out to creation.
  const stored = resource.conversation_flow as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  stored.nodes.push({
    type: "prompt", id: "ticket_confirm", name: "TICKET_CONFIRM",
    instructions: "Legacy confirmation.", instructions_mode: "append",
    shared_tool_ids: [], tools_mode: "replace", position: { x: 1500, y: 360 },
    tools: [], model: null, external_llm: null,
  });
  stored.edges.push(
    { id: "ticket_intake_to_confirm", start_node_id: "ticket_intake",
      target: { type: "node", node_id: "ticket_confirm" }, condition: { type: "llm", prompt: "Legacy." } },
    { id: "ticket_confirm_create", start_node_id: "ticket_confirm",
      target: { type: "node", node_id: "create_ticket" }, condition: { type: "llm", prompt: "Legacy." } },
    { id: "ticket_confirm_correct", start_node_id: "ticket_confirm",
      target: { type: "node", node_id: "ticket_intake" }, condition: { type: "llm", prompt: "Legacy." } },
  );
  const second = await upsertAssistant(api, store, DEFINITION);
  assert.equal(second.action, "updated");
  assert.equal(second.resource.id, first.resource.id);
  assert.equal(api.items.size, 1);
  assert.equal(api.calls.filter(call => call.method === "POST" && call.path === "/ai/assistants").length, 1);
  const reconciled = api.items.get(first.resource.id)!.conversation_flow as typeof DEFINITION.conversation_flow;
  assert.ok(!reconciled.nodes.some(node => node.id === "ticket_confirm"));
  assert.ok(!reconciled.edges.some(edge => edge.id === "ticket_intake_to_confirm"));
  assert.ok(!reconciled.edges.some(edge => edge.id === "ticket_confirm_create"));
  assert.ok(!reconciled.edges.some(edge => edge.id === "ticket_confirm_correct"));
  assert.ok(reconciled.nodes.some(node => node.id === "ticket_intake"));
  assert.ok(reconciled.edges.some(edge => edge.id === "ticket_intake_create"));
});

// A discovered id must also be hydrated, even when no id survived locally.
// Partial list values cannot trigger writes or conceal a failed detail read.
test("incomplete assistant lists use full GET before deciding reuse or update", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  delete store.state.assistant_id;
  delete store.state.assistant_default_texml_app_id;
  const writes = api.calls.filter((call) => call.method !== "GET").length;
  const second = await upsertAssistant(api, store, DEFINITION);
  assert.equal(second.action, "reused");
  assert.equal(second.resource.id, first.resource.id);
  assert.equal(store.state.assistant_default_texml_app_id, "texml-auto-example");
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, writes);

  // A successful list is insufficient if its matching resource cannot be read.
  delete store.state.assistant_id;
  const denied: ResourceApi = { async request(method, path, body, key) {
    if (method === "GET" && path !== "/ai/assistants") throw new TelnyxApiError("api_request_rejected", method, path, 403);
    return api.request(method, path, body, key);
  } };
  await assert.rejects(upsertAssistant(denied, store, DEFINITION), { http_status: 403 });
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, writes);
});

// Update uses a fresh complete graph and never copies resolved response tools.
test("changed instructions update the same assistant with the complete desired graph", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  const desired = { ...DEFINITION, instructions: DEFINITION.instructions + " Keep the test short." };
  const second = await upsertAssistant(api, store, desired);
  assert.equal(second.action, "updated"); assert.equal(second.resource.id, first.resource.id);
  assert.equal(api.items.size, 1);
  const update = api.calls.find((call) => call.method === "POST" && call.path.endsWith("/" + first.resource.id))!;
  assert.deepEqual((update.body as typeof DEFINITION).conversation_flow, desired.conversation_flow);
});

// Canvas reorder and read-only defaults do not trigger repeated writes, while
// an extra graph step must be removed by a complete graph update.
test("canvas order and grouping are irrelevant but extra nodes are corrected by update", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  const flow = api.items.get(first.resource.id)!.conversation_flow as typeof DEFINITION.conversation_flow;
  flow.nodes.reverse(); flow.edges.sort((a, b) => a.start_node_id.localeCompare(b.start_node_id));
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "reused");
  flow.nodes.push({ ...flow.nodes[0], id: "extra" });
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "updated");
});

// Guard declaration order changes runtime behavior, unlike canvas node order.
test("changed expression priority is repaired on the existing assistant", async () => {
  const store = new Store(); const api = new Registry(store);
  const first = await upsertAssistant(api, store, DEFINITION);
  const flow = api.items.get(first.resource.id)!.conversation_flow as typeof DEFINITION.conversation_flow;
  flow.edges.reverse();
  const result = await upsertAssistant(api, store, DEFINITION);
  assert.equal(result.action, "updated"); assert.equal(result.resource.id, first.resource.id);
});

// Partial or lost POST outcomes reuse the same logical resource/checkpoint.
test("interrupted assistant creation reuses its key and recovers a lost response", async () => {
  const store = new Store(); const api = new Registry(store); api.failCreation = true;
  await assert.rejects(upsertAssistant(api, store, DEFINITION), { code: "network_result_unknown" });
  const key = store.state.assistant_creation_pending!.idempotency_key;
  await upsertAssistant(api, store, DEFINITION);
  assert.deepEqual(api.calls.filter((call) => call.method === "POST").map((call) => call.key), [key, key]);
  const anotherStore = new Store(); const anotherApi = new Registry(anotherStore); anotherApi.loseCreation = true;
  assert.equal((await upsertAssistant(anotherApi, anotherStore, DEFINITION)).action, "recovered");
  assert.equal(anotherApi.calls.filter((call) => call.method === "POST").length, 1);
});

// A rejected read-back keeps ownership and resumes without creating a duplicate.
test("assistant readback mismatch retains its id and resumes after correction", async () => {
  const store = new Store(); const api = new Registry(store); api.badReadback = true;
  await assert.rejects(upsertAssistant(api, store, DEFINITION), { code: "assistant_readback_mismatch" });
  assert.equal(store.state.assistant_id, "assistant-created");
  assert.ok(store.state.assistant_creation_pending);
  api.badReadback = false;
  assert.equal((await upsertAssistant(api, store, DEFINITION)).action, "reused");
  assert.equal(api.calls.filter((call) => call.method === "POST").length, 1);
});

// Ambiguous names, external-provider conflicts and failed reads cannot create.
test("duplicate assistants and denied reads stop without resource writes", async () => {
  const store = new Store(); const api = new Registry(store);
  await upsertAssistant(api, store, DEFINITION);
  const writes = api.calls.filter((call) => call.method !== "GET").length;
  api.items.set("duplicate", { ...structuredClone(api.items.get("assistant-created")!), id: "duplicate" });
  await assert.rejects(upsertAssistant(api, store, DEFINITION), { code: "duplicate_assistant_matches" });
  api.items.delete("duplicate"); api.denyRead = true;
  await assert.rejects(upsertAssistant(api, store, DEFINITION), { http_status: 403 });
  api.denyRead = false; api.items.get("assistant-created")!.external_llm = { model: "other", base_url: "https://other.invalid" };
  await assert.rejects(upsertAssistant(api, store, DEFINITION), { code: "stored_assistant_conflict" });
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, writes);
});

// Documented complete lists can exceed a page; unexpected partial responses fail.
test("assistant listing scans complete data arrays and rejects partial pagination", async () => {
  const store = new Store(); const api = new Registry(store);
  for (let index = 0; index < 110; index++) api.items.set("unrelated-" + index, { id: "unrelated-" + index, name: "unrelated-" + index });
  await upsertAssistant(api, store, DEFINITION);
  assert.equal(api.items.size, 111);
  const paged: ResourceApi = { async request() { return { data: [], meta: { total_pages: 2, total_results: 2, page_number: 1, page_size: 1 } }; } };
  await assert.rejects(upsertAssistant(paged, new Store(), DEFINITION), { code: "unexpected_assistant_pagination" });
});
