// Function entry point for the telnyx-fde support assistant.
//
// Re-exports the `Counter` actor class so it is bundled and shipped with the
// function (the runtime resolves the [[actors]] type from this export; the
// exported class name must equal the `type` field declared in telnyx.toml).
//
// Step 4 adds two minimal, dependency-light routes used only to verify the
// deployment:
//
//   - GET /health       : 200 { ok: true }. Independent of KV, Actor, secrets.
//                         Proves the Function starts and responds. The full
//                         health/diagnostic landscape (and a real router) is
//                         built in step 6.
//   - GET /admin/check-config : protected by the x-admin-secret header. Reads
//                         the support/config key from KV, checks the three
//                         security environment variables are present, and
//                         returns the boolean status of each check without
//                         ever exposing secret values. Used by the deploy
//                         script as the binding-level smoke test.
//
// All other paths still fall through to the demo Counter behaviour from the
// step-2 scaffold, which is intentionally preserved until the full router
// replaces it in step 6.
//
// Sanitization: when `support/config` is read from KV, its JSON is logged only
// through logEvent (step 3), which allows the `technician_available` boolean
// into the bounded detail `LogDetail` channel. The numeric `http_status`
// channel carries the response status. No secret value is ever emitted.

import { logEvent, STAGE, OUTCOME } from "./logging";

// Re-export the actor class from the entry point so it is bundled and shipped
// with the function (the runtime resolves the [[actors]] type here; the
// exported class name must equal the type).
export { Counter } from "./counter";

// Header carrying the administration secret. Mirrors ADMIN_SECRET_HEADER in
// src/security.ts to keep step 4 self-contained; step 6 will centralize this
// through src/security.ts's verifyAdminSecret helper.
const ADMIN_SECRET_HEADER = "x-admin-secret";

// Static KV key used by the support assistant config flag. This is the only
// key step 4 seeds and reads; the constant lives here until step 6 introduces
// a shared config module.
const SUPPORT_CONFIG_KEY = "support/config";

// Names of the three security environment variables the deploy script
// provisions. /admin/check-config verifies they are present (and defined);
// their values are never read or logged.
const REQUIRED_SECURITY_ENV_VARS = [
  "TELNYX_FDE_PUBLIC_KEY",
  "TELNYX_FDE_CALLER_HMAC_KEY",
  "TELNYX_FDE_ADMIN_SECRET",
] as const;

// Shape of the support/config value stored in KV. Stored as JSON; read with
// `{ type: "json" }`. Only the `technician_available` boolean is consumed in
// step 4; later steps may extend this object without breaking the reader.
interface SupportConfig {
  technician_available?: unknown;
}

// Shape of the /admin/check-config response. Every field is a primitive so
// the response is small and inspectable. `secrets.present` lists the names of
// the security environment variables that are defined; absence means the
// deploy script did not provision the secret.
interface CheckConfigResponse {
  ok: boolean;
  kv: { ok: boolean; technician_available: boolean | null };
  secrets: {
    required: string[];
    present: string[];
    all_present: boolean;
  };
}

export default {
  // Top-level fetch handler. Dispatches /health and /admin/check-config
  // explicitly; every other path falls through to the demo Counter behaviour.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const requestId = crypto.randomUUID();

    // GET /health — independent of every binding. Returns 200 { ok: true } as
    // long as the Function process can answer HTTP. Designed for an external
    // checker (per the README observability section) and for the deploy
    // script.
    if (req.method === "GET" && url.pathname === "/health") {
      logEvent({
        request_id: requestId,
        stage: STAGE.HEALTH,
        operation: "health",
        outcome: OUTCOME.OK,
        duration_ms: 0,
      });
      return Response.json({ ok: true });
    }

    // GET /admin/check-config — deployment diagnostic. Requires the admin
    // secret header; the response only reveals booleans and which env var
    // names are defined, never any value.
    if (req.method === "GET" && url.pathname === "/admin/check-config") {
      return handleCheckConfig(req, env, requestId);
    }

    // Demo fallback retained until step 6 introduces the real router.
    const counter = env.COUNTER.idFromName("demo");
    const value = await counter.increment(1);
    return Response.json({ value });
  },
};

// Handle GET /admin/check-config. Reads support/config from KV, checks that
// technician_available is a boolean, and reports which of the required
// security environment variables are defined. Returns 500 with the same
// shape when any check fails, so the caller (deploy script) can read which
// component is broken. Never logs or returns secret values.
async function handleCheckConfig(
  req: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  const start = Date.now();

  // Gate on the admin secret header. If absent or mismatched, return 401
  // without ever touching KV. We do not distinguish "wrong secret" from
  // "missing secret" to avoid leaking the configured state. The presence of
  // the secret is verified locally against process.env.
  const provided = req.headers.get(ADMIN_SECRET_HEADER);
  const expected = process.env.TELNYX_FDE_ADMIN_SECRET;
  if (!expected || !provided || provided !== expected) {
    logEvent({
      request_id: requestId,
      stage: STAGE.ADMIN_SEED,
      operation: "check_config_auth",
      outcome: OUTCOME.REJECTED,
      duration_ms: Date.now() - start,
      detail: { http_status: 401 },
    });
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Read support/config from KV. A missing key is not a hard failure: the
  // deploy script should have seeded it, but if for any reason it is absent
  // we report kv.ok = false so the caller can act.
  let technicianAvailable: boolean | null = null;
  let kvOk = false;
  try {
    const config = await env.SUPPORT_CONFIG.get<SupportConfig>(
      SUPPORT_CONFIG_KEY,
      { type: "json" },
    );
    if (config === null) {
      kvOk = false;
    } else if (typeof config.technician_available === "boolean") {
      technicianAvailable = config.technician_available;
      kvOk = true;
    } else {
      // Key exists but the field is missing or has the wrong type.
      kvOk = false;
    }
  } catch {
    // Treat any KV failure as a failed check rather than crashing.
    kvOk = false;
  }

  // Check that each required security env var is defined. We list the names
  // that are present (typeof string && length > 0) under `secrets.present`,
  // but never include the values.
  const present: string[] = [];
  for (const name of REQUIRED_SECURITY_ENV_VARS) {
    const v = process.env[name];
    if (typeof v === "string" && v.length > 0) {
      present.push(name);
    }
  }
  const allPresent = present.length === REQUIRED_SECURITY_ENV_VARS.length;

  const ok = kvOk && allPresent;
  const body: CheckConfigResponse = {
    ok,
    kv: { ok: kvOk, technician_available: technicianAvailable },
    secrets: {
      required: [...REQUIRED_SECURITY_ENV_VARS],
      present,
      all_present: allPresent,
    },
  };

  logEvent({
    request_id: requestId,
    stage: STAGE.ADMIN_SEED,
    operation: "check_config",
    outcome: ok ? OUTCOME.OK : OUTCOME.ERROR,
    duration_ms: Date.now() - start,
    detail: {
      http_status: ok ? 200 : 500,
      kv_key: SUPPORT_CONFIG_KEY,
      ticket_count: technicianAvailable === null ? 0 : 1,
    },
  });

  return Response.json(body, { status: ok ? 200 : 500 });
}
