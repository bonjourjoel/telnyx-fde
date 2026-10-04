// MCP-specific configuration adapter over the shared durable upsert algorithm.
// The standalone check reads existing resources; deployment can update them by
// PUT while preserving their ids. Both paths use the verified HTTP transport.

import * as z from "zod/v4";
import { createTelnyxApi, TelnyxApiError, type ApiEvent } from "./telnyx-api";
import { upsertResource, type ResourceApi } from "./resource-upsert";
import type { DeploymentState, DeploymentStateStore } from "./deployment-state";

// Backward-compatible names keep the registration verification command stable.
export { TelnyxApiError as McpRegistrationError };
export type McpDeploymentState = DeploymentState;
export type McpStateStore = DeploymentStateStore;
export type McpRegistryApi = ResourceApi;

// No sensitive resource fields are persisted; validate only managed metadata.
const ServerSchema = z.object({ id: z.string().min(1), name: z.string().min(1),
  type: z.string().min(1), url: z.string().min(1),
  allowed_tools: z.array(z.string()).nullable().optional(), api_key_ref: z.string().nullable().optional() });
export type McpServerResource = z.infer<typeof ServerSchema>;

// candidate_type is retained for the original check interface. It is now http
// in this project, confirmed by authenticated creation and GET read-back.
export interface McpRegistrationConfig {
  name: string; url: string; candidate_type: string; allowed_tools: string[];
}

// Narrow the shared REST transport to MCP endpoints for the standalone check.
export function createMcpRegistryApi(apiKey: string, send: typeof fetch = fetch,
  onResponse?: (event: ApiEvent) => void): McpRegistryApi {
  const api = createTelnyxApi(apiKey, send, onResponse);
  return { async request(method, path, body, key) {
    if (!/^\/ai\/mcp_servers(?:$|\/|\?)/.test(path)) throw new TelnyxApiError("invalid_registry_endpoint");
    return api.request(method, path, body, key);
  } };
}

// Accept the documented flat resource and actual gateway data envelope.
function serverResource(value: unknown): McpServerResource {
  const direct = ServerSchema.safeParse(value);
  if (direct.success) return direct.data;
  const wrapped = z.object({ data: ServerSchema }).safeParse(value);
  if (wrapped.success) return wrapped.data.data;
  throw new TelnyxApiError("invalid_mcp_resource");
}

// Share reconciliation/checkpoints, selecting only resource-specific ownership
// and desired fields. Verification mode never mutates an existing connection.
export async function ensureMcpRegistration(api: McpRegistryApi, store: McpStateStore,
  config: McpRegistrationConfig, updateExisting = false) {
  const result = await upsertResource(api, store, {
    kind: "mcp", collection: "/ai/mcp_servers", updateMethod: "PUT",
    body: { name: config.name, type: config.candidate_type, url: config.url, allowed_tools: config.allowed_tools },
    // A public connection must clear an accidentally configured credential on
    // update; creation omits this unnecessary optional field as already tested.
    updateBody: { name: config.name, type: config.candidate_type, url: config.url,
      allowed_tools: config.allowed_tools, api_key_ref: null },
    parse: serverResource, id: (resource) => resource.id,
    matches: (resource) => resource.name === config.name || resource.url === config.url,
    owns: (resource) => resource.name === config.name && (updateExisting || resource.url === config.url),
    compliant: (resource) => resource.name === config.name && resource.url === config.url &&
      (!updateExisting || resource.type === config.candidate_type) && !resource.api_key_ref &&
      JSON.stringify([...(resource.allowed_tools ?? [])].sort()) === JSON.stringify([...config.allowed_tools].sort()),
    storedId: (state) => state.mcp_server_id,
    remember: (state, resource) => {
      state.mcp_server_id = resource.id; state.mcp_server_name = resource.name;
      state.mcp_server_type = resource.type; state.mcp_server_url = resource.url;
    },
    pending: (state) => state.mcp_registration_pending,
    checkpoint: (state, pending) => {
      if (pending) state.mcp_registration_pending = pending;
      else delete state.mcp_registration_pending;
    },
  }, updateExisting);
  return { action: result.action, server: result.resource, matching_count: result.matching_count };
}
