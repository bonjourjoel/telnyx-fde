// Shared command entry point for seedticketsweb and seedticketsphone. Load the
// checked-in fixtures, deployed URL and admin secret only on explicit invocation.

import { pathToFileURL } from "node:url";
import { createDeploymentStateStore } from "./lib/deployment-state";
import { adminTargetFromDeployment, loadAdminSecret } from "./lib/admin-http";
import { SeedUsageError, seedIdentity, loadTicketFixtures, submitTicketFixtures } from "./lib/ticket-fixtures";
import { HttpError } from "../src/http/common";

// Validate command input before reading configuration or contacting the backend.
async function main(): Promise<void> {
  const identity = seedIdentity(process.argv.slice(2));
  const state = await createDeploymentStateStore().load();
  const target = adminTargetFromDeployment(state, identity);
  const tickets = await loadTicketFixtures();
  const count = await submitTicketFixtures(target, tickets, loadAdminSecret());
  console.log(JSON.stringify({ operation: "seed_tickets", outcome: "ok",
    conversation_channel: identity.conversation_channel, added_count: count }));
}

// Fixed diagnostic text only. Local input and server response excerpts never
// reach logs; a missing phone explicitly shows usage without displaying input.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof SeedUsageError) console.error(error.message);
    else if (error instanceof HttpError) console.error(JSON.stringify({ operation: "seed_tickets", outcome: "error", http_status: error.status, code: error.code }));
    else console.error("Ticket seeding failed. Check the required phone argument, deployment state, and admin secret. Run npm.cmd run help.");
    process.exitCode = 1;
  });
}
