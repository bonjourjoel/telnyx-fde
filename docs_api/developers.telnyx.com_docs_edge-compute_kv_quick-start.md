*** https://developers.telnyx.com/docs/edge-compute/kv/quick-start:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Quick Start

> Create a KV namespace, bind it to your edge function, and read or write data — through the function binding or the REST API.

Get up and running with KV: create a namespace, then use it from a TypeScript function through an `env` binding, or from anywhere through the REST API.

## 1. Create a Namespace

A namespace is an isolated key space. Create one with the CLI or the API.

<Tabs>
  <Tab title="CLI">
    ```bash theme={null}
    telnyx-edge storage kv create --name my-cache
    ```
  </Tab>

  <Tab title="API">
    ```bash theme={null}
    curl -X POST https://api.telnyx.com/v2/storage/kvs \
      -H "Authorization: Bearer $TELNYX_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"name": "my-cache"}'
    ```
  </Tab>
</Tabs>

The response includes the namespace `id` (a UUID) — you'll need it in the next step.

<Note>
  A new namespace starts in `status: "pending"` and isn't writable yet: writes return `409` (`"Namespace is not ready (status: pending)"`) until provisioning finishes, which typically takes a few seconds and can stretch to \~20. If you're scripting, poll `GET https://api.telnyx.com/v2/storage/kvs/{id}` until `"status": "provision_ok"` before your first write. (With the binding path below you rarely notice — editing `func.toml` and deploying already takes longer than provisioning.)
</Note>

## Path A: The Function Binding

Recommended for TypeScript edge functions. The runtime injects the credential, so your code holds **no API key**.

### 2. Bind the Namespace

Declare the namespace in `func.toml`. The block key is a name **you choose** — it's not a reserved word — and it becomes the property on `env`. This example uses `MY_KV`, so the binding is reached as `env.MY_KV`:

```toml theme={null}
[edge_compute]
func_name = "my-function"

[storage.kv.MY_KV]
id = "550e8400-e29b-41d4-a716-446655440000"  # Namespace ID from step 1
```

Add `@telnyx/edge-runtime` (≥ 0.2.2) to your `package.json` dependencies, then regenerate the environment types:

```bash theme={null}
telnyx-edge types   # writes telnyx-env.d.ts — env.MY_KV is now a typed KvNamespace
```

Each `[storage.kv.<NAME>]` block becomes `env.<NAME>: KvNamespace` in the generated `telnyx-env.d.ts` — declare as many namespaces as you need. KV type generation requires CLI **≥ v0.2.3** (earlier releases report the block as an unrecognized key and write an empty `Env`). The binding itself **resolves at runtime** from `func.toml` — types are for the compiler, and a stale `telnyx-env.d.ts` doesn't affect the deployed function.

### 3. Use `env.MY_KV` in Your Code

```ts theme={null}
import { env } from "@telnyx/edge-runtime";

// Write — value is stored verbatim (UTF-8 preserved)
await env.MY_KV.put("user/123", JSON.stringify({ name: "Alice 👋" }));

// Read as text -> '{"name":"Alice 👋"}'  (null if the key is missing)
const raw = await env.MY_KV.get("user/123");

// Read and JSON.parse in one step -> { name: "Alice 👋" }  (null if missing)
const user = await env.MY_KV.get<{ name: string }>("user/123", { type: "json" });

// Write with a server-side TTL — the key deletes itself after ~60 seconds
await env.MY_KV.put("otp/123", "482913", { expirationTtl: 60 });

// Delete (idempotent — deleting a missing key is not an error)
await env.MY_KV.delete("user/123");
```

The binding surface:

| Method | Returns | Notes |
| - | - | - |
| `get(key)` | `Promise<string \| null>` | Raw stored text; `null` if the key doesn't exist |
| `get<T>(key, { type: "json" })` | `Promise<T \| null>` | `JSON.parse`s the value; `null` if missing |
| `put(key, value, options?)` | `Promise<void>` | `value` is a string, stored verbatim; `options.expirationTtl` expires the key server-side after that many seconds |
| `delete(key)` | `Promise<void>` | Idempotent |
| `list(options?)` | `Promise<{ keys, list_complete, cursor? }>` | Returns key names and per-key `sizeBytes`/`updatedAt`, not values |

<Note>
  `list()` returns key metadata, not values — `{ keys: [{ name, sizeBytes, updatedAt }], list_complete, cursor? }`. Paginate by passing the returned `cursor` back in `list({ cursor })`. On 0.2.1 entries carry only `name`; 0.2.0 throws a response-shape error.
</Note>

<Note>
  `put`'s `expirationTtl` option requires ≥ 0.2.2 — earlier versions accept it but silently ignore it. The `metadata` option is deprecated and ignored on every version. See [Key Expiration](/docs/edge-compute/kv/ttl-and-metadata).
</Note>

## Path B: The REST API

Use this anywhere outside a TypeScript edge function — a non-TypeScript function (Go, JS, Python, Quarkus), your own backend, or tooling. Authenticate with your `TELNYX_API_KEY` (the SDKs read it from the environment). Whether you use an SDK or plain HTTP, the value **is** the raw request/response body — no base64, no envelope.

<Note>
  KV support landed in the official server SDKs in **telnyx-node ≥ 7.5.0**, **telnyx-python ≥ 4.166.0**, **telnyx-php ≥ 7.88.0** (see the PHP tab for the required version pin), **telnyx-ruby ≥ 5.152.0**, and **telnyx-go ≥ v4.85.0** — on earlier versions the `storage` resource is object storage (buckets) only. The Java SDK doesn't cover KV yet; call the endpoints over plain HTTP as in the curl tab.
</Note>

<Tabs>
  <Tab title="JavaScript">
    ```javascript theme={null}
    import Telnyx from "telnyx";

    const client = new Telnyx(); // reads TELNYX_API_KEY from the environment
    const kv = client.storage.kvs.keys;
    const id = process.env.KV_NAMESPACE_ID;

    // Write — the body is stored verbatim (UTF-8 preserved, no base64, no envelope)
    await kv.update("user/123", { id, body: JSON.stringify({ name: "Alice 👋" }) });

    // Read — the response body is the raw stored value; a missing key throws NotFoundError
    async function kvGet(key) {
        try {
            const res = await kv.retrieve(key, { id });
            return await res.text();
        } catch (err) {
            if (err instanceof Telnyx.NotFoundError) return null; // Key not found
            throw err;
        }
    }
    const raw = await kvGet("user/123"); // '{"name":"Alice 👋"}'  (null if missing)

    // Write with a server-side TTL — the key deletes itself after ~60 seconds
    await kv.update("otp/123", { id, body: "482913", ttl_secs: 60 });

    // Delete (idempotent — deleting a missing key is not an error)
    await kv.delete("user/123", { id });

    // List by prefix — returns key names and metadata (size_bytes, updated_at), never values
    const page = await kv.list(id, { prefix: "user/", limit: 100 });
    // page.data -> [{ key, size_bytes, updated_at }]
    // When page.meta.has_more is true, pass page.meta.cursor back as { cursor } for the next page
    ```
  </Tab>

  <Tab title="Python">
    ```python theme={null}
    import os

    from telnyx import Telnyx, NotFoundError

    client = Telnyx()  # reads TELNYX_API_KEY from the environment
    KV_NAMESPACE_ID = os.environ["KV_NAMESPACE_ID"]

    # Write — pass bytes; they are stored verbatim (UTF-8 preserved, no base64, no envelope)
    # (a plain str would be JSON-serialized by the SDK — quoted and escaped — before storage)
    client.storage.kvs.keys.update("user/123", id=KV_NAMESPACE_ID, body='{"name": "Alice 👋"}'.encode())

    # Read — the response body is the raw stored value
    def kv_get(key: str) -> str | None:
        try:
            return client.storage.kvs.keys.retrieve(key, id=KV_NAMESPACE_ID).text()
        except NotFoundError:
            return None  # Key not found

    kv_get("user/123")       # '{"name": "Alice 👋"}'
    kv_get("missing/nope")   # None

    # Write with a server-side TTL — the key deletes itself after ~60 seconds
    client.storage.kvs.keys.update("otp/123", id=KV_NAMESPACE_ID, body=b"482913", ttl_secs=60)

    # Delete (idempotent — deleting a missing key is not an error)
    client.storage.kvs.keys.delete("user/123", id=KV_NAMESPACE_ID)

    # List by prefix — returns key names and metadata (size_bytes, updated_at), never values
    page = client.storage.kvs.keys.list(KV_NAMESPACE_ID, prefix="user/", limit=100)
    for entry in page.data:
        print(entry.key, entry.size_bytes, entry.updated_at)
    # When page.meta.has_more is true, pass page.meta.cursor back as cursor= for the next page
    ```
  </Tab>

  <Tab title="PHP">
    ```php theme={null}
    <?php

    require __DIR__ . '/vendor/autoload.php';

    use Telnyx\Client;
    use Telnyx\Core\Exceptions\NotFoundException;

    $client = new Client(); // reads TELNYX_API_KEY from the environment
    $id = getenv('KV_NAMESPACE_ID');
    $kv = $client->storage->kvs->keys;

    // Write — the value is stored verbatim (UTF-8 preserved, no base64, no envelope).
    // v7.88.0's $kv->update() throws a TypeError on every body type, so write through
    // $client->request(); pass the key as-is — the SDK URL-encodes the "/" for you.
    $kvPut = function (string $key, string $value, ?int $ttlSecs = null) use ($client, $id): void {
        $client->request(
            method: 'put',
            path: ['storage/kvs/%1$s/keys/%2$s', $id, $key],
            query: $ttlSecs === null ? [] : ['ttl_secs' => $ttlSecs],
            headers: ['Content-Type' => 'application/octet-stream'],
            body: $value,
        );
    };

    $kvPut('user/123', '{"name":"Alice 👋"}');

    // Read — retrieve() returns the raw stored value as a string; a missing key throws NotFoundException
    $kvGet = function (string $key) use ($kv, $id): ?string {
        try {
            return $kv->retrieve($key, $id);
        } catch (NotFoundException) {
            return null; // Key not found
        }
    };

    $raw = $kvGet('user/123'); // '{"name":"Alice 👋"}'  (null if missing)

    // Write with a server-side TTL — the key deletes itself after ~60 seconds
    $kvPut('otp/123', '482913', ttlSecs: 60);

    // Delete (idempotent — deleting a missing key is not an error)
    $kv->delete('user/123', $id);

    // List by prefix — returns key names and metadata (size_bytes, updated_at), never values
    $page = $kv->list($id, prefix: 'user/', limit: 100);
    foreach ($page->data as $entry) {
        echo "{$entry->key}  {$entry->sizeBytes} bytes  {$entry->updatedAt->format(DATE_RFC3339)}\n";
    }
    // When $page->meta->hasMore is true, pass $page->meta->cursor back as cursor: for the next page
    ```

    Install with `composer require "telnyx/telnyx-php:^7.88" guzzlehttp/guzzle`. The pin matters: the semver-highest tag v8.0.0 predates KV, so an unpinned `composer require telnyx/telnyx-php` installs a version with no `storage->kvs` at all. Guzzle (or any PSR-18 client) is required because the SDK doesn't bundle one — without it `new Client()` throws a discovery exception.
  </Tab>

  <Tab title="Go">
    ```go theme={null}
    package kv

    import (
        "context"
        "errors"
        "io"
        "os"
        "strings"

        "github.com/team-telnyx/telnyx-go/v4"
        "github.com/team-telnyx/telnyx-go/v4/option"
    )

    var (
        namespaceID = os.Getenv("KV_NAMESPACE_ID")
        client      = telnyx.NewClient() // reads TELNYX_API_KEY from the environment
    )

    // Write — pass the value with option.WithRequestBody so it is stored verbatim
    // (don't use the params Body field: it multipart-encodes the value)
    func kvPut(ctx context.Context, key, value string) error {
        return client.Storage.Kvs.Keys.Update(ctx, key,
            telnyx.StorageKvKeyUpdateParams{ID: namespaceID},
            option.WithRequestBody("application/octet-stream", strings.NewReader(value)))
    }

    func kvGet(ctx context.Context, key string) (string, error) {
        resp, err := client.Storage.Kvs.Keys.Get(ctx, key,
            telnyx.StorageKvKeyGetParams{ID: namespaceID})
        var apierr *telnyx.Error
        if errors.As(err, &apierr) && apierr.StatusCode == 404 {
            return "", nil // Key not found
        }
        if err != nil {
            return "", err
        }
        defer resp.Body.Close()
        value, err := io.ReadAll(resp.Body)
        return string(value), err // Raw stored bytes
    }

    // TtlSecs expires the key server-side after that many seconds
    func kvPutTTL(ctx context.Context, key, value string, ttlSecs int64) error {
        return client.Storage.Kvs.Keys.Update(ctx, key,
            telnyx.StorageKvKeyUpdateParams{ID: namespaceID, TtlSecs: telnyx.Int(ttlSecs)},
            option.WithRequestBody("application/octet-stream", strings.NewReader(value)))
    }

    // Idempotent — deleting a missing key is not an error
    func kvDelete(ctx context.Context, key string) error {
        return client.Storage.Kvs.Keys.Delete(ctx, key,
            telnyx.StorageKvKeyDeleteParams{ID: namespaceID})
    }

    // Returns key names + metadata (size_bytes, updated_at), never values.
    // When Meta.HasMore is true, pass Meta.Cursor back to fetch the next page.
    func kvList(ctx context.Context, prefix, cursor string) (*telnyx.StorageKvKeyListResponse, error) {
        params := telnyx.StorageKvKeyListParams{Prefix: telnyx.String(prefix), Limit: telnyx.Int(100)}
        if cursor != "" {
            params.Cursor = telnyx.String(cursor)
        }
        return client.Storage.Kvs.Keys.List(ctx, namespaceID, params)
    }
    ```
  </Tab>

  <Tab title="Ruby">
    ```ruby theme={null}
    require "telnyx"

    client = Telnyx::Client.new # reads ENV["TELNYX_API_KEY"]
    kv_id = ENV.fetch("KV_NAMESPACE_ID")
    kv = client.storage.kvs.keys

    # Write — the value is stored verbatim (UTF-8 preserved, no base64, no envelope)
    kv.update("user/123", id: kv_id, body: '{"name":"Alice 👋"}')

    # Read — returns the raw stored value; a missing key raises NotFoundError
    value =
      begin
        kv.retrieve("user/123", id: kv_id).read
      rescue Telnyx::Errors::NotFoundError
        nil # Key not found
      end

    # Write with a server-side TTL — the key deletes itself after ~60 seconds
    kv.update("otp/123", id: kv_id, body: "482913", ttl_secs: 60)

    # Delete (idempotent — deleting a missing key is not an error)
    kv.delete("user/123", id: kv_id)

    # List by prefix — returns key names and metadata (size_bytes, updated_at), never values
    page = kv.list(kv_id, prefix: "user/", limit: 100)
    page.data.each { |k| puts "#{k.key}  #{k.size_bytes} bytes  #{k.updated_at}" }
    # When page.meta.has_more is true, pass page.meta.cursor back as cursor: for the next page
    ```

    The gem requires Ruby ≥ 3.2. On Ruby ≥ 3.4, also `gem install base64` — telnyx 5.152.0 loads it but doesn't yet declare it as a dependency.
  </Tab>

  <Tab title="curl">
    ```bash theme={null}
    # Write — the request body is stored verbatim (no base64, no envelope)
    curl -X PUT "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID/keys/user/123" \
      -H "Authorization: Bearer $TELNYX_API_KEY" \
      --data-binary '{"name":"Alice 👋"}'

    # Read — the response body is the raw stored value (404 if the key doesn't exist)
    curl "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID/keys/user/123" \
      -H "Authorization: Bearer $TELNYX_API_KEY"

    # Write with a server-side TTL — the key deletes itself after ~60 seconds
    curl -X PUT "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID/keys/otp/123?ttl_secs=60" \
      -H "Authorization: Bearer $TELNYX_API_KEY" \
      --data-binary '482913'

    # Delete (idempotent — deleting a missing key is not an error)
    curl -X DELETE "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID/keys/user/123" \
      -H "Authorization: Bearer $TELNYX_API_KEY"

    # List keys by prefix — returns key names and metadata, never values
    curl "https://api.telnyx.com/v2/storage/kvs/$KV_NAMESPACE_ID/keys?prefix=user/&limit=100" \
      -H "Authorization: Bearer $TELNYX_API_KEY"
    ```
  </Tab>
</Tabs>

Server-side TTL (`ttl_secs`), its error cases, and an inspectable application-level alternative are covered in [Key Expiration](/docs/edge-compute/kv/ttl-and-metadata).

`list` returns key names and per-key metadata, never values:

```json theme={null}
{
  "record_type": "storage_kv_key",
  "data": [{ "key": "user/123", "size_bytes": 21, "updated_at": "2026-06-18T14:48:17.475129983Z" }],
  "meta": { "has_more": false }
}
```

When `meta.has_more` is `true`, pass the returned `meta.cursor` back as `?cursor=` (in the SDKs, the `cursor` parameter) to fetch the next page — key listing does not auto-paginate in any SDK.

<Note>
  Inside an edge function, the org binding injects `TELNYX_API_KEY` (and a base-URL proxy) at runtime, so REST calls from a function authenticate without you shipping a key.
</Note>

Next: [Best Practices](/docs/edge-compute/kv/best-practices) for key naming, serialization, and error handling.


