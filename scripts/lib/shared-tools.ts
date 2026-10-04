// Shared-tool adapter and sequential synchronization of the four support tools.
// Desired payloads come from config/tools.ts; GET definitions are inspected,
// never sent back as inline tools or persisted with phone values.

import * as z from "zod/v4";
import { SUPPORT_TOOL_NAMES, type SharedToolDefinition, type SupportToolName } from "../../config/tools";
import { TelnyxApiError } from "./telnyx-api";
import { matchesDesired, upsertResource, type ResourceApi, type UpsertResult } from "./resource-upsert";
import type { DeploymentStateStore } from "./deployment-state";

// Native library response, including the separate root display name and timeout.
const ToolSchema = z.object({ id: z.string().min(1), type: z.string().min(1),
  display_name: z.string().nullable().optional(), timeout_ms: z.number().int().optional(),
  tool_definition: z.record(z.string(), z.unknown()) });
export type SharedToolResource = z.infer<typeof ToolSchema>;

// Support documented flat responses and the observed gateway envelope pattern.
function toolResource(value: unknown): SharedToolResource {
  const direct = ToolSchema.safeParse(value);
  if (direct.success) return direct.data;
  const wrapped = z.object({ data: ToolSchema }).safeParse(value);
  if (wrapped.success) return wrapped.data.data;
  throw new TelnyxApiError("invalid_shared_tool_resource");
}

// The library returns the native configuration directly in tool_definition;
// type stays at the resource root. Compare managed fields only, rejecting an
// expanded model parameter schema or variable allowlist despite extra defaults.
function configuredTool(resource: SharedToolResource, desired: SharedToolDefinition): boolean {
  return resource.display_name === desired.display_name && resource.type === desired.type &&
    resource.timeout_ms === desired.timeout_ms &&
    matchesDesired(resource.tool_definition, desired[desired.type]);
}

// Upsert by stored id or unique project-prefixed name. Timeout/rejection recovery
// uses the common algorithm and its per-tool pending key, with no automatic delete.
export async function upsertSharedTool(api: ResourceApi, store: DeploymentStateStore,
  role: SupportToolName, desired: SharedToolDefinition): Promise<UpsertResult<SharedToolResource>> {
  return upsertResource(api, store, {
    kind: "shared_tool", collection: "/ai/tools", updateMethod: "PATCH", body: desired,
    parse: toolResource, id: (resource) => resource.id,
    matches: (resource) => resource.display_name === desired.display_name,
    owns: (resource) => resource.display_name === desired.display_name,
    compliant: (resource) => configuredTool(resource, desired),
    storedId: (state) => state.shared_tool_ids?.[role],
    remember: (state, resource) => { state.shared_tool_ids = { ...state.shared_tool_ids, [role]: resource.id }; },
    pending: (state) => state.shared_tool_pending?.[role],
    checkpoint: (state, pending) => {
      if (pending) state.shared_tool_pending = { ...state.shared_tool_pending, [role]: pending };
      else if (state.shared_tool_pending) {
        delete state.shared_tool_pending[role];
        if (!Object.keys(state.shared_tool_pending).length) delete state.shared_tool_pending;
      }
    },
  });
}

// Sequential calls keep checkpoints concrete and make a partial deployment
// resumable. The returned summary contains only names, actions, and identifiers.
export async function syncSharedTools(api: ResourceApi, store: DeploymentStateStore,
  definitions: Record<SupportToolName, SharedToolDefinition>) {
  const summary: { tool: SupportToolName; action: string; id: string }[] = [];
  for (const role of SUPPORT_TOOL_NAMES) {
    const result = await upsertSharedTool(api, store, role, definitions[role]);
    summary.push({ tool: role, action: result.action, id: result.resource.id });
  }
  return summary;
}
