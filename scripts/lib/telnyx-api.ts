// Shared authenticated REST transport. Bound requests to the Telnyx API, retain
// endpoint/status diagnostics, and scrub errors instead of printing payloads.

// Supported verbs for account resources; no automatic retry or deletion.
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH";
export interface ApiEvent { method: string; endpoint: string; http_status: number }
export interface TelnyxApi {
  request(method: ApiMethod, path: string, body?: unknown, idempotencyKey?: string): Promise<unknown>;
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

// Safe diagnostics never retain the response body or authentication header.
export class TelnyxApiError extends Error {
  constructor(readonly code: string, readonly method?: string, readonly endpoint?: string,
    readonly http_status?: number, readonly detail?: string) {
    super(code);
    this.name = "TelnyxApiError";
  }
}

// Redact exact known values first, then generic credential/phone/email patterns.
export function sanitizeDiagnostic(value: string, redactions: readonly string[] = []): string {
  let result = value;
  for (const secret of redactions) if (secret) result = result.split(secret).join("[REDACTED]");
  return result.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/\+?[1-9]\d{6,14}/g, "[REDACTED_PHONE]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .slice(0, 500);
}

// Select only known error descriptions, never inputs, headers, or raw payloads.
export function apiErrorDetail(body: unknown, redactions: readonly string[]): string {
  if (body === null || typeof body !== "object") return "Request rejected.";
  const record = body as Record<string, unknown>;
  const errors = Array.isArray(record.errors) ? record.errors : Array.isArray(record.detail) ? record.detail : [];
  const messages = errors.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return [];
    const fields = entry as Record<string, unknown>;
    const code = typeof fields.code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(fields.code) ? fields.code : undefined;
    return [code, fields.title, fields.detail, fields.msg].filter((value): value is string => typeof value === "string");
  });
  if (typeof record.detail === "string") messages.push(record.detail);
  return sanitizeDiagnostic(messages.join("; ") || "Request rejected.", redactions);
}

// Parse once and expose only controlled failures. Callers needing a raw KV value
// use fetch instead; only an explicit 404 may be treated as missing.
export async function readApiJson(response: Response, method: string, endpoint: string,
  redactions: readonly string[]): Promise<unknown> {
  let value: unknown;
  try { value = await response.json(); } catch {
    throw new TelnyxApiError("invalid_api_response", method, endpoint, response.status);
  }
  if (!response.ok) throw new TelnyxApiError("api_request_rejected", method, endpoint,
    response.status, apiErrorDetail(value, redactions));
  return value;
}

// Fixed host, no redirects, timeout, and reporting limited to safe metadata.
export function createTelnyxApi(apiKey: string, send: typeof fetch = fetch,
  onResponse?: (event: ApiEvent) => void, redactions: readonly string[] = []): TelnyxApi {
  if (!apiKey) throw new TelnyxApiError("api_key_missing");
  const protectedValues = [apiKey, ...redactions];
  const requestResponse = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const endpoint = path.startsWith("/v2/") ? path.slice(3) : path;
    if (!endpoint.startsWith("/") || endpoint.startsWith("//") || endpoint.includes("#")) {
      throw new TelnyxApiError("invalid_api_endpoint");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await send("https://api.telnyx.com/v2" + endpoint, { ...init, headers,
        redirect: "error", signal: AbortSignal.timeout(15000) });
    } catch { throw new TelnyxApiError("network_result_unknown", init.method ?? "GET", endpoint); }
    onResponse?.({ method: init.method ?? "GET", endpoint: sanitizeDiagnostic(endpoint, protectedValues), http_status: response.status });
    return response;
  };
  return {
    fetch: requestResponse,
    async request(method, path, body, idempotencyKey) {
      const headers = new Headers();
      if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
      const response = await requestResponse(path, { method, headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return readApiJson(response, method, path, protectedValues);
    },
  };
}
