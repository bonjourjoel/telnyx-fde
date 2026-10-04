// Sequential local checks for CallerTickets using the real actor class and a
// clone-on-read/write storage double. No network, credentials, or .env access.
// These checks prove business logic, not Telnyx durability or RPC serialization.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActorContext, ActorStorage } from "@telnyx/edge-runtime";
import { CallerTickets } from "../src/actors/caller-tickets";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_OPERATION_ID_LENGTH,
  MAX_SUBJECT_LENGTH,
  isValidIsoDate,
  type CreateTicketInput,
  type DemoTicketInput,
} from "../src/contracts";

// Minimal storage seam; values never share references with the actor or tests.
// Rejecting put simulates failure before commit, without emulating the runtime.
class TestStorage implements Pick<ActorStorage, "get" | "put"> {
  private readonly values = new Map<string, unknown>();
  writes = 0;
  failWrites = false;

  // Return a detached copy, as a persistent storage codec would.
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }

  // Commit only successful writes and count them to detect unnecessary updates.
  async put<T>(key: string, value: T): Promise<void> {
    if (this.failWrites) throw new Error("simulated storage failure");
    this.values.set(key, structuredClone(value));
    this.writes += 1;
  }
}

// Wire the real SDK base constructor to the two storage methods under test.
// No other ActorContext or Env facility is used by this class.
function actor(storage = new TestStorage()): CallerTickets {
  return new CallerTickets({ storage } as unknown as ActorContext, {} as Env);
}

// Synthetic business request, with no caller identity or real support content.
function creation(operationId = "local-create-1"): CreateTicketInput {
  return {
    subject: " Example subject ",
    description: " Example description ",
    operation_id: operationId,
  };
}

// Synthetic historical fixture. Its stable operation id makes seeding replayable.
function fixture(operationId = "local-fixture-1"): DemoTicketInput {
  return {
    ...creation(operationId),
    status: "in_progress",
    status_summary: "Investigation in progress.",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-02T11:00:00.000Z",
  };
}

// Assert empty state, generated fields, normalization, and a detached read result.
test("creation persists normalized tickets and assigns successive references", async () => {
  const storage = new TestStorage();
  const caller = actor(storage);
  assert.deepEqual(await caller.listTickets(), []);
  assert.equal(storage.writes, 0);
  const first = await caller.createTicket(creation());
  const second = await caller.createTicket(creation("local-create-2"));
  assert.equal(first.reference, "T-0001");
  assert.equal(second.reference, "T-0002");
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const tickets = await caller.listTickets();
  assert.equal(tickets.length, 2);
  assert.equal(tickets[0].subject, "Example subject");
  assert.equal(tickets[0].description, "Example description");
  assert.equal(tickets[0].status, "open");
  assert.equal(tickets[0].status_summary, "Awaiting handling.");
  assert.ok(isValidIsoDate(tickets[0].created_at));
  assert.equal(tickets[0].created_at, tickets[0].updated_at);
  tickets[0].subject = "Changed outside actor";
  assert.equal((await caller.listTickets())[0].subject, "Example subject");
});

// Reconstruct an actor with the same storage to catch accidental memory-only state.
test("a new actor instance reads existing state and deduplicates a replay", async () => {
  const storage = new TestStorage();
  const original = await actor(storage).createTicket(creation());
  const reconstructed = actor(storage);
  assert.equal((await reconstructed.listTickets()).length, 1);
  assert.deepEqual(await reconstructed.createTicket({ ...creation(), subject: "Changed retry" }), original);
  assert.equal(storage.writes, 1);
  assert.equal((await reconstructed.listTickets())[0].subject, "Example subject");
  assert.equal((await reconstructed.createTicket(creation("next-operation"))).reference, "T-0002");
  assert.deepEqual(await actor().listTickets(), []);
});

// Reject malformed RPC envelopes, empty fields, non-strings, and boundary excesses.
test("invalid creation inputs never write or consume a reference", async () => {
  const storage = new TestStorage();
  const caller = actor(storage);
  const invalid: unknown[] = [null, [], {},
    { ...creation(), subject: " " },
    { ...creation(), subject: 42 },
    { ...creation(), subject: "s".repeat(MAX_SUBJECT_LENGTH + 1) },
    { ...creation(), description: " " },
    { ...creation(), description: "d".repeat(MAX_DESCRIPTION_LENGTH + 1) },
    { ...creation(), operation_id: " " },
    { ...creation(), operation_id: "o".repeat(MAX_OPERATION_ID_LENGTH + 1) },
  ];
  for (const input of invalid) {
    await assert.rejects(caller.createTicket(input as CreateTicketInput), { name: "ValidationError" });
  }
  assert.equal(storage.writes, 0);
  assert.deepEqual(await caller.listTickets(), []);
  const result = await caller.createTicket({
    subject: "s".repeat(MAX_SUBJECT_LENGTH),
    description: "d".repeat(MAX_DESCRIPTION_LENGTH),
    operation_id: "o".repeat(MAX_OPERATION_ID_LENGTH),
  });
  assert.equal(result.reference, "T-0001");
});

// Fixture replays preserve business tickets and historical status/date fields.
test("fixtures append once and share numbering with ordinary creation", async () => {
  const storage = new TestStorage();
  const caller = actor(storage);
  await caller.createTicket(creation());
  const first = fixture();
  assert.deepEqual(await caller.seedDemoTickets({ tickets: [first, first, fixture("fixture-2")] }), { added_count: 2 });
  const beforeReplay = await caller.listTickets();
  assert.deepEqual(beforeReplay.map((ticket) => ticket.reference), ["T-0001", "T-0002", "T-0003"]);
  assert.equal(beforeReplay[1].status, first.status);
  assert.equal(beforeReplay[1].updated_at, first.updated_at);
  assert.deepEqual(await actor(storage).seedDemoTickets({ tickets: [{ ...first, status: "resolved" }] }), { added_count: 0 });
  assert.deepEqual(await caller.listTickets(), beforeReplay);
  assert.equal(storage.writes, 2);
  assert.equal((await caller.createTicket(creation("after-fixtures"))).reference, "T-0004");
});

// Validate a complete batch before writing, including dates and status metadata.
test("an invalid fixture rejects the whole batch without changing state", async () => {
  const storage = new TestStorage();
  const caller = actor(storage);
  await caller.createTicket(creation());
  const before = await caller.listTickets();
  const invalid: unknown[] = [
    { ...fixture(), status: "unknown" },
    { ...fixture(), status_summary: " " },
    { ...fixture(), created_at: "2026-02-31T10:00:00Z" },
    { ...fixture(), updated_at: "2026-08-01T10:00:00Z" },
    null,
  ];
  for (const input of invalid) {
    await assert.rejects(caller.seedDemoTickets({ tickets: [fixture("valid-first"), input as DemoTicketInput] }), { name: "ValidationError" });
  }
  assert.equal(storage.writes, 1);
  assert.deepEqual(await caller.listTickets(), before);
  assert.deepEqual(await caller.seedDemoTickets({ tickets: [] }), { added_count: 0 });
  assert.equal(storage.writes, 1);
});

// Failure is propagated and a subsequent successful call still gets T-0001.
test("storage failure never returns creation success", async () => {
  const storage = new TestStorage();
  const caller = actor(storage);
  storage.failWrites = true;
  await assert.rejects(caller.createTicket(creation()), /simulated storage failure/);
  assert.deepEqual(await caller.listTickets(), []);
  storage.failWrites = false;
  assert.equal((await caller.createTicket(creation())).reference, "T-0001");
});

// An unexpected stored shape is an error, never a reason to erase old data.
test("malformed persistent state fails without resetting it", async () => {
  const storage = new TestStorage();
  await storage.put("tickets_state", { next_ticket_number: 0, tickets: [] });
  await assert.rejects(actor(storage).createTicket(creation()), { name: "ActorError" });
  assert.equal(storage.writes, 1);
  assert.deepEqual(await storage.get("tickets_state"), { next_ticket_number: 0, tickets: [] });
});
