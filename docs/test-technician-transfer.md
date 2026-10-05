# Test the technician flag and transfer branch

Deploy the step 14 workflow:

```powershell
npm.cmd run deploy
```

The flag is `technician_available` in the existing `support/config` KV key, set
by an earlier deployment to `false`. The three CLI commands below read or set it
on the existing namespace and key without redeploying. Each command rejects
unknown or extra args before any .env load or account access.

```powershell
npm.cmd run technician:get
npm.cmd run technician:true
npm.cmd run technician:false
```

`technician:get` reports only `technician_available = true` or
`technician_available = false`.
`technician:true` writes the boolean when it differs, reads back and verifies the
full stored object before reporting success; an already-correct value skips the
PUT. `technician:false` mirrors that in the other direction. The CLI never
substitutes a default on a failed read, never claims success on an uncertain
write, and never provisions missing configuration. Reads and writes use the
existing `support/config` key only; no new endpoint is created.

KV stores the entire configuration object under one key, so the CLI performs a
whole-object GET, replaces only `technician_available`, and PUTs the full JSON
object back to the same key. There is no documented atomic compare-and-swap for
this endpoint, so administrative flag edits must run sequentially: do not run
`technician:true`/`technician:false` concurrently with each other or with a
redeploy that also writes `support/config`. The new value takes effect on the
next call without redeploy.

## Graph from RESOLUTION

```text
RESOLUTION (Speak: "The FAQ doesn't cover this question.")
  -> TECHNICIAN_OFFER (Prompt)
       +-- technician_available == false  (preempts the model)
       |     -> TICKET_INTAKE
       +-- flag true and caller explicitly agrees
       |     -> TRANSFER_MESSAGE -> TRANSFER
       |           +-- Success: call transferred, no automatic workflow hangup
       |           +-- Failure recognized by Telnyx
       |                 -> TRANSFER_FAILED -> TICKET_INTAKE (no second offer)
       +-- caller declines the technician (not ending)
       |     -> TICKET_INTAKE
       +-- caller ends or cancels
             -> GOODBYE -> HANGUP
```

The local checks only assert the graph structure, deterministic guard, edge
conditions, and tool scopes; they do not run the hosted model or place a real
call. Joel performs every smoke test below.

## Flag false

1. Run `npm.cmd run technician:false` (or check `npm.cmd run technician:get`).
2. Start a Portal voice test and ask an uncovered FAQ question.
3. `RESOLUTION` reaches `TECHNICIAN_OFFER`; the comparison
   `technician_available == false` preempts the model and routes straight to
   `TICKET_INTAKE`. The caller never hears the technician question.

## Successful transfer (real phone)

Use a real call to the project number in `config/telephony.ts` for the
physical-chain proof. Portal routing checks do not prove real phone behavior or
a real transfer; they are useful only for routine conversational smoke checks.

1. Run `npm.cmd run technician:true`.
2. Call the project number and ask an uncovered FAQ question.
3. `TECHNICIAN_OFFER` asks "Would you like me to connect you to a technician?".
4. Answer "yes" explicitly. The workflow routes `transfer_message -> transfer`.
   Verify on the real call that the caller leg is transferred and the assistant
   does not run an automatic workflow hangup.
5. After the conversation ends, run `npm.cmd run technician:false` to restore the
   safe default. The flag takes effect on the next call without redeploy.

## Failed transfer

The hosted transfer tool can fail in ways Telnyx recognizes as a failure on the
real call (a transfer rejection, or a failure reported through the workflow
runtime). On failure the single default outgoing edge on `TRANSFER` routes to
`TRANSFER_FAILED`, whose verbatim Speak is "I couldn't connect you to a
technician." (no ticket offer wording). `TRANSFER_FAILED` then routes directly
to `TICKET_INTAKE`, where the unchanged single ticket offer is presented exactly
once. There is no second offer inside the failure Speak and no automatic retry.

1. Run `npm.cmd run technician:true`.
2. Make a real call to the project number, ask an uncovered FAQ question, and
   explicitly agree to the technician.
3. If Telnyx reports a transfer failure on the real call, verify the
   `TRANSFER_FAILED` Speak, then the standard ticket intake. Follow
   [test-ticket-creation.md](test-ticket-creation.md) to create or decline a
   ticket from there. Inspect the real trace (transcript and workflow logs) to
   confirm the failure was recognized by the transfer tool rather than assumed.

## Decline and cancel

With the flag true:

- Answering "no" to the technician question routes to `TICKET_INTAKE`. The
  caller can create, decline, or cancel a ticket as in step 13.
- Asking to cancel or to finish routes to `GOODBYE -> HANGUP`.

## Repeated offer is contained

The technician transfer branch can only run from `TECHNICIAN_OFFER`. The FAQ,
ticket follow-up, ticket status, ticket creation, and hangup paths never offer
a transfer; the assistant tool ids expose only the updater, and the standalone
`TRANSFER` Tool node is the only reference to the `TRANSFER` shared tool. After
a failed transfer, `TICKET_INTAKE` is the only path available through the
unchanged single offer.

Continue observing logs and metrics during the smoke test. The local suite
covers the deterministic flag guard, prompt scope, the single failure default,
and the reconciliation of previously deployed 15- and 16-node graphs to the new
20-node technician branch on the same assistant id; it does not prove the
hosted model's consent handling, real transfer, or physical voice behavior.
