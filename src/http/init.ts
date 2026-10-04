// Signed assistant-start callback. Reads caller tickets and the KV flag,
// returns voice-safe context, and degrades without claiming records are empty.

import {
  DEFAULT_INIT_DYNAMIC_VARIABLES, PRESENTABLE_TICKETS_LIMIT, RECENT_TICKET_WINDOW_DAYS,
  isValidIsoDate, isSupportChannel, type InitDynamicVariables, type PresentableTicket, type Ticket,
} from "../contracts";
import { OUTCOME } from "../logging";
import { computeTicketOperationId, computeWebTicketOperationId } from "../security";
import { resolveSupportIdentity } from "../identity";
import { readSupportConfig } from "../support-config";
import { HttpError, isObject, observe, signedJson, type HttpContext } from "./common";

// Validate dates rather than silently hiding corrupt records as old tickets.
// The verbal limit never deletes records and excludes description/operation_id.
function presentTickets(tickets: Ticket[]): PresentableTicket[] {
  const cutoff = Date.now() - RECENT_TICKET_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  for (const ticket of tickets) {
    if (!isValidIsoDate(ticket.created_at) || !isValidIsoDate(ticket.updated_at)) {
      throw new HttpError(503, "invalid_ticket_dates");
    }
  }
  return tickets
    .filter((ticket) => ticket.status === "open" || Date.parse(ticket.updated_at) >= cutoff)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id))
    .slice(0, PRESENTABLE_TICKETS_LIMIT)
    .map(({ id, reference, subject, status, status_summary, updated_at }) =>
      ({ id, reference, subject, status, status_summary, updated_at }));
}

// Read the documented envelope. A missing identity/context returns generic
// context; malformed envelopes and unsupported event types are rejected.
export async function handleInit(req: Request, context: HttpContext): Promise<Response> {
  const body = await signedJson(req, context);
  const data = body.data;
  if (!isObject(data) || data.event_type !== "assistant.initialization" || !isObject(data.payload)) {
    throw new HttpError(400, "invalid_initialization_event");
  }
  const payload = data.payload;
  const variables: InitDynamicVariables = { ...DEFAULT_INIT_DYNAMIC_VARIABLES };
  const channel = payload.telnyx_conversation_channel;
  if (!isSupportChannel(channel)) {
    context.outcome = OUTCOME.REJECTED;
    context.error_code = "ValidationError";
    return Response.json({ dynamic_variables: variables });
  }

  // Read independent dependencies even when one fails, so both failures are
  // observable. No raw call id, phone, ticket text, or full payload is logged.
  const configuration = observe(context, "kv_read", () => readSupportConfig(context.env));
  const results = await Promise.allSettled([
    configuration,
    observe(context, "actor_context_read", async () => {
      const identity = channel === "web_call" ? { conversation_channel: channel } : {
        conversation_channel: channel,
        caller_phone: typeof payload.telnyx_end_user_target === "string" ? payload.telnyx_end_user_target : "",
      };
      const resolved = await resolveSupportIdentity(identity, context.env, context.secrets.caller_hmac_key, configuration);
      if (!resolved) throw new HttpError(422, "caller_identity_unusable");
      const key = resolved.actor_key;
      const callId = typeof payload.call_control_id === "string" ? payload.call_control_id : null;
      const operationId = resolved.kind === "demo"
        ? await computeWebTicketOperationId(key, data.id, context.secrets.caller_hmac_key)
        : await computeTicketOperationId(key, callId, context.secrets.caller_hmac_key);
      // Demo reads remain available when an event id is missing, but creation
      // is disabled. No random id or fake native session field is substituted.
      const tickets = presentTickets(await context.env.CALLER_TICKETS.idFromName(key).listTickets());
      return { tickets, operationId };
    }),
  ]);
  const [config, caller] = results;
  if (config.status === "rejected" || caller.status === "rejected") {
    context.outcome = OUTCOME.ERROR;
    context.error_code = "ConfigError";
    return Response.json({ dynamic_variables: variables });
  }
  variables.init_ok = true;
  variables.can_create_ticket = caller.value.operationId !== null;
  variables.operation_id = caller.value.operationId ?? "";
  variables.technician_available = config.value.technician_available;
  variables.tickets_count = caller.value.tickets.length;
  variables.tickets_json = JSON.stringify(caller.value.tickets);
  variables.greeting_text = variables.tickets_count > 0
    ? `Hello, this is the Telnyx developer support line. I have ${variables.tickets_count} recent or open ${variables.tickets_count === 1 ? "ticket" : "tickets"} for you. Would you like to follow up on a ticket or ask a new question?`
    : "Hello, this is the Telnyx developer support line. How can I help you today?";
  return Response.json({ dynamic_variables: variables });
}
