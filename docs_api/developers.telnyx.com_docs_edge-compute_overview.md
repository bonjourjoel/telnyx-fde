*** https://developers.telnyx.com/docs/edge-compute/overview:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Functions

> Functions are the compute primitive of Telnyx Edge Compute: an HTTP server in a container, wired to KV, stateful actors, object storage, and the Telnyx API.

A **function** is the compute primitive of Telnyx Edge Compute: an ordinary HTTP server, packaged as a container, deployed to Telnyx's global edge network, and served at its own public URL. You write a server that listens on `PORT`; one command builds and ships it.

```ts index.ts theme={null}
import * as http from "node:http";

const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Hello from Telnyx Edge Compute!" }));
});

server.listen(process.env.PORT || 8080);
```

```bash theme={null}
telnyx-edge ship
# 📡 Your function is live at:
#    https://demo-0198c2c5-8.telnyxcompute.com
```

On its own, a function just echoes HTTP. What makes it useful is the platform it plugs into — key-value storage, durable per-entity state, object storage, the Telnyx API, and private networking — each declared as a binding and reachable from your handler. This page maps that platform; the rest of these docs go deep on each piece.

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/docs/edge-compute/quickstart">
    Install the CLI, scaffold a function, ship it, and curl the live URL — about five minutes.
  </Card>
</CardGroup>

HTTP is the only trigger today — there are no cron triggers. For scheduled work, call the function's URL from an external scheduler, such as a GitHub Actions cron job.

## The platform around your functions

Declare a binding in `func.toml` and it surfaces on `env` at runtime in TypeScript, or as REST and injected environment variables in every other language. See [Bindings](/docs/edge-compute/runtime/bindings) for the mechanics — these are the products worth reaching for.

**State and storage**

<CardGroup cols={2}>
  <Card title="KV" icon="key" href="/docs/edge-compute/kv">
    Globally distributed key-value storage with server-side TTL — an `env` binding in TypeScript, REST everywhere else. For caches, sessions, and feature flags.
  </Card>

  <Card title="Stateful Actors" icon="cube" href="/docs/edge-compute/stateful-actors">
    Beta — durable per-entity state and coordination: one instance per name, one call at a time. For counters, per-user state, and anything that needs a serialized owner.
  </Card>

  <Card title="Object storage" icon="box" href="/docs/cloud-storage/quick-start">
    S3-compatible buckets for files and media — a separate product, reached over its S3 API from any language.
  </Card>
</CardGroup>

**Connect to Telnyx**

<CardGroup cols={2}>
  <Card title="Telnyx API" icon="phone" href="/docs/edge-compute/telnyx-api">
    A pre-authenticated client for Voice, Messaging, and AI — or plain REST with the injected key. Answer calls, send messages, and run inference without managing credentials.
  </Card>
</CardGroup>

## Languages

`telnyx-edge new-func -l <language>` scaffolds a project in TypeScript (`ts`), JavaScript (`js`), Go (`go`), Python (`python`), or Java (`quarkus`). Each language uses its own standard server contract — `node:http`, Go's `http.Handler`, ASGI, Quarkus Funqy — documented in [HTTP handler](/docs/edge-compute/runtime/http-handler).

The binding SDK (`@telnyx/edge-runtime`) — a typed `env` exposing a pre-authenticated Telnyx client, secrets, and KV namespaces — is TypeScript-only today. The other runtimes use the same features over REST and injected environment variables.

## Where your code runs

Functions run on the infrastructure that carries Telnyx voice and messaging traffic: edge sites inside carrier facilities, close to end users rather than in generic cloud availability zones. Each region is backed by multiple independent sites across different providers, with automatic failover if a site goes down.

## Resources

<CardGroup cols={2}>
  <Card title="HTTP handler" icon="code-branch" href="/docs/edge-compute/runtime/http-handler">
    The entrypoint contract for each language.
  </Card>

  <Card title="Configuration" icon="sliders" href="/docs/edge-compute/configuration">
    Environment variables, secrets, routing, and versions.
  </Card>

  <Card title="CLI reference" icon="terminal" href="/docs/edge-compute/reference/cli">
    Every `telnyx-edge` command and flag.
  </Card>

  <Card title="Limits" icon="gauge" href="/docs/edge-compute/platform/limits">
    Request timeouts, payload sizes, and quotas.
  </Card>

  <Card title="Pricing" icon="credit-card" href="/docs/edge-compute/platform/pricing">
    Free tier plus usage-based rates for requests and CPU time.
  </Card>

  <Card title="Community" icon="slack" href="https://joinslack.telnyx.com/">
    Ask questions and share what you build.
  </Card>
</CardGroup>


