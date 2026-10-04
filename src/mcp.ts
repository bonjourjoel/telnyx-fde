// Public, stateless MCP endpoint for the documentation catalogue. The official
// SDK owns protocol parsing, HTTP methods, and per-request server lifecycle.
// No caller identity, KV, Actor, or secret is needed by these three read tools.

import {
  createMcpHandler, McpServer, hostHeaderValidationResponse,
  originValidationResponse, type CallToolResult,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { findFaqTopic, listFaqTopics } from "./faq";
import { errorCode, logEvent, OUTCOME, STAGE } from "./logging";

// Actual hostname returned by the earlier deployment, plus loopback for local
// checks. Update this list if hosting changes; never trust an incoming Host
// value to build its own allowlist.
const ALLOWED_HOSTNAMES = [
  "telnyx-fde-0768c5c4-b.telnyxcompute.com", "localhost", "127.0.0.1", "[::1]",
];

// The catalogue is called server-to-server, so no browser origins are needed.
// The SDK admits an absent Origin header and rejects unlisted present origins.
const ALLOWED_ORIGIN_HOSTNAMES: string[] = [];

// Malformed parameters are SDK errors; a well-formed but unknown id reaches the
// explicit catalogue lookup error. No question text is accepted as a parameter.
const TOPIC_INPUT = z.strictObject({
  topic_id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
});

// One consistent safety description for all three catalogue tools.
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
} as const;

// Supply standard text plus machine-readable data. Voice instructions can
// announce the short result's title without reading its separate URL aloud.
function toolResult(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

// Unknown ids never echo arbitrary input and never produce an invented answer.
function unknownTopic(): CallToolResult {
  return { isError: true, content: [{ type: "text", text: "Unknown topic_id. Use list_topics to select a supported topic." }] };
}

// Log the tool name and only a known catalogue id, never arguments or text.
function runTool(requestId: string, toolName: string, topicId: string | undefined,
  read: () => CallToolResult): CallToolResult {
  const start = Date.now();
  const result = read();
  logEvent({ request_id: requestId, stage: STAGE.MCP, operation: "mcp_tool_call",
    outcome: result.isError ? OUTCOME.REJECTED : OUTCOME.OK,
    duration_ms: Date.now() - start,
    detail: { tool_name: toolName, ...(topicId ? { topic_id: topicId } : {}) },
  });
  return result;
}

// Register exactly three read-only tools on each fresh server instance.
function createFaqServer(requestId: string): McpServer {
  const server = new McpServer({ name: "telnyx-fde-faq", version: "0.1.0" });
  // Discovery provides coverage so the assistant can choose a supported topic.
  server.registerTool("list_topics", {
    description: "List verified Telnyx documentation topics and their coverage. Use the returned ids for the reading tools.",
    inputSchema: z.strictObject({}),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => runTool(requestId, "list_topics", undefined, () => toolResult({ topics: listFaqTopics() })));

  // The short answer is the page title and source URL, not generated advice.
  server.registerTool("read_short_answer", {
    description: "Read the documentation title and URL for a listed topic. Announce the title; do not read the URL aloud.",
    inputSchema: TOPIC_INPUT,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ topic_id }) => {
    const topic = findFaqTopic(topic_id);
    return runTool(requestId, "read_short_answer", topic?.id, () => topic
      ? toolResult({ topic_id: topic.id, title: topic.title, documentation_url: topic.documentation_url })
      : unknownTopic());
  });

  // Return the same topic's authored explanation without runtime browsing.
  server.registerTool("read_long_answer", {
    description: "Read the authored 80 to 120 word voice explanation for the same topic_id used by the short answer.",
    inputSchema: TOPIC_INPUT,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ topic_id }) => {
    const topic = findFaqTopic(topic_id);
    return runTool(requestId, "read_long_answer", topic?.id, () => topic
      ? toolResult({ topic_id: topic.id, long_answer: topic.long_answer })
      : unknownTopic());
  });
  return server;
}

// Delegate every /mcp method without consuming or reserializing its body. SDK
// instances and reporting context are scoped to a request, not a call session.
export async function handleMcpRequest(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  let response: Response;
  try {
    const rejected = hostHeaderValidationResponse(request, ALLOWED_HOSTNAMES)
      ?? originValidationResponse(request, ALLOWED_ORIGIN_HOSTNAMES);
    if (rejected) {
      response = rejected;
    } else {
      const handler = createMcpHandler(() => createFaqServer(requestId), {
        legacy: "stateless", keepAliveMs: 0, maxSubscriptions: 0,
        maxRequestBodySize: 64 * 1024,
        // Reporting only: preserve the SDK's own MCP error response.
        onerror: (error) => logEvent({ request_id: requestId, stage: STAGE.MCP,
          operation: "mcp_protocol", outcome: OUTCOME.REJECTED,
          duration_ms: Date.now() - start, error_code: errorCode(error) }),
      });
      response = await handler.fetch(request);
    }
  } catch (error) {
    // Preserve a protocol-shaped failure, without SDK exception text or data.
    logEvent({ request_id: requestId, stage: STAGE.MCP, operation: "mcp_failure",
      outcome: OUTCOME.ERROR, duration_ms: Date.now() - start, error_code: errorCode(error) });
    response = Response.json({ jsonrpc: "2.0", id: null,
      error: { code: -32603, message: "Internal server error" } }, { status: 500 });
  }
  logEvent({ request_id: requestId, stage: STAGE.MCP, operation: "mcp_request",
    outcome: response.ok ? OUTCOME.OK : response.status < 500 ? OUTCOME.REJECTED : OUTCOME.ERROR,
    duration_ms: Date.now() - start, detail: { http_status: response.status } });
  return response;
}
