// Persistent ticket management for one caller, addressed by an opaque HMAC key.
// Each method reads current storage, never a cached list from initialization.
// Telnyx serializes calls to an instance, including across awaits, and commits
// successful turns before replying. No custom lock or external HTTP is needed.

import { StatefulActor } from "@telnyx/edge-runtime";
import {
  NEW_TICKET_STATUS_SUMMARY,
  isValidIsoDate,
  validateDescription,
  validateOperationId,
  validateSubject,
  type ActorState,
  type CreateTicketInput,
  type CreateTicketResult,
  type DemoTicketInput,
  type SeedDemoTicketsInput,
  type SeedDemoTicketsResult,
  type Ticket,
  type ResetActorResult,
  type ValidationResult,
} from "../contracts";

// Store list and reference counter together; reserved runtime keys are avoided.
const STATE_KEY = "tickets_state";

// Raise a fixed validation message without including caller-provided content.
function rejectInput(message: string): never {
  const error = new Error(message);
  error.name = "ValidationError";
  throw error;
}

// Extract a validated, normalized string or reject before any storage write.
function validatedValue(result: ValidationResult): string {
  if (!result.ok) rejectInput(result.error);
  return result.value;
}

// Check the RPC envelope too: TypeScript types do not validate runtime inputs.
function requireObject(input: unknown): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    rejectInput("ticket input must be an object");
  }
}

// Normalize the shared business fields, explicitly dropping unrelated fields.
function validateCreation(input: CreateTicketInput): CreateTicketInput {
  requireObject(input);
  return {
    subject: validatedValue(validateSubject(input.subject)),
    description: validatedValue(validateDescription(input.description)),
    operation_id: validatedValue(validateOperationId(input.operation_id)),
  };
}

// Validate all fixture fields before the batch can change persistent state.
function validateDemoTicket(input: DemoTicketInput): DemoTicketInput {
  const creation = validateCreation(input);
  if (!["open", "in_progress", "resolved"].includes(input.status)) {
    rejectInput("invalid demo ticket status");
  }
  // A voice summary is required and bounded by the existing text limit.
  const statusSummary = validatedValue(validateDescription(input.status_summary));
  if (!isValidIsoDate(input.created_at) || !isValidIsoDate(input.updated_at)) {
    rejectInput("demo ticket dates must be valid ISO timestamps");
  }
  if (Date.parse(input.updated_at) < Date.parse(input.created_at)) {
    rejectInput("demo ticket update cannot precede creation");
  }
  return {
    ...creation,
    status: input.status,
    status_summary: statusSummary,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

// Append one ticket to the current state and consume exactly one reference.
// Both ordinary creation and fixture insertion use this same numbering logic.
function appendTicket(state: ActorState, input: DemoTicketInput): Ticket {
  if (state.next_ticket_number >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("ticket reference counter exhausted");
  }
  const ticket: Ticket = {
    id: crypto.randomUUID(),
    reference: `T-${String(state.next_ticket_number).padStart(4, "0")}`,
    ...input,
  };
  state.tickets.push(ticket);
  state.next_ticket_number += 1;
  return ticket;
}

// Own all tickets for one caller. Public methods are RPCs;
// the underscore-prefixed storage helper is excluded by Telnyx RPC dispatch.
export class CallerTickets extends StatefulActor {
  // Explicit test administration only. Delete just the business-state key;
  // the absent-key default restores an empty list and next reference T-0001.
  // Keep the actor identity and unrelated storage keys. Repetition is harmless.
  async resetTickets(): Promise<ResetActorResult> {
    await this.ctx.storage.delete(STATE_KEY);
    return { ok: true };
  }

  // Read all records. Filtering, ordering, and the voice limit belong to /init.
  async listTickets(): Promise<Ticket[]> {
    const state = await this._readState();
    return structuredClone(state.tickets);
  }

  // Read, deduplicate, append, and persist within one serialized actor call.
  // A storage failure propagates; no successful result is fabricated or logged.
  async createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
    const creation = validateCreation(input);
    const state = await this._readState();
    const existing = state.tickets.find(
      (ticket) => ticket.operation_id === creation.operation_id,
    );
    if (existing) return { id: existing.id, reference: existing.reference };

    const now = new Date().toISOString();
    const ticket = appendTicket(state, {
      ...creation,
      status: "open",
      status_summary: NEW_TICKET_STATUS_SUMMARY,
      created_at: now,
      updated_at: now,
    });
    await this.ctx.storage.put(STATE_KEY, state);
    return { id: ticket.id, reference: ticket.reference };
  }

  // Preparation only: validate the complete batch, then append absent fixtures.
  // Replays never update existing tickets, even if fixture text has changed.
  async seedDemoTickets(input: SeedDemoTicketsInput): Promise<SeedDemoTicketsResult> {
    requireObject(input);
    if (!Array.isArray(input.tickets)) rejectInput("demo tickets must be an array");
    const fixtures = input.tickets.map(validateDemoTicket);
    const state = await this._readState();
    let addedCount = 0;
    for (const fixture of fixtures) {
      if (state.tickets.some((ticket) => ticket.operation_id === fixture.operation_id)) {
        continue;
      }
      appendTicket(state, fixture);
      addedCount += 1;
    }
    // Avoid writing or consuming references when every fixture already exists.
    if (addedCount > 0) await this.ctx.storage.put(STATE_KEY, state);
    return { added_count: addedCount };
  }

  // Initialize only an absent key. Malformed stored state must fail visibly,
  // never silently reset the caller's tickets or numbering.
  private async _readState(): Promise<ActorState> {
    const state = await this.ctx.storage.get<ActorState>(STATE_KEY);
    if (state === undefined) return { next_ticket_number: 1, tickets: [] };
    if (
      state === null ||
      !Number.isSafeInteger(state.next_ticket_number) ||
      state.next_ticket_number < 1 ||
      !Array.isArray(state.tickets)
    ) {
      const error = new Error("invalid stored ticket state");
      error.name = "ActorError";
      throw error;
    }
    // Work on an isolated copy so a failed call cannot mutate a cached value.
    return structuredClone(state);
  }
}
