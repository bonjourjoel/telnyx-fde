*** https://developers.telnyx.com/docs/edge-compute/reference/logs-metrics -> https://developers.telnyx.com/docs/edge-compute/observability:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Edge Compute observability

> Observe Edge Compute functions with logs, metrics, deployment history, health checks, and CLI diagnostics.

Edge Compute provides visibility into function execution through runtime logs, request-level invocation logs, function metrics, deployment history, and health checks. Use the CLI for day-to-day debugging, or the Edge Compute API to integrate observability data into your own tooling.

## What you can observe

| Area | What it tells you | CLI |
| - | - | - |
| Runtime logs | Your function's stdout/stderr, including `console.log`, errors, and uncaught exceptions | `telnyx-edge logs <function>` |
| Invocation logs | One platform-generated record for each HTTP request served | `telnyx-edge logs <function> --type invocations` |
| Metrics | Request counts and HTTP rates, latency, CPU, and memory | `telnyx-edge metrics <function>` |
| Latest ship outcome | Whether the latest ship succeeded, is still running, or failed, including the failure stage and reason | `telnyx-edge ship status <function>` |
| Deployment history | Previous ships, their status and build duration, active revision, and per-ship failure details | `telnyx-edge deployments <function>` |
| Health checks | Application-level health through a route implemented by your function | Your `/health` route + an external checker |

## Control-plane visibility

The CLI also provides read-only views of your function inventory and deployment state:

| Command | What it tells you |
| - | - |
| `telnyx-edge ship` | Build and deploy progress for one revision, ending in the live URL — build and deploy failures surface here |
| `telnyx-edge ship status <function>` | The outcome of a function's latest ship: one line classifying where it failed, with `--logs` for the platform-provided error snippet when available |
| `telnyx-edge list` | Every function: id, name, status, creation time, invoke URL |
| `telnyx-edge inspect <function>` | One function's status, invoke URL, timestamps, and actor bindings — accepts a name or an id |
| `telnyx-edge logs <function>` | Recent runtime or invocation logs — `--since`, `--last`, and `--json` work with both log types |
| `telnyx-edge deployments <function>` | Deploy history, newest first, including failure stage and reason for failed ships |
| `telnyx-edge status` | CLI self-diagnostics: config file, authentication, connectivity to `api.telnyx.com` — it checks your CLI, not your functions |

Add `-v` to any command for verbose client-side logging when a command itself misbehaves.

## Next steps

* [Logs](/docs/edge-compute/observability/logs) — runtime and invocation logs, plus guidance for sending custom telemetry to a sink you run
* [Metrics](/docs/edge-compute/observability/metrics) — request, latency, CPU, and memory metrics
* [Deployment history](/docs/edge-compute/observability/deployment-history) — latest ship outcome and historical failures
* [Health checks](/docs/edge-compute/observability/health-checks) — implement and probe an application-level health route
* [API Reference](/docs/edge-compute/observability/api-reference) — customer-facing observability endpoints
* [CLI Reference](/docs/edge-compute/reference/cli) — full command and flag reference


