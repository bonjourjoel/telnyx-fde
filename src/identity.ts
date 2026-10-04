// Resolve the same actor key for initialization, creation, and demo fixtures.
// Phone identities preserve the existing HMAC scheme. Portal identities always
// come from backend KV configuration, never request parameters or model choices.

import type { SupportIdentityRequest } from "./contracts";
import { computeCallerKey, computeWebDemoKey, computePortalTargetHash } from "./security";
import { readSupportConfig, type SupportConfig } from "./support-config";

// Initialization uses the identity kind to select phone/event deduplication.
export interface ResolvedSupportIdentity { actor_key: string; kind: "phone" | "demo" }

// Valid phone numbers always retain the original caller HMAC. Non-phone targets
// use the demo only when their exact fingerprint is configured on the backend.
// Missing configuration fails explicitly; unmatched identities never share state.
export async function resolveSupportIdentity(
  input: SupportIdentityRequest, env: Pick<Env, "SUPPORT_CONFIG">,
  hmacSecret: string | undefined, configuration?: SupportConfig | Promise<SupportConfig>,
): Promise<ResolvedSupportIdentity | null> {
  if (!hmacSecret) {
    const error = new Error("identity secret is missing");
    error.name = "ConfigError";
    throw error;
  }
  if (input.conversation_channel === "phone_call") {
    const key = await computeCallerKey(input.caller_phone, hmacSecret);
    if (key) return { actor_key: key, kind: "phone" };
    if (!input.caller_phone.trim()) return null;
  }
  const config = await (configuration ?? readSupportConfig(env));
  if (input.conversation_channel === "phone_call" && (!config.portal_demo_target_sha256 ||
    await computePortalTargetHash(input.caller_phone) !== config.portal_demo_target_sha256)) return null;
  if (!config.web_demo_identity) {
    const error = new Error("web demo identity is not configured");
    error.name = "ConfigError";
    throw error;
  }
  return { actor_key: await computeWebDemoKey(config.web_demo_identity, hmacSecret), kind: "demo" };
}

// Creation and fixtures share precisely the same resolution as initialization.
export async function resolveSupportActorKey(
  input: SupportIdentityRequest, env: Pick<Env, "SUPPORT_CONFIG">,
  hmacSecret: string | undefined, configuration?: SupportConfig | Promise<SupportConfig>,
): Promise<string | null> {
  return (await resolveSupportIdentity(input, env, hmacSecret, configuration))?.actor_key ?? null;
}
