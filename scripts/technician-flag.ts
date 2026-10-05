// CLI entry for the technician_available flag. Three npm commands
// (technician:get / technician:true / technician:false) all run this script with
// one argument. Strict mode parsing rejects unknown/extra args before any .env
// load or account access. Tests/imports perform no I/O; only an explicit CLI
// invocation reads deployment state and reaches Telnyx.

import { pathToFileURL } from "node:url";
import { createTelnyxApi, sanitizeDiagnostic, TelnyxApiError } from "./lib/telnyx-api";
import { createDeploymentStateStore, type DeploymentState } from "./lib/deployment-state";
import {
  createRawKvClient, getTechnicianFlag, parseTechnicianMode, setTechnicianFlag,
  type TechnicianFlagMode,
} from "./lib/technician-flag";

// Display labels per mode for the startup banner; never include credentials.
const MODE_LABEL: Record<TechnicianFlagMode, string> = {
  get: "GET", true: "SET TRUE", false: "SET FALSE",
};

// The CLI reuses the namespace id recorded by an earlier deployment. It never
// creates a namespace or provisions missing configuration; a missing id fails
// explicitly before any account access.
function requireNamespace(state: DeploymentState): string {
  if (typeof state.kv_namespace_id !== "string" || !state.kv_namespace_id.trim()) {
    throw new TelnyxApiError("technician_flag_namespace_missing");
  }
  return state.kv_namespace_id;
}

// Run one mode against the existing KV support/config. .env is loaded only here,
// after mode parsing and namespace lookup; a shell-set TELNYX_API_KEY wins.
async function runTechnicianFlag(mode: TechnicianFlagMode): Promise<void> {
  const state = await createDeploymentStateStore().load();
  const namespaceId = requireNamespace(state);
  try { (process as { loadEnvFile?: (path: string) => void }).loadEnvFile?.(".env"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new TelnyxApiError("api_key_missing");
  // Reuse the shared bounded REST transport: fixed host, timeout, redaction.
  const client = createRawKvClient(createTelnyxApi(apiKey));
  if (mode === "get") {
    const value = await getTechnicianFlag(client, namespaceId);
    console.log(`technician_available = ${value}`);
  } else {
    const desired = mode === "true";
    const value = await setTechnicianFlag(client, namespaceId, desired);
    console.log(`technician_available = ${value}`);
  }
}

// Print a single sanitized failure line. No credential/raw error text/stack trace
// is shown; only the operation name, safe code, sanitized endpoint, and status.
function reportFatal(error: unknown, startedAt: number): void {
  if (error instanceof TelnyxApiError) {
    console.error(JSON.stringify({ operation: "technician_flag", outcome: "error", code: error.code,
      method: error.method ?? null,
      endpoint: sanitizeDiagnostic(error.endpoint ?? "", [process.env.TELNYX_API_KEY ?? ""]),
      http_status: error.http_status ?? null }));
  } else {
    console.error("Technician flag command failed. Check local state and .env.");
  }
  console.error(`Duration: ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  console.error("FAILED");
}

// Imports and tests perform no I/O; only the explicit CLI invocation loads .env.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const startedAt = performance.now();
  let mode: TechnicianFlagMode;
  try { mode = parseTechnicianMode(process.argv.slice(2)); }
  // Strict parsing stops before any .env load or account access. process.exit is
  // typed as `never`, so the assignment below is safe to keep uninitialized.
  catch (error) { reportFatal(error, startedAt); process.exit(1); }
  console.log(`Technician flag: ${MODE_LABEL[mode]}`);
  runTechnicianFlag(mode).then(() => {
    console.log(`Duration: ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log("OK");
  }).catch((error: unknown) => {
    reportFatal(error, startedAt);
    process.exitCode = 1;
  });
}
