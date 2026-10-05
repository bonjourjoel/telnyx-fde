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
| `scripts/seed-tickets.ts` / `scripts/lib/ticket-fixtures.ts` | Shared seed command and ready-made fixture loader for Portal and phone callers. |
| `fixtures/tickets.json` | Two public demo ticket templates; no caller identity or credentials. |
| `scripts/help.ts` / `scripts/lib/commands.ts` | Public npm command usage and shared descriptions. |
| `src/faq.ts` | Verified catalogue of 12 public documentation topics with voice-length explanations. |
| `src/mcp.ts` | Official SDK MCP endpoint with exactly three tools and no business resource access. |
| `scripts/check-mcp.ts` / `scripts/check-mcp.test.ts` | Official client verification and sequential offline protocol checks. |
| `config/telephony.ts` | Explicitly authorized phone constants for the assistant and technician. |
| `config/tools.ts` | Desired definitions of the four shared native tools. |
| `config/assistant.ts` / `config/workflow.ts` | Assistant settings and ticket/FAQ workflow with context guards. |
| `config/faq-prompts.ts` | Approved structured FAQ prompts and scripted fallback text. |
| `config/ticket-prompts.ts` | Approved single-offer ticket intake prompt and short result messages. |
| `scripts/check-assistant.test.ts` | Offline graph, model preflight, and assistant create/update/reuse checks. |
| `scripts/run-tests.ts` | Single full local test routine used by npm run test and deployment. |
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

For `web_call` and explicitly pinned Portal tests, the actor key comes only from
`web_demo_identity` in KV.
The initialization event's documented `data.id` determines a separate operation
HMAC. Replaying the same event preserves the operation; a different event gets a
new operation on the same demo Actor. This is an event id, not a guaranteed native
web session id. No `conversation_id` or `session_id` is assumed in this webhook.
If `data.id` is absent, empty, or not a string, return an empty `operation_id` and
`can_create_ticket=false`. Successful reads and ticket follow-up remain available.
No random operation id is generated. Neither raw call/event ids nor the demo
label are returned or logged. Default variables are in `src/contracts.ts`.

### Stable Portal demo identity

Two real Portal voice tests on 2026-10-04 were recorded as `phone_call` with the
same non-phone target. `portal_demo_target_sha256` explicitly pins that target's
SHA-256 fingerprint in backend KV. Deployment fills only a missing fingerprint,
using the verified project default; existing values are preserved. Set it to
null to disable this alias. No raw target or test phone number is stored in Git
or logged. This observed marker is not a guaranteed Telnyx Portal contract.

Valid phone numbers always retain their original phone HMAC, even if a configured
fingerprint matches one. Other missing/non-phone identities never select a demo
Actor. The pinned target, `web_call`, and web fixtures share one demo Actor and
event-based operation ids. The existing protected webhook presets require no
additional model arguments.

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

To prepare the Portal demo, run this after successful deployment:

```powershell
npm.cmd run seedticketsweb
```

For one phone caller, pass their international number:

```powershell
npm.cmd run --silent seedticketsphone -- "YOUR_CALLER_NUMBER_IN_E164"
```

Both commands use `scripts/seed-tickets.ts`, the same checked-in
`fixtures/tickets.json`, and the same administration client. No file copying or
URL editing is needed: the URL comes from ignored deployment state. The phone
argument is required; only its international syntax is checked, not whether it
belongs to an actual subscriber. A missing Actor is created normally by the
backend. `--silent` avoids npm echoing the phone argument; application/backend
logs never include it. The secret comes from `.env` or the shell, with a
10-second timeout and no redirect/retry. Neither command runs during deployment.

Relative fixture ages keep dates recent without manual edits. Stable operation
ids mean replay leaves existing content, dates and statuses unchanged. Web
fixtures and all Portal smoke tests share the configured demo Actor; each phone
caller has their own Actor. No request supplies the backend web demo identity.

Run `npm.cmd run help` for every public command with a short description and
argument usage. The helper verifies its description registry against package
scripts so new or renamed commands cannot silently disappear from help.

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
branch is added by step 12 below. Local protocol checks alone do not establish native voice integration.
The SDK integration follows its official
[web-standard serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/web-standard.md)
and [client testing guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md).

## MCP and shared-tool deployment (step 8)

`npm.cmd run deploy` now ships/checks the backend, upserts the HTTP MCP connection,
then synchronizes `SET_SUPPORT_VARIABLES`, `CREATE_TICKET`, `TRANSFER`, and
`HANGUP` through the account API. It retains the already-registered MCP id.
Minimal assistant/workflow creation is added by step 9 below.

Definitions come from `config/tools.ts`. The variable updater exposes only the
three keys in `WRITABLE_DYNAMIC_VARIABLE_KEYS`. The synchronous creation webhook
has only subject and description as model arguments; channel, caller target, and
operation id are preset. Response mappings use `name` and `value_path`. Transfer
has one destination and a fixed caller ID. Joel explicitly requested both phone
values as constants in `config/telephony.ts`; neither is read from `.env`.

The shared algorithm first reads a saved id and fully lists matching resources.
List entries establish identity and uniqueness only; configuration comparisons
use the full GET by id, including when an id is recovered from the list.
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
npm.cmd run test
```

The resource tests simulate two sequential synchronizations, definition changes,
lost responses, partial creation, denied reads, duplicate names, malformed id
maps, and redaction. They do not prove native tools were accepted by the live API.
Two real step 8 deployments succeeded on 2026-10-04. The second reused the same
KV namespace, MCP and all four tool ids; configuration and the HMAC were preserved.

Native request contracts follow the official
[Tools Library](https://developers.telnyx.com/docs/inference/ai-assistants/tools-library),
[Preset Webhook Parameters](https://developers.telnyx.com/docs/inference/ai-assistants/preset-webhook-parameters),
and [Telnyx OpenAPI](https://github.com/team-telnyx/openapi/blob/master/openapi/spec3.json).

## Minimal assistant deployment (step 9)

`npm.cmd run deploy` now also upserts the project assistant and its complete graph:

```text
GREETING (Speak) -> CONVERSATION (Prompt) -> GOODBYE (Speak) -> HANGUP (Tool)
```

Configuration lives in `config/assistant.ts` and `config/workflow.ts`. The approved
Speak messages are `{{greeting_text}}` and "Thank you for calling Telnyx developer
support. Goodbye." The prompt uses append mode and a conditional exit when the
user wants to end the conversation. It exposes no business tools; FAQ, ticket and
transfer branches are later steps. The existing ticket greeting is preserved.

The assistant uses voice-verified `moonshotai/Kimi-K2.6`, `Telnyx.KokoroTTS.af_heart`,
and English `deepgram/flux` transcription. Deployment checks model availability
through GET before provisioning writes. `/init` has an 8000 ms timeout and the
same fallback variables as the backend. The standard greeting is empty to avoid
a second greeting. The registered MCP and shared HANGUP are referenced by id.

The assistant adapter reuses the saved id or a unique project name, checkpoints
creation, sends desired configuration on update, and verifies the complete graph.
Assistant list entries were observed with empty MCP/tools and a null flow even
when GET by id returned the correct configuration. The list therefore never
drives the update decision. GET-only resolved shared tools are never copied
back into request bodies. The
platform's automatically created default TeXML application id is saved. Step 10
below adds a separate application for the physical number. No tickets or fixtures
are changed by deployment.

Local verification:

```powershell
npm.cmd run typecheck
npm.cmd run test
```

`npm.cmd run test` and deployment both call `runLocalTests` from
`scripts/run-tests.ts`, which holds the complete local suite in one place.
Deployment runs typecheck first, then all tests sequentially, before loading
`.env` or accessing Telnyx. Either failure stops deployment with a failure result.

These checks use synthetic API responses and state. Joel's two step 9 deployments
confirmed API acceptance and the same assistant id. The corrected comparison was
also run twice against the real assistant using GET only: both returned reused,
with no API or local state writes. Joel's Portal voice test on 2026-10-04 at 17:54
Europe/Paris succeeded with the microphone muted during the greeting. Server logs
confirmed KV and Actor reads, /init HTTP 200 in 1358 ms, the complete greeting,
conversation, goodbye and hangup. Request id: 769c0fef-c80c-4b18-a294-69a8ad955473.

Contracts follow the official [workflow guide](https://developers.telnyx.com/docs/inference/ai-assistants/workflows),
[Create Assistant](https://developers.telnyx.com/api-reference/assistants/create-an-assistant),
[Update Assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant),
[List Assistants](https://developers.telnyx.com/api-reference/assistants/list-assistants),
and [voice model documentation](https://developers.telnyx.com/docs/voice/conversational-ai/quickstart).

## Physical phone routing (step 10)

Deployment now fetches the assistant's TeXML JSON string, checks the assistant id,
and stores it as a JSON string under `voice/texml` in the existing KV namespace.
Public `POST /voice-entry` returns that document with `application/xml`. It ignores
the form-encoded caller fields and performs no Actor or support business operation.
Missing, unsupported or unreadable XML returns 503. Signed `/init` and ticket
callbacks retain their existing verification and shared identity resolver.

`config/telephony.ts` supplies the purchased number and stable routing names.
`scripts/lib/phone-routing.ts` fully lists and reads the existing number, checks
its active voice settings, upserts `telnyx-fde-voice`, and assigns its connection id
with PATCH. It never orders a number or places a call. The deployed instruction
route is checked before assignment. Unrelated number connections, forwarding,
denied reads and duplicate resources stop with explicit diagnostics.

The account allows only one outbound profile. The script reuses the existing
profile referenced by the assistant's automatic TeXML application, currently
`Default`. It preserves US, CA and every existing destination and adds FR for the
future technician transfer. The physical phone application shares that profile
with the Portal. Its name, billing, limits, recording and other policies are
preserved and checked by read-back. The automatic Portal application is unchanged.
A missing, disabled or conflicting profile stops deployment; no profile POST is
ever issued. A real transfer remains step 14 verification.

The common upsert/state helpers checkpoint application creation. The existing
profile id is saved and an obsolete failed-profile-creation checkpoint is removed
only after successful inventory and read-back checks. Repeated deployment reuses
the ids and skips unchanged profile, XML and number-assignment writes. Only ids and
creation checkpoints are stored locally; phones and XML are not logged or copied
into deployment state. Phone callers keep their number HMAC Actor; Portal tests
keep the stable configured demo Actor. Neither identity scheme changes here.

Deploy and test yourself:

```powershell
npm.cmd run deploy
```

After success, call the purchased number in `config/telephony.ts`. Check the full
greeting, ask one simple question, then ask the assistant to hang up. Verify
`voice_entry`, `/init`, KV/Actor reads and the conversation's goodbye/hangup.
Repeat the Portal test to check both entry modes. Re-run deploy to verify reused
application/profile/number ids. Local checks use the same `npm.cmd run test` suite
as deployment. The first step 10 deployment shipped the backend but failed because
creating a second outbound profile exceeded the account limit (HTTP 403, code
10039). The corrected routing still needs deployment and a real phone call.

Contracts follow [Get Assistant TeXML](https://developers.telnyx.com/api-reference/assistants/get-assistant-texml),
[TeXML Instruction Fetching](https://developers.telnyx.com/docs/voice/programmable-voice/texml-instruction-fetching),
[Create TeXML Application](https://developers.telnyx.com/api-reference/texml-applications/creates-a-texml-application),
[Update Phone Number](https://developers.telnyx.com/api-reference/phone-number-configurations/update-a-phone-number),
[Update Outbound Profile](https://developers.telnyx.com/api-reference/outbound-voice-profiles/updates-an-existing-outbound-voice-profile),
and the [official OpenAPI schemas](https://github.com/team-telnyx/openapi/blob/master/openapi/spec3.json).

## Ticket follow-up and explicit reset (step 11)

The deployed configuration now adds `ORIENTATION` and `TICKET_STATUS`. The backend
includes `status_text` in each presented ticket: reference, spoken status label,
and the stored progress summary. The model selects a ticket by number, reference
or subject, asks for clarification when needed, and copies that exact text through
the existing `SET_SUPPORT_VARIABLES` tool. Only then does the Speak node announce
the status and goodbye in one Speak message, then routes directly to hangup.
The status-preparation error uses the same closing pattern. Free conversation
and cancellation keep the separate GOODBYE node. No follow-up operation changes tickets.

This is a workaround for the observed consecutive-Speak audio problem: both
messages appeared in the transcript, but only one playback completed before
hangup and the farewell was not heard. The combined message needs a new Portal
voice test after deployment; local graph tests cannot prove audio delivery.

The orientation prompt has only the variable updater. Deterministic expression
edges prioritize initialization failure, then an empty ticket list, then a filled
status variable. An initialization failure gets an explicit unavailable message;
it is never presented as an empty caller history. Updater failure has an error
branch. Step 12 replaces the new-question placeholder with FAQ lookup; intake and
transfer remain later work. Instruction mode stays append.

Assistant read-back verifies the configured shared model tools and the updater's exact
writable allowlist. It preserves expression-edge priority while tolerating canvas
node reordering. Complete workflow updates reuse the existing assistant and tool
ids. Deployment neither resets callers nor loads fixtures.

`npm.cmd run resetactor` runs `scripts/reset-actor.ts` and targets only the
backend-configured Portal demo. It reads the Function URL from deployment state
and the admin secret from the environment. Protected `POST /admin/reset-actor`
uses the same identity resolver as initialization, creation and fixtures, then
calls `resetTickets()` to delete only `tickets_state`. The instance and unrelated
keys are preserved; the next ticket starts at `T-0001`. Repeat resets succeed.
Use the command between calls, not during an active test conversation.

For one real phone caller, `npm.cmd run resetactor -- --phone` requires their
number in ignored `reset-actor.local.json` (copy the supplied example). No phone
argument, all-callers mode, or reset/seed hook in deployment is provided. The route
is never an assistant tool. Fixtures and reset reuse common backend authentication
and local HTTP helpers; logs report only safe operation/status metadata.

See [test-tickets.md](docs/test-tickets.md) for the short deploy/reset/seed test
sequence. The local suite checks reset/replay/isolation, counter restart, failures,
formatted status context, expression precedence, and idempotent assistant updates.
It does not execute a hosted LLM. Native tool update and spoken ticket selection
still require a Portal voice test after deployment. Physical inbound calls remain
blocked by the account-level D61 restriction recorded in AGENTS.md.

## Voice MCP FAQ (step 12)

`config/faq-prompts.ts` contains the approved structured `FAQ_SHORT` instructions.
Collect a question only if needed, call `list_topics`, match coverage and call
`read_short_answer` with the chosen tool-result id. Announce the exact page title,
never the URL, then call `transition__faq_short_to_goodbye`. The GOODBYE Speak
has one default edge to the HANGUP Tool node. No caller confirmation is needed.

Joel approved removing the long explanation offer and branch. The FAQ does not
store conversation variables. The public MCP and both allowlists still expose
all three tools, including `read_long_answer`, verified through the official
client. The voice flow uses only `list_topics` and `read_short_answer`.

FAQ_SHORT uses `tools_mode=append` with no added shared tools to retain MCP.
Assistant `tool_ids` contains only the updater for ticket follow-up/intake.
HANGUP is available only through the standalone Tool node, never as a native
tool for any Prompt. Existing assistant, MCP, shared-tool and phone ids are reused.

No catalogue match reaches the short `RESOLUTION` Speak, then ticket intake.
MCP failure still reaches a distinct `FAQ_ERROR` Speak with goodbye before hangup;
unavailability is never declared as absent coverage. Ticket follow-up is preserved.
Technician transfer remains step 14.

The local suite verifies ticket guard priority, title-only routing, closing
Speak/default hangup paths, model tool scopes, allowlist repair and stable ids.
It also exercises the real SDK with native Telnyx conversation metadata in `_meta`,
outside strict business arguments. These checks do not run the hosted voice model.
After deployment, follow [test-faq.md](docs/test-faq.md) for Portal validation of
the two voice tool calls, spoken title, goodbye and hangup. Deployment and this live
FAQ smoke test remain to be run by Joel. FAQ reads do not change Actor records.

## Ticket creation (step 13)

An uncovered question leads to the approved single ticket offer in
`TICKET_INTAKE`. This Prompt exposes only SET_SUPPORT_VARIABLES. It briefly
summarizes the caller's request, then asks "Would you like me to create a support
ticket?". If the caller explicitly agrees, it calls SET_SUPPORT_VARIABLES with a
short `ticket_subject` and a faithful `ticket_description` based on the request,
waits for successful storage, and calls the creation transition. If the update
fails it routes to the error Speak; if the caller declines, cancels, or asks to
finish, it routes to goodbye. There is no separate confirmation node, collection
loop, or correction branch.

`TICKET_INTAKE` requires `can_create_ticket` to be the boolean true. CREATE_TICKET
is a standalone Tool node using the existing library id, never a model-visible
native tool. Telnyx fills its two business arguments from identically named
variables. The existing synchronous webhook preserves its channel/caller/operation
presets and response mappings. Signatures, phone/Portal identity resolution and
Actor idempotence are unchanged.

The single LLM creation transition requires that the assistant summarized the
request, asked the ticket creation question, the caller explicitly agreed to that
question, and the subsequent SET_SUPPORT_VARIABLES call successfully stored both
fields. Silence, ambiguity, or merely already-filled variables do not authorize
creation.

The success edge uses the documented `bool_op` AND form: voice HTTP status string
`"200"`, nonempty `created_ticket_id`, and nonempty `created_ticket_reference`.
All other outcomes take the default error edge. A timeout may follow a committed
write, so the error message says creation could not be confirmed rather than
claiming no ticket exists. There is no automatic retry. Success, error and
unavailability each use one short Speak containing goodbye, then default HANGUP.

Deployment reuses the existing shared tool and assistant, replacing the complete
graph. It never creates tickets, loads fixtures, resets Actors, changes caller
HMAC/demo identity or toggles the technician flag. No transfer is offered yet.
Local tests check the capability guard, the single LLM creation entry from intake,
the absence of a confirmation node and return-to-intake edges, scoped tools,
business argument names, the typed result fallback, readback drift, and an offline
reconciliation test that updates an existing assistant still carrying the removed
confirmation branch. They do not run the hosted model or prove voice
timing/callback behavior. Follow [test-ticket-creation.md](docs/test-ticket-creation.md)
after deployment to verify the real single offer, decline, callback mappings and
next-call retrieval on the stable Portal demo Actor.

## KV failure diagnosis

The protected `/admin/check-config` includes `kv.error` on a failed read: a fixed
`code` and, when available, `upstream_status`. Runtime `kv_read` errors log the
same category and HTTP status without the SDK message, response body or token.
Categories distinguish authentication, permission, network, timeout, invalid
response/configuration and a missing binding. Failure still returns HTTP 500.

During the Portal investigation, the namespace/configuration read returned 200
directly, but reading through the Function binding failed. The deployed diagnostic
identified upstream HTTP 401 (authentication). Adding the per-function `TELNYX`
declaration did not resolve it. Comparing step 8 and step 9 showed no changes in
runtime source, manifest or dependency lock. Server logs showed KV OK at 15:37
Europe/Paris and an error at 15:47, with no ship between those requests.

The real organization `telnyx-sdk` binding was found through the account binding
inventory. Server validation reported "binding token is invalid or expired".
Renewing that existing binding, without changing its id or deploying again,
restored valid authentication and `/admin/check-config` HTTP 200 immediately.
The non-secret id is saved as runtime_api_binding_id in local deployment state.
Validation alone can return CLI exit code 0 even for an invalid token: inspect
the returned validity, not just the process exit code. No key value is logged.
The CLI had no default binding id configured locally, which alone establishes
neither absence nor invalidity of the server-side binding.

`deploy.ts` now calls `ensureRuntimeBinding` before storage provisioning, secret
updates and ship. The helper fully lists account bindings, selects the unique
`telnyx-sdk` organization binding, saves only its id, and calls the observed
`POST /v2/compute/bindings/{id}/actions/validate` endpoint. Valid tokens are reused.
Only the confirmed invalid/expired-token result triggers PUT on the same id,
followed by GET and successful revalidation. Unreadable, missing, duplicate or
conflicting bindings stop deployment; no new binding is created automatically.
Lost renewal responses are reconciled without another PUT. Token values are
neither printed nor persisted. Two real preflight checks reused the healthy
binding without renewing it; expiry/renewal paths are covered by offline tests.
