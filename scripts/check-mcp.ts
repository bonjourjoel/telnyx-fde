// Official MCP client verification of discovery, all authored topics, and
// negative inputs. Default mode runs the actual HTTP handler in-process with
// no port, account, .env file, or network. An explicit URL enables later public
// endpoint checks. Always close the client, including on failed assertions.

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import * as z from "zod/v4";
import { countWords, MIN_FAQ_LONG_ANSWER_WORDS, MAX_FAQ_LONG_ANSWER_WORDS } from "../src/contracts";
import { routeRequest } from "../src/index";

// Response contracts are independent of implementation helpers and validated
// after the actual SDK client receives an MCP result over its HTTP transport.
const TopicList = z.strictObject({ topics: z.array(z.strictObject({
  id: z.string(), title: z.string().min(1), coverage: z.string().min(1),
})) });
const ShortAnswer = z.strictObject({ topic_id: z.string(), title: z.string(), documentation_url: z.url() });
const LongAnswer = z.strictObject({ topic_id: z.string(), long_answer: z.string() });

// Protocol modes cover modern negotiation and the 2025 initialization handshake.
export type CheckMode = "auto" | "legacy";

// Small sanitized summary: no complete MCP payloads are printed by this script.
export interface McpCheckReport {
  mode: CheckMode;
  tool_count: number;
  topic_count: number;
  reading_calls: number;
  negative_cases: number;
}

// Serve SDK-generated HTTP requests through the real router, without bindings
// or secrets. Add the Host header normally supplied by an actual HTTP client.
export const localMcpFetch: typeof fetch = async (input, init) => {
  const incoming = new Request(input, init);
  const headers = new Headers(incoming.headers);
  headers.set("Host", new URL(incoming.url).host);
  return routeRequest(new Request(incoming, { headers }), {} as Env, {});
};

// Connect and verify the three tools with ids discovered from list_topics.
// Calls are sequential, including all topics and each negative scenario.
export async function checkMcpEndpoint(
  endpoint: URL, send: typeof fetch = localMcpFetch, mode: CheckMode = "auto",
): Promise<McpCheckReport> {
  const client = new Client({ name: "telnyx-fde-mcp-check", version: "0.1.0" },
    { versionNegotiation: { mode } });
  const transport = new StreamableHTTPClientTransport(endpoint, { fetch: send });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(),
      ["list_topics", "read_long_answer", "read_short_answer"]);
    assert.ok(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true));
    const discovery = await client.callTool({ name: "list_topics", arguments: {} });
    assert.ok(!discovery.isError);
    const { topics } = TopicList.parse(discovery.structuredContent);
    assert.ok(topics.length >= 10 && topics.length <= 15);
    assert.equal(new Set(topics.map((topic) => topic.id)).size, topics.length);

    for (const topic of topics) {
      const short = await client.callTool({ name: "read_short_answer", arguments: { topic_id: topic.id } });
      assert.ok(!short.isError);
      const summary = ShortAnswer.parse(short.structuredContent);
      assert.equal(summary.topic_id, topic.id);
      assert.equal(summary.title, topic.title);
      const source = new URL(summary.documentation_url);
      assert.equal(source.protocol, "https:");
      assert.equal(source.hostname, "developers.telnyx.com");
      const long = await client.callTool({ name: "read_long_answer", arguments: { topic_id: topic.id } });
      assert.ok(!long.isError);
      const answer = LongAnswer.parse(long.structuredContent);
      assert.equal(answer.topic_id, topic.id);
      const words = countWords(answer.long_answer);
      assert.ok(words >= MIN_FAQ_LONG_ANSWER_WORDS && words <= MAX_FAQ_LONG_ANSWER_WORDS);
    }

    // Unknown valid ids are explicit tool errors; malformed/extra parameters
    // must also fail rather than retrieve or invent documentation.
    const negativeCases = [
      { name: "read_short_answer", arguments: { topic_id: "unknown-topic" } },
      { name: "read_long_answer", arguments: { topic_id: "unknown-topic" } },
      { name: "read_long_answer", arguments: {} },
      { name: "read_short_answer", arguments: { topic_id: 42 } },
      { name: "read_long_answer", arguments: { topic_id: topics[0].id, extra: "private-parameter-marker" } },
      { name: "list_topics", arguments: { extra: "private-parameter-marker" } },
    ];
    for (const request of negativeCases) {
      const result = await client.callTool(request);
      assert.equal(result.isError, true);
    }
    return { mode, tool_count: tools.tools.length, topic_count: topics.length,
      reading_calls: topics.length * 2, negative_cases: negativeCases.length };
  } finally {
    await client.close();
  }
}

// Local is the default. Public verification is explicit and never reads a key.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf("--url");
  const endpoint = new URL(urlIndex >= 0 ? args[urlIndex + 1] : "https://localhost/mcp");
  if (endpoint.pathname !== "/mcp" || endpoint.search || endpoint.hash ||
    endpoint.username || endpoint.password || (urlIndex >= 0 && endpoint.protocol !== "https:")) {
    throw new Error("MCP endpoint must be an HTTPS /mcp URL without credentials or query");
  }
  const mode: CheckMode = args.includes("--legacy") ? "legacy" : "auto";
  let failedStatus: number | undefined;
  const baseSend = urlIndex >= 0 ? fetch : localMcpFetch;
  // Retain only HTTP status for diagnostics, never response bodies or headers.
  const reportingSend: typeof fetch = async (input, init) => {
    const response = await baseSend(input, init);
    if (!response.ok) failedStatus = response.status;
    return response;
  };
  try {
    const report = await checkMcpEndpoint(endpoint, reportingSend, mode);
    console.log(JSON.stringify({ operation: "check_mcp", outcome: "ok", ...report }));
  } catch {
    console.error(JSON.stringify({ operation: "check_mcp", outcome: "error", endpoint: "/mcp",
      mode, ...(failedStatus !== undefined ? { http_status: failedStatus } : {}), error: "verification_failed" }));
    process.exitCode = 1;
  }
}

// Importing this module for tests never executes a public request or local CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("MCP verification failed. Check endpoint configuration and sanitized request logs.");
    process.exitCode = 1;
  });
}
