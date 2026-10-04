// Sequential offline phone-routing checks using the real public XML handler
// and a synthetic account. No .env, account mutation, deployment or phone call.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPhoneRoutingConfig } from "../config/telephony";
import { assistantStartupId, VOICE_TEXML_KEY } from "../src/voice-texml";
import { routeRequest } from "../src/index";
import { syncPhoneRouting } from "./lib/phone-routing";
import { TelnyxApiError, type ApiMethod, type TelnyxApi } from "./lib/telnyx-api";
import { validateDeploymentState, type DeploymentState, type DeploymentStateStore } from "./lib/deployment-state";

// Fictional caller/destination data; account credentials never enter this suite.
const CONFIG = { ...buildPhoneRoutingConfig("https://local.invalid", "telnyx-fde"), phone_number: "+12025550123" };
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<Response><Connect><AIAssistant id="assistant-test"></AIAssistant></Connect></Response>';

// Detached snapshots model durable checkpoints, including unrelated metadata.
class Store implements DeploymentStateStore {
  state: DeploymentState = { func_name: "telnyx-fde", assistant_id: "assistant-test", kv_namespace_id: "kv-test",
    assistant_default_texml_app_id: "automatic-app", untouched: true };
  async load(): Promise<DeploymentState> { return structuredClone(this.state); }
  async save(state: DeploymentState): Promise<void> { this.state = structuredClone(state); }
}

// Registry emulates documented wrappers/JSON string TeXML and empty KV PUT.
// The one existing profile is shared; the automatic Portal app is preserved.
class Account implements TelnyxApi {
  readonly store = new Store();
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  readonly kv = new Map<string, unknown>([["support/config", { technician_available: false, web_demo_identity: "stable-demo" }]]);
  readonly profiles = new Map<string, Record<string, unknown>>([["default-profile", { id: "default-profile", name: "Default",
    enabled: true, traffic_type: "conversational", service_plan: "global", whitelisted_destinations: ["US", "CA"],
    concurrent_call_limit: 2, daily_spend_limit: "10.00", daily_spend_limit_enabled: true,
    max_destination_rate: 0.5, tags: ["existing-tag"], billing_group_id: "existing-billing-group",
    call_recording: { call_recording_type: "none" }, calling_window: null }]]);
  readonly apps = new Map<string, Record<string, unknown>>([["automatic-app", { id: "automatic-app", friendly_name: "ai-assistant-test",
    active: true, voice_url: "https://api.telnyx.com/assistant", voice_method: "get", outbound: { outbound_voice_profile_id: "default-profile" } }]]);
  number = { id: "phone-test", phone_number: CONFIG.phone_number, status: "active", connection_id: "", call_forwarding_enabled: false };
  missingNumber = false;
  deniedPath?: string;
  lostCreation?: string;
  lostAssignment = false;
  lostProfileUpdate = false;
  rejectedProfileUpdate = false;
  resetProfilePolicy = false;
  lostXmlWrite = false;
  rejectedAssignment = false;
  wrongReadback = false;
  xml: unknown = XML;
  probeStatus = 200;
  forwarding = false;

  // Only account provisioning endpoints are accepted. Unexpected calls fail.
  async request(method: ApiMethod, path: string, body?: unknown, key?: string): Promise<unknown> {
    this.calls.push({ method, path, body: structuredClone(body) });
    if (path === this.deniedPath) throw new TelnyxApiError("api_request_rejected", method, path, 403);
    const root = path.split("?")[0];
    const params = new URLSearchParams(path.split("?")[1]);
    if (method === "GET" && path.includes("?")) {
      const all = root === "/phone_numbers" ? (this.missingNumber ? [] : [this.number]) :
        root === "/texml_applications" ? [...this.apps.values()] : root === "/outbound_voice_profiles" ? [...this.profiles.values()] : undefined;
      assert.ok(all);
      // Each list spans two pages when there are two resources.
      const page = Number(params.get("page[number]"));
      return { data: structuredClone(all.slice(page - 1, page)), meta: { total_pages: Math.ceil(all.length),
        total_results: all.length, page_number: page, page_size: 1 } };
    }
    if (root === "/ai/assistants/assistant-test/texml") { assert.equal(method, "GET"); return this.xml; }
    if (root.startsWith("/storage/kvs/kv-test/keys/")) {
      assert.equal(method, "GET");
      const k = decodeURIComponent(root.split("/keys/")[1]);
      if (!this.kv.has(k)) throw new TelnyxApiError("api_request_rejected", method, path, 404);
      return structuredClone(this.kv.get(k));
    }
    if (root === "/phone_numbers/phone-test/voice") {
      assert.equal(method, "GET");
      return { data: { id: this.number.id, phone_number: this.number.phone_number, connection_id: this.number.connection_id,
        tech_prefix_enabled: false, translated_number: "", inbound_call_screening: "disabled",
        call_forwarding: { call_forwarding_enabled: this.forwarding } } };
    }
    if (root === "/phone_numbers/phone-test") {
      if (method === "PATCH") {
        assert.deepEqual(body, { connection_id: this.store.state.texml_application_id });
        if (this.rejectedAssignment) throw new TelnyxApiError("api_request_rejected", method, path, 422);
        this.number.connection_id = (body as { connection_id: string }).connection_id;
        if (this.lostAssignment) { this.lostAssignment = false; throw new TelnyxApiError("network_result_unknown", method, path); }
      } else assert.equal(method, "GET");
      return { data: { ...this.number, ...(this.wrongReadback && this.number.connection_id ? { connection_id: "wrong-app" } : {}) } };
    }
    const app = root.startsWith("/texml_applications");
    assert.ok(app || root.startsWith("/outbound_voice_profiles"));
    const map = app ? this.apps : this.profiles;
    const collection = app ? "/texml_applications" : "/outbound_voice_profiles";
    if (method === "GET") {
      const value = map.get(root.slice(collection.length + 1));
      if (!value) throw new TelnyxApiError("api_request_rejected", method, path, 404);
      return { data: structuredClone(value) };
    }
    let id: string;
    if (method === "POST") {
      assert.equal(root, collection);
      // Reproduce the real one-profile account limit in every routing test.
      if (!app) throw new TelnyxApiError("api_request_rejected", method, path, 403);
      assert.equal(key, this.store.state.texml_application_pending?.idempotency_key);
      id = "owned-app";
    } else {
      assert.equal(method, "PATCH");
      id = root.slice(collection.length + 1);
      assert.ok(map.has(id));
    }
    if (!app) {
      const fields = body as Record<string, unknown>;
      assert.deepEqual(Object.keys(fields).sort(), ["name", "whitelisted_destinations"]);
      assert.equal(fields.name, map.get(id)!.name);
      if (this.rejectedProfileUpdate) throw new TelnyxApiError("api_request_rejected", method, path, 403);
    }
    const value: Record<string, unknown> = { ...map.get(id), ...structuredClone(body as object), id };
    if (!app && this.resetProfilePolicy) value.daily_spend_limit = "0.00";
    map.set(id, value);
    if (!app && this.lostProfileUpdate) {
      this.lostProfileUpdate = false; throw new TelnyxApiError("network_result_unknown", method, path);
    }
    if (method === "POST" && this.lostCreation === collection) {
      this.lostCreation = undefined; throw new TelnyxApiError("network_result_unknown", method, path);
    }
    return { data: structuredClone(value) };
  }

  // Raw transport is reserved for one XML-string KV write with no response body.
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    this.calls.push({ method: init.method ?? "GET", path });
    assert.equal(init.method, "PUT"); assert.ok(path.endsWith(encodeURIComponent(VOICE_TEXML_KEY)));
    this.kv.set(VOICE_TEXML_KEY, JSON.parse(String(init.body)));
    if (this.lostXmlWrite) { this.lostXmlWrite = false; throw new TelnyxApiError("network_result_unknown", "PUT", path); }
    return new Response(null, { status: 204 });
  }

  // Real handler with the same stored value proves storage/serving compatibility.
  readonly probe: typeof fetch = async (input, init) => {
    if (this.probeStatus !== 200) return new Response("Synthetic failure", { status: this.probeStatus });
    const env = { SUPPORT_CONFIG: { get: async (key: string) => structuredClone(this.kv.get(key)) } } as unknown as Env;
    return routeRequest(new Request(String(input), init), env, {});
  };
}

// Keep fixed-code failure assertions independent of server or user messages.
async function rejects(account: Account, code: string): Promise<void> {
  await assert.rejects(() => syncPhoneRouting(account, account.store, CONFIG, account.probe),
    (e: unknown) => e instanceof TelnyxApiError && e.code === code);
}

test("phone routing reconciles resources sequentially and preserves Portal configuration", async (t) => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (line: unknown) => { logs.push(String(line)); };
  try {
    await t.test("two runs retain ids and the second performs GET only", async () => {
      const a = new Account();
      const defaultApp = structuredClone(a.apps.get("automatic-app"));
      const defaultProfile = structuredClone(a.profiles.get("default-profile"));
      const config = structuredClone(a.kv.get("support/config"));
      const first = await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(first.application_action, "created"); assert.equal(first.outbound_profile_action, "updated");
      assert.equal(first.outbound_profile_id, "default-profile");
      const count = a.calls.length;
      const second = await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(second.application_id, first.application_id); assert.equal(second.outbound_profile_id, first.outbound_profile_id);
      assert.equal(second.number_action, "reused"); assert.equal(second.texml_action, "reused");
      assert.ok(a.calls.slice(count).every(c => c.method === "GET"));
      assert.equal(a.apps.size, 2); assert.equal(a.profiles.size, 1);
      assert.deepEqual(a.apps.get("automatic-app"), defaultApp);
      assert.deepEqual(a.profiles.get("default-profile"), { ...defaultProfile, whitelisted_destinations: ["US", "CA", "FR"] });
      assert.equal((a.apps.get("owned-app")!.outbound as { outbound_voice_profile_id: string }).outbound_voice_profile_id, "default-profile");
      assert.ok(!a.calls.some(c => c.method === "POST" && c.path === "/outbound_voice_profiles"));
      assert.deepEqual(a.kv.get("support/config"), config); assert.equal(a.store.state.untouched, true);
      assert.ok(!JSON.stringify(a.store.state).includes(CONFIG.phone_number));
    });
    await t.test("updates owned configuration by PATCH without new resources", async () => {
      const a = new Account(); await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      a.profiles.get("default-profile")!.whitelisted_destinations = ["US", "CA", "GB"];
      a.apps.get("owned-app")!.voice_url = "https://old.invalid/voice";
      a.apps.get("owned-app")!.voice_fallback_url = "https://old.invalid/fallback";
      const count = a.calls.length;
      const r = await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(r.application_action, "updated"); assert.equal(r.outbound_profile_action, "updated");
      assert.ok(!a.calls.slice(count).some(c => c.method === "POST"));
      assert.deepEqual(a.profiles.get("default-profile")!.whitelisted_destinations, ["US", "CA", "GB", "FR"]);
    });
    for (const collection of ["/texml_applications"]) {
      await t.test("recovers lost creation response for " + collection, async () => {
        const a = new Account(); a.lostCreation = collection;
        await syncPhoneRouting(a, a.store, CONFIG, a.probe);
        assert.equal(a.calls.filter(c => c.method === "POST" && c.path === collection).length, 1);
        await syncPhoneRouting(a, a.store, CONFIG, a.probe);
        assert.equal(a.calls.filter(c => c.method === "POST" && c.path === collection).length, 1);
      });
    }
    await t.test("lost existing-profile PATCH response is reconciled without another write", async () => {
      const a = new Account(); a.lostProfileUpdate = true;
      const r = await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(r.outbound_profile_id, "default-profile"); assert.equal(a.profiles.size, 1);
      assert.equal(a.calls.filter(c => c.method === "PATCH" && c.path === "/outbound_voice_profiles/default-profile").length, 1);
    });
    await t.test("old rejected creation checkpoint is retired only after successful reuse", async () => {
      const a = new Account();
      a.store.state.outbound_voice_profile_pending = { idempotency_key: "11111111-1111-4111-8111-111111111111",
        request_hash: "0".repeat(64), started_at: new Date().toISOString() };
      await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(a.store.state.outbound_voice_profile_pending, undefined);
      assert.equal(a.store.state.outbound_voice_profile_id, "default-profile"); assert.equal(a.profiles.size, 1);
    });
    await t.test("missing, disabled and conflicting profiles never trigger creation", async () => {
      for (const code of ["existing_outbound_profile_missing", "existing_outbound_profile_disabled", "stored_outbound_voice_profile_conflict"]) {
        const a = new Account();
        if (code === "existing_outbound_profile_missing") a.profiles.clear();
        if (code === "existing_outbound_profile_disabled") a.profiles.get("default-profile")!.enabled = false;
        if (code === "stored_outbound_voice_profile_conflict") a.store.state.outbound_voice_profile_id = "wrong-profile";
        await rejects(a, code);
        assert.ok(!a.calls.some(c => ["POST", "PATCH"].includes(c.method)));
      }
    });
    await t.test("denied profile reads and updates stop without modifying the Portal app", async () => {
      for (const denied of ["/outbound_voice_profiles?page%5Bsize%5D=100&page%5Bnumber%5D=1", "/outbound_voice_profiles/default-profile"]) {
        const a = new Account(); a.deniedPath = denied;
        await assert.rejects(() => syncPhoneRouting(a, a.store, CONFIG, a.probe));
        assert.ok(!a.calls.some(c => ["POST", "PATCH"].includes(c.method)));
      }
      const a = new Account(); a.rejectedProfileUpdate = true;
      const app = structuredClone(a.apps.get("automatic-app"));
      await assert.rejects(() => syncPhoneRouting(a, a.store, CONFIG, a.probe), (e: unknown) => e instanceof TelnyxApiError && e.http_status === 403);
      assert.deepEqual(a.apps.get("automatic-app"), app); assert.equal(a.profiles.size, 1); assert.equal(a.number.connection_id, "");
    });
    await t.test("unexpected profile-policy changes fail read-back verification", async () => {
      const a = new Account(); a.resetProfilePolicy = true;
      await rejects(a, "outbound_profile_readback_mismatch"); assert.equal(a.number.connection_id, "");
    });
    await t.test("an actually created legacy project profile is not silently orphaned", async () => {
      const a = new Account();
      a.profiles.set("legacy-profile", { ...a.profiles.get("default-profile"), id: "legacy-profile", name: "telnyx-fde-outbound" });
      await rejects(a, "legacy_project_outbound_profile_conflict");
      assert.ok(!a.calls.some(c => ["POST", "PATCH"].includes(c.method)));
    });
    await t.test("reconciles lost XML and number assignment responses by read-back", async () => {
      const a = new Account(); a.lostXmlWrite = true; a.lostAssignment = true;
      await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(a.calls.filter(c => c.method === "PUT").length, 1);
      assert.equal(a.calls.filter(c => c.method === "PATCH" && c.path === "/phone_numbers/phone-test").length, 1);
    });
    await t.test("partial failure saves resources and resumes without duplicates", async () => {
      const a = new Account(); a.rejectedAssignment = true;
      await assert.rejects(() => syncPhoneRouting(a, a.store, CONFIG, a.probe), (e: unknown) => e instanceof TelnyxApiError && e.http_status === 422);
      assert.equal(a.store.state.texml_application_id, "owned-app");
      a.rejectedAssignment = false; await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(a.apps.size, 2); assert.equal(a.profiles.size, 1);
    });
    await t.test("missing, conflicting and inactive numbers stop before writes", async () => {
      for (const code of ["purchased_phone_number_missing", "stored_phone_number_conflict", "phone_number_not_ready"]) {
        const a = new Account();
        if (code === "purchased_phone_number_missing") a.missingNumber = true;
        if (code === "stored_phone_number_conflict") a.store.state.phone_number_id = "another-number";
        if (code === "phone_number_not_ready") a.number.status = "pending";
        await rejects(a, code); assert.ok(a.calls.every(c => c.method === "GET"));
      }
    });
    await t.test("an unrelated number application is not overwritten", async () => {
      const a = new Account(); a.number.connection_id = "other-app";
      a.apps.set("other-app", { id: "other-app", friendly_name: "another-project" });
      await rejects(a, "phone_connection_conflict"); assert.ok(a.calls.every(c => c.method === "GET"));
    });
    await t.test("saved application ids still require project ownership", async () => {
      for (const field of ["texml_application_id", "assistant_default_texml_app_id"] as const) {
        const a = new Account(); a.store.state[field] = "foreign-app"; a.number.connection_id = "foreign-app";
        a.apps.set("foreign-app", { id: "foreign-app", friendly_name: "another-project" });
        await rejects(a, "phone_connection_conflict"); assert.ok(a.calls.every(c => c.method === "GET"));
      }
      const a = new Account(); a.number.connection_id = "automatic-app";
      await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      assert.equal(a.number.connection_id, "owned-app"); assert.equal(a.apps.get("automatic-app")!.voice_method, "get");
    });
    await t.test("voice redirection and denied reads are never treated as absence", async () => {
      const a = new Account(); a.forwarding = true;
      await rejects(a, "phone_voice_configuration_conflict"); assert.ok(a.calls.every(c => c.method === "GET"));
      const b = new Account(); b.deniedPath = "/phone_numbers?page%5Bsize%5D=100&page%5Bnumber%5D=1";
      await assert.rejects(() => syncPhoneRouting(b, b.store, CONFIG, b.probe)); assert.ok(b.calls.every(c => c.method === "GET"));
    });
    await t.test("duplicate owned applications stop without choosing an arbitrary id", async () => {
      const a = new Account(); await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      a.apps.set("duplicate-app", { ...a.apps.get("owned-app"), id: "duplicate-app" });
      await rejects(a, "duplicate_texml_application_matches");
    });
    await t.test("duplicate outbound profiles never trigger another creation", async () => {
      const a = new Account(); await syncPhoneRouting(a, a.store, CONFIG, a.probe);
      a.profiles.set("duplicate-profile", { ...a.profiles.get("default-profile"), id: "duplicate-profile" });
      const count = a.calls.length;
      await rejects(a, "duplicate_outbound_voice_profile_matches");
      assert.ok(a.calls.slice(count).every(c => c.method === "GET"));
    });
    await t.test("wrong XML assistant or broken entry route prevents assignment", async () => {
      const a = new Account(); a.xml = XML.replace("assistant-test", "assistant-other");
      await rejects(a, "assistant_texml_mismatch"); assert.ok(a.calls.every(c => c.method === "GET"));
      const b = new Account(); b.probeStatus = 503;
      await rejects(b, "voice_entry_probe_mismatch"); assert.equal(b.number.connection_id, ""); assert.equal(b.apps.size, 1);
    });
    await t.test("assignment read-back mismatch is not announced as success", async () => {
      const a = new Account(); a.wrongReadback = true; await rejects(a, "phone_assignment_readback_mismatch");
    });
    await t.test("logs and deployment state contain no synthetic phone or XML document", async () => {
      assert.ok(logs.length); assert.ok(!logs.join("\n").includes(CONFIG.phone_number)); assert.ok(!logs.join("\n").includes(XML));
      assert.throws(() => validateDeploymentState({ texml_application_pending: {} }));
      assert.throws(() => validateDeploymentState({ phone_number_id: 123 }));
    });
  } finally { console.log = original; }
});

test("public voice entry serves only stored startup XML and ignores caller fields", async () => {
  const output: string[] = [];
  const original = console.log; console.log = (line: unknown) => { output.push(String(line)); };
  try {
    const keys: string[] = [];
    const env = { SUPPORT_CONFIG: { get: async (key: string) => { keys.push(key); return XML; } },
      CALLER_TICKETS: { idFromName: () => { throw new Error("Actor must not be accessed"); } } } as unknown as Env;
    const response = await routeRequest(new Request("https://local.invalid/voice-entry", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "From=%2B12025550123&To=%2B12025550124" }), env, {});
    assert.equal(response.status, 200); assert.equal(await response.text(), XML);
    assert.match(response.headers.get("Content-Type")!, /^application\/xml/); assert.deepEqual(keys, [VOICE_TEXML_KEY]);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await routeRequest(new Request("https://local.invalid/voice-entry"), env, {})).status, 405);
    for (const value of [undefined, {}, "<Response><Dial>+12025550123</Dial></Response>", XML.replace("</Connect>", "")]) {
      const badEnv = { SUPPORT_CONFIG: { get: async () => value } } as unknown as Env;
      assert.equal((await routeRequest(new Request("https://local.invalid/voice-entry", { method: "POST" }), badEnv, {})).status, 503);
    }
    const failingEnv = { SUPPORT_CONFIG: { get: async () => { throw new Error('KV get failed: HTTP 401: private-token'); } } } as unknown as Env;
    assert.equal((await routeRequest(new Request("https://local.invalid/voice-entry", { method: "POST" }), failingEnv, {})).status, 503);
    assert.equal(assistantStartupId(XML), "assistant-test");
    assert.equal(assistantStartupId(XML.replace('<AIAssistant id="assistant-test"></AIAssistant>', '<AIAssistant id="assistant-test"/>')), "assistant-test");
    assert.equal(assistantStartupId('<!DOCTYPE Response>' + XML), null);
    assert.ok(!output.join("\n").includes("private-token")); assert.ok(!output.join("\n").includes("+12025550123"));
  } finally { console.log = original; }
});
