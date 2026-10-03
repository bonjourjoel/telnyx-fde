*** https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/how-it-works:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# How It Works

> Derive the stateful actor execution model from first principles, then map each mechanism — per-entity lock, flush-before-ack storage — to what you'd build in C.

Take a concrete problem: **keep a balance per account, reachable over HTTP, correct
when requests overlap, and intact across restarts.** A `debit` must never overdraw,
and a committed debit must never be lost. Below is what that actually requires, from
first principles, and how a stateful actor hands you the same thing.

## How You'd Build This, from First Principles

Strip it to the metal. One process serves **every** account — `a`, `b`, `c`, `x`, `y`,
… — holding them all in an in-memory map and handling a request for whichever one comes
in. Two things make each `debit` correct: a **per-account lock**, so two debits on the
same account can't interleave (while debits on *different* accounts still run in
parallel), and a **write-ahead log + `fsync`**, so a committed debit is on disk before
you reply.

```c theme={null}
struct account {
    int64_t         balance;
    pthread_mutex_t lock;     // serializes debits on THIS account; other accounts run in parallel
};
// one process, every account: a map of account_id -> struct account *
struct account *lookup_or_create(const char *acct_id);
```

Durability is append-to-log then `fsync` — you don't acknowledge the debit until the
bytes are on disk:

```c theme={null}
void persist_data(const char *acct_id, int64_t balance) {
    dprintf(wal_fd, "%s %lld\n", acct_id, (long long)balance);  // append one record to the log
    fsync(wal_fd);                                              // the durability boundary: on disk before we return
}
```

A request names an account; the process looks it up and serves it. Lock that account,
check-and-decrement, log, `fsync`, unlock:

```c theme={null}
// One process, any account. Error handling elided.
int debit(const char *acct_id, int64_t amount, int64_t *out) {
    struct account *a = lookup_or_create(acct_id);  // a, b, c, x, y ... all live in this process

    pthread_mutex_lock(&a->lock);              // serialize debits on THIS account
    if (a->balance < amount) {
        pthread_mutex_unlock(&a->lock);
        return -EAGAIN;                         // insufficient funds
    }
    a->balance -= amount;
    persist_data(acct_id, a->balance);          // append a record + fsync: durable before we return

    *out = a->balance;
    pthread_mutex_unlock(&a->lock);
    return 0;
}
```

Two primitives do all the work: the **lock** is the serialization point, and **`fsync`
before you reply** is durability. Everything else follows:

* one process owns it all — the map, the per-account locks, and the log are shared by
  every account `a`…`y`;
* **durability** is the log: a debit is committed once its record is `fsync`'d, so a
  crash loses only what was never acked;
* **recovery** is *not* replaying an ever-growing log from zero — that gets slower
  forever. You periodically write a **snapshot** of all balances and keep only the log
  records since it; on restart you load the snapshot and replay that short tail.
  (Postgres' checkpoint + WAL, SQLite's WAL mode, and Redis' RDB + AOF all do exactly
  this.) The on-disk snapshot + log is the truth; memory is a cache;
* to grow past one process you **shard** accounts across processes and machines,
  routing each account to the one that owns it — and *this* is where most people stop
  hand-rolling and reach for a **database**,
  which is exactly this machine (sharded, replicated, snapshot + write-ahead log) run by
  someone else. Postgres' `COMMIT` is what `persist_data` does, its checkpoint is your
  snapshot, and `SELECT … FOR UPDATE` is the lock.

You can build all of this. The work isn't any single line — it's that you own the lock
discipline on every path, the log format, the snapshots, the recovery, the sharding, and
the restarts, forever.

## The Same Thing as a Stateful Actor

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

The class is only the logic half. In the C version, `debit(acct_id, …)` did the lookup
itself (`lookup_or_create`) *and* the logic. With an actor that lookup moves to the
**caller**: a normal function parses the request, names the account with `idFromName`,
and calls the method — which now takes only `amount` and never has to find its own state.

```ts theme={null}
import { type ActorNamespace, type ActorStub } from "@telnyx/edge-runtime";
import { Account } from "./account";
export { Account };

type AccountStub = ActorStub & Pick<Account, "debit">;
interface AccountNamespace extends ActorNamespace {
  idFromName(name: string): AccountStub;
}
interface Env { ACCOUNT: AccountNamespace }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const acct = new URL(req.url).pathname.slice(1);     // /acct_123 — the account name
    const { amount } = (await req.json()) as { amount: number };
    const result = await env.ACCOUNT.idFromName(acct).debit(amount);  // route by name, then call
    return Response.json(result);
  },
};
```

`idFromName(acct)` is the actor-world `lookup_or_create` — instead of finding a struct in
this process's map, it routes to the one instance that owns that account, anywhere (the
"Reaching one account" row below).

Same check-and-decrement, same durability requirement — but no `pthread_mutex`, no
`fsync`, no log, no snapshots, no shard map. The two primitives are still there; the
runtime provides them. Here's the mapping, mechanism by mechanism:

| Mechanism (first principles) | Hand-rolled in C | Stateful actor |
| - | - | - |
| Serialization point | a `pthread_mutex` per account, held across the change | one thread per name — the lock you can't forget, because there is none |
| Durable before you reply | `persist_data` — append + `fsync` — then ack | method returns ⇒ writes flushed (flush-before-ack) |
| Truth vs cache | the snapshot + log on disk; the in-memory map is a cache | `ctx.storage`; instance fields are a cache, gone on restart |
| Reaching one account | a map lookup in-process; a shard map + router once you outgrow one process | `idFromName(name)` routes to the one owner |
| Parallelism across accounts | per-account locks in one multi-threaded process | a separate instance per name — each its own thread and `storage` |
| Restart recovery | load the snapshot, replay the log tail | runtime restarts the instance; `storage` is already durable |
| Scheduling | a `timerfd` + a timer wheel | `ctx.storage.setAlarm` + an `alarm()` handler |

The runtime takes the one process that multiplexed `a`, `b`, `c`, `x`, `y` and splits
it: each account id becomes its own instance. `idFromName("a")` and `idFromName("b")`
are two different instances, on two different threads, each with its own `storage` —
debits on `a` serialize, debits on `a` and `b` run in parallel, and there is no shared
map, per-account lock, or single log to own. A stateful actor *is* that machine — a
single-threaded server with durable, flush-before-ack storage, one per account — that
the platform shards, routes, and restarts for you. You write the body of `debit`; the
runtime is the lock, the durability, the recovery, and the router.

The four guarantees the runtime makes from this mapping are stated precisely in
[Execution model](/docs/edge-compute/stateful-actors/concepts/execution-model).

## Next Steps

* [Execution model](/docs/edge-compute/stateful-actors/concepts/execution-model) — the four guarantees, stated precisely
* [Lifecycle & placement](/docs/edge-compute/stateful-actors/concepts/lifecycle) — where an instance runs, and what survives a restart
* [Addressing](/docs/edge-compute/stateful-actors/concepts/addressing) — naming and routing instances
* [Project structure](/docs/edge-compute/stateful-actors/guides/project-structure) — the two-export shape


