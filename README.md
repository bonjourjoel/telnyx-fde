# telnyx-fde

A Telnyx Edge **StatefulActor** project, scaffolded with `telnyx-edge new-func --actor`.

> **Preview.** StatefulActor support is in preview — this project is ready to
> build against and ship with `telnyx-edge`; the surface may still change
> before general availability.

## Layout

| File | Purpose |
| --- | --- |
| `telnyx.toml` | Project manifest. Declares `COUNTER`, `CALLER_TICKETS`, the KV binding, and the existing function identity. |
| `src/index.ts` | Function entry point. Serves the existing HTTP routes and exports both actor classes for bundling. |
| `src/counter.ts` | The `Counter` actor class. |
| `src/actors/caller-tickets.ts` | Persistent tickets for one caller: read, idempotent creation, and preparation-only fixture insertion. |
| `src/contracts.ts` | Shared ticket contracts, actor inputs, and field validations. |
| `telnyx-env.d.ts` | Binding types generated from the manifest by `telnyx-edge types`. |
| `scripts/check-caller-tickets.ts` | Sequential local actor checks with synthetic inputs and a storage double. |
| `package.json` / `tsconfig.json` | TypeScript project configuration. |

## Deploy

Install dependencies and ship:

```powershell
npm install
telnyx-edge ship
```

## Using the actor

`src/index.ts` resolves an actor instance by name and calls a method on it:

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
the raw phone number. Business HTTP routes are not connected to this actor yet.

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
node --import tsx --test scripts/check-caller-tickets.ts
```

The checks cover creation, re-reading from a reconstructed instance, numbering,
operation replays, input limits, fixture replay, invalid batches, and rejected
writes. They use a storage double and execute sequentially. They do not establish
production durability, redeployment preservation, or runtime serialization;
those require later checks on Telnyx. No parallel test is planned.
