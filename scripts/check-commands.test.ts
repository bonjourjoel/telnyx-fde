// Verify public npm help and both seed entry modes against ready-made fixtures.
// All administration HTTP is routed in-process; no .env or live account access.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import type { ActorContext } from "@telnyx/edge-runtime";
import { COMMAND_USAGE, renderCommandHelp } from "./lib/commands";
import { seedIdentity, loadTicketFixtures, prepareTicketFixtures, submitTicketFixtures } from "./lib/ticket-fixtures";
import { adminTargetFromDeployment } from "./lib/admin-http";
import { routeRequest } from "../src/index";
import { CallerTickets } from "../src/actors/caller-tickets";

// Synthetic caller and recorded origin are isolated from the real deployment.
const PHONE = "+12025550123";
const STATE = { func_url: "https://local.invalid" };

// Command metadata must cover every actual executable script, without stale keys.
test("npm help covers actual scripts with descriptions and required arguments", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const help = renderCommandHelp(pkg.scripts);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), Object.keys(COMMAND_USAGE).sort());
  for (const name of Object.keys(pkg.scripts)) {
    assert.ok(help.includes("npm.cmd run " + name)); assert.ok(COMMAND_USAGE[name].description);
  }
  assert.match(help, /seedticketsphone -- <E164_PHONE>/);
  assert.ok(help.includes("Phone number is required"));
  assert.equal(pkg.scripts.seedticketsweb, "tsx scripts/seed-tickets.ts --web");
  assert.equal(pkg.scripts.seedticketsphone, "tsx scripts/seed-tickets.ts --phone");
  assert.throws(() => renderCommandHelp({ ...pkg.scripts, unexpected: "script" }));
  assert.throws(() => renderCommandHelp({ ...pkg.scripts, toString: "script" }));
  const missing = { ...pkg.scripts }; delete missing.deploy;
  assert.throws(() => renderCommandHelp(missing));
});

// Parsing never performs an existence lookup or silently changes target mode.
test("seed commands require one phone argument and derive the URL from state", () => {
  const web = seedIdentity(["--web"]);
  assert.deepEqual(web, { conversation_channel: "web_call" });
  assert.deepEqual(adminTargetFromDeployment(STATE, web).identity, web);
  const phone = seedIdentity(["--phone", PHONE]);
  assert.deepEqual(phone, { conversation_channel: "phone_call", caller_phone: PHONE });
  for (const args of [[], ["--phone"], ["--phone", " "], ["--all"], ["--web", PHONE], ["--phone", PHONE, "extra"]]) {
    assert.throws(() => seedIdentity(args));
  }
  assert.throws(() => seedIdentity(["--phone"]), { code: "phone_number_required" });
  assert.throws(() => adminTargetFromDeployment({}, web));
  assert.throws(() => adminTargetFromDeployment({ func_url: "http://local.invalid" }, web));
});

// Relative dates produce valid chronology while fixed operation ids deduplicate.
test("fixture preparation keeps dates recent and rejects impossible ages", async () => {
  const data = JSON.parse(await readFile(new URL("../fixtures/tickets.json", import.meta.url), "utf8"));
  const now = Date.parse("2030-01-10T12:00:00Z");
  const prepared = prepareTicketFixtures(data, now) as { created_at: string; updated_at: string; operation_id: string }[];
  assert.equal(prepared[1].created_at, "2030-01-08T12:00:00.000Z");
  assert.equal(prepared[1].updated_at, "2030-01-09T12:00:00.000Z");
  assert.equal(prepared[1].operation_id, data[1].operation_id);
  assert.ok(!Object.hasOwn(prepared[1], "created_days_ago"));
  for (const age of [-1, 0.5, 10_001]) assert.throws(() => prepareTicketFixtures([{ ...data[0], created_days_ago: age }], now));
  assert.throws(() => prepareTicketFixtures([{ ...data[0], updated_days_ago: 4 }], now));
});

// The real router and Actor class prove that a caller need not have called first.
// Both targets receive identical fixture data; replays preserve the existing ids.
test("ready fixtures seed new Portal and phone instances separately without duplicates", async () => {
  const tickets = await loadTicketFixtures(); assert.equal(tickets.length, 2);
  assert.ok(!JSON.stringify(tickets).includes(PHONE));
  const actors = new Map<string, CallerTickets>();
  const env = { SUPPORT_CONFIG: { get: async () => ({ technician_available: false, web_demo_identity: "offline-command-demo" }) },
    CALLER_TICKETS: { idFromName: (key: string) => {
      if (!actors.has(key)) {
        const values = new Map<string, unknown>();
        const storage = { get: async (key: string) => structuredClone(values.get(key)),
          put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); } };
        actors.set(key, new CallerTickets({ storage } as unknown as ActorContext, {} as Env));
      }
      return actors.get(key)!;
    } } } as unknown as Env;
  const logs: string[] = []; const original = console.log;
  console.log = (line: unknown) => { logs.push(String(line)); };
  const secrets = { admin_secret: "offline-command-admin", caller_hmac_key: "offline-command-hmac" };
  const bodies: unknown[] = [];
  const send: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://local.invalid/admin/seed"); assert.equal(init?.redirect, "error");
    bodies.push(JSON.parse(String(init?.body)));
    return routeRequest(new Request(String(url), init), env, secrets);
  };
  try {
    assert.equal(actors.size, 0);
    for (const args of [["--web"], ["--phone", PHONE]]) {
      const target = adminTargetFromDeployment(STATE, seedIdentity(args));
      assert.equal(await submitTicketFixtures(target, tickets, secrets.admin_secret, send), 2);
      const before = await [...actors.values()].at(-1)!.listTickets();
      assert.equal(await submitTicketFixtures(target, tickets, secrets.admin_secret, send), 0);
      assert.deepEqual(await [...actors.values()].at(-1)!.listTickets(), before);
    }
    assert.equal(actors.size, 2);
    assert.deepEqual(bodies[0], { tickets, conversation_channel: "web_call" });
    assert.deepEqual(bodies[2], { tickets, conversation_channel: "phone_call", caller_phone: PHONE });

    // A US caller is retrieved on a later signed initialization, proving the
    // phone seed follows the ordinary identity scheme rather than demo state.
    const keys = generateKeyPairSync("ed25519");
    const raw = JSON.stringify({ data: { event_type: "assistant.initialization", id: "seed-test-event",
      payload: { telnyx_conversation_channel: "phone_call", telnyx_end_user_target: PHONE, call_control_id: "seed-test-call" } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = new Request("https://local.invalid/init", { method: "POST", body: raw,
      headers: { "telnyx-timestamp": timestamp, "telnyx-signature-ed25519": sign(null, Buffer.from(timestamp + "|" + raw), keys.privateKey).toString("base64") } });
    const response = await routeRequest(request, env, { ...secrets,
      public_key: keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64") });
    assert.equal(response.status, 200); const variables = (await response.json()).dynamic_variables;
    assert.equal(variables.init_ok, true); assert.equal(variables.tickets_count, 2);
    assert.ok(!logs.join("\n").includes(PHONE)); assert.ok(!logs.join("\n").includes(secrets.admin_secret));
    assert.ok(!logs.join("\n").includes("Webhook signature troubleshooting"));
  } finally { console.log = original; }
});

// Invalid counts, denied requests and empty fixtures cannot announce success.
test("seed response and empty fixture failures remain explicit", async () => {
  const target = adminTargetFromDeployment(STATE, seedIdentity(["--web"]));
  const tickets = await loadTicketFixtures();
  await assert.rejects(submitTicketFixtures(target, [], "synthetic-secret", async () => { throw new Error("must not send"); }));
  await assert.rejects(submitTicketFixtures(target, tickets, "", async () => { throw new Error("must not send"); }));
  for (const result of [{ added_count: -1 }, { added_count: 3 }, { added_count: "2" }, {}]) {
    await assert.rejects(submitTicketFixtures(target, tickets, "synthetic-secret", async () => Response.json(result)));
  }
});
