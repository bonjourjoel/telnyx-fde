// Shared local administration client for fixtures and an explicit actor reset.
// Validate the target, hide credentials/phone data, and perform no import-time I/O.

import { isSupportChannel, type SupportIdentityRequest } from "../../src/contracts";
import { normalizePhoneE164 } from "../../src/security";
import { HttpError, isObject } from "../../src/http/common";
import type { DeploymentState } from "./deployment-state";

// The URL is local tooling configuration; the backend still resolves identity.
export interface AdminTarget { base: URL; identity: SupportIdentityRequest }

// Validate one target without allowing a request to choose a demo Actor label.
export function parseAdminTarget(config: unknown): AdminTarget {
  if (!isObject(config) || typeof config.base_url !== "string" || !isSupportChannel(config.conversation_channel)) {
    throw new Error("invalid administration target");
  }
  const base = new URL(config.base_url);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("administration base_url must be an HTTPS origin without credentials");
  }
  if (config.conversation_channel === "web_call") return { base, identity: { conversation_channel: "web_call" } };
  const phone = typeof config.caller_phone === "string" ? normalizePhoneE164(config.caller_phone) : null;
  if (!phone) throw new Error("invalid local phone identity");
  return { base, identity: { conversation_channel: "phone_call", caller_phone: phone } };
}

// Seed and reset commands share the recorded live origin; no URL file copying.
export function adminTargetFromDeployment(state: Pick<DeploymentState, "func_url">, identity: SupportIdentityRequest): AdminTarget {
  if (typeof state.func_url !== "string") throw new Error("deployment URL is missing");
  return parseAdminTarget({ base_url: state.func_url, ...identity });
}

// Authenticate one fixed administration endpoint. No retries, redirects, account
// API calls or response excerpts; a lost response requires explicit user action.
export async function submitAdminRequest(target: AdminTarget, secret: string,
  path: "/admin/seed" | "/admin/reset-actor", fields: Record<string, unknown> = {}, send: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!secret) throw new Error("administration secret is missing");
  const response = await send(new URL(path, target.base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", "x-admin-secret": secret },
    // The validated target wins even if fields accidentally contains identity.
    body: JSON.stringify({ ...fields, ...target.identity }),
  });
  if (response.status !== 200) throw new HttpError(response.status, path === "/admin/seed" ? "seed_request_failed" : "reset_request_failed");
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("invalid administration response"); }
  if (!isObject(body)) throw new Error("invalid administration response");
  return body;
}

// Load a secret only when a command is explicitly run. A shell value also works.
export function loadAdminSecret(): string {
  const loadEnv = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  try { loadEnv?.(".env"); }
  catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
  const secret = process.env.TELNYX_FDE_ADMIN_SECRET;
  if (!secret) throw new Error("administration secret is missing");
  return secret;
}
