# Debugging journal

This document records the real defects encountered while building and running
the Telnyx developer support assistant, with the logs and measurements that
revealed each one and the fix that resolved it. It is referenced from the
README's observability section and demonstrated on demo day.

> **Status.** The first real incidents are appended starting at Step 6, once
> the two business webhooks (`POST /init`, `POST /tickets/create`), the Telnyx
> public-key secret, the KV binding, and the Actor are all deployed. The scaffold
> shipped in Step 2 only contains a `Counter` actor and cannot receive signed
> callbacks, so it cannot produce dialogue-side incidents yet.

## Distinction enforced in this file

A **simulated failure** is one we deliberately trigger to exercise an error
branch (e.g. sending a request without the `telnyx-signature-ed25519` header
to confirm the 403 path, or pointing the assistant at an unreachable MCP tool).
Simulated failures are part of verification, not bugs. They are recorded in
`docs/verification.md` (Step 16), not here.

A **real defect** is a behaviour we did not intend that occurred while the
system was running against itself. Each entry below clearly states which kind
it is, and only real defects appear in this file.

## Entry template

Copy this block when appending a new real defect.

```text
### Real bug #N — <short title>

- **Symptom:** what the caller/operator observed, in one or two lines.
- **Affected request / call:** request id(s), stage, operation (no phone,
  no free-form ticket text, no secret).
- **Logs / measurements that revealed it:** the exact log line(s) or metric
  values that pointed at the cause, with their timestamp. Prefer runtime logs
  (`telnyx-edge logs <function> --json`) and invocation logs (`--type
  invocations --json`); mention `telnyx-edge metrics <function>` if the signal
  was a latency or error-rate spike.
- **Cause:** root cause, one paragraph. Distinguish "code wrong" from
  "config/deploy wrong" from "platform/runtime wrong".
- **Fix:** the change that resolved it (file + line if a code change).
- **Verification after the fix:** the request that failed before, replayed,
  and the observation that now confirms OK (log line or metric value).
```

## Detection within a minute

The README's observability section describes how we would notice a break
within a minute and where the diagnosis starts. The short version, kept here
for quick reference:

- **Live call problems**: tail runtime logs (`telnyx-edge logs <function>
  --tail --json`) and the assistant transcript in parallel; the transcript
  names the failing node, the log line names the stage/operation/error_code.
- **No call reaching the assistant**: check the phone number assignment and
  the TeXML application first (Step 10 wiring).
- **Call connects but workflow stuck**: check the transcript and the latest
  `/init` log entry; missing variables usually mean a signature or KV/Actor
  failure in the webhook。
- **Ticket not created**: check the `create_ticket` invocation logs, then the
  Actor invocation logs (`telnyx-edge actors logs CallerTickets --type
  invocations --json`).
- **FAQ/MCP failure**: check the `mcp` stage log entries and the MCP server
  connectivity from the assistant.
- **Latency spike**: `telnyx-edge metrics <function> --since 5m --json` and the
  p95 / error-rate columns.

## Entries

_No real defects recorded yet. The first entry is appended during Step 6
onwards, once signed callbacks can reach the deployed Function._
