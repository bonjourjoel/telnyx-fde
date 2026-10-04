// Sanitized structured logging for the Edge Function.
//
// Every business operation writes one JSON line via console.log with a fixed
// set of fields: request_id, stage, operation, outcome, and optional
// correlation_id, duration_ms, error_code, and detail. Safety here is built on
// an allowlist, not on pattern scrubbing: regex cannot guarantee that no
// sensitive data is emitted, so:
//
//   - logEvent constructs the emitted object field by field from a closed
//     LogEvent shape. It never spreads the input, so any extra property a
//     caller accidentally attaches (caller_phone, ticket_description, ...) is
//     silently dropped instead of written to the log.
//   - detail is a closed record (LogDetail): only keys declared in DETAIL_KEYS
//     are accepted, both at compile time (the type) and at runtime (allowlist).
//     Every remaining string value is still passed through sanitize() as
//     defense-in-depth, length-bounded, and matched against a safe pattern.
//   - errorCode maps any thrown value to one of a fixed set of standard error
//     names (ALLOWED_ERROR_CODES); unknown custom names are collapsed to
//     "unknown_error" so an attacker-influenced name or message never leaks.
//   - No phone numbers, no free-form ticket text, no secrets, no full payloads.
//
// These logs are the Function's primary observability surface; the Telnyx
// platform also produces HTTP invocation logs and metrics (see
// the README observability section).

// ---------------------------------------------------------------------------
// Stage and outcome vocabularies
// ---------------------------------------------------------------------------

// A Stage is the broad phase of a request. An operation is the specific action
// performed inside that stage. Keeping stages in a closed set makes log
// queries and dashboards stable.
export const STAGE = {
  // Signature/timestamp verification, admin-secret checks, raw-body handling.
  SECURITY: "security",
  // Health probe (added in step 6).
  HEALTH: "health",
  // POST /init: dynamic variables webhook.
  INIT: "init",
  // POST /tickets/create: create-ticket webhook.
  CREATE_TICKET: "create_ticket",
  // POST /mcp and the three MCP tools.
  MCP: "mcp",
  // POST /admin/seed: demo fixture seeding.
  ADMIN_SEED: "admin_seed",
  // POST /voice-entry: TeXML that starts the assistant.
  VOICE_ENTRY: "voice_entry",
} as const;
export type Stage = (typeof STAGE)[keyof typeof STAGE];

// Outcomes. OK on success, ERROR on a handled failure, REJECTED when an input
// or security check refused the request before any business action ran.
export const OUTCOME = {
  OK: "ok",
  ERROR: "error",
  REJECTED: "rejected",
} as const;
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

// ---------------------------------------------------------------------------
// Log event shape
// ---------------------------------------------------------------------------

// One structured log event. mandatory fields are always present; the rest
// are optional and supplied when meaningful.
export interface LogEvent {
  // Opaque id for this HTTP request. Generated per inbound request and
  // threaded through handler/Actor/MCP calls so a single call path can be
  // reconstructed.
  request_id: string;
  // Broad phase of the request (see STAGE).
  stage: Stage;
  // Specific action inside the stage (e.g. "verify_signature", "kv_read",
  // "actor_create_ticket"). Free-form but kept short and snake_case.
  operation: string;
  // Result classification (see OUTCOME).
  outcome: Outcome;
  // Optional wall-clock duration of the operation, in milliseconds.
  duration_ms?: number;
  // Optional id of a related request/correlation, when available (e.g. the
  // call_control_id or assistant-side correlation id).
  correlation_id?: string;
  // Optional short, non-leaking error code (see errorCode). Never the
  // message body, which may contain user text.
  error_code?: string;
  // Optional structured metadata. Keys are restricted to the closed LogDetail
  // shape (DETAIL_KEYS). String values are sanitized, length-bounded, and
  // pattern-checked before emission. Arbitrary keys are refused at compile
  // time and dropped at runtime.
  detail?: LogDetail;
}

// Maximum length of any detail string after sanitization. Keeps a single log
// line bounded even if a caller passes a large value.
const MAX_DETAIL_STRING = 200;

// Closed set of detail keys that may ever appear in a log line. Anything else
// is dropped at runtime (defense-in-depth) and rejected by the LogDetail type
// at compile time. Keys are chosen so their values are never caller free text:
// status codes, counts, short prefixes of our own HMACs, static config keys,
// workflow node names, tool names, and FAQ topic ids we author.
export const DETAIL_KEYS = [
  "http_status",
  "ticket_count",
  "actor_key_prefix",
  "kv_key",
  "node_name",
  "tool_name",
  "topic_id",
  "record_type",
  "kv_failure_code",
] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];

// Closed detail record. Every field is optional; values are primitives only.
// `actor_key_prefix` stores the first 8 hex chars of the caller's HMAC digest,
// enough to correlate a single caller's calls in logs without storing or
// logging the full digest (which is also never the raw phone number).
export interface LogDetail {
  // HTTP status of the response we are about to return (200, 401, 403, 500).
  http_status?: number;
  // Count of tickets presented on /init, or created on /tickets/create.
  ticket_count?: number;
  // First 8 hex chars of the caller's HMAC key. Bounded by sanitize + the
  // safe-char pattern below; never the full digest.
  actor_key_prefix?: string;
  // Static KV key read/written in this operation (e.g. "support/config").
  kv_key?: string;
  // Workflow node name reported by the assistant (e.g. "FAQ_SHORT"). Bounded
  // and pattern-checked to reject free text.
  node_name?: string;
  // MCP tool name called in this operation (e.g. "list_topics").
  tool_name?: string;
  // FAQ topic id from our own catalogue (e.g. "kv-quickstart").
  topic_id?: string;
  // Telnyx envelope record_type (e.g. "event"). Bounded + pattern-checked.
  record_type?: string;
  // Fixed dependency error category; never the KV exception message or body.
  kv_failure_code?: string;
}

// Safe-character pattern shared by string detail fields. Rejects anything that
// is not short ASCII snake/Pascal-case or a static config path. Applied after
// sanitize so a value that survives sanitize but is still suspicious is dropped
// rather than logged.
const SAFE_DETAIL_STRING = /^[A-Za-z][A-Za-z0-9_./-]{0,63}$/;

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

// Redact obvious PII and secrets from a string. This is a safety net:
// production code must still avoid passing sensitive data as detail in the
// first place. Redaction targets:
//   - E.164 phone numbers and long digit runs that look like phone numbers.
//   - API-key-ish tokens with common prefixes (sk_live, Bearer, ...).
//   - Long hex strings that look like hashes/UUIDs of more than 32 chars.
//   - Strings longer than MAX_DETAIL_STRING, which are truncated.
export function sanitize(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) return "";
  let out = value;
  // E.164 phone numbers (+ followed by 7-15 digits), and bare 10+ digit runs.
  out = out.replace(/\+?[1-9]\d{6,14}/g, "[REDACTED_PHONE]");
  // Secret-ish patterns: keyword followed by a token.
  out = out.replace(
    /(?:sk_live|sk_test|bearer|token|secret|password|api[_-]?key)[:_\s]+[A-Za-z0-9.\-_]+/gi,
    "[REDACTED_SECRET]",
  );
  // Long hex runs (32+ chars) that look like hashes or long keys.
  out = out.replace(/\b[0-9a-f]{32,}\b/gi, "[REDACTED_SECRET]");
  // Bound the length to keep log lines small.
  if (out.length > MAX_DETAIL_STRING) {
    out = out.slice(0, MAX_DETAIL_STRING) + "...[truncated]";
  }
  return out;
}

// Closed set of error-class names we are willing to emit as error_code. Any
// other name (possibly attacker-influenced, or carrying PII such as a phone
// number embedded in a custom error name) is collapsed to "unknown_error".
// The set covers the standard ECMAScript/DOM error classes plus a small set of
// project-internal names that we control and trust.
export const ALLOWED_ERROR_CODES = new Set<string>([
  // Standard ECMAScript error classes.
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  // Standard/DOM runtime error classes.
  "AbortError",
  "TimeoutError",
  "OperationError",
  "DataError",
  "QuotaExceededError",
  "NotSupportedError",
  "InvalidAccessError",
  "NetworkError",
  "SecurityError",
  "DOMException",
  "RuntimeError",
  // Project-internal error names we control and trust.
  "ValidationError",
  "SignatureError",
  "ActorError",
  "McpError",
  "ConfigError",
]);

// Reduce an unknown thrown value to a short, non-leaking error code. We map
// the value to one of ALLOWED_ERROR_CODES; anything else collapses to
// "unknown_error". The error message body is intentionally discarded because
// it may contain caller-supplied text (ticket description, phone, secret) that
// must never reach logs. A bare string thrown value is also collapsed, never
// returned verbatim.
export function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name: unknown }).name || "");
    if (ALLOWED_ERROR_CODES.has(name)) return name;
  }
  // "unknown_error" is itself a member-free sentinel: callers reading logs see
  // an error occurred without revealing its class or message.
  return "unknown_error";
}

// ---------------------------------------------------------------------------
// Request id generation
// ---------------------------------------------------------------------------

// Generate a fresh opaque request id. crypto.randomUUID is available in the
// Edge runtime and in Node 19+ (we run on Node 24). A fallback is kept only
// for completeness; the runtime path is always used in practice.
export function genRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-crypto fallback.
  }
  return (
    "rid-" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

// Emit one structured log event as a single JSON line. The emitted object is
// built field by field from the closed LogEvent shape: never spread, so any
// extra property the caller accidentally attached is dropped. Inside detail,
// only keys in DETAIL_KEYS are kept; string values are sanitized, length-
// bounded, and pattern-checked, then dropped if suspicious. Numbers, booleans,
// and null at known keys pass through unchanged.
export function logEvent(event: LogEvent): void {
  // Build the fixed top-level fields explicitly. We do not spread `event`
  // because spread would also copy any stray caller-attached property.
  const safe: {
    request_id: string;
    stage: Stage;
    operation: string;
    outcome: Outcome;
    duration_ms?: number;
    correlation_id?: string;
    error_code?: string;
    detail?: Record<string, string | number | boolean | null>;
  } = {
    request_id: event.request_id,
    stage: event.stage,
    operation: event.operation,
    outcome: event.outcome,
  };
  if (typeof event.duration_ms === "number" && Number.isFinite(event.duration_ms)) {
    safe.duration_ms = event.duration_ms;
  }
  if (typeof event.correlation_id === "string" && event.correlation_id.length > 0) {
    // correlation_id is a request/call id from Telnyx; sanitize + bound it as
    // defense-in-depth, in case a malformed signed request carries odd chars.
    safe.correlation_id = sanitize(event.correlation_id).slice(0, 128);
  }
  if (typeof event.error_code === "string" && event.error_code.length > 0) {
    safe.error_code = event.error_code;
  }

  // Closed detail allowlist. Iterate the caller's detail and keep only known
  // keys, validating each value's type and running strings through sanitize +
  // the safe pattern. Unknown keys are silently dropped.
  if (event.detail && typeof event.detail === "object") {
    const cleaned: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(event.detail)) {
      if (!(DETAIL_KEYS as readonly string[]).includes(key)) {
        // Not a known key: drop silently rather than log the fact of dropping
        // (avoid turning key names themselves into log content).
        continue;
      }
      if (value === null) {
        cleaned[key] = null;
      } else if (typeof value === "boolean") {
        cleaned[key] = value;
      } else if (typeof value === "number") {
        cleaned[key] = Number.isFinite(value) ? value : null;
      } else if (typeof value === "string") {
        const s = sanitize(value);
        if (s.length > 0 && SAFE_DETAIL_STRING.test(s)) {
          cleaned[key] = s;
        }
        // else: drop the suspicious string entirely.
      }
      // Any other runtime type at a known key is also dropped.
    }
    // Only attach detail if it produced at least one field.
    if (Object.keys(cleaned).length > 0) {
      safe.detail = cleaned;
    }
  }

  console.log(JSON.stringify(safe));
}

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------

// Result of a timed() call: the wrapped function's result plus the measured
// wall-clock duration in milliseconds. Lets callers log duration_ms without
// managing Date.now() at every call site.
export interface TimedResult<T> {
  result: T;
  duration_ms: number;
}

// Measure the wall-clock duration of an async operation. Returns the result
// (or rethrows after doing nothing) so the caller is responsible for emitting
// the corresponding log line. Usage:
//
//   const { result, duration_ms } = await timed(() => actor.createTicket(input));
//   logEvent({ request_id, stage: STAGE.CREATE_TICKET, operation: "actor_create_ticket",
//             outcome: OUTCOME.OK, duration_ms });
export async function timed<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
  const start = Date.now();
  const result = await fn();
  return { result, duration_ms: Date.now() - start };
}
