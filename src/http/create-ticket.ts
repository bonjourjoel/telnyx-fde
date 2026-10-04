// Signed synchronous ticket-creation callback. Identity and operation_id come
// from preset tool fields; only confirmed, persisted actor results yield 200.

import { validateSubject, validateDescription, validateOperationId, type CreateTicketResponse } from "../contracts";
import { computeCallerKey } from "../security";
import { HttpError, observe, signedJson, type HttpContext } from "./common";

// Validate before actor access; explicitly translate the HTTP names to actor
// business input. Never forward caller_phone into persistent ticket storage.
export async function handleCreateTicket(req: Request, context: HttpContext): Promise<Response> {
  const body = await signedJson(req, context);
  const subject = validateSubject(typeof body.ticket_subject === "string" ? body.ticket_subject : undefined);
  const description = validateDescription(typeof body.ticket_description === "string" ? body.ticket_description : undefined);
  const operation = validateOperationId(typeof body.operation_id === "string" ? body.operation_id : undefined);
  if (!subject.ok || !description.ok || !operation.ok) throw new HttpError(400, "invalid_ticket_fields");
  if (!context.secrets.caller_hmac_key) throw new HttpError(503, "identity_unavailable");
  const phone = typeof body.caller_phone === "string" ? body.caller_phone : null;
  const key = await computeCallerKey(phone, context.secrets.caller_hmac_key);
  if (!key) throw new HttpError(422, "caller_identity_unusable");
  const result = await observe(context, "actor_create_ticket", () =>
    context.env.CALLER_TICKETS.idFromName(key).createTicket({
      subject: subject.value, description: description.value, operation_id: operation.value,
    }));
  if (!result || typeof result.id !== "string" || !result.id ||
    typeof result.reference !== "string" || !result.reference) {
    throw new HttpError(502, "invalid_actor_result");
  }
  const response: CreateTicketResponse = { ticket_id: result.id, ticket_reference: result.reference };
  return Response.json(response);
}
