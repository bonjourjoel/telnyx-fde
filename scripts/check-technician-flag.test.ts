// Offline technician flag CLI checks. Cover strict mode parsing, pure config
// builders, the bounded KV transport seam, and every safe failure category.
// No .env, account resource, namespace creation, or provisioning is accessed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { TelnyxApiError } from "./lib/telnyx-api";
import {
  createRawKvClient, getTechnicianFlag, parseTechnicianMode, readRawConfig,
  reportFlag, setFlag, setTechnicianFlag, supportConfigPath,
  type RawKvClient,
} from "./lib/technician-flag";

// Configuration the deploy script provisions: every unrelated field must survive
// a flag write, and the existing primitive boolean must keep appearing in reads.
// Nested and unrelated fields exercise the full-config readback comparison so a
// write that drops or alters any field is detected, not just a flag mismatch.
const FULL_CONFIG = {
  technician_available: false,
  web_demo_identity: "portal-demo",
  portal_demo_target_sha256: "1eab918d377968e5a52df0765c346db6952cbecc3faacbe1a35c3619fbe543ed",
  unrelated_note: "should not be modified",
  nested: { a: 1, b: ["x", "y"] },
};

// Strict mode parsing rejects anything that is not exactly one of get/true/false
// before any .env load or account access. Empty/multiple/unknown args all fail
// with the same explicit code.
test("technician mode parser accepts exactly get/true/false", () => {
  assert.equal(parseTechnicianMode(["get"]), "get");
  assert.equal(parseTechnicianMode(["true"]), "true");
  assert.equal(parseTechnicianMode(["false"]), "false");
  for (const args of [[], ["get", "extra"], ["true", "now"], ["yes"], ["GET"], ["1"]]) {
    assert.throws(() => parseTechnicianMode(args), { code: "technician_flag_mode_required" });
  }
});

// The raw KV key path is the documented REST endpoint, with the configured
// namespace id and stable support/config key. An empty id fails explicitly.
test("support config path encodes namespace id and stable key, rejecting empty ids", () => {
  assert.equal(supportConfigPath("kv-123"),
    "/v2/storage/kvs/kv-123/keys/support%2Fconfig");
  assert.equal(supportConfigPath("kv-123", "support/config"),
    "/v2/storage/kvs/kv-123/keys/support%2Fconfig");
  assert.throws(() => supportConfigPath(""), { code: "technician_flag_namespace_missing" });
});

// Only the boolean is reported; any other shape fails instead of producing a
// default. Non-boolean values that look truthy/falsy must not pass through.
test("report flag exposes only the boolean and fails on malformed input", () => {
  assert.equal(reportFlag(FULL_CONFIG), false);
  assert.equal(reportFlag({ ...FULL_CONFIG, technician_available: true }), true);
  for (const value of [
    null, undefined, 1, "true", [], { technician_available: "true" },
    { technician_available: null }, {}, { technician_available: 1, other: 1 },
  ]) assert.throws(() => reportFlag(value), { code: "technician_flag_config_invalid" });
});

// The setter preserves every unrelated field verbatim and only flips the flag.
// The already-correct path marks the body so the CLI can skip the PUT entirely.
test("set flag preserves unrelated fields and reports already-correct values", () => {
  const flipped = setFlag(FULL_CONFIG, true);
  assert.equal(flipped.already, false);
  const next = JSON.parse(flipped.body);
  assert.equal(next.technician_available, true);
  assert.equal(next.web_demo_identity, FULL_CONFIG.web_demo_identity);
  assert.equal(next.portal_demo_target_sha256, FULL_CONFIG.portal_demo_target_sha256);
  assert.equal(next.unrelated_note, FULL_CONFIG.unrelated_note);
  assert.deepEqual(Object.keys(next).sort(), Object.keys(FULL_CONFIG).sort());
  const kept = setFlag(FULL_CONFIG, false);
  assert.equal(kept.already, true);
  assert.deepEqual(JSON.parse(kept.body), FULL_CONFIG);
  // A non-boolean existing flag never becomes a default during a write plan.
  for (const value of [
    null, "false", 0, [], {}, { technician_available: "true" },
  ]) assert.throws(() => setFlag(value, true), { code: "technician_flag_config_invalid" });
});

// In-memory KV transport double records every call so tests can assert that a set
// command does not silently PUT during a verification read or an already-correct
// value, and that an uncertain write never reports success.
interface RecordedCall { method: "GET" | "PUT"; path: string; body?: string }
function recordClient(config: unknown): { client: RawKvClient; calls: RecordedCall[]; writes: string[] } {
  const calls: RecordedCall[] = [];
  const writes: string[] = [];
  let stored = structuredClone(config);
  const client: RawKvClient = {
    async get(path) { calls.push({ method: "GET", path }); return { status: 200, body: JSON.stringify(stored) }; },
    async put(path, body) { calls.push({ method: "PUT", path, body }); writes.push(body);
      try { stored = JSON.parse(body); } catch { /* leave the stored value unchanged */ }
      return { status: 200 }; },
  };
  return { client, calls, writes };
}

// A client that returns a single deterministic status for reads, useful to test
// every closed failure category without writing back.
function failReads(status: number, body = ""): { client: RawKvClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: RawKvClient = {
    async get(path) { calls.push({ method: "GET", path }); return { status, body }; },
    async put(_path, body) { calls.push({ method: "PUT", path: supportConfigPath("kv-fail"), body }); return { status }; },
  };
  return { client, calls };
}

// A client that adopts a configured next status on PUT, useful to assert that an
// uncertain or rejected write never reports success and never retries.
function failWrite(writeStatus: number): { client: RawKvClient; calls: RecordedCall[]; writes: string[] } {
  const calls: RecordedCall[] = [];
  const writes: string[] = [];
  const client: RawKvClient = {
    async get(path) { calls.push({ method: "GET", path }); return { status: 200, body: JSON.stringify(FULL_CONFIG) }; },
    async put(path, body) { calls.push({ method: "PUT", path, body }); writes.push(body); return { status: writeStatus }; },
  };
  return { client, calls, writes };
}

// A successful get reports only the boolean and performs no PUT.
test("get mode reports the boolean and performs no write", async () => {
  const { client, calls } = recordClient(FULL_CONFIG);
  assert.equal(await getTechnicianFlag(client, "kv-123"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, supportConfigPath("kv-123"));
});

// A flag change writes the full JSON object with only the boolean modified,
// preserves every unrelated and nested field on the server, and reads back the
// full object before reporting success. No silent PUT runs during the readback.
test("set mode writes once, preserves fields, reads back, and reports success", async () => {
  const { client, calls, writes } = recordClient(FULL_CONFIG);
  const value = await setTechnicianFlag(client, "kv-123", true);
  assert.equal(value, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), { ...FULL_CONFIG, technician_available: true });
  // GET, PUT, then a verification GET.
  assert.deepEqual(calls.map(c => c.method), ["GET", "PUT", "GET"]);
  assert.equal(calls[1].path, supportConfigPath("kv-123"));
  assert.equal(calls[2].path, supportConfigPath("kv-123"));
});

// The already-correct value skips the PUT entirely; the CLI never claims an
// uncertain write succeeded.
test("already-correct flag skips the PUT and reports the value", async () => {
  const { client, calls, writes } = recordClient(FULL_CONFIG);
  assert.equal(await setTechnicianFlag(client, "kv-123", false), false);
  assert.equal(writes.length, 0);
  assert.deepEqual(calls.map(c => c.method), ["GET"]);
  // Reversing the same direction with a different starting flag exercises
  // both flipped paths.
  const flipped = recordClient({ ...FULL_CONFIG, technician_available: true });
  const result = await setTechnicianFlag(flipped.client, "kv-456", false);
  assert.equal(result, false);
  assert.equal(flipped.writes.length, 1);
  assert.deepEqual(JSON.parse(flipped.writes[0]), { ...FULL_CONFIG, technician_available: false });
});

// Unsafe reads never become a default boolean; the CLI never substitutes a
// missing configuration with false, identity, or a fallback KV value.
test("read failures never become a default and never trigger a PUT", async () => {
  for (const [status, code] of [
    [404, "technician_flag_config_missing"],
    [401, "technician_flag_read_unauthorized"],
    [403, "technician_flag_read_unauthorized"],
    [500, "technician_flag_read_failed"],
    [502, "technician_flag_read_failed"],
  ] as const) {
    const { client, calls } = failReads(status);
    await assert.rejects(getTechnicianFlag(client, "kv-fail"), { code });
    assert.deepEqual(calls.map(c => c.method), ["GET"]);
    await assert.rejects(setTechnicianFlag(client, "kv-fail", true), { code });
    // A failed read stops before any PUT; only the additional pre-write GET runs.
    assert.deepEqual(calls.map(c => c.method), ["GET", "GET"]);
  }
  // Empty body on a real 200 is an invalid configuration with the ACTUAL status
  // (200). The CLI must not invent a 404 here: a missing key is only reported
  // when the server actually returns 404.
  const emptyClient: RawKvClient = { async get() { return { status: 200, body: "" }; },
    async put() { return { status: 200 }; } };
  await assert.rejects(getTechnicianFlag(emptyClient, "kv-empty"), { code: "technician_flag_config_invalid" });
  // Non-JSON body on 200 is an invalid configuration, distinct from a missing key.
  const badJsonClient: RawKvClient = { async get() { return { status: 200, body: "not-json" }; },
    async put() { return { status: 200 }; } };
  await assert.rejects(getTechnicianFlag(badJsonClient, "kv-bad"), { code: "technician_flag_config_invalid" });
  // A 200 with a valid JSON object but a non-boolean flag fails the same way.
  const noFlagClient: RawKvClient = { async get() { return { status: 200, body: JSON.stringify({ web_demo_identity: "x" }) }; },
    async put() { return { status: 200 }; } };
  await assert.rejects(getTechnicianFlag(noFlagClient, "kv-noflag"), { code: "technician_flag_config_invalid" });
});

// Uncertain writes never report success. A 401/403/500 on PUT fails with the
// distinct unauthorized/write-failed codes, with no automatic retry.
test("uncertain or rejected writes fail without retry or a readback claim", async () => {
  for (const [status, code] of [
    [401, "technician_flag_write_unauthorized"],
    [403, "technician_flag_write_unauthorized"],
    [500, "technician_flag_write_failed"],
    [502, "technician_flag_write_failed"],
  ] as const) {
    const { client, calls, writes } = failWrite(status);
    await assert.rejects(setTechnicianFlag(client, "kv-write-fail", true), { code });
    assert.equal(writes.length, 1);
    assert.deepEqual(calls.map(c => c.method), ["GET", "PUT"]);
  }
});

// A failed readback after a successful PUT never claims success. The CLI may
// not silently treat a missing/5xx readback as the expected written value.
test("readback mismatch and readback failure fail rather than reporting success", async () => {
  const writes: string[] = [];
  const mismatchClient: RawKvClient = {
    // First read returns false. Write succeeds. Readback still returns false.
    async get() { return { status: 200, body: JSON.stringify(FULL_CONFIG) }; },
    async put(_path, body) { writes.push(body); return { status: 200 }; },
  };
  await assert.rejects(setTechnicianFlag(mismatchClient, "kv-mismatch", true), { code: "technician_flag_readback_mismatch" });
  assert.equal(writes.length, 1);
  // A 500 on readback fails with the read-failed code instead of falling back.
  let readCount = 0;
  const failedReadback: RawKvClient = {
    async get() {
      readCount += 1;
      if (readCount === 1) return { status: 200, body: JSON.stringify(FULL_CONFIG) };
      return { status: 500, body: "" };
    },
    async put() { return { status: 200 }; },
  };
  await assert.rejects(setTechnicianFlag(failedReadback, "kv-rb500", true), { code: "technician_flag_read_failed" });
});

// The set mode readback compares the FULL stored object, not just the boolean.
// A write that lands with the right boolean but drops, mutates, or adds an
// unrelated/nested field is a mismatch even though the flag matches.
test("readback verifies the full config, including nested and unrelated fields", async () => {
  // Successful write preserves every nested and unrelated field both directions.
  const { client, writes } = recordClient(FULL_CONFIG);
  const value = await setTechnicianFlag(client, "kv-preserve", true);
  assert.equal(value, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), { ...FULL_CONFIG, technician_available: true });
  // Reversing direction: true -> false also preserves nested/unrelated fields.
  const flipped = recordClient({ ...FULL_CONFIG, technician_available: true });
  const result = await setTechnicianFlag(flipped.client, "kv-reverse", false);
  assert.equal(result, false);
  assert.deepEqual(JSON.parse(flipped.writes[0]), { ...FULL_CONFIG, technician_available: false });

  // Readback returns the right boolean but a dropped nested field -> mismatch.
  const droppedNested = { ...FULL_CONFIG, technician_available: true };
  delete (droppedNested as Partial<typeof FULL_CONFIG>).nested;
  let dropCount = 0;
  const dropClient: RawKvClient = {
    async get() {
      dropCount += 1;
      return { status: 200, body: JSON.stringify(dropCount === 1 ? FULL_CONFIG : droppedNested) };
    },
    async put() { return { status: 200 }; },
  };
  await assert.rejects(setTechnicianFlag(dropClient, "kv-drop", true), { code: "technician_flag_readback_mismatch" });

  // Readback returns the right boolean but a mutated unrelated scalar -> mismatch.
  let mutatedCount = 0;
  const mutatedReadback = { ...FULL_CONFIG, technician_available: true, unrelated_note: "tampered" };
  const mutateClient: RawKvClient = {
    async get() {
      mutatedCount += 1;
      return { status: 200, body: JSON.stringify(mutatedCount === 1 ? FULL_CONFIG : mutatedReadback) };
    },
    async put() { return { status: 200 }; },
  };
  await assert.rejects(setTechnicianFlag(mutateClient, "kv-mutate", true), { code: "technician_flag_readback_mismatch" });

  // Property key reordering in the returned JSON still passes the deep equality
  // check, because isDeepStrictEqual treats objects as unordered key sets. Reverse
  // both the top-level and the nested key order so the assertion genuinely
  // exercises reordering, then confirm Object.keys differs while the semantic
  // readback still succeeds.
  let reorderCount = 0;
  const reorderedTrue = {
    nested: { b: ["x", "y"], a: 1 },
    unrelated_note: FULL_CONFIG.unrelated_note,
    portal_demo_target_sha256: FULL_CONFIG.portal_demo_target_sha256,
    web_demo_identity: FULL_CONFIG.web_demo_identity,
    technician_available: true,
  };
  assert.notDeepEqual(Object.keys(reorderedTrue), Object.keys(FULL_CONFIG));
  assert.notDeepEqual(Object.keys(reorderedTrue.nested), Object.keys(FULL_CONFIG.nested));
  const reorderClient: RawKvClient = {
    async get() {
      reorderCount += 1;
      return { status: 200, body: JSON.stringify(reorderCount === 1 ? FULL_CONFIG : reorderedTrue) };
    },
    async put() { return { status: 200 }; },
  };
  assert.equal(await setTechnicianFlag(reorderClient, "kv-reorder", true), true);
});

// Network failures that throw instead of returning a status must surface as the
// safe network_result_unknown code used by the shared TelnyxApi transport, never
// as a default boolean or a success claim. No raw exception text is propagated.
test("thrown network failures on read stop before any PUT and surface a safe code", async () => {
  // A read failure (network error) prevents any PUT. Only one GET was attempted.
  let readAttempts = 0;
  const networkReadClient: RawKvClient = {
    async get() { readAttempts += 1; throw new TelnyxApiError("network_result_unknown", "GET", supportConfigPath("kv-netread"), undefined); },
    async put() { throw new Error("PUT must not be called when the read failed"); },
  };
  await assert.rejects(getTechnicianFlag(networkReadClient, "kv-netread"), { code: "network_result_unknown" });
  await assert.rejects(setTechnicianFlag(networkReadClient, "kv-netread", true), { code: "network_result_unknown" });
  assert.equal(readAttempts, 2);
});

test("thrown network PUT fails with exactly one PUT, no retry, and no success claim", async () => {
  // A read succeeds; the PUT throws the safe network_result_unknown code. The
  // CLI must not retry and must not read back to "confirm" a value it could not
  // write. The thrown error carries no raw exception message.
  const calls: RecordedCall[] = [];
  let putCount = 0;
  const networkWriteClient: RawKvClient = {
    async get(path) { calls.push({ method: "GET", path }); return { status: 200, body: JSON.stringify(FULL_CONFIG) }; },
    async put(path, body) { putCount += 1; calls.push({ method: "PUT", path, body });
      throw new TelnyxApiError("network_result_unknown", "PUT", path, undefined); },
  };
  await assert.rejects(setTechnicianFlag(networkWriteClient, "kv-netwrite", true), { code: "network_result_unknown" });
  assert.equal(putCount, 1);
  assert.deepEqual(calls.map(c => c.method), ["GET", "PUT"]);
  // A thrown read on the verification step (write returned 200 then read threw)
  // also fails with the same safe code instead of claiming a stored value.
  let throwReadAfter = 0;
  const throwReadAfterClient: RawKvClient = {
    async get(path) {
      throwReadAfter += 1;
      if (throwReadAfter === 1) return { status: 200, body: JSON.stringify(FULL_CONFIG) };
      throw new TelnyxApiError("network_result_unknown", "GET", path, undefined);
    },
    async put() { return { status: 200 }; },
  };
  await assert.rejects(setTechnicianFlag(throwReadAfterClient, "kv-netverify", true), { code: "network_result_unknown" });
});

// The narrow adapter turns a TelnyxApi.fetch response into the status+body shape
// consumed by the helpers; the Authorization header and SDK details are kept out.
test("createRawKvClient adapts TelnyxApi.fetch into the narrow client", async () => {
  const seen: { method: string; path: string; body?: string }[] = [];
  const api = {
    fetch(path: string, init?: RequestInit) {
      seen.push({ method: (init?.method ?? "GET").toUpperCase(), path, body: init?.body as string | undefined });
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        return Promise.resolve(new Response(JSON.stringify(FULL_CONFIG), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    },
    async request() { throw new Error("should not be called"); },
  };
  const client = createRawKvClient(api);
  const got = await client.get("/v2/storage/kvs/kv-adapt/keys/support%2Fconfig");
  assert.equal(got.status, 200);
  assert.deepEqual(JSON.parse(got.body), FULL_CONFIG);
  const put = await client.put("/v2/storage/kvs/kv-adapt/keys/support%2Fconfig", JSON.stringify({ ...FULL_CONFIG, technician_available: true }));
  assert.equal(put.status, 200);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[1].method, "PUT");
  assert.equal(JSON.parse(String(seen[1].body)).technician_available, true);
});

// The read helper rejects a namespace id that is missing during construction,
// not at the network call. A malformed KV value never reaches the parser.
test("read helper rejects missing namespace id and compares only the boolean", async () => {
  const { client } = recordClient(FULL_CONFIG);
  await assert.rejects(readRawConfig(client, ""), { code: "technician_flag_namespace_missing" });
  const config = { ...FULL_CONFIG, technician_available: true };
  const okClient: RawKvClient = { async get() { return { status: 200, body: JSON.stringify(config) }; },
    async put() { return { status: 200 }; } };
  assert.equal(reportFlag(await readRawConfig(okClient, "kv-ok")), true);
});
