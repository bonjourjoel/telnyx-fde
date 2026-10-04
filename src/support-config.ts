// Shared support configuration contract and KV reader used by initialization
// and deployment diagnostics. A missing or malformed flag is an error.

// Stable key provisioned by the deployment script; never reset by a handler.
export const SUPPORT_CONFIG_KEY = "support/config";

// Explicit initial demo identity. Deployments fill only a missing field, never
// regenerate it. Changing a configured identity deliberately selects new state.
export const DEFAULT_WEB_DEMO_IDENTITY = "portal-demo";

// Limit configuration labels without treating them as numbers or caller input.
const MAX_WEB_DEMO_IDENTITY_LENGTH = 128;

// Runtime-validated feature flag, rather than a truthy/falsy arbitrary value.
export interface SupportConfig {
  technician_available: boolean;
  // Optional for legacy/phone-only configuration. Required for every web actor
  // operation and never exposed as a model-editable dynamic variable.
  web_demo_identity?: string;
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
    return { value: { technician_available: false, web_demo_identity: DEFAULT_WEB_DEMO_IDENTITY }, changed: true };
  }
  if (existing === null || typeof existing !== "object" || Array.isArray(existing) ||
    !("technician_available" in existing) || typeof existing.technician_available !== "boolean") {
    throw new Error("existing support configuration is invalid");
  }
  const value: Record<string, unknown> = { ...existing };
  if (Object.hasOwn(value, "web_demo_identity")) {
    if (!configuredWebDemoIdentity(value.web_demo_identity)) throw new Error("existing web demo identity is invalid");
    return { value, changed: false };
  }
  return { value: { ...value, web_demo_identity: DEFAULT_WEB_DEMO_IDENTITY }, changed: true };
}

// Read configuration without defaulting a dependency outage to a valid flag.
export async function readSupportConfig(env: Pick<Env, "SUPPORT_CONFIG">): Promise<SupportConfig> {
  const value = await env.SUPPORT_CONFIG.get<unknown>(SUPPORT_CONFIG_KEY, { type: "json" });
  if (
    value === null || typeof value !== "object" ||
    !("technician_available" in value) || typeof value.technician_available !== "boolean"
  ) {
    const error = new Error("support configuration is missing or invalid");
    error.name = "ConfigError";
    throw error;
  }
  const identity = "web_demo_identity" in value ? configuredWebDemoIdentity(value.web_demo_identity) : null;
  return { technician_available: value.technician_available,
    ...(identity ? { web_demo_identity: identity } : {}),
  };
}
