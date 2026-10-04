// Protected test administration: reset tickets for one resolved caller only.
// The endpoint is never an assistant tool and is never invoked by deployment.

import { adminJson, adminActorKey, HttpError, observe, type HttpContext } from "./common";

// Authenticate before parsing and use the same phone/demo resolver as /init.
export async function handleResetActor(req: Request, context: HttpContext): Promise<Response> {
  const body = await adminJson(req, context);
  const key = await adminActorKey(body, context);
  const result = await observe(context, "actor_reset_tickets", () =>
    context.env.CALLER_TICKETS.idFromName(key).resetTickets());
  if (!result || result.ok !== true) throw new HttpError(503, "invalid_reset_result");
  return Response.json({ ok: true });
}
