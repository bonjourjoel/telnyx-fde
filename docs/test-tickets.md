# Test ticket follow-up

Deploy the follow-up workflow and reset the Portal demo's tickets. Joel
performs these commands; the smoke checks below do not run them:

```powershell
npm.cmd run deploy
npm.cmd run resetactor
```

Step 11 splits the old combined `ORIENTATION` node into `MAIN_ROUTING` and
`TICKET_SELECTION`. `MAIN_ROUTING` decides the intent right after the greeting
and owns no business tools. `TICKET_SELECTION` owns the ticket menu and the
status update; it never routes back to FAQ or main routing. When exactly one
ticket is presented, `/init` prefills `selected_ticket_status_text` with that
ticket's exact backend `status_text`, so the existing
`selected_ticket_status_text != ""` comparison on `TICKET_SELECTION` bypasses
the node's model turn and routes directly to `TICKET_STATUS`. The caller hears
the status and goodbye without selecting a ticket from a menu. With zero
presented tickets the prefill stays empty and `MAIN_ROUTING` routes to FAQ, so
no ticket menu is read. With multiple presented tickets the prefill stays empty
and `TICKET_SELECTION` reads the menu, and the caller chooses a ticket through
`SET_SUPPORT_VARIABLES`. The prefill
depends on successful reads and exactly one presented ticket, never on
`can_create_ticket`, so callers without creation context still hear their
single existing ticket. The split workflow is required: the old combined
`ORIENTATION` node shared its status comparison with intent-like edges on a
single node, so the prefill is unsafe there. These Portal smoke checks exercise
the split and the deterministic single-ticket bypass. Local graph tests do not
run the hosted model or prove voice delivery, so a Portal voice test is still
required after deployment.

Step through these Portal smoke checks in order. They use only the existing
`deploy`, `resetactor`, and `seedticketsweb` commands plus the Portal voice
test. No new scripts, flags, fixture formats, admin endpoints, or automatic
preparations are required.

Run `npm.cmd run resetactor` between cases whenever you want an empty demo.
It clears only that instance's tickets and reference counter, and does not
seed fixtures, deploy code, change KV configuration, or reset other callers.

1. **No tickets** (after `resetactor`): Start a Portal voice test and mute
   your microphone during the greeting. The greeting offers a new question
   only. Enable the microphone and ask a covered FAQ question, so no ticket
   is created. `MAIN_ROUTING` routes a new question to FAQ, and no ticket
   list is read. The assistant announces the page title, says goodbye, and
   hangs up. `selected_ticket_status_text` stays empty, so no status is
   announced for a zero-ticket caller.

2. **One ticket + follow-up**: Prepare one ticket through one normal Portal
   ticket-creation conversation, following
   [test-ticket-creation.md](test-ticket-creation.md), until the ticket is
   confirmed and the call ends. Start a new Portal voice test and choose
   follow-up when the greeting asks. The backend prefills
   `selected_ticket_status_text` because exactly one ticket is presented, so
   `TICKET_SELECTION` is bypassed by the deterministic comparison and
   `TICKET_STATUS` announces the status and goodbye without a further caller
   response or a spoken menu.

3. **One ticket + new question**: After the previous case, start another
   Portal voice test and ask a covered FAQ question (this avoids creating
   another ticket). `MAIN_ROUTING` routes the new question to FAQ without
   reading the ticket menu. The prefilled status variable never bypasses
   `MAIN_ROUTING`'s intent decision; the assistant announces the title, says
   goodbye, and hangs up.

4. **Multiple tickets + menu**: Reset the demo and add the two ready-made
   demo tickets; no file setup is needed:

   ```powershell
   npm.cmd run resetactor
   npm.cmd run seedticketsweb
   ```

   Start a Portal voice test and choose follow-up when the greeting asks.
   Two tickets are presented, so `selected_ticket_status_text` stays empty
   and `TICKET_SELECTION` reads the full list once, asks which ticket to follow
   up on, accepts a list number, reference, or subject, then copies the chosen
   ticket's `status_text` into `selected_ticket_status_text` through
   `SET_SUPPORT_VARIABLES` before announcing it. Also try an ambiguous choice
   and an out-of-range number: expect a clarification request, not a status
   announcement. Cancellation from `TICKET_SELECTION` reaches goodbye and
   hangup without creating or updating a ticket.

Redeploy and check that the same tickets are still offered.

For one physical caller, configure their number privately:

```powershell
Copy-Item -LiteralPath reset-actor.example.json -Destination reset-actor.local.json
# Set caller_phone in this ignored file. Never commit it.
npm.cmd run resetactor -- --phone
```

Real inbound phone tests remain blocked by the account's SIP 486 / D61 restriction.
Portal voice tests remain usable.

To load the same tickets for a physical caller (an existing Actor is not required):

```powershell
npm.cmd run --silent seedticketsphone -- "YOUR_CALLER_NUMBER_IN_E164"
```

The number is required. `--silent` suppresses npm's argument banner. The scripts
and backend never print it. The caller's operator/subscriber existence is not checked.
Both seed commands reuse stable fixture ids, so repeating them adds no duplicates.

Show every project command and its usage:

```powershell
npm.cmd run help
```
