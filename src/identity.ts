// Resolve the same actor key for initialization, creation, and demo fixtures.
// Phone identities preserve the existing HMAC scheme. Portal identities always
// come from backend KV configuration, never request parameters or model choices.

import type { SupportIdentityRequest } from "./contracts";
import { computeCallerKey, computeWebDemoKey } from "./security";
import { readSupportConfig, type SupportConfig } from "./support-config";

// Return null only for an unusable phone. Missing backend configuration fails
// explicitly; callers must not fall back to a shared anonymous actor.
export async function resolveSupportActorKey(
  input: SupportIdentityRequest, env: Pick<Env, "SUPPORT_CONFIG">,
  hmacSecret: string | undefined, configuration?: SupportConfig,
): Promise<string | null> {
  if (!hmacSecret) {
    const error = new Error("identity secret is missing");
    error.name = "ConfigError";
    throw error;
  }
  if (input.conversation_channel === "phone_call") {
    return computeCallerKey(input.caller_phone, hmacSecret);
  }
  const config = configuration ?? await readSupportConfig(env);
  if (!config.web_demo_identity) {
    const error = new Error("web demo identity is not configured");
    error.name = "ConfigError";
    throw error;
  }
  return computeWebDemoKey(config.web_demo_identity, hmacSecret);
}
