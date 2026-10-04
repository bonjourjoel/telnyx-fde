// Explicit demo preparation command. Reads the ignored local fixture config
// and administration secret only when invoked. Never run during deployment.
// Output reports status and counts, never phone numbers, text, or credentials.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { normalizePhoneE164 } from "../src/security";
import { HttpError, isObject } from "../src/http/common";

// Fixed, ignored local file. Copy seed-demo.example.json and fill it privately.
const CONFIG_PATH = "seed-demo.local.json";

// Validate local input, then submit one authenticated request with a timeout.
async function main(): Promise<void> {
  const loadEnv = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  try {
    loadEnv?.(".env");
  } catch (error) {
    // A shell-injected admin secret also works when no .env file exists.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const secret = process.env.TELNYX_FDE_ADMIN_SECRET;
  if (!secret) throw new Error("administration secret is missing");
  const config: unknown = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const addedCount = await submitDemoFixtures(config, secret);
  console.log(JSON.stringify({ operation: "seed_demo", http_status: 200, added_count: addedCount }));
}

// Pure input boundary plus an injectable HTTP sender for offline script checks.
// No files or environment variables are accessed by importing/calling this seam.
export async function submitDemoFixtures(
  config: unknown, secret: string, send: typeof fetch = fetch,
): Promise<number> {
  if (!secret) throw new Error("administration secret is missing");
  if (!isObject(config) || typeof config.base_url !== "string" ||
    typeof config.caller_phone !== "string" || !normalizePhoneE164(config.caller_phone) ||
    !Array.isArray(config.tickets)) {
    throw new Error("invalid local fixture configuration");
  }
  const base = new URL(config.base_url);
  if (base.protocol !== "https:" || base.username || base.password ||
    base.pathname !== "/" || base.search || base.hash) {
    throw new Error("fixture base_url must be an HTTPS origin without credentials");
  }
  const response = await send(new URL("/admin/seed", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify({ caller_phone: config.caller_phone, tickets: config.tickets }),
  });
  if (response.status !== 200) throw new HttpError(response.status, "seed_request_failed");
  const result: unknown = await response.json();
  if (!isObject(result) || typeof result.added_count !== "number" ||
    !Number.isSafeInteger(result.added_count) || result.added_count < 0) {
    throw new Error("invalid fixture response");
  }
  return result.added_count;
}

// Exception details can contain local data or URLs; report a fixed failure only.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof HttpError) {
      console.error(JSON.stringify({ endpoint: "/admin/seed", http_status: error.status, error: error.code }));
    } else {
      console.error("Demo seeding failed. Check local configuration, authorization, and endpoint logs.");
    }
    process.exitCode = 1;
  });
}
