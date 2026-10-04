// Sequential local HTTP integration checks. Exercise the real router, Ed25519
// verification, HMAC identity, handlers, and ticket actor with synthetic data.
// No fetch calls, Telnyx account access, .env loading, or parallel scenarios.

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import type { ActorContext } from "@telnyx/edge-runtime";
import { routeRequest } from "../src/index";
import { CallerTickets } from "../src/actors/caller-tickets";
import { computeCallerKey, computeTicketOperationId, computePortalTargetHash } from "../src/security";
import { MAX_SUBJECT_LENGTH, MAX_DESCRIPTION_LENGTH, type DemoTicketInput, type InitDynamicVariables } from "../src/contracts";
import type { RuntimeSecrets } from "../src/http/common";
import { submitDemoFixtures } from "./seed-demo";
import { prepareSupportConfig } from "../src/support-config";

// Ephemeral signing keys emulate Telnyx callbacks without using account keys.
const keys = generateKeyPairSync("ed25519");
const secrets: RuntimeSecrets = {
  public_key: keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"),
  caller_hmac_key: "synthetic-local-hmac-key", admin_secret: "synthetic-local-admin-secret",
};

// Reserved fictional North American number, used only as local test input.
const PHONE = "+12025550123";

// Clone-on-read/write storage; actual cloud durability is checked separately.
class TestStorage {
  private readonly values = new Map<string, unknown>();
  fail = false;
  // Read detached data to expose accidental memory-only state in the actor.
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  // Throw before committing when a test simulates a storage outage.
  async put<T>(key: string, value: T): Promise<void> {
    if (this.fail) throw new Error("sensitive-storage-error-marker");
    this.values.set(key, structuredClone(value));
  }
}

// Real CallerTickets instances behind a small namespace and KV test double.
class System {
  config: unknown = { technician_available: false, web_demo_identity: "synthetic-private-web-demo" };
  kvFails = false;
  kvFailure?: Error;
  actorFails = false;
  malformedResult = false;
  readonly actorKeys: string[] = [];
  readonly actors = new Map<string, CallerTickets>();
  readonly stores = new Map<string, TestStorage>();
  readonly env: Env;

  // Cast only at the binding boundary; unused runtime methods are not faked.
  constructor() {
    this.env = {
      SUPPORT_CONFIG: { get: async () => {
        if (this.kvFailure) throw this.kvFailure;
        if (this.kvFails) throw new Error("sensitive-kv-error-marker");
        return structuredClone(this.config);
      } },
      CALLER_TICKETS: { idFromName: (key: string) => {
        this.actorKeys.push(key);
        if (this.actorFails) throw new Error("sensitive-actor-error-marker");
        if (this.malformedResult) return { createTicket: async () => ({}) };
        if (!this.actors.has(key)) {
          const storage = new TestStorage();
          this.stores.set(key, storage);
          this.actors.set(key, new CallerTickets({ storage } as unknown as ActorContext, {} as Env));
        }
        return this.actors.get(key)!;
      } },
    } as unknown as Env;
  }
}

// Preserve exact bytes, including whitespace, and sign timestamp|raw_body.
function signedRequest(path: string, body: unknown, timestamp = String(Math.floor(Date.now() / 1000))): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://local.invalid" + path, { method: "POST", body: raw,
    headers: { "Content-Type": "application/json", "telnyx-timestamp": timestamp,
      "telnyx-signature-ed25519": sign(null, Buffer.from(timestamp + "|" + raw), keys.privateKey).toString("base64") },
  });
}

// Documented event envelope; event id can change while call identity stays fixed.
function initialization(phone: unknown = PHONE, callId: unknown = "v3:synthetic-call-1") {
  return { data: { event_type: "assistant.initialization", id: "synthetic-event-1",
    payload: { telnyx_conversation_channel: "phone_call", telnyx_end_user_target: phone, call_control_id: callId } } };
}

// Portal events use the documented envelope id, not invented session fields.
function webInitialization(eventId: unknown = "synthetic-private-web-event-1") {
  return { data: { event_type: "assistant.initialization", id: eventId,
    payload: { telnyx_conversation_channel: "web_call", telnyx_end_user_target: "synthetic-web-target" } } };
}

// Flat body specified by the future CREATE_TICKET tool configuration.
function creation(operationId = "synthetic-operation") {
  return { conversation_channel: "phone_call", caller_phone: PHONE, operation_id: operationId,
    ticket_subject: "synthetic-private-subject-marker", ticket_description: "synthetic-private-description-marker" };
}

// Valid fixture at a relative age so selection checks do not expire over time.
function fixture(id: string, ageDays = 0, status: DemoTicketInput["status"] = "open"): DemoTicketInput {
  const time = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  return { subject: id, description: "synthetic-private-description-marker", operation_id: id,
    status, status_summary: "Synthetic progress.", created_at: time, updated_at: time };
}

// Authenticated preparation request. It is routed in-process, never fetched.
function seedRequest(tickets: unknown, adminSecret = secrets.admin_secret!): Request {
  return new Request("https://local.invalid/admin/seed", { method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
    body: JSON.stringify({ conversation_channel: "phone_call", caller_phone: PHONE, tickets }) });
}

// Decode the explicit initialization wrapper and assert its full primitive shape.
async function variables(response: Response): Promise<InitDynamicVariables> {
  assert.equal(response.status, 200);
  const body = await response.json() as { dynamic_variables: InitDynamicVariables };
  assert.equal(typeof body.dynamic_variables.init_ok, "boolean");
  assert.equal(typeof body.dynamic_variables.can_create_ticket, "boolean");
  assert.equal(typeof body.dynamic_variables.tickets_count, "number");
  return body.dynamic_variables;
}

// One parent runs awaited subtests sequentially and captures only application
// JSON logs. Finally restore console.log even if an assertion fails.
test("local HTTP scenarios and sanitized observability", async (t) => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (line: unknown) => { logs.push(String(line)); };
  try {
    await t.test("health and routing never touch missing bindings", async () => {
      assert.equal((await routeRequest(new Request("https://local.invalid/health"), {} as Env, {})).status, 200);
      assert.equal((await routeRequest(new Request("https://local.invalid/unknown"), {} as Env, {})).status, 404);
      assert.equal((await routeRequest(new Request("https://local.invalid/__proto__"), {} as Env, {})).status, 404);
      for (const path of ["/init", "/tickets/create", "/admin/seed"]) {
        const response = await routeRequest(new Request("https://local.invalid" + path), {} as Env, {});
        assert.equal(response.status, 405);
        assert.equal(response.headers.get("Allow"), "POST");
      }
    });

    await t.test("unsigned, tampered, stale and malformed callbacks are rejected before access", async () => {
      const system = new System();
      for (const path of ["/init", "/tickets/create"]) {
        const unsigned = new Request("https://local.invalid" + path, { method: "POST", body: "not-json" });
        assert.equal((await routeRequest(unsigned, system.env, secrets)).status, 401);
        const old = signedRequest(path, {}, String(Math.floor(Date.now() / 1000) - 600));
        assert.equal((await routeRequest(old, system.env, secrets)).status, 401);
        const valid = signedRequest(path, {});
        const altered = new Request(valid.url, { method: "POST", headers: valid.headers, body: '{"changed":true}' });
        assert.equal((await routeRequest(altered, system.env, secrets)).status, 401);
        assert.equal((await routeRequest(signedRequest(path, "not-json"), system.env, secrets)).status, 400);
        assert.equal((await routeRequest(signedRequest(path, []), system.env, secrets)).status, 400);
        assert.equal((await routeRequest(signedRequest(path, {}), system.env, { ...secrets, public_key: undefined })).status, 503);
      }
      assert.equal(system.actorKeys.length, 0);
    });

    await t.test("empty records and exact raw JSON resolve stable call variables", async () => {
      const system = new System();
      const first = await variables(await routeRequest(signedRequest("/init", JSON.stringify(initialization(), null, 2)), system.env, secrets));
      assert.equal(first.init_ok, true);
      assert.equal(first.can_create_ticket, true);
      assert.equal(first.tickets_json, "[]");
      assert.equal(first.tickets_count, 0);
      assert.equal(first.technician_available, false);
      assert.match(first.operation_id, /^[a-f0-9]{64}$/);
      const retry = initialization();
      retry.data.id = "different-delivery-event";
      const repeat = await variables(await routeRequest(signedRequest("/init", retry), system.env, secrets));
      assert.equal(first.operation_id, repeat.operation_id);
      const another = await variables(await routeRequest(signedRequest("/init", initialization(PHONE, "v3:synthetic-call-2")), system.env, secrets));
      assert.notEqual(first.operation_id, another.operation_id);
      assert.ok(system.actorKeys.every((key) => /^[a-f0-9]{64}$/.test(key)));
    });

    await t.test("selection keeps open or recent records, sorted by update with a limit of three", async () => {
      const system = new System();
      const tickets = [fixture("old-resolved", 60, "resolved"), fixture("old-open", 60),
        fixture("newest", 0), fixture("second", 2, "in_progress"), fixture("third", 3, "resolved")];
      assert.equal((await routeRequest(seedRequest(tickets), system.env, secrets)).status, 200);
      const value = await variables(await routeRequest(signedRequest("/init", initialization()), system.env, secrets));
      const presented = JSON.parse(value.tickets_json) as Record<string, unknown>[];
      assert.equal(value.tickets_count, 3);
      assert.deepEqual(presented.map((ticket) => ticket.subject), ["newest", "second", "third"]);
      assert.ok(presented.every((ticket) => !("description" in ticket) && !("operation_id" in ticket)));
      assert.match(value.greeting_text, /3 recent or open tickets/);
      assert.equal((await [...system.actors.values()][0].listTickets()).length, 5);
      const oldOnly = new System();
      await routeRequest(seedRequest([fixture("old-open", 60), fixture("old-resolved", 60, "resolved")]), oldOnly.env, secrets);
      assert.equal((await variables(await routeRequest(signedRequest("/init", initialization()), oldOnly.env, secrets))).tickets_count, 1);
    });

    await t.test("dependency failures produce generic initialization, never empty-record claims", async () => {
      for (const failure of ["kv", "actor", "missing-config", "invalid-config"]) {
        const system = new System();
        system.kvFails = failure === "kv";
        system.actorFails = failure === "actor";
        if (failure === "missing-config") system.config = null;
        if (failure === "invalid-config") system.config = { technician_available: "false" };
        const value = await variables(await routeRequest(signedRequest("/init", initialization()), system.env, secrets));
        assert.equal(value.init_ok, false);
        assert.equal(value.can_create_ticket, false);
        assert.equal(value.technician_available, false);
        assert.equal(value.operation_id, "");
        assert.doesNotMatch(value.greeting_text, /no tickets|0 tickets/i);
      }
    });

    await t.test("unusable identity has no anonymous actor and missing call context disables creation", async () => {
      for (const phone of [null, {}, "anonymous", "+00000000000"]) {
        const system = new System();
        const value = await variables(await routeRequest(signedRequest("/init", initialization(phone)), system.env, secrets));
        assert.equal(value.init_ok, false);
        assert.equal(value.can_create_ticket, false);
        assert.equal(system.actorKeys.length, 0);
      }
      const system = new System();
      const value = await variables(await routeRequest(signedRequest("/init", initialization(PHONE, null)), system.env, secrets));
      assert.equal(value.init_ok, true);
      assert.equal(value.can_create_ticket, false);
      assert.equal(value.operation_id, "");
      assert.equal((await routeRequest(signedRequest("/init", {}), system.env, secrets)).status, 400);
    });

    await t.test("creation and retry use the same caller actor and are retrieved at next initialization", async () => {
      const system = new System();
      const init = await variables(await routeRequest(signedRequest("/init", initialization()), system.env, secrets));
      const body = { ...creation(init.operation_id), caller_phone: "tel:+1 (202) 555-0123" };
      const created = await routeRequest(signedRequest("/tickets/create", body), system.env, secrets);
      assert.equal(created.status, 200);
      const result = await created.json();
      assert.equal(result.ticket_reference, "T-0001");
      const retry = await routeRequest(signedRequest("/tickets/create", body), system.env, secrets);
      assert.deepEqual(await retry.json(), result);
      const next = await variables(await routeRequest(signedRequest("/init", initialization(PHONE, "v3:next-call")), system.env, secrets));
      assert.equal(next.tickets_count, 1);
      assert.equal(JSON.parse(next.tickets_json)[0].id, result.ticket_id);
      assert.equal(new Set(system.actorKeys).size, 1);
    });

    await t.test("invalid creation fields reject before actor access", async () => {
      const system = new System();
      const inputs = [
        { ...creation(), ticket_subject: " " },
        { ...creation(), ticket_subject: "x".repeat(MAX_SUBJECT_LENGTH + 1) },
        { ...creation(), ticket_description: null },
        { ...creation(), ticket_description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) },
        { ...creation(), operation_id: "" },
      ];
      for (const body of inputs) {
        assert.equal((await routeRequest(signedRequest("/tickets/create", body), system.env, secrets)).status, 400);
      }
      assert.equal((await routeRequest(signedRequest("/tickets/create", { ...creation(), caller_phone: "anonymous" }), system.env, secrets)).status, 422);
      assert.equal((await routeRequest(signedRequest("/tickets/create", creation()), system.env, { ...secrets, caller_hmac_key: undefined })).status, 503);
      assert.equal(system.actorKeys.length, 0);
    });

    await t.test("actor failure or incomplete result cannot return creation success", async () => {
      const system = new System();
      system.actorFails = true;
      const failure = await routeRequest(signedRequest("/tickets/create", creation()), system.env, secrets);
      assert.equal(failure.status, 503);
      assert.deepEqual(await failure.json(), { error: "operation_failed" });
      system.actorFails = false;
      system.malformedResult = true;
      assert.equal((await routeRequest(signedRequest("/tickets/create", creation()), system.env, secrets)).status, 502);
    });

    await t.test("admin authentication, fixture replay, and batch validation protect existing records", async () => {
      const system = new System();
      assert.equal((await routeRequest(seedRequest([], "wrong-secret"), system.env, secrets)).status, 401);
      assert.equal(system.actorKeys.length, 0);
      const first = await routeRequest(seedRequest([fixture("fixture-1")]), system.env, secrets);
      assert.deepEqual(await first.json(), { added_count: 1 });
      const repeat = await routeRequest(seedRequest([fixture("fixture-1")]), system.env, secrets);
      assert.deepEqual(await repeat.json(), { added_count: 0 });
      const invalid = await routeRequest(seedRequest([fixture("fixture-2"), { ...fixture("bad"), status: "invalid" }]), system.env, secrets);
      assert.equal(invalid.status, 400);
      assert.equal((await [...system.actors.values()][0].listTickets()).length, 1);
      assert.equal((await routeRequest(seedRequest({}), system.env, secrets)).status, 400);
    });

    await t.test("configuration diagnostic preserves response shape and reads both flag values", async () => {
      const system = new System();
      const request = () => new Request("https://local.invalid/admin/check-config", { headers: { "x-admin-secret": secrets.admin_secret! } });
      assert.equal((await routeRequest(new Request(request().url), system.env, secrets)).status, 401);
      for (const flag of [false, true]) {
        system.config = { technician_available: flag };
        const response = await routeRequest(request(), system.env, secrets);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.kv.technician_available, flag);
        assert.equal(body.secrets.all_present, true);
        const init = await variables(await routeRequest(signedRequest("/init", initialization()), system.env, secrets));
        assert.equal(init.technician_available, flag);
      }
      system.kvFails = true;
      const response = await routeRequest(request(), system.env, secrets);
      assert.equal(response.status, 500);
      assert.equal((await response.json()).kv.technician_available, null);
    });

    await t.test("identity and operation HMACs are stable and separate calls and callers", async () => {
      const key = await computeCallerKey(PHONE, secrets.caller_hmac_key);
      assert.equal(key, await computeCallerKey("tel:+1 (202) 555-0123", secrets.caller_hmac_key));
      assert.notEqual(key, await computeCallerKey("+12025550124", secrets.caller_hmac_key));
      const operation = await computeTicketOperationId(key!, "same-call", secrets.caller_hmac_key);
      assert.notEqual(operation, await computeTicketOperationId("another-caller", "same-call", secrets.caller_hmac_key));
    });

    await t.test("KV diagnostic exposes only fixed categories and upstream status", async () => {
      const system = new System();
      system.kvFailure = new Error('env KV get("support/config") failed: HTTP 403: Bearer synthetic-private-upstream-token');
      const response = await routeRequest(new Request("https://local.invalid/admin/check-config", {
        headers: { "x-admin-secret": secrets.admin_secret! },
      }), system.env, secrets);
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.deepEqual(body.kv.error, { code: "permission", upstream_status: 403 });
      assert.ok(!JSON.stringify(body).includes("synthetic-private-upstream-token"));
    });

    await t.test("explicit Portal phone_call target shares web demo fixtures and event idempotence", async () => {
      const system = new System();
      const target = "synthetic-private-portal-target";
      system.config = { technician_available: false, web_demo_identity: "synthetic-private-web-demo",
        portal_demo_target_sha256: await computePortalTargetHash(target) };
      const seed = new Request("https://local.invalid/admin/seed", { method: "POST",
        headers: { "x-admin-secret": secrets.admin_secret! },
        body: JSON.stringify({ conversation_channel: "web_call", tickets: [fixture("portal-fixture")] }) });
      assert.equal((await routeRequest(seed, system.env, secrets)).status, 200);
      const event = initialization(target);
      const first = await variables(await routeRequest(signedRequest("/init", event), system.env, secrets));
      assert.equal(first.init_ok, true);
      assert.equal(first.tickets_count, 1);
      assert.equal(first.can_create_ticket, true);
      const create = { ...creation(first.operation_id), caller_phone: target };
      const created = await (await routeRequest(signedRequest("/tickets/create", create), system.env, secrets)).json();
      const repeated = await (await routeRequest(signedRequest("/tickets/create", create), system.env, secrets)).json();
      assert.deepEqual(repeated, created);
      const replay = await variables(await routeRequest(signedRequest("/init", event), system.env, secrets));
      assert.equal(replay.operation_id, first.operation_id);
      event.data.id = "another-private-portal-event";
      const next = await variables(await routeRequest(signedRequest("/init", event), system.env, secrets));
      assert.notEqual(next.operation_id, first.operation_id);
      assert.equal(next.tickets_count, 2);
      const web = await variables(await routeRequest(signedRequest("/init", webInitialization()), system.env, secrets));
      assert.equal(web.tickets_count, 2);
      assert.equal(new Set(system.actorKeys).size, 1);
      delete (event.data as { id?: string }).id;
      const missing = await variables(await routeRequest(signedRequest("/init", event), system.env, secrets));
      assert.equal(missing.init_ok, true);
      assert.equal(missing.can_create_ticket, false);
    });

    await t.test("Portal opt-in never replaces valid phones or accepts other anonymous targets", async () => {
      const system = new System();
      system.config = { technician_available: false, web_demo_identity: "synthetic-private-web-demo",
        portal_demo_target_sha256: await computePortalTargetHash(PHONE) };
      const phone = await variables(await routeRequest(signedRequest("/init", initialization()), system.env, secrets));
      assert.equal(phone.init_ok, true);
      assert.equal(system.actorKeys[0], await computeCallerKey(PHONE, secrets.caller_hmac_key));
      const count = system.actorKeys.length;
      const unknown = await variables(await routeRequest(signedRequest("/init", initialization("unknown-private-target")), system.env, secrets));
      assert.equal(unknown.init_ok, false);
      assert.equal(system.actorKeys.length, count);
      const unsigned = new Request("https://local.invalid/init", { method: "POST", body: JSON.stringify(initialization("synthetic-private-portal-target")) });
      assert.equal((await routeRequest(unsigned, system.env, secrets)).status, 401);
    });

    await t.test("web initialization, creation and fixtures share one configured demo actor", async () => {
      const system = new System();
      const webSeed = () => new Request("https://local.invalid/admin/seed", {
        method: "POST", headers: { "x-admin-secret": secrets.admin_secret! },
        body: JSON.stringify({ conversation_channel: "web_call", tickets: [fixture("web-fixture")],
          caller_phone: "+12025550124", web_demo_identity: "request-must-not-choose-identity" }),
      });
      assert.deepEqual(await (await routeRequest(webSeed(), system.env, secrets)).json(), { added_count: 1 });
      const first = await variables(await routeRequest(signedRequest("/init", webInitialization()), system.env, secrets));
      assert.equal(first.init_ok, true);
      assert.equal(first.can_create_ticket, true);
      assert.equal(first.tickets_count, 1);
      assert.match(first.operation_id, /^[a-f0-9]{64}$/);
      const create = { ...creation(first.operation_id), conversation_channel: "web_call",
        caller_phone: "not-a-phone", web_demo_identity: "another-request-identity" };
      const response = await routeRequest(signedRequest("/tickets/create", create), system.env, secrets);
      assert.equal(response.status, 200);
      const ticket = await response.json();
      assert.equal(ticket.ticket_reference, "T-0002");
      const replayInit = await variables(await routeRequest(signedRequest("/init", webInitialization()), system.env, secrets));
      assert.equal(replayInit.operation_id, first.operation_id);
      const replayCreate = await routeRequest(signedRequest("/tickets/create", create), system.env, secrets);
      assert.deepEqual(await replayCreate.json(), ticket);
      const next = webInitialization("synthetic-private-web-event-2");
      next.data.payload.telnyx_end_user_target = "different-portal-target";
      const nextVariables = await variables(await routeRequest(signedRequest("/init", next), system.env, secrets));
      assert.equal(nextVariables.tickets_count, 2);
      assert.notEqual(nextVariables.operation_id, first.operation_id);
      assert.equal(new Set(system.actorKeys).size, 1);
      const nextCreate = await routeRequest(signedRequest("/tickets/create", {
        ...creation(nextVariables.operation_id), conversation_channel: "web_call", caller_phone: undefined,
      }), system.env, secrets);
      assert.equal((await nextCreate.json()).ticket_reference, "T-0003");
      assert.deepEqual(await (await routeRequest(webSeed(), system.env, secrets)).json(), { added_count: 0 });
      const phone = await variables(await routeRequest(signedRequest("/init", initialization()), system.env, secrets));
      assert.equal(phone.tickets_count, 0);
      assert.equal(new Set(system.actorKeys).size, 2);
    });

    await t.test("missing web event ids disable creation while preserving ticket follow-up", async () => {
      const system = new System();
      const initial = await variables(await routeRequest(signedRequest("/init", webInitialization()), system.env, secrets));
      await routeRequest(signedRequest("/tickets/create", {
        ...creation(initial.operation_id), conversation_channel: "web_call", caller_phone: undefined,
      }), system.env, secrets);
      for (const id of [undefined, null, "", " ", 42]) {
        const event = webInitialization();
        event.data.id = id;
        const value = await variables(await routeRequest(signedRequest("/init", event), system.env, secrets));
        assert.equal(value.init_ok, true);
        assert.equal(value.tickets_count, 1);
        assert.equal(value.can_create_ticket, false);
        assert.equal(value.operation_id, "");
        assert.equal((await routeRequest(signedRequest("/tickets/create", {
          ...creation(value.operation_id), conversation_channel: "web_call",
        }), system.env, secrets)).status, 400);
      }
      assert.equal(new Set(system.actorKeys).size, 1);
    });

    await t.test("missing demo configuration, unsupported channels and unsigned web requests fail closed", async () => {
      for (const config of [
        { technician_available: false },
        { technician_available: false, web_demo_identity: " " },
        { technician_available: false, web_demo_identity: 42 },
      ]) {
        const system = new System();
        system.config = config;
        const value = await variables(await routeRequest(signedRequest("/init", webInitialization()), system.env, secrets));
        assert.equal(value.init_ok, false);
        assert.equal(value.can_create_ticket, false);
        const request = { ...creation(), conversation_channel: "web_call" };
        assert.equal((await routeRequest(signedRequest("/tickets/create", request), system.env, secrets)).status, 503);
        const seed = new Request("https://local.invalid/admin/seed", { method: "POST",
          headers: { "x-admin-secret": secrets.admin_secret! },
          body: JSON.stringify({ conversation_channel: "web_call", tickets: [] }) });
        assert.equal((await routeRequest(seed, system.env, secrets)).status, 503);
        assert.equal(system.actorKeys.length, 0);
      }
      const system = new System();
      for (const channel of ["websocket_call", "sms_chat", "unknown", undefined]) {
        assert.equal((await routeRequest(signedRequest("/tickets/create", {
          ...creation(), conversation_channel: channel,
        }), system.env, secrets)).status, 400);
      }
      const unsigned = new Request("https://local.invalid/init", { method: "POST", body: JSON.stringify(webInitialization()) });
      assert.equal((await routeRequest(unsigned, system.env, secrets)).status, 401);
      assert.equal(system.actorKeys.length, 0);
    });

    await t.test("configuration preparation preserves flags and demo identity across repeated deployments", async () => {
      const first = prepareSupportConfig(undefined);
      assert.equal(first.changed, true);
      assert.equal(first.value.web_demo_identity, "portal-demo");
      assert.equal(first.value.technician_available, false);
      const original = { technician_available: true, web_demo_identity: "explicit-stable-demo",
        portal_demo_target_sha256: null, extra: "private-setting" };
      const second = prepareSupportConfig(original);
      const third = prepareSupportConfig(second.value);
      assert.equal(second.changed, false);
      assert.equal(third.changed, false);
      assert.deepEqual(third.value, original);
      const legacy = prepareSupportConfig({ technician_available: true, extra: "private-setting" });
      assert.equal(legacy.changed, true);
      assert.equal(legacy.value.technician_available, true);
      assert.equal(legacy.value.extra, "private-setting");
      assert.equal(prepareSupportConfig(legacy.value).changed, false);
      assert.throws(() => prepareSupportConfig({ technician_available: true, web_demo_identity: "" }));
      assert.throws(() => prepareSupportConfig({ technician_available: "false" }));
      assert.throws(() => prepareSupportConfig({ technician_available: true, portal_demo_target_sha256: "invalid" }));
    });

    await t.test("fixture script validates local config and handles sanitized HTTP rejection offline", async () => {
      const config = { base_url: "https://local.invalid", conversation_channel: "phone_call", caller_phone: PHONE, tickets: [fixture("cli-fixture")] };
      const send: typeof fetch = async (url, options) => {
        assert.equal(String(url), "https://local.invalid/admin/seed");
        assert.equal(new Headers(options?.headers).get("x-admin-secret"), secrets.admin_secret);
        assert.equal(JSON.parse(String(options?.body)).caller_phone, PHONE);
        assert.equal(options?.redirect, "error");
        return Response.json({ added_count: 1 });
      };
      assert.equal(await submitDemoFixtures(config, secrets.admin_secret!, send), 1);
      await assert.rejects(submitDemoFixtures({ ...config, base_url: "http://local.invalid" }, secrets.admin_secret!, send));
      await assert.rejects(submitDemoFixtures({ ...config, caller_phone: "anonymous" }, secrets.admin_secret!, send));
      await assert.rejects(submitDemoFixtures(config, secrets.admin_secret!, async () =>
        new Response("sensitive-response-marker", { status: 403 })), { status: 403, code: "seed_request_failed" });
      await assert.rejects(submitDemoFixtures(config, secrets.admin_secret!, async () => Response.json({ added_count: "1" })));
      const webConfig = { ...config, conversation_channel: "web_call", caller_phone: undefined };
      assert.equal(await submitDemoFixtures(webConfig, secrets.admin_secret!, async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        assert.equal(body.conversation_channel, "web_call");
        assert.ok(!Object.hasOwn(body, "caller_phone"));
        assert.ok(!Object.hasOwn(body, "web_demo_identity"));
        return Response.json({ added_count: 1 });
      }), 1);
    });

    await t.test("application logs contain reconstructable events without sensitive values", async () => {
      assert.ok(logs.length > 0);
      const output = logs.join("\n");
      for (const marker of [PHONE, "tel:+1 (202) 555-0123", "synthetic-private-subject-marker",
        "synthetic-private-description-marker", "sensitive-storage-error-marker", "sensitive-actor-error-marker",
        "sensitive-kv-error-marker", "synthetic-private-web-demo", "synthetic-private-web-event-1",
        "synthetic-private-portal-target", "another-private-portal-event", "synthetic-private-upstream-token",
        "synthetic-private-web-event-2", secrets.admin_secret!, secrets.caller_hmac_key!, secrets.public_key!]) {
        assert.ok(!output.includes(marker));
      }
      const events = logs.map((line) => JSON.parse(line));
      assert.ok(events.every((event) => typeof event.request_id === "string" && event.stage && event.operation &&
        event.outcome && typeof event.duration_ms === "number"));
      assert.ok(events.some((event) => event.operation === "kv_read" && event.outcome === "error"));
      assert.ok(events.some((event) => event.operation === "actor_create_ticket" && event.outcome === "ok"));
      assert.ok(events.some((event) => event.operation === "initialize" && event.outcome === "error"));
    });
  } finally {
    console.log = originalLog;
  }
});
