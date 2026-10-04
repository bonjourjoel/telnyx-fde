// Offline KV diagnostics checks. Reproduce SDK failures without account access,
// proving that only fixed categories/statuses escape the configuration boundary.

import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnoseKvError, SupportConfigError } from "../src/kv-errors";
import { readSupportConfig } from "../src/support-config";

// SDK status extraction must discard the complete upstream response body.
test("KV diagnostics classify SDK failures without retaining sensitive messages", () => {
  for (const [status, code] of [[401, "authentication"], [403, "permission"], [502, "upstream_http"]] as const) {
    const error = new Error(`env KV get("support/config") failed: HTTP ${status}: Bearer synthetic-private-token +12025550123`);
    assert.deepEqual(diagnoseKvError(error), { code, upstream_status: status });
    const safe = new SupportConfigError(diagnoseKvError(error));
    assert.ok(!JSON.stringify(safe).includes("synthetic-private-token"));
    assert.ok(!safe.message.includes("+12025550123"));
    assert.equal(safe.cause, undefined);
  }
  assert.deepEqual(diagnoseKvError(new SyntaxError("private JSON contents")), { code: "invalid_response" });
  assert.deepEqual(diagnoseKvError(new Error("fetch failed")), { code: "network" });
  assert.deepEqual(diagnoseKvError(new Error("request timed out")), { code: "timeout" });
  assert.deepEqual(diagnoseKvError(new Error("private unexpected failure")), { code: "unknown" });
});

// Absent bindings, malformed values and failed requests stay distinct and typed.
test("support reader reports safe diagnostic categories for unavailable KV", async () => {
  const failures = [
    { env: {} as Env, code: "binding_missing" },
    { env: { SUPPORT_CONFIG: { get: async () => null } } as unknown as Env, code: "invalid_configuration" },
    { env: { SUPPORT_CONFIG: { get: async () => { throw new Error('env KV get("support/config") failed: HTTP 403: private response'); } } } as unknown as Env, code: "permission" },
  ];
  for (const failure of failures) {
    await assert.rejects(readSupportConfig(failure.env), (error: unknown) => {
      assert.ok(error instanceof SupportConfigError);
      assert.equal(error.diagnostic.code, failure.code);
      assert.ok(!error.message.includes("private response"));
      return true;
    });
  }
});
