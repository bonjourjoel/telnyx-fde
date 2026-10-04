// Validate the organization's SDK credential before deploying. Renew only a
// confirmed invalid/expired token on the existing binding; never create duplicates,
// expose token values or confuse this resource with a per-function declaration.

import * as z from "zod/v4";
import { listMatches, type ResourceApi } from "./resource-upsert";
import { validateDeploymentState, type DeploymentStateStore } from "./deployment-state";
import { TelnyxApiError } from "./telnyx-api";

// Observed account inventory fields. Parsing drops any unexpected credentials.
const BindingSchema = z.object({ binding_id: z.uuid(), binding_type: z.string().min(1) });
type RuntimeBinding = z.infer<typeof BindingSchema>;
const COLLECTION = "/compute/bindings";

// Accept metadata directly or in the API's data envelope, never retaining extras.
function bindingResource(value: unknown): RuntimeBinding {
  const direct = BindingSchema.safeParse(value);
  if (direct.success) return direct.data;
  const wrapped = z.object({ data: BindingSchema }).safeParse(value);
  if (wrapped.success) return wrapped.data.data;
  throw new TelnyxApiError("invalid_runtime_binding_resource");
}

// HTTP 200 is not proof of validity. Read the actual validation status and accept
// renewal only for the specific invalid/expired-token result observed from Telnyx.
async function validToken(api: ResourceApi, id: string): Promise<boolean> {
  const path = `${COLLECTION}/${encodeURIComponent(id)}/actions/validate`;
  const result = z.object({ data: z.object({ status: z.enum(["valid", "invalid"]), message: z.string() }) })
    .safeParse(await api.request("POST", path));
  if (!result.success) throw new TelnyxApiError("invalid_runtime_binding_validation", "POST", path);
  if (result.data.data.status === "valid") return true;
  if (!/^binding token is invalid or expired\b/i.test(result.data.data.message)) {
    throw new TelnyxApiError("runtime_binding_validation_failed", "POST", path);
  }
  return false;
}

// Fully list before selecting, preserve the existing id and unrelated state,
// and fail on missing/duplicate/conflicting resources or unsuccessful reads.
export async function ensureRuntimeBinding(api: ResourceApi, store: DeploymentStateStore): Promise<{
  action: "reused" | "renewed"; id: string;
}> {
  const state = validateDeploymentState(await store.load());
  const matches = await listMatches(api, {
    kind: "runtime_binding", collection: COLLECTION, parse: bindingResource,
    id: (binding) => binding.binding_id, matches: (binding) => binding.binding_type === "telnyx-sdk",
  });
  if (matches.length !== 1) throw new TelnyxApiError(matches.length ? "duplicate_runtime_bindings" : "runtime_binding_missing", "GET", COLLECTION);
  const id = matches[0].binding_id;
  if (state.runtime_api_binding_id !== undefined && state.runtime_api_binding_id !== id) {
    throw new TelnyxApiError("runtime_binding_identity_conflict", "GET", COLLECTION);
  }
  state.runtime_api_binding_id = id;
  await store.save(state);
  if (await validToken(api, id)) return { action: "reused", id };

  const path = `${COLLECTION}/${encodeURIComponent(id)}`;
  let unknownRenewalError: TelnyxApiError | undefined;
  try {
    // The documented renewal operation generates credentials server-side.
    // Its response may contain sensitive fields: ignore it completely.
    await api.request("PUT", path);
  } catch (error) {
    // A lost successful response must not cause another renewal. Reconcile by
    // reading metadata and validation only; explicit rejected writes still fail.
    if (!(error instanceof TelnyxApiError) ||
      !["network_result_unknown", "invalid_api_response"].includes(error.code)) throw error;
    unknownRenewalError = error;
  }
  const current = bindingResource(await api.request("GET", path));
  if (current.binding_id !== id || current.binding_type !== "telnyx-sdk") {
    throw new TelnyxApiError("runtime_binding_identity_conflict", "GET", path);
  }
  if (!await validToken(api, id)) throw unknownRenewalError ?? new TelnyxApiError("runtime_binding_renewal_failed", "PUT", path);
  return { action: "renewed", id };
}
