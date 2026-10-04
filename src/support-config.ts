// Shared support configuration contract and KV reader used by initialization
// and deployment diagnostics. A missing or malformed flag is an error.

import { SupportConfigError, diagnoseKvError } from "./kv-errors";

// Stable key provisioned by the deployment script; never reset by a handler.
export const SUPPORT_CONFIG_KEY = "support/config";

// Explicit initial demo identity. Deployments fill only a missing field, never
// regenerate it. Changing a configured identity deliberately selects new state.
export const DEFAULT_WEB_DEMO_IDENTITY = "portal-demo";

// Exact non-phone Portal target observed in two conversation records.
// This is explicit project configuration, not a guaranteed Telnyx marker.
export const DEFAULT_PORTAL_DEMO_TARGET_SHA256 = "1eab918d377968e5a52df0765c346db6952cbecc3faacbe1a35c3619fbe543ed";

// Limit configuration labels without treating them as numbers or caller input.
const MAX_WEB_DEMO_IDENTITY_LENGTH = 128;

// Runtime-validated feature flag, rather than a truthy/falsy arbitrary value.
export interface SupportConfig {
  technician_available: boolean;
  // Optional for legacy/phone-only configuration. Required for every web actor
  // operation and never exposed as a model-editable dynamic variable.
  web_demo_identity?: string;
  // Optional exact-match opt-in for Portal tests recorded as phone_call.
  portal_demo_target_sha256?: string;
}

// Normalize an explicitly configured label; no random or anonymous fallback.
export function configuredWebDemoIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  return label.length > 0 && label.length <= MAX_WEB_DEMO_IDENTITY_LENGTH ? label : null;
}

// Prepare a KV value for provisioning. Preserve existing flags, identity, and
// unrelated settings; invalid existing configuration must not be silently reset.
export function prepareSupportConfig(existing: unknown): { value: Record<string, unknown>; changed: boolean } {
  if (existing === undefined) {
    return { value: { technician_available: false, web_demo_identity: DEFAULT_WEB_DEMO_IDENTITY,
      portal_demo_target_sha256: DEFAULT_PORTAL_DEMO_TARGET_SHA256 }, changed: true };
  }
  if (existing === null || typeof existing !== "object" || Array.isArray(existing) ||
    !("technician_available" in existing) || typeof existing.technician_available !== "boolean") {
    throw new Error("existing support configuration is invalid");
  }
  const value: Record<string, unknown> = { ...existing };
  let changed = false;
  if (Object.hasOwn(value, "web_demo_identity")) {
    if (!configuredWebDemoIdentity(value.web_demo_identity)) throw new Error("existing web demo identity is invalid");
  } else {
    value.web_demo_identity = DEFAULT_WEB_DEMO_IDENTITY;
    changed = true;
  }
  if (!Object.hasOwn(value, "portal_demo_target_sha256")) {
    value.portal_demo_target_sha256 = DEFAULT_PORTAL_DEMO_TARGET_SHA256;
    changed = true;
  } else if (value.portal_demo_target_sha256 !== null &&
    (typeof value.portal_demo_target_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.portal_demo_target_sha256))) {
    throw new Error("existing Portal demo fingerprint is invalid");
  }
  return { value, changed };
}

// Read configuration without defaulting a dependency outage to a valid flag.
export async function readSupportConfig(env: Pick<Env, "SUPPORT_CONFIG">): Promise<SupportConfig> {
  if (!env.SUPPORT_CONFIG || typeof env.SUPPORT_CONFIG.get !== "function") {
    throw new SupportConfigError({ code: "binding_missing" });
  }
  let value: unknown;
  try { value = await env.SUPPORT_CONFIG.get<unknown>(SUPPORT_CONFIG_KEY, { type: "json" }); }
  catch (error) { throw new SupportConfigError(diagnoseKvError(error)); }
  if (
    value === null || typeof value !== "object" ||
    !("technician_available" in value) || typeof value.technician_available !== "boolean"
  ) {
    throw new SupportConfigError({ code: "invalid_configuration" });
  }
  const identity = "web_demo_identity" in value ? configuredWebDemoIdentity(value.web_demo_identity) : null;
  const fingerprint = "portal_demo_target_sha256" in value ? value.portal_demo_target_sha256 : undefined;
  if (fingerprint != null && (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint))) {
    throw new SupportConfigError({ code: "invalid_configuration" });
  }
  return { technician_available: value.technician_available,
    ...(identity ? { web_demo_identity: identity } : {}),
    ...(typeof fingerprint === "string" ? { portal_demo_target_sha256: fingerprint } : {}),
  };
}
