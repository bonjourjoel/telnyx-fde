*** https://developers.telnyx.com/docs/edge-compute/telnyx-api:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Telnyx API

> Call the Telnyx API from Edge Compute through a pre-authenticated binding — no API keys in your code.

The Telnyx API binding puts a ready-to-use, authenticated Telnyx client on `env`. You never handle an API key — the binding injects credentials at the edge and keeps them out of your code, bundle, and logs.

```ts theme={null}
import { env } from "@telnyx/edge-runtime";

await env.MY_TELNYX.messages.send({
  from: "+13125550100",
  to: "+13125550101",
  text: "Hello from Edge Compute",
});
```

* **Free-formed name** — `MY_TELNYX` is whatever you set as `binding` in `func.toml`. It becomes the property on `env`.
* **Typed** — `telnyx-edge types` types `env.MY_TELNYX` as the Telnyx client.
* **One per organization** — every function in the org shares it.

Start with the [Quick start](/docs/edge-compute/telnyx-api/quick-start).

The org-level credential behind the binding (`bindings create` / `validate` / `update`) is account-level and rarely touched — see the [CLI reference](/docs/edge-compute/reference/cli#bindings).


