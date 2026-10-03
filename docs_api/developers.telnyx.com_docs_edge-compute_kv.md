*** https://developers.telnyx.com/docs/edge-compute/kv:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# KV

> Telnyx KV is globally distributed key-value storage for low-latency reads from edge functions. Use it through the function binding or the REST API.

KV is a globally distributed key-value store: you write bytes under a string key and read them back, fast, from anywhere. It is built for read-heavy edge workloads — session data, cached responses, feature flags, and other small values a function needs on every request.

A value is **opaque bytes**. You choose the serialization (text, JSON, binary); KV stores exactly what you send and returns it byte-for-byte. There is no envelope, no base64 encoding, and no server-side interpretation of the value.

## Two Ways to Use KV

The same namespaces and keys are reachable two ways. Pick based on where your code runs.

| | `env` binding | REST API |
| - | - | - |
| **Where** | Inside a TypeScript edge function | Anywhere — any language, any host |
| **Auth** | Injected by the runtime; no API key in your code | Your `TELNYX_API_KEY` as a bearer token |
| **Shape** | `env.<name>.get(...)`, `.put(...)`, `.delete(...)` | `GET`/`PUT`/`DELETE https://api.telnyx.com/v2/storage/kvs/{id}/keys/{key}` |
| **Use it for** | Reads and writes on the request path from your function | Provisioning namespaces, non-TS runtimes, tooling, back-office scripts |

Both hit the same store, so a value written through the binding is immediately readable over REST and vice versa. The binding is a thin, pre-authenticated wrapper over the same REST endpoints — it just means your function never handles an API key. The complete endpoint reference — namespaces and keys, with request/response schemas and code samples — is generated from the OpenAPI spec and lives in the **REST API** group of this KV section in the sidebar.

<Note>
  The `env` KV binding is **TypeScript-only** and requires `@telnyx/edge-runtime` ≥ 0.2.2. Go, JS, Python, and Quarkus functions use the [REST API](/docs/edge-compute/kv/quick-start#path-b-the-rest-api) directly.
</Note>

## Next Steps

* [Quick Start](/docs/edge-compute/kv/quick-start) — Create a namespace, bind it, read and write
* [How KV Works](/docs/edge-compute/kv/concepts/how-kv-works) — Keys, TTL, and the consistency model
* [Examples](/docs/edge-compute/kv/examples/session-storage) — Session storage, caching, and feature flags
* [Runtime API](/docs/edge-compute/kv/reference) — the `env` binding surface (`KvNamespace`)
* [CLI Commands](/docs/edge-compute/kv/cli) — Manage KV from the command line
* [Pricing](/docs/edge-compute/kv/pricing) — Free tier and paid plans

## Related Resources

* [Bindings](/docs/edge-compute/runtime/bindings) — How the `env` binding surface works
* [Secrets](/docs/edge-compute/configuration/secrets) — Secure credential storage


