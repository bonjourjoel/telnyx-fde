// Assistant-specific reconciliation over the shared checkpointed upsert helper.
// Accept documented flat resources/data envelopes and merged shared-tool reads,
// while sending only the desired configuration and full workflow graph.

import * as z from "zod/v4";
import type { AssistantDefinition } from "../../config/assistant";
import type { ConversationFlow } from "../../config/workflow";
import type { DeploymentStateStore } from "./deployment-state";
import { matchesDesired, upsertResource, type ResourceApi } from "./resource-upsert";
import { TelnyxApiError } from "./telnyx-api";
import { WRITABLE_DYNAMIC_VARIABLE_KEYS } from "../../src/contracts";

// List/create/get share these identity fields; configuration is checked below.
const AssistantSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).passthrough();
export type AssistantResource = z.infer<typeof AssistantSchema>;

// Narrow object access without coercing malformed values into empty defaults.
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

// The official assistant responses are flat, unlike the MCP gateway envelope.
// Also support a validated data wrapper rather than assuming either shape.
function assistantResource(value: unknown): AssistantResource {
  const direct = AssistantSchema.safeParse(value);
  if (direct.success) return direct.data;
  const wrapped = z.object({ data: AssistantSchema }).safeParse(value);
  if (wrapped.success) return wrapped.data.data;
  throw new TelnyxApiError("invalid_assistant_resource");
}

// Compare complete graph membership by stable ids, ignoring canvas node order
// and resolved GET-only tools. Expression order per source remains significant.
function configuredFlow(value: unknown, desired: ConversationFlow): boolean {
  const flow = record(value);
  if (!flow || flow.start_node_id !== desired.start_node_id) return false;
  for (const field of ["nodes", "edges"] as const) {
    const entries = flow[field];
    if (!Array.isArray(entries) || entries.length !== desired[field].length) return false;
    const actual = new Map(entries.map((entry) => [record(entry)?.id, record(entry)]));
    if (actual.size !== entries.length) return false;
    for (const wanted of desired[field]) {
      const saved = actual.get(wanted.id);
      if (!saved) return false;
      const wantedType = "type" in wanted ? wanted.type : undefined;
      // Omitted prompt type/tools_mode have documented defaults. Null tools do
      // not mean an empty allowlist, so shared_tool_ids are compared unchanged.
      const normalized = field === "nodes" ? { ...saved, type: saved.type ?? "prompt",
        ...(wantedType === "prompt" ? { tools_mode: saved.tools_mode ?? "replace" } : {}) } : saved;
      if (!matchesDesired(normalized, wanted)) return false;
      if (field === "nodes" && ["model", "external_llm", "llm_api_key_ref", "voice_settings", "transcription"]
        .some((key) => saved[key] != null)) return false;
    }
    if (field === "edges") {
      // Telnyx evaluates variable guards in declaration order. Reversing the
      // guards could let stale status data bypass a failed initialization.
      const sources = new Set(desired.edges.filter(edge => edge.condition.type === "expression").map(edge => edge.start_node_id));
      for (const source of sources) {
        const wantedIds = desired.edges.filter(edge => edge.start_node_id === source && edge.condition.type === "expression").map(edge => edge.id);
        const actualIds = entries.map(record).filter(edge => edge?.start_node_id === source && record(edge.condition)?.type === "expression").map(edge => edge?.id);
        if (!matchesDesired(actualIds, wantedIds)) return false;
      }
    }
  }
  return true;
}

// GET merges shared tools into tools instead of necessarily returning tool_ids.
// Verify the shared hangup/updater and its exact writable allowlist without
// resending merged definitions. Node references are checked in configuredFlow.
function configuredAssistant(resource: AssistantResource, desired: AssistantDefinition): boolean {
  const { tools: _inline, tool_ids, conversation_flow, ...fields } = desired;
  if (!matchesDesired(resource, fields) || !configuredFlow(resource.conversation_flow, conversation_flow)) return false;
  const actualToolIds = resource.tool_ids;
  if (actualToolIds !== undefined && (!Array.isArray(actualToolIds) || actualToolIds.length !== tool_ids.length ||
    new Set(actualToolIds).size !== tool_ids.length || !tool_ids.every(id => actualToolIds.includes(id)))) return false;
  if (!Array.isArray(resource.tools) || resource.tools.length !== tool_ids.length) return false;
  const merged = resource.tools.map(record);
  if (merged.some(tool => tool?.shared !== true)) return false;
  const hangups = merged.filter(tool => tool?.type === "hangup");
  const updaters = merged.filter(tool => tool?.type === "update_dynamic_variables");
  if (hangups.length !== 1 || !record(hangups[0]?.hangup) || updaters.length !== 1) return false;
  const updater = record(updaters[0]?.update_dynamic_variables);
  if (updater?.name !== "SET_SUPPORT_VARIABLES" || !Array.isArray(updater.updatable_variables)) return false;
  return matchesDesired(updater.updatable_variables, WRITABLE_DYNAMIC_VARIABLE_KEYS.map(name => ({ name, type: "string" })), false, "updatable_variables");
}

// Availability is checked before deployment writes. This read spends no model
// tokens and never substitutes a different model silently if the chosen id fails.
export async function assertAssistantModelAvailable(api: ResourceApi, model: string): Promise<void> {
  const response = z.object({ data: z.array(z.object({ id: z.string().min(1) })) })
    .safeParse(await api.request("GET", "/ai/openai/models"));
  if (!response.success) throw new TelnyxApiError("invalid_model_catalogue", "GET", "/ai/openai/models");
  if (!response.data.data.some((entry) => entry.id === model)) {
    throw new TelnyxApiError("assistant_model_unavailable", "GET", "/ai/openai/models");
  }
}

// The Assistants API documents POST for updates and an unpaginated data list.
// Creation checkpoints/id read-back use the same safeguards as MCP and tools.
export async function upsertAssistant(api: ResourceApi, store: DeploymentStateStore, desired: AssistantDefinition) {
  return upsertResource(api, store, {
    kind: "assistant", collection: "/ai/assistants", updateMethod: "POST", listMode: "unpaginated", body: desired,
    parse: assistantResource, id: (resource) => resource.id,
    matches: (resource) => resource.name === desired.name,
    // An external provider would override model; stop rather than inherit one.
    owns: (resource) => resource.name === desired.name && !resource.external_llm && !resource.llm_api_key_ref,
    compliant: (resource) => configuredAssistant(resource, desired),
    storedId: (state) => state.assistant_id,
    remember: (state, resource) => {
      state.assistant_id = resource.id; state.assistant_name = resource.name; state.assistant_model = desired.model;
      if (typeof resource.version_id === "string") state.assistant_version_id = resource.version_id;
      const texmlId = record(resource.telephony_settings)?.default_texml_app_id;
      if (typeof texmlId === "string") state.assistant_default_texml_app_id = texmlId;
    },
    pending: (state) => state.assistant_creation_pending,
    checkpoint: (state, pending) => {
      if (pending) state.assistant_creation_pending = pending;
      else delete state.assistant_creation_pending;
    },
  });
}
