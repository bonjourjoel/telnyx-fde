// Shared support configuration contract and KV reader used by initialization
// and deployment diagnostics. A missing or malformed flag is an error.

// Stable key provisioned by the deployment script; never reset by a handler.
export const SUPPORT_CONFIG_KEY = "support/config";

// Runtime-validated feature flag, rather than a truthy/falsy arbitrary value.
export interface SupportConfig {
  technician_available: boolean;
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
  return { technician_available: value.technician_available };
}
