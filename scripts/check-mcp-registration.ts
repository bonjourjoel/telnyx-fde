// Explicit account-level MCP registration experiment. Use the local API key
// without printing it, reuse or create the project's real connection, persist
// checkpoints atomically, and verify one matching resource. No Function deploy,
// KV/secret update, tool mutation, phone call, or disposable resource is involved.

import { pathToFileURL } from "node:url";
import { createDeploymentStateStore } from "./lib/deployment-state";
import {
  createMcpRegistryApi, ensureMcpRegistration, McpRegistrationError,
} from "./lib/mcp-registration";

// Shared atomic state repository; this check requires an existing deployment.
const stateStore = createDeploymentStateStore();

// Use the URL actually stored by deployment, not a URL inferred from the org.
// The explanatory guide's HTTP/SSE selector identifies the transport. Test
// "http" for our Streamable HTTP server, then verify its actual API read-back.
// Existing connections retain their actual registered type.
async function main(): Promise<void> {
  (process as { loadEnvFile?: (path: string) => void }).loadEnvFile?.(".env");
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new McpRegistrationError("api_key_missing");
  const api = createMcpRegistryApi(apiKey, fetch, (event) =>
    console.log(JSON.stringify({ operation: "mcp_registry_request", ...event })));
  // Diagnostic mode reports structure only. It never prints resource fields
  // or sends a write; use it when a real response differs from the OpenAPI.
  if (process.argv.includes("--inspect-list")) {
    const value = await api.request("GET", "/ai/mcp_servers?page[size]=100&page[number]=1");
    const object = value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
    console.log(JSON.stringify({ operation: "inspect_mcp_list", is_array: Array.isArray(value),
      root_fields: object ? Object.keys(object) : [],
      data_is_array: Array.isArray(object?.data),
      data_count: Array.isArray(object?.data) ? object.data.length : undefined,
      meta_fields: object?.meta !== null && typeof object?.meta === "object" ? Object.keys(object.meta) : [],
      total_results: object?.meta !== null && typeof object?.meta === "object" && "total_results" in object.meta
        ? object.meta.total_results : undefined,
    }));
    return;
  }
  const state = await stateStore.load();
  if (typeof state.func_url !== "string" || typeof state.func_name !== "string" || !state.func_name) {
    throw new McpRegistrationError("deployed_function_context_missing");
  }
  const base = new URL(state.func_url);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new McpRegistrationError("invalid_function_url");
  }
  const result = await ensureMcpRegistration(api, stateStore, {
    name: state.func_name + "-faq", candidate_type: "http", url: new URL("/mcp", base).href,
    allowed_tools: ["list_topics", "read_short_answer", "read_long_answer"],
  });
  console.log(JSON.stringify({ operation: "check_mcp_registration", outcome: "ok", action: result.action,
    mcp_server_id: result.server.id, registered_type: result.server.type, matching_count: result.matching_count }));
}

// No key, request header, response payload, environment dump, or stack trace is
// emitted. An uncertain operation retains its persisted checkpoint for recovery.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ operation: "check_mcp_registration", outcome: "error",
      ...(error instanceof McpRegistrationError ? {
        code: error.code, method: error.method, endpoint: error.endpoint,
        http_status: error.http_status, detail: error.detail,
      } : { code: "local_registration_failure" }) }));
    process.exitCode = 1;
  });
}
