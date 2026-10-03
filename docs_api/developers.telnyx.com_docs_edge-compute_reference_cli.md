*** https://developers.telnyx.com/docs/edge-compute/reference/cli:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# CLI Reference

> Every telnyx-edge CLI command in v0.5.9: install, authenticate, scaffold, deploy, and manage revisions, secrets, bindings, storage, actors, and local development.

`telnyx-edge` is the command-line tool for Edge Compute: it scaffolds function projects, deploys them, and manages the resources they bind. This page covers every command in v0.5.9.

| Command | What it does |
| - | - |
| `auth` | Authenticate the CLI and manage stored credentials |
| `new-func` | Scaffold a new function |
| `ship` | Build and deploy a function |
| `ship status` | Show the latest ship outcome and failure details |
| `list` | List functions |
| `inspect` | Show function details |
| `logs` | Read runtime or invocation logs |
| `log-export` | Configure external log export |
| `status` | Check CLI configuration and API connectivity |
| `revisions` | List immutable function revisions |
| `rollback` | Route traffic back to a prior revision |
| `secrets` | Manage organization-scoped secrets |
| `bindings` | Manage the organization-level Telnyx API binding |
| `types` | Generate TypeScript types from your manifest |
| `storage` | Manage KV and SQL storage |
| `actors` | Inspect and manage Stateful Actor types |
| `metrics` | View function request and resource metrics |
| `dev` | Run a project locally |
| `domains` | Manage custom domains |
| `deployments` | View deployment history |
| `config` | View and change CLI preferences |
| `reset-func` | Reset a failed function to `created` |
| `delete-func` | Delete a function |

## Installation

The CLI ships as GitHub release binaries only — it is not on npm and there is no package-manager install.

| Platform | Asset |
| - | - |
| Linux amd64 | `telnyx-edge-v0.5.9-linux-amd64.tar.gz` |
| Linux arm64 | `telnyx-edge-v0.5.9-linux-arm64.tar.gz` |
| macOS arm64 (Apple silicon) | `telnyx-edge-v0.5.9-macos-arm64.tar.gz` |
| macOS amd64 (Intel) | `telnyx-edge-v0.5.9-macos-amd64.tar.gz` |
| Windows | `.zip` archives on the same [release page](https://github.com/team-telnyx/edge-compute/releases) |

Each tarball extracts into a versioned directory containing the `telnyx-edge` binary:

```bash theme={null}
VERSION=v0.5.9

curl -fsSL "https://github.com/team-telnyx/edge-compute/releases/download/${VERSION}/telnyx-edge-${VERSION}-linux-amd64.tar.gz" | tar xz
sudo mv "telnyx-edge-${VERSION}-linux-amd64/telnyx-edge" /usr/local/bin/
```

## auth

```bash theme={null}
telnyx-edge auth login                       # OAuth 2.0 in the browser
telnyx-edge auth api-key set "KEY..."        # or persist a Telnyx API key
telnyx-edge auth status                      # verify the stored credential
```

Use either `auth login` or `auth api-key set` to authenticate the CLI, then `auth status` to confirm the credential works.

## new-func

```bash theme={null}
telnyx-edge new-func -l ts -n my-func
```

Creates a new function project. `-l` / `--language` selects the runtime and `-n` / `--name` sets the function name. On success the API response contains the function's UUID `func_id`. Rapid successive calls can hit HTTP 429 rate limits.

What each scaffold contains:

| Language | Files |
| - | - |
| `ts` | `func.toml`, `index.ts`, `package.json`, `tsconfig.json` |
| `js` | `func.toml`, `index.js`, `package.json` |
| `go` | `func.toml`, `handler.go`, `go.mod` |
| `python` | `func.toml`, `function/func.py`, `pyproject.toml` |
| `quarkus` | `func.toml`, `pom.xml`, `mvnw`, `.mvn/`, `src/main/java/functions/` |

The entrypoint contract differs per language — see [HTTP handler](/docs/edge-compute/runtime/http-handler).

## ship

```bash theme={null}
telnyx-edge ship                       # deploy the function in the current directory
telnyx-edge ship --from-dir ../other   # or any relative, absolute, or ~/ path
```

| Flag | Description |
| - | - |
| `-f`, `--from-dir` | Path to the function directory (default: current directory) |
| `-t`, `--timeout` | Deployment monitoring timeout as a Go duration (`2m`, `300s`; default `5m0s`) |

`ship` uploads, builds, pushes, and deploys the function named by the directory's `func.toml`. There is no environment flag — staging and production are [separate functions](/docs/edge-compute/deploy#staging-and-production). Umbrella projects (`telnyx.toml`) are bundled client-side before upload: the module graph rooted at `main` is compiled into a single file with esbuild (TypeScript/JavaScript only), and the manifest is included so the platform can deploy any `[[actors]]` it declares.

On success, `ship` prints the live URL — stable across deploys:

```
📡 Your function is live at:
   https://my-func-0198c2c5-8.telnyxcompute.com
```

The scheme is `{func-name}-{func-id-prefix}.telnyxcompute.com` — see [Routes & Domains](/docs/edge-compute/configuration/routing). Each successful ship also produces an immutable revision ([revisions](#revisions), [rollback](#rollback)).

### ship status

```bash theme={null}
telnyx-edge ship status my-func
telnyx-edge ship status my-func --logs
```

Reports the outcome of a function's latest ship, classified by where it failed. Prints one actionable line: an icon plus the reason from the platform. A build- or deploy-stage failure additionally shows a short title naming the stage, with the reason below it — this holds for every deploy-stage cause (a startup crash, the function never becoming ready, or an infrastructure issue), not just crashes.

`--logs` adds a snippet underneath when the platform sent one: always for a build failure, and for a deploy failure only when it was a startup crash. Read-only.

| Flag | Description |
| - | - |
| `--logs` | Also print the build log or crash output, when the platform sent one |

The `<function>` argument accepts a function name or id (resolved like `inspect`).

## list

```bash theme={null}
telnyx-edge list
telnyx-edge list --page 2 --page-size 50
```

Lists your functions — id, name, status, creation time, and invoke URL. Paginated: `--page` (default 1) and `--page-size` (default 25).

## inspect

```bash theme={null}
telnyx-edge inspect my-func   # accepts a name or an id (first column of 'list')
```

Shows one function's status, invoke URL, and timestamps, plus the actor types it binds — each binding's type, status, and owner/reference role.

## logs

> **Requires CLI v0.5.1 or newer.**

```bash theme={null}
telnyx-edge logs my-func                  # last 1h, up to 50 lines
telnyx-edge logs my-func --since 10m       # last 10 minutes
telnyx-edge logs my-func --last 200        # up to 200 lines
telnyx-edge logs my-func --json           # JSON output
```

Prints a deployed function's recent stdout and stderr, oldest line first. Reads a window of history and exits — it does not stay attached. Lines reach the platform a few seconds after the function writes them, so make a request, wait a moment, then run this.

Each line prints as `[timestamp] [level] message`. The level is best-effort and frequently wrong on stack traces — a multi-line error arrives as several separate lines.

| Flag | Description |
| - | - |
| `--since` | How far back to read (Go duration: `10m`, `2h`; default `1h`, max `24h`) |
| `-n`, `--last` | Maximum lines to print (default `50`, max `250`) |
| `--json` | Output the result as a JSON object instead of formatted lines |
| `--type` | Log type to fetch: `runtime` or `invocations` |
| `--tail` | Stream new log lines live instead of reading history (requires CLI v0.5.3 or newer; see [Logs](/docs/edge-compute/observability/logs#tail-logs-live)) |

`--since` and `--last` are clamped rather than refused when they exceed the maximum. Warnings (incomplete result, truncated output) go to stderr so they never contaminate piped output.

The `<function>` argument accepts a function name or id (resolved like `inspect`).

## log-export

> **Requires CLI v0.5.3 or newer.**

```bash theme={null}
telnyx-edge log-export set my-func --endpoint https://api.honeycomb.io/v1/logs --header x-honeycomb-team=abc123
telnyx-edge log-export set my-func --endpoint https://collector.example.com/v1/logs
telnyx-edge log-export set my-func --endpoint https://collector.example.com/v1/logs --invocations
telnyx-edge log-export get my-func
telnyx-edge log-export delete my-func
```

Configure where a function's runtime and/or invocation logs are pushed — an external OTLP endpoint (Honeycomb, Datadog, Grafana, your own collector, ...) — as they happen, instead of only being readable with `logs`. See [Log export](/docs/edge-compute/observability/log-export).

| Subcommand | Description |
| - | - |
| `set <function>` | Configure (or replace) a function's log export destination |
| `get <function>` | Show the current destination and which log types are exported |
| `delete <function>` | Stop exporting; idempotent |

`set` flags:

| Flag | Description |
| - | - |
| `--endpoint` | HTTPS URL to push logs to (required) |
| `--header` | Header attached to every push as `KEY=VALUE` (repeatable); encrypted at rest and never returned |
| `--runtime` | Export runtime logs; naming this flag alone exports runtime only |
| `--invocations` | Export invocation logs; naming this flag alone exports invocations only |

Naming neither `--runtime` nor `--invocations` exports both. `set` is a full replace, not a patch. `get` accepts `--json` and emits `{"configured": bool, "data": ...|null}`.

## status

```bash theme={null}
telnyx-edge status
```

Self-diagnostics: config file existence, authentication status, and connectivity to `https://api.telnyx.com`. Run it first when any other command misbehaves.

## revisions

```bash theme={null}
telnyx-edge revisions list my-func
```

Lists the most recent revisions for a function, newest first, with each revision's id, ship time, author, and deploy status; the revision currently serving traffic is marked. Every successful `ship` produces an immutable revision — see [Versions & Rollback](/docs/edge-compute/configuration/versions).

## rollback

```bash theme={null}
telnyx-edge rollback my-func a1b2c3d
# → Rollback of 'my-func' to revision a1b2c3d accepted; traffic is switching across clusters.
```

Instantly retargets traffic to an existing, immutable revision across all clusters — no rebuild, no re-upload. Only revisions that reached `deploy_ok` can be rolled back to; get ids from `revisions list`. Your source tree is untouched — the next `ship` deploys whatever is on disk, as a new revision.

## secrets

Secrets are organization-scoped key-value pairs for sensitive data. The arguments are positional — there are no `--name`/`--value` flags:

```bash theme={null}
telnyx-edge secrets add STRIPE_API_KEY "sk_live_abc123"
# → Secret 'STRIPE_API_KEY' added successfully

telnyx-edge secrets list      # keys only — values are never shown
telnyx-edge secrets delete OLD_API_KEY
```

`add` on an existing key overwrites it. Values are injected at deploy time, so `ship` each function that uses a changed secret.

Functions read secrets two ways, and both are always true: every secret is injected as a plain environment variable into **all** functions in your organization, and TypeScript functions can additionally declare a `[[secrets]]` binding and read through the typed `env.SECRETS.get()`. See [Secrets](/docs/edge-compute/configuration/secrets) for both surfaces.

## bindings

Manages the **org-level Telnyx credential** (one per organization) behind the [Telnyx API binding](/docs/edge-compute/telnyx-api). The per-function flow needs none of these commands — declaring `[telnyx]` in `func.toml` wires the binding automatically on `ship`.

```bash theme={null}
telnyx-edge bindings create     # provision the org credential (one per organization)
telnyx-edge bindings get        # binding metadata
telnyx-edge bindings validate   # check the credential works
telnyx-edge bindings update     # regenerate — use if you suspect compromise
telnyx-edge bindings delete     # remove; functions lose automatic Telnyx API access
```

## types

```bash theme={null}
telnyx-edge types                  # writes telnyx-env.d.ts at the project root
telnyx-edge types -f ./my-func     # or point at another project directory
```

Generates TypeScript types for the `env` surface from your manifest (`func.toml` or `telnyx.toml`), folding every declared binding into one global `Env` interface:

| Declaration | Generated type |
| - | - |
| `[telnyx]` | `env.<BINDING>` is the Telnyx client class from the `telnyx` npm package — `env.<BINDING>.balance.retrieve()` type-checks |
| `[[secrets]]` | `env.SECRETS.get()` accepts the literal union of declared handles → `Promise<string>`; a typo'd handle fails to compile |
| `[storage.kv.<NAME>]` | `env.<NAME>` is `KvNamespace` from `@telnyx/edge-runtime` — new in v0.2.3 |
| `[storage.cloudstorage.<NAME>]` | `env.<NAME>` is `CloudStorageBucket` from `@telnyx/edge-runtime` — new in v0.2.4 |
| `[storage.sqldb.<NAME>]` | `env.<NAME>` is `SqlDatabase` from `@telnyx/edge-runtime` — requires the SDK at 0.9.0 or newer |
| `[[actors]]` | `env.<BINDING>` exposes the bound actor class's public method signatures (umbrella `telnyx.toml` projects only) |
| `[[ratelimits]]` | `env.<NAME>` is `RateLimiter` from `@telnyx/edge-runtime` — new in v0.4.0, requires the SDK at 0.9.2 or newer |

Declarations only — no JavaScript, no runtime glue, no source edits. Re-run after changing any binding declaration.

<Note>
  `types` generates a `.d.ts` consumed by `tsc` — it has no effect on `js`, `go`, `python`, or `quarkus` runtimes. Bindings on those runtimes are reached over REST instead; see [Bindings](/docs/edge-compute/runtime/bindings).
</Note>

## storage

```bash theme={null}
telnyx-edge storage kv create --name my-cache
telnyx-edge storage kv key put <namespace-id> user/123 "hello" --ttl 30s
telnyx-edge storage sqldb create --name links-db
telnyx-edge storage sqldb execute links-db --remote --command "SELECT 1"
telnyx-edge storage sqldb export links-db --remote --output ./database.sql
```

Manages KV storage namespaces and keys: `storage kv` covers namespace create/list/get/delete, and `storage kv key` covers put/get/list/delete including server-side TTL and prefix listing. Full flags and examples live in the [KV CLI reference](/docs/edge-compute/kv/cli).

`storage sqldb` manages SQL databases: create/list/get/delete, `execute` for running SQL against a database out-of-band, `export` for dumping a database as a `.sql` file, and `migrations` for versioned schema files. It requires **CLI v0.3.0 or newer** — see the [SQL Databases CLI reference](/docs/edge-compute/sqldb/cli) for the full flags and examples.

## actors

```bash theme={null}
telnyx-edge actors list               # the account's registered actor types
telnyx-edge actors inspect Account    # one type, its attached functions, + live instance count
telnyx-edge actors instances Account  # list persisted instances (type/id pairs)
telnyx-edge actors logs Counter       # recent runtime + invocation logs
telnyx-edge actors metrics Counter    # recent request + resource metrics
telnyx-edge actors delete Account     # delete an account-scoped type
```

Inspects and manages the [Stateful Actor](/docs/edge-compute/stateful-actors) types registered to your account (account-scoped, keyed by type). `inspect` reports the actor type's live instance count; `instances` lists the persisted instances (type/id pairs, e.g. `Counter/alice`); `logs` and `metrics` show recent activity — see [Stateful Actor observability](/docs/edge-compute/stateful-actors/observability). Output renders backend state — never inferred from local files.

### actors logs

> **Requires CLI v0.5.8 or newer.**

```bash theme={null}
telnyx-edge actors logs Counter                       # both streams, interleaved
telnyx-edge actors logs Counter --type runtime        # console.log/error output only
telnyx-edge actors logs Counter --type invocations    # one record per method call
telnyx-edge actors logs Counter --type invocations --instance alice
telnyx-edge actors logs Counter --since 10m --last 200 --json
```

Prints a StatefulActor type's recent logs, oldest line first. Reads a window of history and exits — it does not stay attached. Without `--type`, both streams print interleaved by time: `runtime` is the `console.log`/`error` output from your own method bodies; `invocations` is one platform-recorded record per method call (auto-RPC, `fetch()`, or `alarm()`), so it reports traffic even for a type that logs nothing.

| Flag | Description |
| - | - |
| `--type` | Log type to fetch: `runtime` or `invocations` (omit for both, interleaved) |
| `--instance` | Keep only this instance's records; valid only with `--type invocations` |
| `--since` | How far back to read (Go duration: `10m`, `2h`; default `1h`, max `24h`) |
| `-n`, `--last` | Maximum lines to print (default `50`, max `250`) |
| `--json` | Output the result as a JSON object instead of formatted lines |

`--since` and `--last` are clamped rather than refused when they exceed the maximum.

Runtime lines print as `[timestamp] [level] message`. Invocation lines print as `[timestamp] instance method outcome <duration>ms`, where outcome is `ok` or an error outcome.

`<type>` accepts an actor type name or id (resolved like `actors inspect`).

### actors metrics

> **Requires CLI v0.5.8 or newer.**

```bash theme={null}
telnyx-edge actors metrics Counter
telnyx-edge actors metrics Counter --since 6h
telnyx-edge actors metrics Counter --json
```

Shows a StatefulActor type's recent request and resource metrics: request count, success/error rates, latency (p50/p95/p99/average), average request/response byte sizes, CPU, memory, and stored state size. Defaults to the last `24h`.

Stored state is the type's total `ctx.storage.sql` size across all its instances over the window, not a per-instance figure — per-instance point-in-time size stays on `actors instances`.

`--since` is capped at `90h`: past the backend's invocation-window budget, request/latency/byte-size fields would come back null while CPU, memory, and storage kept reporting, so the CLI refuses wider windows rather than return a partial response.

| Flag | Description |
| - | - |
| `--since` | How far back to summarize (e.g. `1h`, `24h`, `90h`; default `24h`, max `90h`) |
| `--json` | Output the raw metric aggregate response as JSON |

`<type>` accepts an actor type name or id (resolved like `actors inspect`).

## metrics

> **Requires CLI v0.5.2 or newer.** Shows a deployed function's recent request and resource metrics: request count, success/error rates, latency percentiles (p50/p95/p99), CPU, and memory over a `--since` window (default `24h`, max `168h`).

```bash theme={null}
telnyx-edge metrics <function>              # last 24 hours
telnyx-edge metrics <function> --since 1h --json
```

Full metric definitions and the window budget live in [Observability](/docs/edge-compute/observability). The actor-scoped counterpart — `actors metrics <type>` — covers StatefulActor types and additionally reports stored state size.

## dev

> **Requires CLI v0.5.6 or newer.** Runs a `telnyx.toml` project locally in Docker — the function runtime and its StatefulActors (KV, SQL, alarms) — served at `http://127.0.0.1:8787`, with hot reload on save. Needs Docker with Compose v2.17 or later; the first run downloads about 1 GB of runtime images.

```bash theme={null}
telnyx-edge dev                # boot + watch
telnyx-edge dev --no-watch     # boot and return (scripts, CI)
```

Local state persists between runs. Bindings that need the platform (`[[secrets]]`, `[telnyx]`, `[storage.*]`, `[[ratelimits]]`) are not available locally and are listed at startup. See [Local Development](/docs/edge-compute/stateful-actors/local-development) for the full guide, including how to reset the local environment and delete persisted state.

## domains

Manages custom domains for a function. After adding a hostname, verify domain ownership and upload your own TLS certificate before serving HTTPS traffic.

```bash theme={null}
telnyx-edge domains list
telnyx-edge domains add api.example.com <function_id>
telnyx-edge domains verify api.example.com
telnyx-edge domains cert upload api.example.com --cert <cert-file> --key <key-file>
telnyx-edge domains delete api.example.com
```

See [Custom Domains](/docs/edge-compute/custom-domains) for DNS and certificate setup.

## deployments

> **Requires CLI v0.5.2 or newer.** Shows a function's deploy history including why deploys failed — each ship's build, deploy, and rollback outcome.

```bash theme={null}
telnyx-edge deployments <function>
```

## config

Views and changes persistent CLI preferences stored in `~/.telnyx-edge/config.toml` (for example, confirmation-prompt behavior). Authentication and endpoint settings are managed by [`auth`](#auth) and shown by [`status`](#status), not by this command.

## reset-func

```bash theme={null}
telnyx-edge reset-func broken-func
```

Tears down a failed function's deployed resources and returns it to the `created` state — preserving its id, name, and config — so you can fix the code and `ship` again. Allowed only from a terminal failure state (`build_failed`, `deploy_failed`, `delete_failed`); a healthy function can't be reset (use `delete-func`), and an in-progress operation must finish first.

## delete-func

```bash theme={null}
telnyx-edge delete-func my-old-func
```

Deletes a function by name. This cannot be undone — the function, its revisions, and its URL are gone.

## Related

* [Configuration](/docs/edge-compute/configuration) — every `func.toml` / `telnyx.toml` key the CLI reads
* [CI/CD](/docs/edge-compute/deploy) — install, authenticate, and ship from a pipeline
* [Versions & Rollback](/docs/edge-compute/configuration/versions) — how revisions and rollback behave
* [KV CLI](/docs/edge-compute/kv/cli) — the full `storage kv` surface
* [SQL Databases CLI](/docs/edge-compute/sqldb/cli) — the full `storage sqldb` surface, including `execute`, `export`, and `migrations`
* [Stateful Actors](/docs/edge-compute/stateful-actors) — the projects behind `--actor` and the `actors` command


