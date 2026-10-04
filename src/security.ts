// HTTP security helpers for the Edge Function.
//
// This module centralizes everything that touches request trust:
//
//   - Reading the raw body exactly once (it must be available verbatim for
//     signature verification; we never parse-and-reserialize before verify).
//   - Verifying the Telnyx Ed25519 signature on AI-Assistant callbacks
//     (POST /init and POST /tickets/create) with a bounded replay window.
//   - Deriving a stable, opaque Actor key from the caller's phone number via
//     HMAC-SHA256, so the raw number never becomes the Actor key nor a log
//     field.
//   - Verifying the admin-secret header that protects POST /admin/seed.
//
// Design rules:
//   - Verification functions never throw. They return false on any missing
//     input, malformed header, stale timestamp, or failed signature, so the
//     caller can emit a sanitized rejection log and return 401/403 without
//     leaking the specific failure reason in the response body.
//   - Secrets are injected at deploy time as environment variables / bindings
//     (step 4). Their absence is treated as a hard reject: we never serve a
//     signed callback when we cannot verify it.
//   - The raw number is only ever seen inside normalizePhoneE164; everything
//     else (logs, Actor key) uses the HMAC digest or null.

// ---------------------------------------------------------------------------
// Header names and constants
// ---------------------------------------------------------------------------

// Header carrying the base64 Ed25519 signature of the signed message.
export const SIGNATURE_HEADER = "telnyx-signature-ed25519";
// Header carrying the unix-second timestamp used in the signed message.
export const TIMESTAMP_HEADER = "telnyx-timestamp";
// The signed message is exactly "{timestamp}|{raw_body}" (string concatenation).
export const SIGNED_MESSAGE_SEPARATOR = "|";

// Allowed clock skew for replay protection (5 minutes, matching the Telnyx
// guide example). Both negative skew (clock drift ahead) and positive skew
// (delayed delivery) are bounded by this value.
export const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

// Header carrying the administration secret that protects POST /admin/seed.
export const ADMIN_SECRET_HEADER = "x-admin-secret";

// E.164 length bounds (after the leading "+").
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

// ---------------------------------------------------------------------------
// Raw body
// ---------------------------------------------------------------------------

// Read the entire request body once as a byte array. Request bodies can only
// be consumed once in the Web Fetch model, so callers MUST thread this
// Uint8Array to any consumer that needs the original bytes (signature
// verification, JSON parse, logging of sanitized extracts).
export async function readRawBody(req: Request): Promise<Uint8Array> {
  const buffer = await req.arrayBuffer();
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Base64 and hex helpers
// ---------------------------------------------------------------------------

// Decode a base64 string into a byte array. atob is available in the Edge
// runtime and in Node 16+ (we run on Node 24). The returned view is backed by
// a plain ArrayBuffer (via the new Uint8Array(number) constructor) so it
// satisfies Web Crypto's BufferSource under TS 5.9's stricter typed-array
// generics.
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Convert a byte array to a lowercase hex string. Used for the HMAC digest.
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// Build the exact bytes that Telnyx signs: the ASCII timestamp, the "|"
// separator, then the raw body bytes. Concatenated as a single Uint8Array
// backed by a plain ArrayBuffer so it satisfies Web Crypto's BufferSource.
function buildSignedMessage(
  timestamp: string,
  rawBody: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const prefix = timestamp + SIGNED_MESSAGE_SEPARATOR;
  const prefixBytes = new TextEncoder().encode(prefix);
  const out = new Uint8Array(prefixBytes.length + rawBody.length);
  out.set(prefixBytes, 0);
  out.set(rawBody, prefixBytes.length);
  return out;
}

// ---------------------------------------------------------------------------
// Telnyx signature verification (Ed25519 via Web Crypto)
// ---------------------------------------------------------------------------

// Verify a Telnyx-signed request using the org's Ed25519 public key. Returns
// true only when every check passes; false on any missing input, malformed
// header, stale timestamp, malformed key, or failed signature. Never throws.
//
// publicKeyB64 is the base64-encoded raw 32-byte Ed25519 public key returned
// by GET https://api.telnyx.com/v2/public_key under data.public. It is read
// from an injected secret in step 4; until then, callers should pass the
// secret value (or undefined) and treat the result as authoritative.
export async function verifyTelnyxSignature(
  req: Request,
  rawBody: Uint8Array,
  publicKeyB64: string | null | undefined,
): Promise<boolean> {
  // Without a configured key we cannot verify anything: reject hard.
  if (!publicKeyB64) return false;

  const signature = req.headers.get(SIGNATURE_HEADER);
  const timestamp = req.headers.get(TIMESTAMP_HEADER);
  if (!signature || !timestamp) return false;
  if (!/^\d+$/.test(timestamp)) return false;

  // Replay window. The timestamp is unix seconds, per the Telnyx guide.
  const tsSeconds = Number(timestamp);
  if (!Number.isSafeInteger(tsSeconds)) return false;
  const ageMs = Date.now() - tsSeconds * 1000;
  if (Math.abs(ageMs) > MAX_TIMESTAMP_SKEW_MS) return false;

  // Import the raw public key as Ed25519. Treat any failure the same as a
  // missing key: reject without distinguishing the cause.
  let key: CryptoKey;
  try {
    const keyBytes = base64ToBytes(publicKeyB64);
    key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      // Cast is needed because older lib.dom.d.ts does not list "Ed25519"
      // explicitly even though the runtime supports it.
      { name: "Ed25519" } as KeyAlgorithm,
      false,
      ["verify"],
    );
  } catch {
    return false;
  }

  // Decode the signature. A bad base64 here means a malformed request. The
  // explicit ArrayBuffer-backed type keeps the BufferSource compatibility
  // gained from base64ToBytes (TS otherwise widens to Uint8Array<ArrayBufferLike>).
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = base64ToBytes(signature);
  } catch {
    return false;
  }

  const message = buildSignedMessage(timestamp, rawBody);
  try {
    return await crypto.subtle.verify("Ed25519", key, sigBytes, message);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Caller identity derivation
// ---------------------------------------------------------------------------

// Normalize a phone number to canonical E.164 form: a leading "+" followed by
// 7-15 digits. Accepts "+13128675309", "13128675309", "+1 312 867 5309"
// (whitespace, dashes, parentheses stripped), and a "tel:" prefix. Returns
// null when the input has no usable form, so the caller never builds a
// syntactically invalid Actor key.
export function normalizePhoneE164(
  input: string | null | undefined,
): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Strip whitespace, dashes, parentheses, and an optional "tel:" scheme.
  const cleaned = trimmed
    .replace(/[\s\-().]/g, "")
    .replace(/^tel:/i, "");
  // A leading "+" is allowed but not required.
  const digits = cleaned.replace(/^\+/, "");
  if (!/^[1-9]\d+$/.test(digits)) return null;
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return null;
  }
  return "+" + digits;
}

// Compute a stable, opaque Actor key for a caller. The key is HMAC-SHA256 of
// the E.164-normalized phone, using a stable project secret. The raw phone is
// never used as the Actor key and never logged. Returns null when the phone
// cannot be normalized or the secret is missing; callers must then refuse
// per-caller operations while still allowing FAQ-only flows.
export async function computeCallerKey(
  phone: string | null | undefined,
  hmacSecret: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizePhoneE164(phone);
  if (!normalized) return null;
  if (!hmacSecret) return null;

  return hmacDigest(normalized, hmacSecret);
}

// Derive a stable ticket operation for one caller and phone call. Domain
// separation prevents this HMAC from colliding with the caller-key input.
// Missing call context disables creation; an event id is not a call identity.
export async function computeTicketOperationId(
  callerKey: string,
  callControlId: string | null | undefined,
  hmacSecret: string | null | undefined,
): Promise<string | null> {
  if (typeof callControlId !== "string" || !callControlId.trim() || !hmacSecret) {
    return null;
  }
  return hmacDigest(
    "support-ticket:v1:" + JSON.stringify([callerKey, callControlId]),
    hmacSecret,
  );
}

// Shared HMAC implementation for opaque caller and operation identifiers.
async function hmacDigest(value: string, secret: string): Promise<string> {
  // Import the stable secret without retaining raw identity in actor state.
  const keyData = new TextEncoder().encode(secret);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" } as KeyAlgorithm,
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, data));
  return bytesToHex(digest);
}

// ---------------------------------------------------------------------------
// Admin secret verification
// ---------------------------------------------------------------------------

// Verify an admin-secret request header against the configured admin secret.
// Uses a constant-time comparison to avoid leaking the secret via timing.
// Returns false when either value is missing or mismatched. Never throws.
export function verifyAdminSecret(
  req: Request,
  expectedSecret: string | null | undefined,
): boolean {
  if (!expectedSecret) return false;
  const provided = req.headers.get(ADMIN_SECRET_HEADER);
  if (!provided) return false;
  return timingSafeEqual(provided, expectedSecret);
}

// Constant-time string comparison. Compares against the longest length so a
// length mismatch does not leak via the iteration count; the XOR of lengths
// guarantees a non-zero result when lengths differ.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let mismatch = aBytes.length ^ bBytes.length;
  const n = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < n; i++) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return mismatch === 0;
}
