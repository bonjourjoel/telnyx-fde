// Edge Function entry point: explicit HTTP routing, independent health checks,
// protected configuration diagnostics, and exported actor classes for bundling.

import { STAGE, OUTCOME } from "./logging";
import { verifyAdminSecret } from "./security";
import { readSupportConfig } from "./support-config";
import { handleMcpRequest } from "./mcp";
import { handleInit } from "./http/init";
import { handleCreateTicket } from "./http/create-ticket";
import { handleSeed } from "./http/seed";
import { runHttp, runtimeSecrets, observe, type HttpContext, type RuntimeSecrets } from "./http/common";

// The exported names match the manifest's actor types. Counter remains deployed
// as an actor type, but unknown URLs no longer increment its demo instance.
export { Counter } from "./counter";
export { CallerTickets } from "./actors/caller-tickets";

// Describe one route so method checks and completion logs use the same table.
interface Route {
  method: string;
  stage: (typeof STAGE)[keyof typeof STAGE];
  operation: string;
  handler: (req: Request, context: HttpContext) => Promise<Response>;
}

// Fixed-method business routes. MCP is delegated separately to its SDK;
// voice-entry remains a later step.
const ROUTES: Record<string, Route> = {
  "/health": { method: "GET", stage: STAGE.HEALTH, operation: "health", handler: handleHealth },
  "/admin/check-config": { method: "GET", stage: STAGE.SECURITY, operation: "check_config", handler: handleCheckConfig },
  "/init": { method: "POST", stage: STAGE.INIT, operation: "initialize", handler: handleInit },
  "/tickets/create": { method: "POST", stage: STAGE.CREATE_TICKET, operation: "create_ticket", handler: handleCreateTicket },
  "/admin/seed": { method: "POST", stage: STAGE.ADMIN_SEED, operation: "seed_demo", handler: handleSeed },
};

// Testable routing seam: local checks inject synthetic secrets instead of
// loading .env or modifying process.env. Production uses the wrapper below.
export async function routeRequest(req: Request, env: Env, secrets: RuntimeSecrets): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path === "/mcp") return handleMcpRequest(req);
  const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
  return runHttp(req, env, secrets, route?.stage ?? STAGE.SECURITY,
    route?.operation ?? "route_request", async (request, context) => {
      if (!route) return Response.json({ error: "not_found" }, { status: 404 });
      if (request.method !== route.method) {
        return Response.json({ error: "method_not_allowed" }, {
          status: 405, headers: { Allow: route.method },
        });
      }
      return route.handler(request, context);
    });
}

// Runtime fetch export preserves the scaffold convention and injected secrets.
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Public MCP reads do not load runtime secret values.
    return routeRequest(req, env, new URL(req.url).pathname === "/mcp" ? {} : runtimeSecrets());
  },
};

// Function availability only. No dependency access, including when bindings fail.
async function handleHealth(): Promise<Response> {
  return Response.json({ ok: true });
}

// Preserve the deployment diagnostic response shape and secret presence checks.
// Secret values are never returned. The shared reader now enforces the KV flag.
async function handleCheckConfig(req: Request, context: HttpContext): Promise<Response> {
  if (!verifyAdminSecret(req, context.secrets.admin_secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let technicianAvailable: boolean | null = null;
  try {
    technicianAvailable = (await observe(context, "kv_read", () => readSupportConfig(context.env))).technician_available;
  } catch {
    // The diagnostic keeps its structured failure response, never a fake flag.
  }
  const checks = [
    { name: "TELNYX_FDE_PUBLIC_KEY", value: context.secrets.public_key },
    { name: "TELNYX_FDE_CALLER_HMAC_KEY", value: context.secrets.caller_hmac_key },
    { name: "TELNYX_FDE_ADMIN_SECRET", value: context.secrets.admin_secret },
  ];
  const present = checks.filter((check) => typeof check.value === "string" && check.value.length > 0)
    .map((check) => check.name);
  const allPresent = present.length === checks.length;
  const kvOk = technicianAvailable !== null;
  const ok = kvOk && allPresent;
  context.outcome = ok ? OUTCOME.OK : OUTCOME.ERROR;
  return Response.json({ ok, kv: { ok: kvOk, technician_available: technicianAvailable },
    secrets: { required: checks.map((check) => check.name), present, all_present: allPresent },
  }, { status: ok ? 200 : 500 });
}
