// Safe KV diagnostics: expose fixed categories and HTTP status only, never the
// SDK exception body, credential, configuration value or original cause.

// Closed categories make dependency failures actionable without leaking input.
export interface KvDiagnostic {
  code: "binding_missing" | "authentication" | "permission" | "network" | "timeout" |
    "upstream_http" | "invalid_response" | "invalid_configuration" | "unknown";
  upstream_status?: number;
}

// Carry only sanitized metadata through the HTTP/logging boundaries.
export class SupportConfigError extends Error {
  constructor(readonly diagnostic: KvDiagnostic) {
    super("support configuration unavailable");
    this.name = "ConfigError";
  }
}

// Parse the installed SDK's fixed error prefix for this exact configuration key.
// Even when an exception contains a bearer token, only its status is retained.
export function diagnoseKvError(error: unknown): KvDiagnostic {
  if (error instanceof SupportConfigError) return error.diagnostic;
  if (!(error instanceof Error)) return { code: "unknown" };
  const match = /^env KV get\("support\/config"\) failed: HTTP ([1-5]\d{2}):/.exec(error.message);
  if (match) {
    const upstream_status = Number(match[1]);
    return { code: upstream_status === 401 ? "authentication" : upstream_status === 403 ? "permission" : "upstream_http", upstream_status };
  }
  if (error.name === "SyntaxError") return { code: "invalid_response" };
  if (/timeout|timed out/i.test(error.message)) return { code: "timeout" };
  if (/fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(error.message)) return { code: "network" };
  return { code: "unknown" };
}
