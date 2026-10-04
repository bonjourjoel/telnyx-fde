# Test ticket follow-up

Deploy the follow-up workflow and reset the Portal demo's tickets:

```powershell
npm.cmd run deploy
npm.cmd run resetactor
```

Start a Portal voice test: the greeting should contain no ticket offer.
Mute your microphone during the greeting, then enable it to speak.

Prepare the two demo tickets once:

```powershell
Copy-Item -LiteralPath seed-demo.example.json -Destination seed-demo.local.json
# Set base_url to the deployed Function URL. Keep conversation_channel = web_call.
node --import tsx scripts/seed-demo.ts
```

Start another Portal test. Choose a ticket by number, reference, or subject.
Expect its reference, status and progress, then goodbye and automatic hangup.
Also try an ambiguous choice, an out-of-range number, a new question, and cancellation.
Redeploy and check that the same tickets are still offered.

Run `npm.cmd run resetactor` between tests whenever you want an empty demo again.
It clears only that instance's tickets and reference counter. It does not seed
fixtures, deploy code, change KV configuration, or reset other callers.

For one physical caller, configure their number privately:

```powershell
Copy-Item -LiteralPath reset-actor.example.json -Destination reset-actor.local.json
# Set caller_phone in this ignored file. Never commit it.
npm.cmd run resetactor -- --phone
```

Real inbound phone tests remain blocked by the account's SIP 486 / D61 restriction.
Portal voice tests remain usable.
