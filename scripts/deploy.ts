// Idempotent deployment orchestrator for the telnyx-fde support assistant.
//
// Runs locally with `npm run deploy` (tsx). It provisions the resources the
// Function needs at runtime, then ships and validates. The script is safe to
// run repeatedly: it reuses identifiers stored in deployment-state.json and
// never resets already-created state.
//
// Order (matches ARCHITECTURE.md step 4):
//   1. Load .env (Node 24 process.loadEnvFile), confirm TELNYX_API_KEY.
//   2. Load deployment-state.json (or {}).
//   3. Resolve the KV namespace by id, then by name, then by creation. Never
//      create a duplicate of an existing namespace named
//      telnyx-fde-support-config.
//   4. Poll provision_ok before any write.
//   5. Seed support/config = {"technician_available":false} ONLY when the
//      key is absent. A previously set true or false is preserved.
//   6. Admin secret (hybrid, .env priority): use the value from .env if
//      present; otherwise generate one, persist it to .env, and push to
//      Telnyx. If the secret exists at Telnyx but .env has lost it, fail
//      explicitly; --regen-admin-secret overrides and rewrites both. The
//      secret only protects admin endpoints and never touches tickets.
//   7. HMAC caller key (Telnyx only). Generated once if missing at Telnyx,
//      otherwise preserved across deployments. Never written to .env.
//   8. Public key, fetched fresh from GET /v2/public_key each run and pushed
//      to Telnyx (stable across runs; idempotent push).
//   9. Patch telnyx.toml to add or update the [storage.kv.SUPPORT_CONFIG]
//      block, preserving every other declaration (Counter actor, func_id,
//      compatibility_date).
//  10. telnyx-edge types — regenerate telnyx-env.d.ts from the patched
//      manifest so SUPPORT_CONFIG: KvNamespace is typed.
//  11. telnyx-edge ship — deploy the Function (secrets are injected at ship
//      time).
//  12. Read the Function's invoke URL from `telnyx-edge list`.
//  13. Probe GET /health until it is 200 (deployed revision warming up).
//  14. Probe GET /admin/check-config with the admin secret header and verify
//      every dependency check passes (KV read + three secrets present).
//  15. Save deployment-state.json (ids + names only, never secret values).
//  16. Print the live URL, KV namespace id, and configured secret names.
//
// All errors are surfaced explicitly. A 401/403/5xx during namespace lookup
// is treated as an error, never as "resource absent", to avoid accidentally
// creating a duplicate after a transient failure.
//
// This file is part of the project's Node tooling and runs on Node 24 with
// `tsx`. It is NOT shipped to the Function.

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Project-level constants. KV namespace name and the config key are stable
// across deployments; renaming them would orphane previously written state.
const KV_NAMESPACE_NAME = "telnyx-fde-support-config";
const SUPPORT_CONFIG_KEY = "support/config";
const SEED_CONFIG_VALUE = JSON.stringify({ technician_available: false });

// Secret names use a project-prefixed scheme to avoid clashing with other
// functions in the same organization (secrets are org-scoped).
const ADMIN_SECRET_NAME = "TELNYX_FDE_ADMIN_SECRET";
const HMAC_SECRET_NAME = "TELNYX_FDE_CALLER_HMAC_KEY";
const PUBLIC_KEY_NAME = "TELNYX_FDE_PUBLIC_KEY";

// Telnyx REST API base. All REST calls in this script hit this host with the
// user's TELNYX_API_KEY as a bearer token.
const API_BASE = "https://api.telnyx.com";

// Local-only state file (gitignored) storing ids and names. Never contains
// secret values.
const STATE_FILE = "deployment-state.json";
const ENV_FILE = ".env";
const TELNYX_TOML = "telnyx.toml";

// Polling intervals (ms) used during namespace provisioning and post-ship
// health probing.
const PROVISION_POLL_INTERVAL_MS = 2000;
const PROVISION_POLL_TIMEOUT_MS = 60000;
const HEALTH_POLL_INTERVAL_MS = 2000;
const HEALTH_POLL_TIMEOUT_MS = 60000;

// Ship monitoring timeout. Match the CLI default to give cold builds room.
const SHIP_TIMEOUT = "10m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Persistent deployment state. Identifiers only; no secret values.
interface DeploymentState {
  func_id?: string;
  func_name?: string;
  func_url?: string;
  kv_namespace_id?: string;
  kv_namespace_name?: string;
  secrets_configured?: string[];
  last_deployed_at?: string;
}

// /v2/storage/kvs/{id} response shape (subset we read).
interface KvNamespaceResource {
  id: string;
  name: string;
  status: string;
}

// /v2/storage/kvs list response shape (subset we read).
interface KvNamespaceListResponse {
  data: KvNamespaceResource[];
  meta?: { page_number?: number; page_size?: number; total_pages?: number };
}

// /v2/storage/kvs/{id}/keys/{key} GET response: 200 with the raw value, or
// 404 when missing. We treat the body as text (raw bytes) and parse JSON
// ourselves.
// /v2/public_key response shape.
interface PublicKeyResponse {
  data: { public: string };
}

// ---------------------------------------------------------------------------
// Telnyx REST helpers
// ---------------------------------------------------------------------------

// Fetch the Telnyx REST API with the bearer token from .env. Throws on a non-
// 2xx response with the status and a (truncated, sanitized) body snippet so
// the caller sees the underlying cause.
async function telnyxFetch(
  path: string,
  init?: RequestInit & { expectedStatus?: number[] },
): Promise<Response> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new Error(
      "TELNYX_API_KEY is missing. Copy .env.example to .env and fill in your API key, then re-run `npm run deploy`.",
    );
  }
  // Normalize the caller-supplied headers into a plain record. HeadersInit
  // may be a Headers object, an array of [key, value] pairs, or a record;
  // only Headers has a .has() method, so we avoid it entirely and fold every
  // incoming string-valued header into the final record.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  const incoming = init?.headers;
  let hasContentType = false;
  if (incoming) {
    if (typeof incoming === "string") {
      // Single string header form; leave to fetch to parse. Cover edge case.
      const parsed = new Headers(incoming);
      parsed.forEach((value, key) => {
        headers[key] = value;
        if (key.toLowerCase() === "content-type") hasContentType = true;
      });
    } else if (Array.isArray(incoming)) {
      for (const [k, v] of incoming) {
        if (typeof v === "string") {
          headers[k] = v;
          if (k.toLowerCase() === "content-type") hasContentType = true;
        }
      }
    } else if (incoming instanceof Headers) {
      incoming.forEach((value, key) => {
        headers[key] = value;
        if (key.toLowerCase() === "content-type") hasContentType = true;
      });
    } else {
      // HeadersInit also allows a Record<string,string>.
      for (const [k, v] of Object.entries(incoming)) {
        if (typeof v === "string") {
          headers[k] = v;
          if (k.toLowerCase() === "content-type") hasContentType = true;
        }
      }
    }
  }
  // Default Content-Type for JSON bodies, unless the caller already set one.
  if (init?.body && !hasContentType) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method || "GET",
    body: init?.body,
    headers,
  });
  return res;
}

// Fetch and return the parsed JSON body. Throws on a non-2xx status. The error
// message includes the path, status, and a short body snippet for diagnosis.
async function telnyxJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await telnyxFetch(path, init);
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const snippet =
      typeof body === "string"
        ? body.slice(0, 200)
        : JSON.stringify(body).slice(0, 200);
    throw new Error(
      `Telnyx ${init?.method || "GET"} ${path} -> ${res.status}: ${snippet}`,
    );
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

// Replace every occurrence of each `redact` value in `text` with "[REDACTED]".
// Uses split/join instead of String.replace to avoid regex-escaping issues when
// a secret value contains characters like ".", "$", or "/".
function redactIn(text: string, redact: string[]): string {
  let out = text;
  for (const v of redact) {
    if (v && v.length > 0) {
      out = out.split(v).join("[REDACTED]");
    }
  }
  return out;
}

// Options for runCli:
//   - display: masked representation of `args` used in the error message
//     prefix (e.g. ["secrets", "add", "<name>", "[REDACTED]"]).
//   - redact:  list of literal values to scrub from e.message and stderr in
//     the error message. Node's execFile error embeds the original command
//     (including arguments) in e.message, so the secret value would otherwise
//     reappear right after the masked prefix. We redact every occurrence in
//     both e.message and stderr; the command name, secret name, exit code,
//     and stderr cause remain visible for diagnosis.
interface RunCliOptions {
  display?: string[];
  redact?: string[];
}

// Run `telnyx-edge <args>` and return trimmed stdout. Throws on a non-zero
// exit code; the error includes stderr for diagnosis. Callers that pass a
// secret value as an argument (pushSecret) MUST supply both:
//   - display: a masked version of the command for the error prefix.
//   - redact:  the secret value(s) to scrub from Node's execFile error.
async function runCli(args: string[], opts?: RunCliOptions): Promise<string> {
  const shown = opts?.display ?? args;
  const redact = opts?.redact ?? [];
  try {
    const r = await execFileAsync("telnyx-edge", args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return (r.stdout || "").trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    // Scrub the secret value from Node's error message (which embeds the
    // original command + args) and from stderr, then build the final message.
    const msg = redactIn(e.message || "", redact);
    const stderr = redactIn((e.stderr || "").trim(), redact);
    throw new Error(
      `telnyx-edge ${shown.join(" ")} failed: ${msg}${
        stderr ? "\n--- stderr ---\n" + stderr : ""
      }`,
    );
  }
}

// Parse `telnyx-edge secrets list` output into a Set of secret names. The
// output is a fixed-column table with a 2-line header followed by rows. The
// SECOND whitespace-separated column is the secret name.
async function getSecretsList(): Promise<Set<string>> {
  const out = await runCli(["secrets", "list"]);
  const lines = out.split(/\r?\n/);
  // Skip until we find the line of dashes, then read every non-empty line.
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^-+\s/.test(lines[i])) {
      dataStart = i + 1;
      break;
    }
  }
  const names = new Set<string>();
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    // Columns are separated by 2+ spaces. The second column is the name.
    const cols = line.split(/\s{2,}/);
    if (cols.length >= 2 && cols[1] && !/^-+/.test(cols[1])) {
      names.add(cols[1].trim());
    }
  }
  return names;
}

// Parse `telnyx-edge list` output to find our function's invoke URL by
// function name. The output is a fixed-column table; we match the row by
// name and read the last column (INVOKE URL).
async function getInvokeUrl(funcName: string): Promise<string> {
  const out = await runCli(["list", "--page", "1", "--page-size", "100"]);
  const lines = out.split(/\r?\n/);
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^-+\s/.test(lines[i])) {
      dataStart = i + 1;
      break;
    }
  }
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    // The INVOKE URL column is the last whitespace-separated token.
    const urlMatch = line.match(/(https?:\/\/\S+)\s*$/);
    const nameCol = line.split(/\s{2,}/)[1];
    if (urlMatch && nameCol && nameCol.trim() === funcName) {
      return urlMatch[1];
    }
  }
  throw new Error(
    `Could not find the invoke URL for function "${funcName}" in \`telnyx-edge list\` output.`,
  );
}

// ---------------------------------------------------------------------------
// .env helpers
// ---------------------------------------------------------------------------

// Read .env as an array of lines. Returns [] when the file is absent so the
// first run (before .env exists) can still complete the API-key check via
// process.env alone.
async function readEnvLines(): Promise<string[]> {
  try {
    const content = await readFile(ENV_FILE, "utf8");
    return content.split(/\r?\n/);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "ENOENT") return [];
    throw err;
  }
}

// Parse .env lines into a key->value map, ignoring comments and blanks.
// Strips surrounding quotes from values.
function parseEnvMap(lines: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k.length > 0) map[k] = v;
  }
  return map;
}

// Upsert a single key in .env. If the key exists, its line is replaced in
// place; otherwise the line is appended. All other lines (including
// TELNYX_API_KEY and any unrelated variable) are preserved verbatim.
async function upsertEnvKey(key: string, value: string): Promise<void> {
  const lines = await readEnvLines();
  const prefix = `${key}=`;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(prefix)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  const out = (found ? lines : [...lines, `${key}=${value}`]).join("\n");
  // Ensure the file ends with a newline.
  const finalOut = out.endsWith("\n") ? out : out + "\n";
  await writeFile(ENV_FILE, finalOut, "utf8");
}

// ---------------------------------------------------------------------------
// deployment-state.json helpers
// ---------------------------------------------------------------------------

async function loadState(): Promise<DeploymentState> {
  try {
    const content = await readFile(STATE_FILE, "utf8");
    return JSON.parse(content) as DeploymentState;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "ENOENT") return {};
    throw err;
  }
}

async function saveState(state: DeploymentState): Promise<void> {
  const json = JSON.stringify(state, null, 2) + "\n";
  await writeFile(STATE_FILE, json, "utf8");
}

// ---------------------------------------------------------------------------
// telnyx.toml patching
// ---------------------------------------------------------------------------

// Ensure telnyx.toml contains a [storage.kv.SUPPORT_CONFIG] block with the
// given namespace id. Preserves every other declaration in the manifest:
//   - If the block already exists, only its `id = "..."` line is replaced.
//   - Otherwise, the block is inserted immediately before [edge_compute] so
//     the top-level keys and [[actors]] blocks remain untouched.
async function ensureKvBlockInToml(kvId: string): Promise<void> {
  const existing = await readFile(TELNYX_TOML, "utf8");
  const blockHeader = "[storage.kv.SUPPORT_CONFIG]";
  const newBlock = `${blockHeader}\nid = "${kvId}"\n`;

  if (existing.includes(blockHeader)) {
    // If the existing block already carries the exact target id line, this is
    // a re-deploy with no manifest change: succeed without rewriting the file
    // so the second (and every subsequent) deploy is a no-op here.
    const idLine = `id = "${kvId}"`;
    const blockStart = existing.indexOf(blockHeader);
    // The block's id line is the first `id = "..."` line after the header.
    const afterHeader = existing.slice(blockStart);
    const idMatch = /\nid\s*=\s*"([^"]*)"/.exec(afterHeader);
    if (idMatch && idMatch[1] === kvId) {
      console.log(
        `${TELNYX_TOML}: [storage.kv.SUPPORT_CONFIG] already has id = "${kvId}"; no change.`,
      );
      return;
    }

    // Replace the existing block's id line. Match the block header line
    // followed by its id line, regardless of surrounding whitespace.
    const pattern = new RegExp(
      String.raw`(\[storage\.kv\.SUPPORT_CONFIG\][^\n]*\n)\s*id\s*=\s*"[^"]*"\n`,
    );
    const updated = existing.replace(pattern, `${blockHeader}\nid = "${kvId}"\n`);
    if (updated === existing) {
      // This branch now only triggers when the block's syntax is structurally
      // different from what we expect, not when the id is already correct.
      throw new Error(
        `Found ${blockHeader} in ${TELNYX_TOML} but could not rewrite its id line. Please edit it manually to: id = "${kvId}".`,
      );
    }
    await writeFile(TELNYX_TOML, updated, "utf8");
    return;
  }

  // Insert before [edge_compute]. Anchor on the [edge_compute] header.
  const marker = "[edge_compute]";
  const idx = existing.indexOf(marker);
  if (idx < 0) {
    throw new Error(
      `Could not find ${marker} in ${TELNYX_TOML}. Ensure the manifest still declares the [edge_compute] block.`,
    );
  }
  const updated = existing.slice(0, idx) + newBlock + "\n" + existing.slice(idx);
  await writeFile(TELNYX_TOML, updated, "utf8");
}

// ---------------------------------------------------------------------------
// Step 3: KV namespace resolution
// ---------------------------------------------------------------------------

// Resolve the KV namespace id. Order:
//   1. If state.kv_namespace_id is set, verify the namespace exists and
//      reuse it. A 404 falls through to (2); any other failure is an error.
//   2. List all namespaces and look for one named KV_NAMESPACE_NAME. If
//      found, reuse it.
//   3. Otherwise, create the namespace.
async function resolveKvNamespace(state: DeploymentState): Promise<string> {
  // 1. Verify the id stored in state, if any.
  if (state.kv_namespace_id) {
    try {
      const res = await telnyxFetch(
        `/v2/storage/kvs/${encodeURIComponent(state.kv_namespace_id)}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { data: KvNamespaceResource };
        if (body?.data?.id === state.kv_namespace_id) {
          console.log(
            `KV namespace found by stored id: ${state.kv_namespace_id} (${body.data.name}).`,
          );
          return state.kv_namespace_id;
        }
      }
      if (res.status !== 404) {
        throw new Error(
          `GET /v2/storage/kvs/${state.kv_namespace_id} -> ${res.status}: ${await res.text()}`,
        );
      }
      // 404 → fall through to name lookup.
      console.log(
        `Stored kv_namespace_id ${state.kv_namespace_id} no longer exists; looking up by name.`,
      );
    } catch (err) {
      // Network errors must NOT be treated as "absent".
      throw err;
    }
  }

  // 2. List all namespaces, looking for the configured name.
  let page = 1;
  for (;;) {
    const body = await telnyxJson<KvNamespaceListResponse>(
      `/v2/storage/kvs?page_number=${page}&page_size=100`,
    );
    const items = body.data ?? [];
    for (const item of items) {
      if (item.name === KV_NAMESPACE_NAME) {
        console.log(
          `KV namespace found by name "${KV_NAMESPACE_NAME}": ${item.id}.`,
        );
        return item.id;
      }
    }
    const totalPages = body.meta?.total_pages ?? 1;
    if (page >= totalPages) break;
    page += 1;
  }

  // 3. Create the namespace.
  console.log(`Creating KV namespace "${KV_NAMESPACE_NAME}"...`);
  const createRes = await telnyxJson<{ data: KvNamespaceResource }>(
    "/v2/storage/kvs",
    {
      method: "POST",
      body: JSON.stringify({ name: KV_NAMESPACE_NAME }),
    },
  );
  const created = createRes.data;
  if (!created?.id) {
    throw new Error(`Create KV namespace returned no id: ${JSON.stringify(createRes)}`);
  }
  console.log(`KV namespace created: ${created.id}.`);
  return created.id;
}

// Poll the namespace status until it reaches provision_ok (or provision_failed).
// Throws on timeout or failure status.
async function pollKvProvisioning(namespaceId: string): Promise<void> {
  const deadline = Date.now() + PROVISION_POLL_TIMEOUT_MS;
  for (;;) {
    const body = await telnyxJson<{ data: KvNamespaceResource }>(
      `/v2/storage/kvs/${encodeURIComponent(namespaceId)}`,
    );
    const status = body?.data?.status;
    if (status === "provision_ok") {
      console.log(`KV namespace ${namespaceId} is ready.`);
      return;
    }
    if (status === "provision_failed" || status === "deleted") {
      throw new Error(
        `KV namespace ${namespaceId} provisioning failed (status=${status}).`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `KV namespace ${namespaceId} did not become ready within ${PROVISION_POLL_TIMEOUT_MS / 1000}s (status=${status}).`,
      );
    }
    console.log(`KV status=${status}; waiting ${PROVISION_POLL_INTERVAL_MS / 1000}s...`);
    await sleep(PROVISION_POLL_INTERVAL_MS);
  }
}

// Seed support/config ONLY when the key is absent. We GET the key; a 404 means
// absent and triggers the PUT. Any other non-2xx is an error. If the key
// already exists (technician_available true or false), it is preserved.
async function seedSupportConfig(namespaceId: string): Promise<void> {
  const keyUrl = `/v2/storage/kvs/${encodeURIComponent(namespaceId)}/keys/${encodeURIComponent(
    SUPPORT_CONFIG_KEY,
  )}`;
  const res = await telnyxFetch(keyUrl);
  if (res.ok) {
    const body = await res.text();
    console.log(
      `support/config already exists; preserving current value (${body}).`,
    );
    return;
  }
  if (res.status !== 404) {
    throw new Error(
      `GET ${keyUrl} -> ${res.status}: ${await res.text()} (network/server error is NOT treated as "key absent").`,
    );
  }
  // 404 → seed.
  const putRes = await telnyxFetch(keyUrl, {
    method: "PUT",
    body: SEED_CONFIG_VALUE,
  });
  if (!putRes.ok) {
    throw new Error(
      `PUT ${keyUrl} -> ${putRes.status}: ${await putRes.text()}`,
    );
  }
  console.log(`support/config seeded with ${SEED_CONFIG_VALUE}.`);
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

// Push a secret to Telnyx (idempotent: `secrets add` overwrites if the name
// already exists). The secret value is passed to the CLI as a real argument
// but masked as "[REDACTED]" in any error message so a failed command never
// leaks it. Both safeguards are required because Node's execFile error embeds
// the original command (including the value) in its message: `display` masks
// the prefix, and `redact` scrubs the value from the rest of the message and
// from stderr. The command name, the secret name, the exit code, and the
// stderr cause remain visible for diagnosis.
async function pushSecret(name: string, value: string): Promise<void> {
  await runCli(["secrets", "add", name, value], {
    display: ["secrets", "add", name, "[REDACTED]"],
    redact: [value],
  });
  console.log(`Secret "${name}" pushed to Telnyx.`);
}

// Resolve the admin secret. The hybrid logic, exactly as agreed:
//   - --regen-admin-secret: generate, replace ONLY the TELNYX_FDE_ADMIN_SECRET
//     line in .env (preserving TELNYX_API_KEY and anything else), push to
//     Telnyx.
//   - .env value present: use it as-is and push to Telnyx (idempotent).
//   - .env absent, Telnyx absent: generate, append to .env, push to Telnyx.
//   - .env absent, Telnyx present: explicit error instructing the user to
//     restore the value or to re-run with --regen-admin-secret.
async function resolveAdminSecret(regenRequested: boolean): Promise<void> {
  const envLines = await readEnvLines();
  const envMap = parseEnvMap(envLines);
  const existingAtTelnyx = await getSecretsList();
  const atTelnyx = existingAtTelnyx.has(ADMIN_SECRET_NAME);
  const inEnv = envMap[ADMIN_SECRET_NAME];

  if (regenRequested) {
    const value = randomBytes(32).toString("base64");
    await upsertEnvKey(ADMIN_SECRET_NAME, value);
    await pushSecret(ADMIN_SECRET_NAME, value);
    console.log(
      `Admin secret regenerated. .env's ${ADMIN_SECRET_NAME} line was replaced; other variables preserved. Tickets are untouched.`,
    );
    return;
  }

  if (inEnv && inEnv.length > 0) {
    await pushSecret(ADMIN_SECRET_NAME, inEnv);
    return;
  }

  if (!atTelnyx) {
    const value = randomBytes(32).toString("base64");
    await upsertEnvKey(ADMIN_SECRET_NAME, value);
    await pushSecret(ADMIN_SECRET_NAME, value);
    console.log(
      `Admin secret generated and appended to .env. Keep .env safe; the value is never displayed by the CLI.`,
    );
    return;
  }

  // atTelnyx && !inEnv && !regen
  throw new Error(
    `${ADMIN_SECRET_NAME} exists at Telnyx but is missing from .env (or empty). To recover, either:
  1. Restore the original ${ADMIN_SECRET_NAME} value into .env and re-run (preserves the existing admin secret), OR
  2. Re-run with --regen-admin-secret to generate a new value, replace ONLY the ${ADMIN_SECRET_NAME} line in .env, and push it to Telnyx. This only changes admin access; tickets and fixtures are NOT affected.`,
  );
}

// Resolve the HMAC caller key. Always stored at Telnyx only (never in .env,
// since the Function reads it via the injected env var, not from a local
// file). Generated once if missing; preserved across deployments to keep
// actor keys stable (changing it would change every caller's Actor key).
async function resolveHmacSecret(): Promise<void> {
  const atTelnyx = (await getSecretsList()).has(HMAC_SECRET_NAME);
  if (atTelnyx) {
    console.log(`HMAC secret "${HMAC_SECRET_NAME}" already at Telnyx; preserved.`);
    return;
  }
  const value = randomBytes(32).toString("base64");
  await pushSecret(HMAC_SECRET_NAME, value);
  console.log(
    `HMAC secret generated and pushed to Telnyx. It is NOT written to .env; the Function reads it through the injected env var. Keep it stable: regenerating would change every caller's Actor key.`,
  );
}

// Fetch the org's public key and push it to Telnyx as a secret. The public
// key is stable across runs; re-fetching and re-pushing is idempotent.
async function pushPublicKey(): Promise<void> {
  const res = await telnyxJson<PublicKeyResponse>("/v2/public_key");
  const publicKey = res?.data?.public;
  if (!publicKey || publicKey.length === 0) {
    throw new Error(
      `GET /v2/public_key returned no public key: ${JSON.stringify(res)}`,
    );
  }
  await pushSecret(PUBLIC_KEY_NAME, publicKey);
}

// ---------------------------------------------------------------------------
// Post-ship validation
// ---------------------------------------------------------------------------

// Probe GET /health until it returns 200 or the timeout is reached. Throws
// on timeout. The deployed revision can take several seconds to warm up.
async function probeHealth(funcUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  const url = `${funcUrl.replace(/\/+$/, "")}/health`;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`GET ${url} -> 200. Function is up.`);
        return;
      }
    } catch {
      // Network error: function not yet routable.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `GET ${url} did not return 200 within ${HEALTH_POLL_TIMEOUT_MS / 1000}s.`,
      );
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
}

// Probe GET /admin/check-config with the admin secret and verify every
// dependency check passes. Throws if any check fails, with the full response
// body in the error message so the deployer can see which dependency is
// broken (KV read failed, which secret is missing, etc.).
async function probeCheckConfig(funcUrl: string): Promise<void> {
  const envLines = await readEnvLines();
  const envMap = parseEnvMap(envLines);
  const adminSecret = envMap[ADMIN_SECRET_NAME];
  if (!adminSecret) {
    throw new Error(
      `Cannot call /admin/check-config: ${ADMIN_SECRET_NAME} is not in .env.`,
    );
  }
  const url = `${funcUrl.replace(/\/+$/, "")}/admin/check-config`;
  const res = await fetch(url, {
    headers: { "x-admin-secret": adminSecret },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `GET ${url} -> ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }
  const b = body as {
    ok?: boolean;
    kv?: { ok?: boolean; technician_available?: boolean | null };
    secrets?: { all_present?: boolean; required?: string[]; present?: string[] };
  };
  if (!b.ok || !b.kv?.ok || !b.secrets?.all_present) {
    throw new Error(
      `/admin/check-config dependency checks failed:\n${JSON.stringify(b, null, 2)}`,
    );
  }
  console.log(
    `/admin/check-config -> 200. KV ok, technician_available=${b.kv.technician_available}. All ${b.secrets.required?.length || 0} secrets present: ${(b.secrets.present || []).join(", ")}.`,
  );
  if (b.kv.technician_available !== false && b.kv.technician_available !== true) {
    throw new Error(
      `/admin/check-config: technician_available is not a boolean (got ${JSON.stringify(b.kv.technician_available)}).`,
    );
  }
  console.log(
    `Flag value preserved (technician_available=${b.kv.technician_available}). Subsequent deployments accept either true or false.`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== telnyx-fde deploy (step 4) ===");

  // 1. Load .env. process.loadEnvFile is available on Node 24.
  try {
    // loadEnvFile does not overwrite existing process.env entries by default,
    // which is what we want: a shell-set value wins.
    (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.(ENV_FILE);
    console.log(`Loaded ${ENV_FILE}.`);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "ENOENT") {
      throw new Error(
        `${ENV_FILE} not found. Copy .env.example to ${ENV_FILE}, fill in TELNYX_API_KEY (and optionally TELNYX_FDE_ADMIN_SECRET), then re-run.`,
      );
    }
    throw err;
  }
  if (!process.env.TELNYX_API_KEY) {
    throw new Error(
      "TELNYX_API_KEY is missing in .env / environment. Set it before running `npm run deploy`.",
    );
  }
  const regenRequested = process.argv.includes("--regen-admin-secret");

  // 2. State.
  const state = await loadState();

  // 3. KV namespace.
  const kvId = await resolveKvNamespace(state);
  state.kv_namespace_id = kvId;
  state.kv_namespace_name = KV_NAMESPACE_NAME;

  // 4. Poll provisioning before any write.
  await pollKvProvisioning(kvId);

  // 5. Seed support/config only if absent.
  await seedSupportConfig(kvId);

  // 6. Admin secret (hybrid, .env priority).
  await resolveAdminSecret(regenRequested);

  // 7. HMAC caller key (Telnyx only, stable).
  await resolveHmacSecret();

  // 8. Public key.
  await pushPublicKey();

  // 9. Patch telnyx.toml.
  await ensureKvBlockInToml(kvId);
  console.log(`${TELNYX_TOML}: [storage.kv.SUPPORT_CONFIG] id = "${kvId}".`);

  // 10. telnyx-edge types.
  console.log("Running `telnyx-edge types` to regenerate telnyx-env.d.ts...");
  await runCli(["types"]);
  console.log("telnyx-env.d.ts regenerated.");

  // Capture func_id and func_name from telnyx.toml so the state file is
  // self-contained. We read the manifest text rather than parsing TOML.
  const tomlText = await readFile(TELNYX_TOML, "utf8");
  const funcIdMatch = /func_id\s*=\s*"([^"]+)"/.exec(tomlText);
  const funcNameMatch = /func_name\s*=\s*"([^"]+)"/.exec(tomlText);
  if (funcIdMatch) state.func_id = funcIdMatch[1];
  if (funcNameMatch) state.func_name = funcNameMatch[1];

  // 11. telnyx-edge ship.
  console.log(`Running \`telnyx-edge ship\` (timeout ${SHIP_TIMEOUT})...`);
  const shipOut = await runCli(["ship", "--timeout", SHIP_TIMEOUT]);
  console.log(shipOut.split(/\r?\n/).pop() || shipOut);

  // 12. Get invoke URL.
  if (!state.func_name) {
    throw new Error("func_name could not be read from telnyx.toml.");
  }
  const funcUrl = await getInvokeUrl(state.func_name);
  state.func_url = funcUrl;
  console.log(`Function URL: ${funcUrl}`);

  // 13. /health probe.
  await probeHealth(funcUrl);

  // 14. /admin/check-config probe.
  await probeCheckConfig(funcUrl);

  // 15. Save state.
  state.secrets_configured = [ADMIN_SECRET_NAME, HMAC_SECRET_NAME, PUBLIC_KEY_NAME];
  state.last_deployed_at = new Date().toISOString();
  await saveState(state);
  console.log(`Saved ${STATE_FILE}.`);

  // 16. Summary.
  console.log("");
  console.log("=== Deployment summary ===");
  console.log(`Function URL : ${funcUrl}`);
  console.log(`KV namespace : ${kvId} (${KV_NAMESPACE_NAME})`);
  console.log(`KV config key: ${SUPPORT_CONFIG_KEY}`);
  console.log(
    `Secrets      : ${state.secrets_configured.join(", ")} (values never displayed).`,
  );
  console.log(
    `Local .env   : TELNYX_API_KEY and ${ADMIN_SECRET_NAME} (gitignored).`,
  );
  console.log(
    `Diagnostic   : curl -H "x-admin-secret: <admin secret>" ${funcUrl.replace(/\/+$/, "")}/admin/check-config`,
  );
  console.log("Done.");
}

main().catch((err: unknown) => {
  const e = err as { message?: string; stack?: string };
  console.error("");
  console.error("DEPLOY FAILED:");
  console.error(e.message || String(err));
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
