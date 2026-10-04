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
| `scripts/check-http.ts` | Offline signed HTTP integration scenarios and log sanitization checks. |
| `scripts/seed-demo.ts` | Explicit fixture preparation command, separate from deployment. |
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
one caller's records. In step 6, the Function will resolve the instance through
`env.CALLER_TICKETS.idFromName(callerKey)`, using the existing stable HMAC of the
normalized phone number. Neither the actor input nor its stored state contains
the raw phone number. The business HTTP routes now use this actor; assistant
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

The handler reads caller tickets and `support/config`. It presents open tickets
or records updated within 30 days, orders by most recent update, and limits the
result to three. `tickets_count` is the displayed count. `tickets_json` excludes
description and operation id. A successful read with tickets produces a greeting
offering follow-up; a successful empty read produces the generic question greeting.

Missing/unusable caller identity never creates a shared anonymous actor. A KV or
actor failure returns 200 with complete safe defaults: `init_ok=false`,
`can_create_ticket=false`, flag false, no creation operation, and a generic
greeting. The zero count in this fallback is not evidence of an empty record set;
the workflow must check `init_ok` before interpreting it. Logs mark degraded
initialization as an error even though its HTTP response delivers valid defaults.
Rejected signatures/envelopes use non-200 responses; the assistant must also have
the defaults configured for transport errors/timeouts.

With a valid caller and successful reads, `init_ok=true`. Missing call context
still allows ticket follow-up but disables creation. Otherwise `operation_id` is
a domain-separated HMAC of the caller key and `call_control_id`. A new delivery
event id does not change it; another call or caller does. The raw call id is not
returned or logged. Default variables are defined in `src/contracts.ts`.

### Creation input

```json
{
  "ticket_subject": "Webhook integration question",
  "ticket_description": "A concise support request without credentials.",
  "caller_phone": "CALLER_E164_NUMBER",
  "operation_id": "OPERATION_RETURNED_BY_INIT"
}
```

The flat body matches Telnyx webhook tool callbacks. Subject and description are
validated to 100 and 1,500 characters. `caller_phone` and `operation_id` must be
preset configuration fields in the later assistant tool setup, not model-selected
arguments. Initialization and creation use the same `computeCallerKey` function.
Only business fields reach the actor. Repeated operations return the same ticket.
No automatic retry is performed by this handler.

### Demo preparation

The admin body is `{ "caller_phone": "...", "tickets": [...] }`, with the
fixture fields described above. Every fixture is validated by the actor before
the batch is written. The endpoint requires the project administration secret
and is never configured as an assistant tool.

To prepare a real demo later, explicitly run these PowerShell commands:

```powershell
Copy-Item -LiteralPath seed-demo.example.json -Destination seed-demo.local.json
# Edit the local file: real Function HTTPS origin and your test E.164 number.
# Keep fixture operation ids stable. Choose dates appropriate for your demo.
node --import tsx scripts/seed-demo.ts
```

`seed-demo.local.json` is ignored by Git. The script loads the administration
secret from `.env` or the shell only when run directly. It has a 10-second HTTP
timeout, refuses redirects, and outputs counts or a sanitized HTTP status. It is
not invoked by deployment and was not run against a public URL in this step.
Replaying fixtures leaves their existing content, dates, and statuses unchanged.

### Local verification and logs

```powershell
npm.cmd run typecheck
node --import tsx --test --test-concurrency=1 scripts/check-caller-tickets.ts scripts/check-http.ts
```

HTTP checks run entirely in-process with ephemeral Ed25519 keys, fictional caller
data, an actor namespace double, and KV/storage doubles. They verify raw-body
signatures, timestamp rejection, stable identity/operation ids, ticket selection,
creation/replay/retrieval, fallback behavior, admin protection, and sanitized logs.
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
