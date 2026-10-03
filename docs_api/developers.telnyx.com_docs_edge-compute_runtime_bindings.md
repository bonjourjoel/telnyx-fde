*** https://developers.telnyx.com/docs/edge-compute/runtime/bindings:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Bindings

> Typed, pre-authenticated handles to platform resources, resolved by the runtime from a manifest declaration.

A binding maps a name you declare in the project manifest to an authenticated resource handle, resolved by the runtime — the credential is injected for you and never appears in your code, bundle, or logs.

Each binding resolves on the `env` object (from `@telnyx/edge-runtime`) — `env.MY_TELNYX`, `env.SECRETS`, and so on.

<Note>
  The `env` object and `telnyx-edge types` are **TypeScript-only** today. Other runtimes (`js`, `go`, `python`, `quarkus`) don't get the typed `env` handle, but reach the same resources through the credentials injected into the container — see [Bindings from other languages](#bindings-from-other-languages).
</Note>

## Every binding works the same way

```toml theme={null}
# func.toml — 1. declare
[telnyx]
binding = "MY_TELNYX"
```

```bash theme={null}
# 2. generate types
telnyx-edge types
```

```ts theme={null}
// 3. use it — typed and authenticated
import { env } from "@telnyx/edge-runtime";
const { data } = await env.MY_TELNYX.availablePhoneNumbers.list({
  filter: { country_code: "US" },
});
```

The binding name (`MY_TELNYX`) is yours to choose; it becomes the property on `env`. `telnyx-edge types` writes `telnyx-env.d.ts` from the manifest — re-run it after every binding change. Typing for `[storage.kv.<name>]` blocks requires CLI **v0.2.3** or later.

<Note>
  The SDK types `.data` as `T | undefined` for list calls. Under `tsc --strict`, indexing into `data` (e.g. `data.length`) fails with `TS18048: 'data' is possibly 'undefined'`. Coalesce before use: `const arr = list.data ?? [];`.
</Note>

## Catalogue

| Resource | Declaration | On `env` |
| - | - | - |
| [Telnyx API](/docs/edge-compute/telnyx-api) | `[telnyx]` | `env.<BINDING>` — a pre-authenticated Telnyx SDK client |
| [Secrets](/docs/edge-compute/configuration/secrets) | `[[secrets]]` | `env.SECRETS.get("<handle>")` → `Promise<string>` |
| [Rate limiting](/docs/edge-compute/rate-limiting) | `[[ratelimits]]` | `env.<NAME>.limit({ key })` → `Promise<{ success: boolean }>` |
| [Key-Value storage](/docs/edge-compute/kv) | `[storage.kv.<name>]` | `env.<NAME>` — a [`KvNamespace`](/docs/edge-compute/kv/reference/kv-namespace): `get`, `put`, `delete`, `list` |
| [Object storage](/docs/cloud-storage/bindings) | `[storage.cloudstorage.<name>]` | `env.<NAME>` — a [`CloudStorageBucket`](/docs/cloud-storage/bindings/reference): `get`, `put`, `head`, `delete`, `list` |
| [SQL Databases](/docs/edge-compute/sqldb) (Beta) | `[storage.sqldb.<name>]` — `id` must be the database UUID | `env.<NAME>` — a [`SqlDatabase`](/docs/edge-compute/sqldb/reference/sql-database): `prepare`, `batch`, `exec` |
| [Stateful Actors](/docs/edge-compute/stateful-actors) (Beta) | `[[actors]]` — umbrella `telnyx.toml` only | `env.<BINDING>` — an actor namespace: one instance per name, addressed via `idFromName` |

## Manifest: `func.toml` or `telnyx.toml`

Bindings are declared in your project manifest. `telnyx-edge types` reads either form and types `env.<binding>` for each declared binding.

* **`func.toml`** (classic) — the standard `[edge_compute]` project file. Can declare `[telnyx]`, `[[secrets]]`, `[storage.kv.<name>]`, `[storage.cloudstorage.<name>]`, `[storage.sqldb.<name>]`, and `[[ratelimits]]`.
* **`telnyx.toml`** (umbrella) — a manifest with top-level `name` and `main`. Declares the same bindings, plus `[[actors]]`, whose classes are imported from `main`.

```toml theme={null}
# telnyx.toml — umbrella manifest
name = "my-app"
main = "src/index.ts"

[telnyx]
binding = "MY_TELNYX"

[[secrets]]
binding = "GREETING"
name    = "DEMO_GREETING"

[storage.kv.CACHE]
id = "<kv-namespace-uuid>"   # from `telnyx-edge storage kv list`

[[ratelimits]]
name   = "API_LIMIT"          # → env.API_LIMIT
limit  = 100
period = 60
```

## Bindings from other languages

The `env` SDK surface is TypeScript-only, but the credentials behind it are not:

* **Telnyx API** — declaring `[telnyx]` also injects a `TELNYX_API_KEY` environment variable into the container at runtime. Any language can call the Telnyx REST API with it as a bearer token — see [Using the Telnyx API](/docs/edge-compute/telnyx-api).
* **Secrets** — every secret is also injected as a plain environment variable into all your functions (`os.environ["DEMO_GREETING"]`, `os.Getenv("DEMO_GREETING")`, …). `env.SECRETS.get()` and the environment variable are two views of the same value.
* **KV** — any language can use the [KV REST API](/docs/edge-compute/kv/quick-start#path-b-the-rest-api) with the injected `TELNYX_API_KEY`.
* **Object storage** — the typed `env` binding is TypeScript only; from any language, reach the same buckets over the [S3-compatible API](/docs/cloud-storage/quick-start) with your own access keys.
* **SQL Databases** — the typed `env` binding is TypeScript only; from any language, query the same database over [`POST /v2/storage/sqldbs/{id}/actions/query`](/docs/edge-compute/sqldb/quick-start#8-query-it-from-any-language) with a Telnyx API key as a bearer token. `TELNYX_API_KEY` is only in the environment when the function also declares `[telnyx]`, so declare that block as well or supply the key as a [secret](/docs/edge-compute/configuration/secrets). That endpoint takes no bound parameters, so use it for SQL you wrote yourself, never for values that came from a caller.
* **Stateful Actors** — TypeScript only; there is no REST fallback today.
* **Rate limiting** — the typed `env` binding is TypeScript only, and there is no environment-variable equivalent.

## Bindings vs secrets

* **Binding** — a Telnyx or platform resource, authenticated for you (`env.MY_TELNYX`).
* **Secret** — a value you supply (`env.SECRETS.get("STRIPE_KEY")`).

Use a binding for platform resources; use a [secret](/docs/edge-compute/configuration/secrets) for your own third-party credentials.

## Next Steps

* [Telnyx API quick start](/docs/edge-compute/telnyx-api/quick-start) — declare `[telnyx]` and make your first authenticated call
* [KV quick start](/docs/edge-compute/kv/quick-start) — create a namespace, bind it, read and write
* [Object storage binding](/docs/cloud-storage/bindings) — bind a bucket and read, write, and list objects from `env`
* [SQL Databases quick start](/docs/edge-compute/sqldb/quick-start) — create a database, bind it, and query it from `env.DB`
* [Secrets](/docs/edge-compute/configuration/secrets) — add, rotate, and access secrets
* [Stateful Actors](/docs/edge-compute/stateful-actors) — per-entity state and coordination
* [Rate limiting](/docs/edge-compute/rate-limiting) — enforce per-key request budgets with a platform-managed counter


