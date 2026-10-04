// Common HTTP callback boundaries: authentication before JSON parsing,
// controlled errors, and one sanitized completion event for every request.

import { DEFAULT_INIT_DYNAMIC_VARIABLES, isSupportChannel, type SupportIdentityRequest } from "../contracts";
import { errorCode, logEvent, OUTCOME, type Stage, type Outcome } from "../logging";
import { readRawBody, verifyTelnyxSignature } from "../security";
import { SupportConfigError } from "../kv-errors";

// Only the injected runtime secrets required by these HTTP handlers.
export interface RuntimeSecrets {
  public_key?: string;
  caller_hmac_key?: string;
  admin_secret?: string;
}

// Request-scoped dependencies and opaque logging identity. Test code passes
// synthetic secrets directly; production reads injected variables only.
export interface HttpContext {
  env: Env;
  secrets: RuntimeSecrets;
  request_id: string;
  stage: Stage;
  outcome?: Outcome;
  error_code?: string;
}

// A static code and status are safe to expose; exception messages never are.
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = status >= 500 ? "ConfigError" : "ValidationError";
  }
}

// Resolve secrets from the deployment's injected environment, not a .env file.
export function runtimeSecrets(): RuntimeSecrets {
  return {
    public_key: process.env.TELNYX_FDE_PUBLIC_KEY,
    caller_hmac_key: process.env.TELNYX_FDE_CALLER_HMAC_KEY,
    admin_secret: process.env.TELNYX_FDE_ADMIN_SECRET,
  };
}

// Narrow an untrusted JSON value without assertions about its properties.
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Parse our flat preset/admin identity fields. Web caller values are ignored;
// no request may supply the backend's web demo configuration label.
export function requestIdentity(body: Record<string, unknown>): SupportIdentityRequest {
  if (!isSupportChannel(body.conversation_channel)) throw new HttpError(400, "unsupported_channel");
  return body.conversation_channel === "web_call"
    ? { conversation_channel: "web_call" }
    : { conversation_channel: "phone_call", caller_phone: typeof body.caller_phone === "string" ? body.caller_phone : "" };
}

// Parse only once, reject arrays/primitives, and keep malformed JSON out of logs.
export function parseObject(raw: Uint8Array): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (isObject(value)) return value;
  } catch {
    // No parser message is exposed: it may contain sensitive input excerpts.
  }
  throw new HttpError(400, "invalid_json_object");
}

// Read original bytes once; verify timestamp and signature before parsing JSON.
export async function signedJson(req: Request, context: HttpContext): Promise<Record<string, unknown>> {
  if (!context.secrets.public_key) throw new HttpError(503, "verification_unavailable");
  const raw = await readRawBody(req);
  if (!await verifyTelnyxSignature(req, raw, context.secrets.public_key)) {
    throw new HttpError(401, "invalid_signature");
  }
  return parseObject(raw);
}

// Time a dependency operation and log only its fixed name and sanitized result.
export async function observe<T>(context: HttpContext, operation: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent({ request_id: context.request_id, stage: context.stage, operation,
      outcome: OUTCOME.OK, duration_ms: Date.now() - start });
    return result;
  } catch (error) {
    logEvent({ request_id: context.request_id, stage: context.stage, operation,
      outcome: OUTCOME.ERROR, duration_ms: Date.now() - start, error_code: errorCode(error),
      ...(error instanceof SupportConfigError ? { detail: { kv_failure_code: error.diagnostic.code,
        ...(error.diagnostic.upstream_status ? { http_status: error.diagnostic.upstream_status } : {}) } } : {}),
    });
    throw error;
  }
}

// Run a handler under a single completion log and a sanitized error boundary.
// /init errors also carry safe defaults; assistant defaults cover non-200 cases.
export async function runHttp(
  req: Request, env: Env, secrets: RuntimeSecrets, stage: Stage, operation: string,
  handler: (req: Request, context: HttpContext) => Promise<Response>,
): Promise<Response> {
  const start = Date.now();
  const context: HttpContext = { env, secrets, stage, request_id: crypto.randomUUID() };
  let response: Response;
  try {
    response = await handler(req, context);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    const code = error instanceof HttpError ? error.code : "operation_failed";
    context.outcome = status < 500 ? OUTCOME.REJECTED : OUTCOME.ERROR;
    context.error_code = errorCode(error);
    response = Response.json({ error: code,
      ...(operation === "initialize" ? { dynamic_variables: { ...DEFAULT_INIT_DYNAMIC_VARIABLES } } : {}),
    }, { status });
  }
  logEvent({ request_id: context.request_id, stage, operation,
    outcome: context.outcome ?? (response.ok ? OUTCOME.OK : response.status < 500 ? OUTCOME.REJECTED : OUTCOME.ERROR), error_code: context.error_code,
    duration_ms: Date.now() - start, detail: { http_status: response.status } });
  return response;
}
