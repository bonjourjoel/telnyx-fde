*** https://developers.telnyx.com/docs/edge-compute/stateful-actors:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Stateful Actors

> A stateful actor is a single-threaded server owning one entity's state: one instance per name, calls routed to it, methods run one at a time, writes persisted.

A **stateful actor** is a single-threaded server that owns the state of one entity — one
user, one cart, one call leg, one chat room. You write it as a TypeScript class; the
platform runs **one instance per name**, routes every call for that name to that
instance, runs your methods **one at a time**, and **persists** what you write. You never
bind a socket, take a lock, or shard it.

```ts theme={null}
import { StatefulActor } from "@telnyx/edge-runtime";

export class Account extends StatefulActor {
  async debit(amount: number): Promise<{ ok: boolean; balance: number }> {
    const balance = (await this.ctx.storage.get<number>("balance")) ?? 0;
    if (balance < amount) return { ok: false, balance };   // check-then-act, no lock
    await this.ctx.storage.put("balance", balance - amount);
    return { ok: true, balance: balance - amount };
  }
}
```

That `debit` is a read-modify-write with no lock and no transaction. In a normal request
handler that's a race; here it isn't — and that property is the whole product.
[How it works](/docs/edge-compute/stateful-actors/concepts/how-it-works) derives it from
first principles, starting from a plain C server.

Two words used precisely throughout these docs: the **actor** is the class you ship
(`Account`); an **instance** is its per-name materialization (`idFromName("acct_123")`
reaches the `acct_123` instance of `Account`).

## What the Runtime Guarantees

* **One instance per name** — `idFromName("acct_123")` routes every call to a single owner; no two hosts run it at once.
* **One call at a time** — single-threaded dispatch. No locks, no races inside an instance.
* **Durable before reply** — a method's result isn't returned until the writes it made are persisted.
* **Memory is a cache** — only what you write to `storage` survives eviction or restart.

[Execution model](/docs/edge-compute/stateful-actors/concepts/execution-model) states
each precisely; [How it works](/docs/edge-compute/stateful-actors/concepts/how-it-works)
derives them from a plain C server.

<CardGroup cols={2}>
  <Card title="Quick start" href="/docs/edge-compute/stateful-actors/quick-start">
    Scaffold, deploy, and curl an actor.
  </Card>

  <Card title="How it works" href="/docs/edge-compute/stateful-actors/concepts/how-it-works">
    The C-vs-actor derivation from first principles.
  </Card>

  <Card title="Execution model" href="/docs/edge-compute/stateful-actors/concepts/execution-model">
    The four guarantees, stated precisely.
  </Card>

  <Card title="Lifecycle & placement" href="/docs/edge-compute/stateful-actors/concepts/lifecycle">
    Where instances run; what survives a restart.
  </Card>

  <Card title="Addressing" href="/docs/edge-compute/stateful-actors/concepts/addressing">
    Naming and routing instances.
  </Card>

  <Card title="Project structure" href="/docs/edge-compute/stateful-actors/guides/project-structure">
    The two-export shape.
  </Card>

  <Card title="Shared actors" href="/docs/edge-compute/stateful-actors/shared-actors">
    Reach one actor from many functions.
  </Card>

  <Card title="When to use" href="/docs/edge-compute/stateful-actors/guides/when-to-use">
    And when to reach for something else.
  </Card>

  <Card title="Runtime API" href="/docs/edge-compute/stateful-actors/api-reference">
    The full surface.
  </Card>

  <Card title="Alarms" href="/docs/edge-compute/stateful-actors/alarms">
    Scheduled work from inside an actor.
  </Card>

  <Card title="WebSockets" href="/docs/edge-compute/stateful-actors/websockets">
    Terminate a live socket on the actor — each frame is a serialized turn.
  </Card>

  <Card title="Observability" href="/docs/edge-compute/stateful-actors/observability">
    Recent logs and request/resource metrics for a type.
  </Card>
</CardGroup>

## Related Resources

* [Bindings](/docs/edge-compute/runtime/bindings) — how bindings resolve on `env`
* [KV](/docs/edge-compute/kv) — globally distributed key-value storage
* [Execution Model](/docs/edge-compute/runtime/execution-model) — function lifecycle and concurrency


