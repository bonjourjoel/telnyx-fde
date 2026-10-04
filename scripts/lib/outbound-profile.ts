// Reuse the existing outbound profile referenced by the assistant's automatic
// TeXML application. Add required countries without creating or renaming a
// profile, changing other policies, or modifying the Portal application.

import * as z from "zod/v4";
import { listMatches, matchesDesired, type ResourceApi } from "./resource-upsert";
import { validateDeploymentState, type DeploymentStateStore } from "./deployment-state";
import { TelnyxApiError } from "./telnyx-api";

// Retain policy fields for read-back comparison only; never resend a GET body.
const ProfileSchema = z.object({ id: z.string().min(1), name: z.string().min(1), enabled: z.boolean(),
  whitelisted_destinations: z.array(z.string().regex(/^[A-Z]{2}$/)) }).passthrough();
type Profile = z.infer<typeof ProfileSchema>;

// Resolve the profile through this project's known automatic application.
const ApplicationSchema = z.object({ id: z.string().min(1), friendly_name: z.string(),
  outbound: z.object({ outbound_voice_profile_id: z.string().min(1) }) });

// Accept observed flat/data-wrapped responses; expose only a fixed failure code.
function parse<T>(schema: z.ZodType<T>, value: unknown, kind: string): T {
  const body = value !== null && typeof value === "object" && "data" in value ? value.data : value;
  const result = schema.safeParse(body);
  if (!result.success) throw new TelnyxApiError(`invalid_${kind}_resource`);
  return result.data;
}

// Check all existing policy fields except changing API metadata/country list.
function preservedPolicy(profile: Profile): Record<string, unknown> {
  const ignored = new Set(["id", "record_type", "connections_count", "created_at", "updated_at", "whitelisted_destinations"]);
  return Object.fromEntries(Object.entries(profile).filter(([key]) => !ignored.has(key)));
}

// There is deliberately no POST fallback. Missing/conflicting/disabled profiles
// stop deployment. A second run skips PATCH once all required countries exist.
export async function ensureExistingOutboundProfile(api: ResourceApi, store: DeploymentStateStore,
  requiredCountries: readonly string[]) {
  const state = validateDeploymentState(await store.load());
  if (!state.assistant_id || !state.assistant_default_texml_app_id || !state.func_name ||
    !requiredCountries.length || requiredCountries.some(country => !/^[A-Z]{2}$/.test(country))) {
    throw new TelnyxApiError("outbound_profile_context_missing");
  }
  const appPath = "/texml_applications/" + encodeURIComponent(state.assistant_default_texml_app_id);
  const app = parse(ApplicationSchema, await api.request("GET", appPath), "automatic_texml_application");
  if (app.id !== state.assistant_default_texml_app_id || app.friendly_name !== "ai-" + state.assistant_id) {
    throw new TelnyxApiError("automatic_texml_application_conflict");
  }
  const profiles = await listMatches(api, { kind: "outbound_voice_profile", collection: "/outbound_voice_profiles",
    parse: value => parse(ProfileSchema, value, "outbound_voice_profile"), id: profile => profile.id, matches: () => true });
  const id = app.outbound.outbound_voice_profile_id;
  const listed = profiles.find(profile => profile.id === id);
  if (!listed) throw new TelnyxApiError("existing_outbound_profile_missing");
  if (state.outbound_voice_profile_id !== undefined && state.outbound_voice_profile_id !== id) {
    throw new TelnyxApiError("stored_outbound_voice_profile_conflict");
  }
  // Detect an old project-owned creation before retiring its local checkpoint.
  // Never silently abandon an actually created resource from the earlier code.
  if (profiles.some(profile => profile.id !== id && profile.name === state.func_name + "-outbound")) {
    throw new TelnyxApiError("legacy_project_outbound_profile_conflict");
  }
  if (profiles.filter(profile => profile.name === listed.name).length !== 1) {
    throw new TelnyxApiError("duplicate_outbound_voice_profile_matches");
  }
  const path = "/outbound_voice_profiles/" + encodeURIComponent(id);
  const current = parse(ProfileSchema, await api.request("GET", path), "outbound_voice_profile");
  if (current.id !== id || current.name !== listed.name) throw new TelnyxApiError("outbound_profile_identity_conflict");
  if (!current.enabled) throw new TelnyxApiError("existing_outbound_profile_disabled");
  const countries = [...new Set([...current.whitelisted_destinations, ...requiredCountries])];
  const changed = requiredCountries.some(country => !current.whitelisted_destinations.includes(country));
  const policy = preservedPolicy(current);
  state.outbound_voice_profile_id = id;
  await store.save(state);
  if (changed) {
    try {
      // name is required by PATCH; keep its current value. No billing, limit,
      // recording, enabled, or service-plan fields are sent in this update.
      await api.request("PATCH", path, { name: current.name, whitelisted_destinations: countries });
    } catch (error) {
      // Reconcile a lost response by read-back; never issue another blind PATCH.
      if (!(error instanceof TelnyxApiError) || !["network_result_unknown", "invalid_api_response"].includes(error.code)) throw error;
    }
  }
  const verified = parse(ProfileSchema, await api.request("GET", path), "outbound_voice_profile");
  if (verified.id !== id || !countries.every(country => verified.whitelisted_destinations.includes(country)) ||
    !matchesDesired(verified, policy)) throw new TelnyxApiError("outbound_profile_readback_mismatch");
  const appAfter = parse(ApplicationSchema, await api.request("GET", appPath), "automatic_texml_application");
  if (appAfter.id !== app.id || appAfter.friendly_name !== app.friendly_name || appAfter.outbound.outbound_voice_profile_id !== id) {
    throw new TelnyxApiError("automatic_texml_application_changed");
  }
  // The failed POST from the old implementation created no profile. Clear its
  // checkpoint only after full inventory and successful existing-profile checks.
  delete state.outbound_voice_profile_pending;
  await store.save(state);
  return { resource: verified, action: changed ? "updated" as const : "reused" as const };
}
