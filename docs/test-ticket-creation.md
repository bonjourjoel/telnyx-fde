# Test ticket creation

Deploy:

```powershell
npm.cmd run deploy
```

Use the Portal voice test. Choose a new question if tickets are presented.
Ask something outside the FAQ, for example: "My invoice was charged twice."

- When the assistant summarizes the request and asks "Would you like me to create
  a support ticket?", say yes. Expect a reference, goodbye and hangup.
- Start a new call. Expect that same ticket in the history, with status open.
- On another call, decline the single ticket offer. Expect goodbye without creation.

Check logs/transcript for the updater, CREATE_TICKET and `POST /tickets/create`.
Success requires voice status `"200"`, `created_ticket_id` and
`created_ticket_reference`; the backend must report a persisted Actor result.
Confirm the real callback's signature, identity presets and response mappings.

A failed/unconfirmed result says "I couldn't confirm ticket creation" and hangs
up without retry. A missing usable call identity/context blocks creation before
the offer. The local suite covers these guards and backend failures; it does not
prove the hosted model's consent handling or real Portal callbacks.

No reset or seeding is required. These calls create real demo tickets.
