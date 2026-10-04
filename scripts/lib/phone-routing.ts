// Idempotent phone entry deployment: existing purchased number, validated
// assistant TeXML in KV, shared existing profile and owned TeXML application.
// Uses shared API/state/upsert helpers; never starts a call or buys a number.

import * as z from "zod/v4";
import type { PhoneRoutingConfig } from "../../config/telephony";
import { assistantStartupId, VOICE_TEXML_KEY } from "../../src/voice-texml";
import { TelnyxApiError, type TelnyxApi } from "./telnyx-api";
import { validateDeploymentState, type DeploymentStateStore } from "./deployment-state";
import { listMatches, matchesDesired, upsertResource } from "./resource-upsert";
import { ensureExistingOutboundProfile } from "./outbound-profile";

// Parse routing fields only; discard unrelated personal number metadata.
const NumberSchema = z.object({ id: z.string().min(1), phone_number: z.string().min(1),
  status: z.string(), connection_id: z.string().nullable().optional(),
  call_forwarding_enabled: z.boolean().optional(), release_in_progress: z.boolean().optional() });
const ApplicationSchema = z.object({ id: z.string().min(1), friendly_name: z.string().min(1), active: z.boolean().optional(),
  voice_url: z.string().optional(), voice_method: z.string().optional(),
  outbound: z.object({ outbound_voice_profile_id: z.string().nullable().optional() }).optional(),
  voice_fallback_url: z.string().nullable().optional(), status_callback: z.string().nullable().optional() });
type PhoneNumber = z.infer<typeof NumberSchema>;

// Read flat resources and documented data wrappers without retaining inputs.
function resource<T>(schema: z.ZodType<T>, value: unknown, kind: string): T {
  const wrapped = value !== null && typeof value === "object" && "data" in value ? value.data : value;
  const parsed = schema.safeParse(wrapped);
  if (!parsed.success) throw new TelnyxApiError(`invalid_${kind}_resource`);
  return parsed.data;
}

// Fully list before selecting the exact constant. No number creation fallback.
async function existingPhone(api: TelnyxApi, store: DeploymentStateStore, config: PhoneRoutingConfig): Promise<PhoneNumber> {
  const state = validateDeploymentState(await store.load());
  const numbers = await listMatches(api, { kind: "phone_number", collection: "/phone_numbers",
    parse: (value) => resource(NumberSchema, value, "phone_number"), id: (n) => n.id,
    matches: (n) => n.phone_number === config.phone_number });
  if (numbers.length !== 1) throw new TelnyxApiError(numbers.length ? "duplicate_phone_number_matches" : "purchased_phone_number_missing");
  const n = resource(NumberSchema, await api.request("GET", "/phone_numbers/" + encodeURIComponent(numbers[0].id)), "phone_number");
  if (n.id !== numbers[0].id || n.phone_number !== config.phone_number ||
    (state.phone_number_id && state.phone_number_id !== n.id)) throw new TelnyxApiError("stored_phone_number_conflict");
  if (n.status !== "active" || n.release_in_progress || n.call_forwarding_enabled) throw new TelnyxApiError("phone_number_not_ready");
  // Read every assigned application's identity, including saved ids. A stale
  // state reference alone never grants ownership of another project's routing.
  if (n.connection_id) {
    const app = resource(ApplicationSchema, await api.request("GET", "/texml_applications/" + encodeURIComponent(n.connection_id)), "texml_application");
    const owned = app.friendly_name === config.application_name;
    const automatic = app.id === state.assistant_default_texml_app_id && app.friendly_name === "ai-" + state.assistant_id;
    if (app.id !== n.connection_id || (!owned && !automatic)) throw new TelnyxApiError("phone_connection_conflict");
  }
  state.phone_number_id = n.id;
  await store.save(state);
  return n;
}

// Confirm voice settings are readable and inbound calls are not redirected or
// rejected. Conflicting phone settings are reported rather than silently reset.
async function checkPhoneVoice(api: TelnyxApi, n: PhoneNumber): Promise<void> {
  const schema = z.object({ id: z.string(), phone_number: z.string(), tech_prefix_enabled: z.boolean(),
    translated_number: z.string().nullable().optional(), inbound_call_screening: z.string(),
    call_forwarding: z.object({ call_forwarding_enabled: z.boolean() }) });
  const v = resource(schema, await api.request("GET", "/phone_numbers/" + encodeURIComponent(n.id) + "/voice"), "phone_voice");
  if (v.id !== n.id || v.phone_number !== n.phone_number || v.tech_prefix_enabled || v.translated_number ||
    v.call_forwarding.call_forwarding_enabled || v.inbound_call_screening === "reject_calls") {
    throw new TelnyxApiError("phone_voice_configuration_conflict");
  }
}

// Fetch the documented JSON string and check its assistant before storing it.
// This separate key leaves support/config, caller identity and tickets intact.
async function syncStartupXml(api: TelnyxApi, assistantId: string, namespaceId: string) {
  const value = await api.request("GET", "/ai/assistants/" + encodeURIComponent(assistantId) + "/texml");
  if (assistantStartupId(value) !== assistantId) throw new TelnyxApiError("assistant_texml_mismatch");
  const xml = value as string;
  const path = "/storage/kvs/" + encodeURIComponent(namespaceId) + "/keys/" + encodeURIComponent(VOICE_TEXML_KEY);
  let existing: unknown;
  try { existing = await api.request("GET", path); }
  catch (error) { if (!(error instanceof TelnyxApiError) || error.http_status !== 404) throw error; }
  if (existing === xml) return { xml, action: "reused" };
  if (existing !== undefined && typeof existing !== "string") throw new TelnyxApiError("invalid_stored_voice_texml");
  try {
    // A successful KV write may have an empty body; do not parse it as JSON.
    const r = await api.fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(xml) });
    if (!r.ok) throw new TelnyxApiError("voice_texml_write_rejected", "PUT", path, r.status);
  } catch (error) {
    // Reconcile a lost PUT response without issuing another write.
    if (!(error instanceof TelnyxApiError) || error.code !== "network_result_unknown") throw error;
    if (await api.request("GET", path) !== xml) throw error;
  }
  if (await api.request("GET", path) !== xml) throw new TelnyxApiError("voice_texml_readback_mismatch");
  return { xml, action: existing === undefined ? "created" : "updated" };
}

// Probe the live instruction route before assigning the number. No call or
// caller initialization is triggered by fetching this public XML document.
async function checkEntryUrl(url: string, xml: string, send: typeof fetch): Promise<void> {
  let r: Response;
  try { r = await send(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000) }); }
  catch { throw new TelnyxApiError("voice_entry_probe_failed"); }
  if (!r.ok || !/^application\/xml\b/i.test(r.headers.get("Content-Type") ?? "") || await r.text() !== xml) {
    throw new TelnyxApiError("voice_entry_probe_mismatch", "POST", "/voice-entry", r.status);
  }
}

// Reuse the Portal's outbound profile, then upsert the phone application and
// PATCH only connection_id. Preserve the
// assistant's automatic application used by Portal tests and all Actor keys.
export async function syncPhoneRouting(api: TelnyxApi, store: DeploymentStateStore,
  config: PhoneRoutingConfig, send: typeof fetch = fetch) {
  const state = validateDeploymentState(await store.load());
  if (!state.assistant_id || !state.kv_namespace_id || !state.func_name ||
    config.application_name !== state.func_name + "-voice") {
    throw new TelnyxApiError("phone_routing_context_missing");
  }
  const number = await existingPhone(api, store, config);
  await checkPhoneVoice(api, number);
  const startup = await syncStartupXml(api, state.assistant_id, state.kv_namespace_id);
  await checkEntryUrl(config.voice_url, startup.xml, send);

  const profile = await ensureExistingOutboundProfile(api, store, config.required_outbound_countries);
  // Own URL/method/activation/profile. Clear obsolete alternate instruction
  // URLs on this project application; preserve unrelated optional settings.
  const desired = { friendly_name: config.application_name, active: true, voice_url: config.voice_url,
    voice_method: "post", outbound: { outbound_voice_profile_id: profile.resource.id } };
  const application = await upsertResource(api, store, {
    kind: "texml_application", collection: "/texml_applications", updateMethod: "PATCH", body: desired,
    updateBody: { ...desired, voice_fallback_url: null, status_callback: null },
    parse: (value) => resource(ApplicationSchema, value, "texml_application"), id: (a) => a.id,
    matches: (a) => a.friendly_name === config.application_name, owns: (a) => a.friendly_name === config.application_name,
    compliant: (a) => matchesDesired(a, desired) && !a.voice_fallback_url && !a.status_callback,
    storedId: (s) => s.texml_application_id, remember: (s, a) => { s.texml_application_id = a.id; },
    pending: (s) => s.texml_application_pending,
    checkpoint: (s, p) => { if (p) s.texml_application_pending = p; else delete s.texml_application_pending; },
  });
  const path = "/phone_numbers/" + encodeURIComponent(number.id);
  // Refresh before PATCH: stop if another application was assigned meanwhile.
  const before = resource(NumberSchema, await api.request("GET", path), "phone_number");
  if (before.id !== number.id || before.phone_number !== config.phone_number || before.status !== "active" ||
    before.release_in_progress || before.call_forwarding_enabled ||
    (before.connection_id !== number.connection_id && before.connection_id !== application.resource.id)) {
    throw new TelnyxApiError("phone_assignment_changed");
  }
  const assigned = before.connection_id === application.resource.id;
  if (!assigned) {
    try { await api.request("PATCH", path, { connection_id: application.resource.id }); }
    catch (error) {
      if (!(error instanceof TelnyxApiError) || !["network_result_unknown", "invalid_api_response"].includes(error.code)) throw error;
      const recovered = resource(NumberSchema, await api.request("GET", path), "phone_number");
      if (recovered.connection_id !== application.resource.id) throw error;
    }
  }
  const verified = resource(NumberSchema, await api.request("GET", path), "phone_number");
  if (verified.id !== number.id || verified.phone_number !== config.phone_number || verified.status !== "active" ||
    verified.connection_id !== application.resource.id) throw new TelnyxApiError("phone_assignment_readback_mismatch");
  await checkPhoneVoice(api, verified);
  return { phone_number_id: number.id, number_action: assigned ? "reused" : "updated", texml_action: startup.action,
    application_id: application.resource.id, application_action: application.action,
    outbound_profile_id: profile.resource.id, outbound_profile_action: profile.action };
}
