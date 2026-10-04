# telnyx-fde

A Telnyx Edge **StatefulActor** project, scaffolded with `telnyx-edge new-func --actor`.

> **Preview.** StatefulActor support is in preview — this project is ready to
> build against and ship with `telnyx-edge`; the surface may still change
> before general availability.

## Layout

| File | Purpose |
| --- | --- |
| `telnyx.toml` | Project manifest. Declares `COUNTER`, `CALLER_TICKETS`, the KV binding, and the existing function identity. |
| `src/index.ts` | Explicit HTTP router, independent health check, protected configuration diagnostic, and both actor exports. |
| `src/counter.ts` | The `Counter` actor class. |
| `src/actors/caller-tickets.ts` | Persistent tickets for one caller: read, idempotent creation, and preparation-only fixture insertion. |
| `src/contracts.ts` | Shared ticket contracts, actor inputs, and field validations. |
| `telnyx-env.d.ts` | Binding types generated from the manifest by `telnyx-edge types`. |
| `scripts/check-caller-tickets.ts` | Sequential local actor checks with synthetic inputs and a storage double. |
| `src/http/` | Shared callback security/logging boundaries and the initialization, creation, and administration handlers. |
| `src/support-config.ts` | Shared strict KV feature-flag reader. |
| `src/identity.ts` | Common phone/web actor identity resolution for initialization, creation, and fixtures. |
| `scripts/check-http.ts` | Offline signed HTTP integration scenarios and log sanitization checks. |
| `scripts/seed-demo.ts` | Explicit fixture preparation command, separate from deployment. |
| `src/faq.ts` | Verified catalogue of 12 public documentation topics with voice-length explanations. |
| `src/mcp.ts` | Official SDK MCP endpoint with exactly three tools and no business resource access. |
| `scripts/check-mcp.ts` / `scripts/check-mcp.test.ts` | Official client verification and sequential offline protocol checks. |
| `config/telephony.ts` | Explicitly authorized phone constants for the assistant and technician. |
| `config/tools.ts` | Desired definitions of the four shared native tools. |
| `scripts/lib/` | Shared safe REST client, atomic state, and resource upsert adapters. |
| `package.json` / `tsconfig.json` | TypeScript project configuration. |

## Deploy

Install dependencies and ship:

```powershell
npm install
telnyx-edge ship
```

## Using the actor

An actor binding resolves an instance by name and calls its methods:

```ts
const counter = env.COUNTER.idFromName("demo");
const value = await counter.increment(1);
```

`COUNTER` is the binding declared under `[[actors]]` in `telnyx.toml`; it maps to
the `Counter` class in `src/counter.ts`. Add methods to that class and call them
through the binding. Generate the `env.COUNTER` types (`Env`) with
`telnyx-edge types`.

## Caller tickets (step 5)

`CALLER_TICKETS` maps to the exported `CallerTickets` class. Each instance owns
one identity's records. The Function resolves it through
`env.CALLER_TICKETS.idFromName(actorKey)`. Phone calls retain the existing HMAC of
the normalized phone number; Portal web calls use a separate HMAC namespace and
the backend-configured demo label. Neither the actor input nor stored state
contains the raw phone number. The business HTTP routes now use this actor; assistant
configuration and real callback verification remain later integration work.

The actor exposes three methods:

- `listTickets()` returns all stored tickets; the initialization handler will
  later select and sort the records presented by voice.
- `createTicket({ subject, description, operation_id })` returns `{ id, reference }`.
  Required fields are trimmed and validated. New tickets start as `open` with
  `Awaiting handling.` and ISO timestamps.
- `seedDemoTickets({ tickets })` inserts absent fixtures and returns
  `{ added_count }`. Each fixture supplies the creation fields plus `status`,
  `status_summary`, `created_at`, and `updated_at`. Stable fixture operation ids
  prevent duplicates, including within one batch. Existing records are never
  overwritten. This method is for preparation only, not an assistant tool.

The persistent key `tickets_state` holds the complete ticket list and
`next_ticket_number` together. References start at `T-0001` and are unique within
one caller's records. Ids are UUIDs. Every call reads current storage instead of
using a list cached at call initialization. Malformed stored state is rejected,
never replaced with an empty list.

Two simultaneous additions for the same caller cannot read the same stale
counter: Telnyx dispatches one method to completion before starting the next,
even across `await`. Each creation reads, appends, increments, and writes within
that single call. No custom lock or external HTTP call is needed. This guarantee
is documented in [Execution Model](https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/execution-model).

Idempotence handles a separate problem: a repeated webhook carrying the same
`operation_id` returns the existing id and reference, without consuming a new
number or modifying the original ticket. Fixtures use the same deduplication
rule and numbering logic; use distinct stable operation ids for each fixture.

`this.ctx.storage` survives instance eviction and redeployment. The runtime
commits writes atomically at the end of a successful turn and waits for durability
before replying; failed storage writes propagate instead of returning success.
See [Actor Storage](https://developers.telnyx.com/docs/edge-compute/stateful-actors/api-reference/storage).

Run the local checks from PowerShell:

```powershell
npm.cmd run typecheck
node --import tsx --test --test-concurrency=1 scripts/check-caller-tickets.ts
```

The checks cover creation, re-reading from a reconstructed instance, numbering,
operation replays, input limits, fixture replay, invalid batches, and rejected
writes. They use a storage double and execute sequentially. They do not establish
production durability, redeployment preservation, or runtime serialization;
those require later checks on Telnyx. No parallel test is planned.

## HTTP contracts (step 6)

The Function routes exact paths and methods. Unknown paths return 404; a wrong
method on a known path returns 405 with `Allow`. There is no Counter fallback.

| Endpoint | Caller | Authentication | Result |
| --- | --- | --- | --- |
| `GET /health` | Deployment or availability probe | None | 200 `{ "ok": true }`, independent of bindings. |
| `GET /admin/check-config` | Deployment diagnostic | `x-admin-secret` | Existing KV/secrets presence shape; 500 when checks fail. |
| `POST /init` | Telnyx at assistant startup | Telnyx Ed25519 | 200 `{ "dynamic_variables": { ... } }`. |
| `POST /tickets/create` | Synchronous assistant webhook tool | Telnyx Ed25519 | 200 `{ "ticket_id": "...", "ticket_reference": "..." }` only after actor success. |
| `POST /admin/seed` | Explicit demo preparation | `x-admin-secret` | 200 `{ "added_count": 2 }`; replays add zero existing fixtures. |
| `/mcp` | MCP clients and, later, the assistant | Public catalogue; SDK Host/Origin checks | Streamable HTTP protocol; methods and error responses managed by the MCP SDK. |

Both business callbacks verify `telnyx-signature-ed25519` and `telnyx-timestamp`
against the exact raw bytes, before parsing JSON. The timestamp must be integer
Unix seconds within five minutes of the Function clock. A bad signature returns
401, malformed JSON or fields return 400, unusable creation identity returns 422,
and dependency failures return 503. An incomplete creation result returns 502.
Responses contain controlled error codes, never exception messages or payloads.

### Initialization input and behavior

The documented callback is an event envelope:

```json
{
  "data": {
    "event_type": "assistant.initialization",
    "payload": {
      "telnyx_conversation_channel": "phone_call",
      "telnyx_end_user_target": "CALLER_E164_NUMBER",
      "call_control_id": "STABLE_TELNYX_CALL_CONTROL_ID"
    }
  }
}
```

The handler accepts `phone_call` and `web_call`. It reads identity tickets and
`support/config`. It presents open tickets
or records updated within 30 days, orders by most recent update, and limits the
result to three. `tickets_count` is the displayed count. `tickets_json` excludes
description and operation id. A successful read with tickets produces a greeting
offering follow-up; a successful empty read produces the generic question greeting.

Missing/unusable phone identity never creates a shared anonymous actor. A KV or
actor failure returns 200 with complete safe defaults: `init_ok=false`,
`can_create_ticket=false`, flag false, no creation operation, and a generic
greeting. The zero count in this fallback is not evidence of an empty record set;
the workflow must check `init_ok` before interpreting it. Logs mark degraded
initialization as an error even though its HTTP response delivers valid defaults.
Rejected signatures/envelopes use non-200 responses; the assistant must also have
the defaults configured for transport errors/timeouts.

With a valid identity and successful reads, `init_ok=true`. Missing phone call
context still allows follow-up but disables creation. Phone `operation_id` stays
a domain-separated HMAC of the caller key and `call_control_id`; another delivery
event id does not change it.

For Portal `web_call`, the actor key comes only from `web_demo_identity` in KV.
The initialization event's documented `data.id` determines a separate operation
HMAC. Replaying the same event preserves the operation; a different event gets a
new operation on the same demo Actor. This is an event id, not a guaranteed native
web session id. No `conversation_id` or `session_id` is assumed in this webhook.
If `data.id` is absent, empty, or not a string, return an empty `operation_id` and
`can_create_ticket=false`. Successful reads and ticket follow-up remain available.
No random operation id is generated. Neither raw call/event ids nor the demo
label are returned or logged. Default variables are in `src/contracts.ts`.

### Stable Portal demo identity

Backend configuration in the existing `support/config` KV key is:

```json
{
  "technician_available": false,
  "web_demo_identity": "portal-demo"
}
```

This label is explicit backend configuration, not a caller number or a writable
assistant variable. Initialization, creation, and fixture preparation all use
`resolveSupportActorKey`. For web calls, caller targets and request-selected demo
labels are ignored. Without a valid backend demo identity, web actor operations
fail safely. Phone actor keys remain unchanged and isolated from web demo records.

The deployment script initializes missing configuration fields only. It adds
the demo label to legacy configuration if absent, preserving the flag and other
fields. It never replaces a configured label; invalid existing configuration is
reported rather than reset. The HMAC secret is also preserved. Changing either
identity input deliberately would select different state. Raw configuration is
not printed by deployment. The updated script has not been deployed in this step.

A real Portal smoke test must still verify the signed callback, the presence of
`data.id`, distinct event ids on new runs, and ticket retrieval between runs.
Do not treat local fixtures as proof of that real callback behavior.

### Creation input

```json
{
  "conversation_channel": "phone_call",
  "ticket_subject": "Webhook integration question",
  "ticket_description": "A concise support request without credentials.",
  "caller_phone": "CALLER_E164_NUMBER",
  "operation_id": "OPERATION_RETURNED_BY_INIT"
}
```

The flat body matches Telnyx webhook tool callbacks. Subject and description are
validated to 100 and 1,500 characters. `conversation_channel`, `caller_phone`, and
`operation_id` must be preset fields in the later assistant tool setup, not
model-selected arguments. Initialization and creation share the identity resolver.
Only business fields reach the actor. Repeated operations return the same ticket.
No automatic retry is performed by this handler.

The future tool presets are:

```json
{
  "conversation_channel": "{{telnyx_conversation_channel}}",
  "caller_phone": "{{telnyx_end_user_target}}",
  "operation_id": "{{operation_id}}"
}
```

These are our backend request fields populated by documented Telnyx variables.
For `web_call`, `caller_phone` is ignored and may be absent: the backend chooses
the configured demo Actor. Only subject and description are business arguments.
The demo identity must never be a tool argument or a model-editable variable.

### Demo preparation

The web admin body is `{ "conversation_channel": "web_call", "tickets": [...] }`.
For phone fixtures, use `{ "conversation_channel": "phone_call", "caller_phone":
"...", "tickets": [...] }`. Both use the shared resolver and the
fixture fields described above. Every fixture is validated by the actor before
the batch is written. The endpoint requires the project administration secret
and is never configured as an assistant tool.

To prepare a real demo later, explicitly run these PowerShell commands:

```powershell
Copy-Item -LiteralPath seed-demo.example.json -Destination seed-demo.local.json
# Edit the local file: real Function HTTPS origin. The example uses web_call.
# For phone_call only, add caller_phone privately with your test E.164 number.
# Keep fixture operation ids stable. Choose dates appropriate for your demo.
node --import tsx scripts/seed-demo.ts
```

`seed-demo.local.json` is ignored by Git. The script loads the administration
secret from `.env` or the shell only when run directly. It has a 10-second HTTP
timeout, refuses redirects, and outputs counts or a sanitized HTTP status. It is
not invoked by deployment and was not run against a public URL in this step.
Replaying fixtures leaves their existing content, dates, and statuses unchanged.
Web fixtures and all Portal smoke tests share the configured demo Actor, so a
ticket created during one run can be retrieved during a later run. The local file
must never supply web_demo_identity; it is configured only on the backend.

### Local verification and logs

```powershell
npm.cmd run typecheck
node --import tsx --test --test-concurrency=1 scripts/check-caller-tickets.ts scripts/check-http.ts
```

HTTP checks run entirely in-process with ephemeral Ed25519 keys, fictional caller
data, an actor namespace double, and KV/storage doubles. They verify raw-body
signatures, timestamp rejection, stable identity/operation ids, ticket selection,
creation/replay/retrieval, fallback behavior, admin protection, and sanitized logs.
They also cover shared web Actor identity, distinct/replayed initialization event
ids, missing web ids, missing demo configuration, and preservation of configuration
across repeated provisioning preparations. Phone and web records remain separate.
Fixture-script HTTP calls are replaced by an injected offline sender. Neither
test file loads `.env` or accesses an account. This does not prove cloud binding
behavior, callback delivery, or a phone workflow; those require later real tests.

Every handled HTTP request emits a JSON completion event with a generated
`request_id`, stage, operation, outcome, duration, and HTTP status. KV and Actor
operations share that request id. No raw phone/call id, ticket text, complete
payload, or secret is logged. These durations are log fields; Telnyx metrics will
provide the separate observability signal in later verification.

Contracts were checked against the supplied Dynamic Variables document and the
official [AI Assistant backend guide](https://developers.telnyx.com/docs/edge-compute/guides/ai-assistant-backend),
[webhook fundamentals](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks),
and [preset webhook parameters](https://developers.telnyx.com/docs/inference/ai-assistants/preset-webhook-parameters).
Portal channel semantics were checked in
[Conversation Keying](https://developers.telnyx.com/docs/inference/ai-assistants/conversation-keying).
Web event-id deduplication follows the documented webhook envelope and duplicate
handling guidance; native Portal session-id availability has not been established.

## Documentation FAQ and MCP (step 7)

The Function serves a public MCP catalogue at `/mcp`. The implementation uses
`@modelcontextprotocol/server` 2.3.0 and Zod 4.2.0. The official client package
2.3.0 is a development dependency for verification. Versions are recorded in
`package-lock.json`; the project's Node requirement is now 24 or newer.

`createMcpHandler` constructs a fresh `McpServer` from a factory for each request.
Legacy requests use the SDK's stateless 2025 compatibility path. There is no
session map or separate HTTP server, and no subscription stream is enabled.
The router hands `/mcp` requests to the SDK without parsing their bodies first,
including GET and DELETE. In stateless legacy mode those session methods return
405 from the SDK. Modern protocol headers, initialization, notifications,
discovery, and calls are handled by the SDK rather than custom REST endpoints.

Exactly three tools are registered:

| Tool | Parameters | Result |
| --- | --- | --- |
| `list_topics` | None | `topics`: id, title, and coverage for each entry. |
| `read_short_answer` | `topic_id` from discovery | Topic id, exact documentation title, and source URL. The assistant should not read the URL aloud. |
| `read_long_answer` | The same `topic_id` | Topic id and the unchanged authored explanation, 80 to 120 words. |

Results include MCP text content and structured content. Unknown ids produce an
explicit `isError` tool result, and invalid or extra parameters are rejected by
the SDK's strict input schemas. No fallback answer is invented. This endpoint
does not access KV, Actors, caller identity, or runtime secrets, and performs no
documentation lookup over the network during a tool call.

### Catalogue and sources

The 12 page URLs and explanations were verified against official Telnyx
documentation on 2026-10-04. Titles follow the pages; coverage lets the assistant
distinguish general deployment from Actor execution or storage, for example.

| Topic id | Documentation page |
| --- | --- |
| `dynamic-variables` | [Dynamic Variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables) |
| `conversation-workflows` | [Conversation Workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows) |
| `tools-library` | [Tools Library](https://developers.telnyx.com/docs/inference/ai-assistants/tools-library) |
| `preset-webhook-parameters` | [Preset Webhook Parameters](https://developers.telnyx.com/docs/inference/ai-assistants/preset-webhook-parameters) |
| `kv` | [KV](https://developers.telnyx.com/docs/edge-compute/kv) |
| `actor-execution` | [Execution Model](https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/execution-model) |
| `actor-storage` | [Actor Storage](https://developers.telnyx.com/docs/edge-compute/stateful-actors/api-reference/storage) |
| `bindings` | [Bindings](https://developers.telnyx.com/docs/edge-compute/runtime/bindings) |
| `secrets` | [Secrets](https://developers.telnyx.com/docs/edge-compute/configuration/secrets) |
| `edge-quickstart` | [Quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart) |
| `logs` | [Logs](https://developers.telnyx.com/docs/edge-compute/observability/logs) |
| `metrics` | [Metrics](https://developers.telnyx.com/docs/edge-compute/observability/metrics) |

The catalogue validates its 10 to 15 entry budget, unique ids, official source
hostnames, and word limits at module initialization. Returned discovery objects
and topic records are detached copies. Changes to documentation require a reviewed
catalogue update, not runtime browsing by the assistant.

### MCP verification

Default client checks use the real router in-process: no port, socket, account,
credential, or .env file is needed. They discover the tools and read both answers
for every topic sequentially, then verify unknown ids and invalid parameters.

```powershell
node --import tsx scripts/check-mcp.ts
node --import tsx scripts/check-mcp.ts --legacy
npm.cmd run typecheck
node --import tsx --test --test-concurrency=1 scripts/check-caller-tickets.ts scripts/check-http.ts scripts/check-mcp.test.ts
```

The tests exercise modern negotiation and the 2025 initialization handshake,
header guards, SDK method handling, malformed messages, the request body limit,
and sanitized request/tool correlation logs. SDK responses are kept intact.
Only recognized catalogue ids and fixed tool names reach tool logs; arguments,
unknown ids, HTTP header values, and complete protocol messages do not.

After a separately authorized deployment, run public verification explicitly:

```powershell
node --import tsx scripts/check-mcp.ts --url https://telnyx-fde-0768c5c4-b.telnyxcompute.com/mcp
node --import tsx scripts/check-mcp.ts --legacy --url https://telnyx-fde-0768c5c4-b.telnyxcompute.com/mcp
```

The public URL above is the Function URL already returned by Telnyx; the updated
MCP code has not been deployed or checked at that URL in this step. Its hostname
and loopback hosts are allowlisted in `src/mcp.ts`. If hosting changes, update
that list to the actual hostname. Server-to-server clients need no Origin header;
present browser origins are rejected because no browser MCP caller is configured.

The HTTP MCP connection was registered and verified by API during the step 8
precheck; its id/type are saved in private deployment state. The workflow's FAQ
branch remains step 12. Local protocol checks do not establish that integration.
The SDK integration follows its official
[web-standard serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md)
and [client testing guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md).

## MCP and shared-tool deployment (step 8)

`npm.cmd run deploy` now ships/checks the backend, upserts the HTTP MCP connection,
then synchronizes `SET_SUPPORT_VARIABLES`, `CREATE_TICKET`, `TRANSFER`, and
`HANGUP` through the account API. It retains the already-registered MCP id.
Assistant/workflow creation remains a later step.

Definitions come from `config/tools.ts`. The variable updater exposes only the
five keys in `WRITABLE_DYNAMIC_VARIABLE_KEYS`. The synchronous creation webhook
has only subject and description as model arguments; channel, caller target, and
operation id are preset. Response mappings use `name` and `value_path`. Transfer
has one destination and a fixed caller ID. Joel explicitly requested both phone
values as constants in `config/telephony.ts`; neither is read from `.env`.

The shared algorithm first reads a saved id and fully lists matching resources.
It stops on failed reads, conflicting ownership, duplicates, or malformed local
state. A missing resource is created with an idempotency key saved before POST.
Returned ids are checkpointed immediately, then verified by GET and a uniqueness
check. Changes use MCP PUT or tool PATCH with the same id; already matching
definitions are reused without another write. Each tool has its own pending key,
so partial deployments resume safely. Unknown/expired POST outcomes are not
silently replaced with new creation keys.

`deployment-state.json` stores identifiers and request fingerprints, not phone
values or credentials. API errors expose controlled endpoint/status diagnostics;
the known phones and credentials are redacted. Responses, request payloads, and
stack traces are not printed. Existing KV config, web demo identity, HMAC key,
and Actor storage remain preserved by the deployment path.

Local verification (no `.env`, API account, deployment, or phone call):

```powershell
npm.cmd run typecheck
node --import tsx --test --test-concurrency=1 scripts/check-caller-tickets.ts scripts/check-http.ts scripts/check-mcp.test.ts scripts/check-mcp-registration.test.ts scripts/check-resource-upsert.test.ts
```

The resource tests simulate two sequential synchronizations, definition changes,
lost responses, partial creation, denied reads, duplicate names, malformed id
maps, and redaction. They do not prove native tools were accepted by the live API.
The new step 8 deployment has not been executed as part of this local coding step.
Its two real deployment runs and read-back checks remain separate verification.

Native request contracts follow the official
[Tools Library](https://developers.telnyx.com/docs/inference/ai-assistants/tools-library),
[Preset Webhook Parameters](https://developers.telnyx.com/docs/inference/ai-assistants/preset-webhook-parameters),
and [Telnyx OpenAPI](https://github.com/team-telnyx/openapi/blob/master/openapi/spec3.json).
