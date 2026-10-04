// One fixture loader and authenticated seed routine for Portal and phone callers.
// Importing this module performs no I/O; requests use the shared admin client.

import { readFile } from "node:fs/promises";
import type { SupportIdentityRequest } from "../../src/contracts";
import { submitAdminRequest, type AdminTarget } from "./admin-http";
import { isObject } from "../../src/http/common";

// Closed usage errors can be displayed safely, unlike file/network exceptions.
export class SeedUsageError extends Error {
  constructor(readonly code: "phone_number_required" | "invalid_seed_options") {
    super(code === "phone_number_required" ? "Phone number is required. Usage: npm.cmd run seedticketsphone -- <E164_PHONE>" :
      "Invalid seed options. See npm.cmd run help.");
    this.name = "SeedUsageError";
  }
}

// Missing phone arguments are errors. Subscriber existence is not checked;
// the common target boundary normalizes the expected international format.
export function seedIdentity(args: readonly string[]): SupportIdentityRequest {
  if (args.length === 1 && args[0] === "--web") return { conversation_channel: "web_call" };
  if (args[0] === "--phone" && (args.length < 2 || !args[1].trim())) throw new SeedUsageError("phone_number_required");
  if (args.length === 2 && args[0] === "--phone") return { conversation_channel: "phone_call", caller_phone: args[1] };
  throw new SeedUsageError("invalid_seed_options");
}

// Ready-to-use public demo records contain no caller number, URL or credential.
export async function loadTicketFixtures(): Promise<unknown[]> {
  const value: unknown = JSON.parse(await readFile(new URL("../../fixtures/tickets.json", import.meta.url), "utf8"));
  return prepareTicketFixtures(value);
}

// Relative ages keep the demo useful without editing dates. Existing operation
// ids never change, so reseeding cannot replace old records or their timestamps.
export function prepareTicketFixtures(value: unknown, now = Date.now()): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || !Number.isFinite(now)) throw new Error("Invalid ticket fixtures.");
  return value.map(ticket => {
    if (!isObject(ticket) || typeof ticket.created_days_ago !== "number" || typeof ticket.updated_days_ago !== "number" ||
      !Number.isSafeInteger(ticket.created_days_ago) || !Number.isSafeInteger(ticket.updated_days_ago) ||
      ticket.updated_days_ago < 0 || ticket.created_days_ago < ticket.updated_days_ago || ticket.created_days_ago > 10_000) {
      throw new Error("Invalid ticket fixture ages.");
    }
    // Emit only business fields; age/template metadata never reaches the Actor.
    return { subject: ticket.subject, description: ticket.description, operation_id: ticket.operation_id,
      status: ticket.status, status_summary: ticket.status_summary,
      created_at: new Date(now - ticket.created_days_ago * 86_400_000).toISOString(),
      updated_at: new Date(now - ticket.updated_days_ago * 86_400_000).toISOString() };
  });
}

// Both npm commands use this routine. Actor-side operation ids make replay
// append-only and idempotent; a new caller instance is created when needed.
export async function submitTicketFixtures(target: AdminTarget, tickets: unknown, secret: string,
  send: typeof fetch = fetch): Promise<number> {
  if (!Array.isArray(tickets) || tickets.length === 0) throw new Error("Ticket fixtures must be a nonempty array.");
  const result = await submitAdminRequest(target, secret, "/admin/seed", { tickets }, send);
  if (typeof result.added_count !== "number" || !Number.isSafeInteger(result.added_count) ||
    result.added_count < 0 || result.added_count > tickets.length) throw new Error("Invalid fixture response.");
  return result.added_count;
}
