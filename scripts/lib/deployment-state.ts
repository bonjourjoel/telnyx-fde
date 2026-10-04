// Atomic persistence of non-secret deployment identifiers and creation keys.
// Both the registration check and deployment use this repository, preserving
// unrelated fields and refusing malformed JSON instead of resetting resources.

import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { TelnyxApiError } from "./telnyx-api";

// A checkpoint ties a logical POST to its exact body across interrupted runs.
export interface CreationCheckpoint {
  idempotency_key: string; request_hash: string; started_at: string; rejected_status?: number;
}

// Identifiers/configuration metadata only. Phone numbers live in telephony.ts,
// credentials live in the local environment, and tickets remain in their Actor.
export interface DeploymentState extends Record<string, unknown> {
  func_id?: string; func_name?: string; func_url?: string;
  kv_namespace_id?: string; kv_namespace_name?: string;
  secrets_configured?: string[]; last_deployed_at?: string;
  mcp_server_id?: string; mcp_server_name?: string; mcp_server_type?: string; mcp_server_url?: string;
  mcp_registration_pending?: CreationCheckpoint;
  shared_tool_ids?: Record<string, string>;
  shared_tool_pending?: Record<string, CreationCheckpoint>;
  assistant_id?: string; assistant_name?: string; assistant_model?: string;
  assistant_version_id?: string; assistant_default_texml_app_id?: string;
  assistant_creation_pending?: CreationCheckpoint;
}
export interface DeploymentStateStore {
  load(): Promise<DeploymentState>;
  save(state: DeploymentState): Promise<void>;
}

// Malformed id/checkpoint maps must fail instead of looking like empty maps.
const CheckpointSchema = z.object({ idempotency_key: z.uuid(), request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  started_at: z.iso.datetime(), rejected_status: z.number().int().min(400).max(499).optional() });
const StateSchema = z.object({
  shared_tool_ids: z.record(z.string(), z.string().min(1)).optional(),
  shared_tool_pending: z.record(z.string(), CheckpointSchema).optional(),
  assistant_id: z.string().min(1).optional(),
  assistant_creation_pending: CheckpointSchema.optional(),
}).passthrough();

// Preserve future fields, while refusing malformed shared-tool tracking data.
export function validateDeploymentState(value: unknown): DeploymentState {
  const parsed = StateSchema.safeParse(value);
  if (!parsed.success) throw new TelnyxApiError("invalid_deployment_state");
  return parsed.data as DeploymentState;
}

// Return a file repository. Missing state is allowed only for initial deploy;
// a registration check requires the already-deployed Function context.
export function createDeploymentStateStore(path = "deployment-state.json", allowMissing = false): DeploymentStateStore {
  return {
    async load() {
      let content: string;
      try { content = await readFile(path, "utf8"); } catch (error: unknown) {
        if (allowMissing && error instanceof Error && "code" in error && error.code === "ENOENT") return {};
        throw new TelnyxApiError("deployment_state_unreadable");
      }
      try {
        const value: unknown = JSON.parse(content);
        return validateDeploymentState(value);
      } catch { /* Report no input excerpts or credential-like content. */ }
      throw new TelnyxApiError("invalid_deployment_state");
    },
    async save(state) {
      const temporary = path + ".tmp-" + randomUUID();
      try {
        await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
        await rename(temporary, path);
      } catch { throw new TelnyxApiError("deployment_state_write_failed"); }
      finally {
        await unlink(temporary).catch((error: unknown) => {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
            throw new TelnyxApiError("deployment_state_cleanup_failed");
          }
        });
      }
    },
  };
}
