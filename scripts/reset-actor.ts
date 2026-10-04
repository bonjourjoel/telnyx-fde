// Explicit local command to clear one caller's ticket records. The default is
// the stable Portal demo; --phone reads a private target file. No deploy or seed.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createDeploymentStateStore, type DeploymentState } from "./lib/deployment-state";
import { loadAdminSecret, adminTargetFromDeployment, submitAdminRequest } from "./lib/admin-http";
import { HttpError, isObject } from "../src/http/common";

// Only an explicit --phone selects a real caller. Unknown flags never reset demo.
export function resetMode(args: readonly string[]): "web_call" | "phone_call" {
  if (args.length === 0) return "web_call";
  if (args.length === 1 && args[0] === "--phone") return "phone_call";
  throw new Error("Usage: npm.cmd run resetactor [-- --phone]");
}

// Reuse the recorded live origin; never hard-code a URL or accept a demo label.
export function resetTarget(state: DeploymentState, mode: "web_call" | "phone_call", privatePhone?: unknown) {
  return adminTargetFromDeployment(state, mode === "web_call" ? { conversation_channel: "web_call" } :
    { conversation_channel: "phone_call", caller_phone: isObject(privatePhone) && typeof privatePhone.caller_phone === "string" ? privatePhone.caller_phone : "" });
}

// Injectable HTTP seam lets tests assert the exact target without using secrets.
export async function submitActorReset(target: ReturnType<typeof resetTarget>, secret: string, send: typeof fetch = fetch): Promise<void> {
  const result = await submitAdminRequest(target, secret, "/admin/reset-actor", {}, send);
  if (result.ok !== true) throw new Error("invalid actor reset response");
}

// Loading state/env/private files happens only when the user invokes the command.
async function main(): Promise<void> {
  const mode = resetMode(process.argv.slice(2));
  const state = await createDeploymentStateStore().load();
  const phone: unknown = mode === "phone_call" ? JSON.parse(await readFile("reset-actor.local.json", "utf8")) : undefined;
  const target = resetTarget(state, mode, phone);
  console.log(`Reset target: ${mode === "web_call" ? "Portal demo" : "configured phone caller"}.`);
  await submitActorReset(target, loadAdminSecret());
}

// Report status without phone numbers, keys, response bodies or stack traces.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = performance.now();
  main().then(() => {
    console.log(`Reset duration: ${((performance.now() - started) / 1000).toFixed(1)}s`);
    console.log("✅ ACTOR RESET SUCCESS");
  }).catch((error: unknown) => {
    if (error instanceof HttpError) console.error(JSON.stringify({ operation: "reset_actor", outcome: "error", http_status: error.status, code: error.code }));
    else console.error("Actor reset failed. Check command options, local configuration and backend logs.");
    console.error(`Reset duration: ${((performance.now() - started) / 1000).toFixed(1)}s`);
    console.error("❌ ACTOR RESET FAILURE");
    process.exitCode = 1;
  });
}
