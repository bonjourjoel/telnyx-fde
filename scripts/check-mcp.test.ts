// Sequential offline MCP checks through the official HTTP client and real
// router. Verify protocol compatibility, safe errors, guards, and JSON logs.
// No Telnyx account, public endpoint, authentication file, or .env is accessed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMcpEndpoint, localMcpFetch } from "./check-mcp";
import { routeRequest } from "../src/index";

// Raw protocol requests cover HTTP boundaries independently of client helpers.
function protocolRequest(body: string, headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("https://localhost/mcp", { method,
    headers: { Host: "localhost", "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", ...headers },
    ...(method === "POST" ? { body } : {}),
  });
}

// Capture application logs while awaiting each scenario; restore on failure.
test("stateless MCP protocol and public catalogue", async (t) => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (value: unknown) => { lines.push(String(value)); };
  try {
    for (const mode of ["auto", "legacy"] as const) {
      await t.test(`official client: ${mode}, exactly three tools and twelve topics`, async () => {
        const traffic: string[] = [];
        const revisions = new Set<string>();
        const send: typeof fetch = async (input, init) => {
          const req = new Request(input, init);
          if (req.method === "POST") {
            const revision = req.headers.get("MCP-Protocol-Version");
            if (revision) revisions.add(revision);
            const body = await req.clone().json();
            traffic.push(body.method);
          }
          return localMcpFetch(req);
        };
        const report = await checkMcpEndpoint(new URL("https://localhost/mcp"), send, mode);
        assert.equal(report.tool_count, 3);
        assert.equal(report.topic_count, 12);
        assert.equal(report.reading_calls, 24);
        assert.equal(report.negative_cases, 6);
        assert.ok(traffic.includes("tools/list") && traffic.includes("tools/call"));
        if (mode === "legacy") {
          assert.ok(traffic.includes("initialize"));
          assert.ok([...revisions].some((revision) => revision.startsWith("2025-")));
        } else {
          assert.ok(revisions.has("2026-07-28"));
        }
      });
    }

    await t.test("Host and Origin validation reject unlisted values", async () => {
      const cases: Record<string, string>[] = [{ Host: "unlisted.invalid" }, { Origin: "https://unlisted.invalid" }];
      for (const headers of cases) {
        const response = await routeRequest(protocolRequest("{}", headers), {} as Env, {});
        assert.equal(response.status, 403);
      }
    });

    await t.test("SDK handles malformed protocol, unsupported methods and body size", async () => {
      const malformed = await routeRequest(protocolRequest("not-json"), {} as Env, {});
      assert.equal(malformed.status, 400);
      assert.match(malformed.headers.get("Content-Type") ?? "", /json/);
      for (const method of ["GET", "DELETE", "PUT"]) {
        const response = await routeRequest(protocolRequest("", {}, method), {} as Env, {});
        assert.equal(response.status, 405);
      }
      const oversized = await routeRequest(protocolRequest(" ".repeat(65 * 1024)), {} as Env, {});
      assert.equal(oversized.status, 413);
      const madeUpRoute = await routeRequest(new Request("https://localhost/mcp/tools/list"), {} as Env, {});
      assert.equal(madeUpRoute.status, 404);
    });

    await t.test("MCP request/tool logs correlate and exclude unknown ids and arguments", async () => {
      const text = lines.join("\n");
      for (const marker of ["private-parameter-marker", "unknown-topic", "unlisted.invalid", "not-json"]) {
        assert.ok(!text.includes(marker));
      }
      const events = lines.map((line) => JSON.parse(line));
      const tools = events.filter((event) => event.operation === "mcp_tool_call");
      assert.ok(tools.length > 0);
      assert.ok(tools.some((event) => event.outcome === "rejected"));
      assert.ok(tools.every((tool) => events.some((event) => event.operation === "mcp_request" &&
        event.request_id === tool.request_id)));
      assert.ok(events.every((event) => event.request_id && event.stage && event.operation && event.outcome &&
        typeof event.duration_ms === "number"));
      assert.ok(!events.some((event) => "payload" in event || "arguments" in event));
    });
  } finally {
    console.log = originalLog;
  }
});
