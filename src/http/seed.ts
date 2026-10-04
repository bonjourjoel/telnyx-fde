// Administration-only fixture endpoint. Authenticate before reading the JSON
// body; the actor validates the whole batch and never overwrites old records.

import type { DemoTicketInput } from "../contracts";
import { computeCallerKey, verifyAdminSecret } from "../security";
import { HttpError, observe, parseObject, type HttpContext } from "./common";

// Fixtures remain separate from assistant tools and require a usable caller.
export async function handleSeed(req: Request, context: HttpContext): Promise<Response> {
  if (!context.secrets.admin_secret) throw new HttpError(503, "administration_unavailable");
  if (!verifyAdminSecret(req, context.secrets.admin_secret)) throw new HttpError(401, "unauthorized");
  const body = parseObject(new Uint8Array(await req.arrayBuffer()));
  if (!Array.isArray(body.tickets)) throw new HttpError(400, "invalid_demo_tickets");
  if (!context.secrets.caller_hmac_key) throw new HttpError(503, "identity_unavailable");
  const phone = typeof body.caller_phone === "string" ? body.caller_phone : null;
  const key = await computeCallerKey(phone, context.secrets.caller_hmac_key);
  if (!key) throw new HttpError(422, "caller_identity_unusable");
  try {
    // The cast describes RPC input; actor validation is the authoritative
    // runtime check of every fixture field, before any persistent write.
    const result = await observe(context, "actor_seed_demo", () =>
      context.env.CALLER_TICKETS.idFromName(key).seedDemoTickets({ tickets: body.tickets as DemoTicketInput[] }));
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "ValidationError") {
      throw new HttpError(400, "invalid_demo_tickets");
    }
    throw error;
  }
}
