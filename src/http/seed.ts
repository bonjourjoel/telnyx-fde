// Administration-only fixture endpoint. Authenticate before reading the JSON
// body; the actor validates the whole batch and never overwrites old records.

import type { DemoTicketInput } from "../contracts";
import { HttpError, observe, adminJson, adminActorKey, type HttpContext } from "./common";

// Fixtures remain separate from assistant tools and require a usable caller.
export async function handleSeed(req: Request, context: HttpContext): Promise<Response> {
  const body = await adminJson(req, context);
  if (!Array.isArray(body.tickets)) throw new HttpError(400, "invalid_demo_tickets");
  const key = await adminActorKey(body, context);
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
