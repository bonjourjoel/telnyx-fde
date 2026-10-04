// Public Telnyx documentation catalogue, verified against official pages on
// 2026-10-04. Answers are authored for voice; tools never browse during a call.
// This module contains no caller records, credentials, or runtime bindings.

import {
  countWords, MIN_FAQ_LONG_ANSWER_WORDS, MAX_FAQ_LONG_ANSWER_WORDS,
  type FaqTopic,
} from "./contracts";

// Discovery exposes coverage, not a detailed answer or an arbitrary search API.
export type FaqTopicSummary = Pick<FaqTopic, "id" | "title" | "coverage">;

// Each entry describes exactly the linked page's scope. Keep answers between
// 80 and 120 words and avoid promising account-specific outcomes or actions.
const TOPICS: readonly FaqTopic[] = [
  // Startup personalization, resolution precedence, and webhook defaults.
  {
    id: "dynamic-variables", title: "Dynamic Variables",
    coverage: "Personalizing assistant instructions, greetings, and tools with variables; startup webhooks, defaults, and resolution timeouts.",
    documentation_url: "https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables",
    long_answer: "Dynamic variables personalize one assistant configuration for different conversations. Place variable names inside double curly braces in instructions, greetings, or tool configuration. Values can come from an outbound request, custom SIP headers, the startup webhook, or configured defaults, in that order of precedence. The webhook response places custom values inside a dynamic_variables object. Telnyx provides native context such as the conversation channel and participant targets. If the webhook misses its configured timeout, the conversation continues using available alternatives. Define meaningful defaults and inspect the conversation's webhook logs when a placeholder remains unresolved. Keep credentials out of ordinary prompt variables.",
  },
  // Focused nodes, deterministic messages, tool execution, and routing.
  {
    id: "conversation-workflows", title: "Conversation Workflows",
    coverage: "Prompt, Speak, and Tool nodes; conditional transitions, instruction modes, and per-node tool availability.",
    documentation_url: "https://developers.telnyx.com/docs/inference/ai-assistants/workflows",
    long_answer: "Conversation Workflows organize an assistant into explicit stages connected by conditions. Prompt nodes use the language model for conversation. Speak nodes deliver configured wording without a model turn, while Tool nodes execute a shared tool directly. Speak nodes advance through one default edge. Conditions can use model judgment or compare variables for deterministic routing. Prompt instructions can append to the assistant's base instructions or replace them; choose this deliberately. Restrict tools at each stage so the model has suitable choices. Tool results can drive success and fallback branches. Test realistic conversations and inspect which node and transition actually ran.",
  },
  // Reusable native tools and correct references on assistant updates.
  {
    id: "tools-library", title: "Tools Library",
    coverage: "Creating reusable assistant tools, assigning shared tool ids, and avoiding duplicates between shared and inline definitions.",
    documentation_url: "https://developers.telnyx.com/docs/inference/ai-assistants/tools-library",
    long_answer: "The Tools Library lets you define a tool once and attach it to several assistants. This centralizes configuration and avoids recreating identical webhook, transfer, or hangup tools for every assistant. You can create and assign library tools in the Portal. API configuration separates inline tool definitions from references to library tools. Updating either collection replaces the collection you supply, so omit it when you intend to leave it unchanged. Retrieved assistant definitions can include shared tools in their merged tool list. Manage those through their library identifiers instead of copying them back as new inline definitions, which can create rejected duplicates.",
  },
  // Backend-controlled parameters carried with model-selected arguments.
  {
    id: "preset-webhook-parameters", title: "Preset Webhook Parameters",
    coverage: "Preset body fields and query parameters, variable substitution, conflict precedence, and forwarding backend-controlled context.",
    documentation_url: "https://developers.telnyx.com/docs/inference/ai-assistants/preset-webhook-parameters",
    long_answer: "Preset webhook parameters carry values the model should not choose, such as an account identifier or channel. Configure preset_body_fields for request bodies or preset_query_params for the query string. These fields are excluded from the model's tool schema and attached when the tool runs. Their values can reference dynamic variables, and a preset wins if it conflicts with a model argument. Query parameters are encoded automatically, which preserves characters such as a phone number's plus sign. GET tools have no request body, so body presets are omitted there. Use supported integration secrets for credentials and prefer headers when the destination accepts them.",
  },
  // Read-heavy configuration/cache values, through bindings or REST.
  {
    id: "kv", title: "KV",
    coverage: "Key-value storage for configuration, feature flags, caches, and session values; TypeScript bindings and REST access.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/kv",
    long_answer: "Telnyx KV stores values under string keys for quick reads from edge functions. It suits small, frequently read values such as configuration, feature flags, cached responses, and session information. Values are stored as bytes; your application chooses text, JSON, or another serialization. Inside a TypeScript function, the runtime binding provides authenticated access through methods such as get and put. Tooling and other languages can use the REST API with account authentication. Both access paths address the same namespaces and keys. Create a namespace and declare its binding before using it. Choose the stored format explicitly and validate configuration after reading it.",
  },
  // Serialization across awaits and durable ownership of one entity.
  {
    id: "actor-execution", title: "Execution Model",
    coverage: "Stateful Actor ownership per name, serialized method calls, durable replies, and why memory alone does not persist state.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/execution-model",
    long_answer: "A Stateful Actor provides one owner for each instance name. Calls to the same instance execute one at a time, and awaiting inside a method does not allow the next method to begin before the current one finishes. This protects a read, modify, and write operation such as assigning a ticket reference or updating a balance. The runtime waits for writes to become durable before returning a successful result. An instance can restart or be evicted between calls, so ordinary class fields are only a cache. Store important state in actor storage and read current persisted values when performing an operation.",
  },
  // Persistent storage API and atomic turn semantics; no unsupported alarms.
  {
    id: "actor-storage", title: "Actor Storage",
    coverage: "Persistent per-Actor get, put, delete, list, transactions, supported stored values, and atomic writes at the end of a turn.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/stateful-actors/api-reference/storage",
    long_answer: "Actor storage is accessed through this.ctx.storage and belongs to one Actor instance. Its key-value methods include get, put, delete, and list, with transactions available for grouped operations. Reads happen when requested and reflect earlier writes made by the Actor. A successful turn commits its writes atomically; an uncaught failure commits none. Supported values pass through a storage codec, while unsupported values such as functions or circular structures are rejected. Listing keys returns a Map in key order and supports filters and limits. Avoid keys reserved for the runtime. Persist business records here instead of relying only on instance memory.",
  },
  // Manifest declarations and generated types for authenticated resources.
  {
    id: "bindings", title: "Bindings",
    coverage: "Declaring platform bindings in manifests, generating Env types, and accessing KV, Actors, secrets, and other resources.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/runtime/bindings",
    long_answer: "Bindings connect names in a function's manifest to platform resources. The runtime supplies authenticated handles on the TypeScript env object, so application code does not need to embed credentials for those resources. Declare the appropriate binding, generate its types with telnyx-edge types, then use the resulting handle in your handler. KV bindings expose storage methods, and Actor namespaces address instances by name. An umbrella telnyx.toml project supports Actor declarations alongside other resources. Regenerate types after changing bindings. A binding represents a resource; a secret represents a sensitive value you provide. Other supported languages access available resources through their documented alternatives.",
  },
  // Organization scope and redeployment needed for injected secret changes.
  {
    id: "secrets", title: "Secrets",
    coverage: "Managing backend secrets, organization scope, environment-variable and typed access, and redeploying after updates.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/configuration/secrets",
    long_answer: "Edge Compute secrets hold sensitive values such as API keys or signing material. They are organization-scoped and managed with the CLI. Adding an existing secret name updates its value; listing secrets shows names without revealing stored values. Functions receive secrets as environment variables when deployed. TypeScript can also use declared secret bindings with typed handles. After adding or changing a secret, redeploy each function that needs the updated value. Keep naming consistent and use distinct names when separating development and production settings. Read secrets only where needed, check that required values exist, and never include them in source code or logs.",
  },
  // General Function deployment, not a replacement for the Actor scaffold.
  {
    id: "edge-quickstart", title: "Quickstart",
    coverage: "Installing and authenticating the Edge CLI, scaffolding a Function, deploying with ship, and using the returned public URL.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/quickstart",
    long_answer: "The Edge Compute quickstart walks through installing the CLI, authenticating, creating a function, and deploying it. Scaffolding registers the function and writes its identity into the project manifest. Choose the supported language and keep its entrypoint conventions. The ship command uploads the project, builds it, deploys it, and monitors the rollout. Use the live URL actually printed by the CLI to verify the function responds. For later changes, edit the existing project and ship again rather than creating another function. Successful deployments produce revisions. Resource bindings and persistent storage are configured separately from the basic HTTP handler shown in the quickstart.",
  },
  // Runtime diagnostics and independent platform invocation records.
  {
    id: "logs", title: "Logs",
    coverage: "Runtime versus HTTP invocation logs, CLI time windows and JSON output, and live log streaming.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/observability/logs",
    long_answer: "Edge Compute offers runtime logs from your function and invocation logs generated by the platform. Runtime output includes console messages and exceptions. Invocation records describe served HTTP requests, including status and duration, even when application code emits no log. Select the log type when investigating a problem, and use time windows or recent-record limits to narrow the results. JSON output is useful for structured inspection. Supported CLI versions also provide a tail mode that streams new records while attached. Correlate application operations with request identifiers and platform records. Log outcomes and timings rather than phone numbers, credentials, complete payloads, or free-form support text.",
  },
  // Aggregated latency/error signals, without claiming automatic alerting.
  {
    id: "metrics", title: "Metrics",
    coverage: "Function request counts, HTTP status rates, latency percentiles, CPU and memory, and CLI aggregate metrics.",
    documentation_url: "https://developers.telnyx.com/docs/edge-compute/observability/metrics",
    long_answer: "Function metrics summarize recent traffic and resource usage. The CLI reports request counts, HTTP success and error rates, average latency, and latency percentiles such as p50, p95, and p99. It also includes CPU and memory information. Choose a time window that matches the incident or demonstration, use the error view to focus on HTTP failures, and request JSON for structured analysis. A high percentile shows how slow the more delayed requests are, while error rates show unsuccessful responses. Compare these aggregates with invocation records and application logs to locate the affected operation. Collecting metrics alone does not establish an automatic alert.",
  },
];

// Fail clearly on authoring mistakes, without contacting a dependency at startup.
function validateCatalogue(): void {
  if (TOPICS.length < 10 || TOPICS.length > 15) throw new Error("FAQ catalogue must contain 10 to 15 topics");
  const ids = new Set<string>();
  for (const topic of TOPICS) {
    const words = countWords(topic.long_answer);
    const url = new URL(topic.documentation_url);
    if (ids.has(topic.id) || !/^[a-z][a-z0-9-]{0,63}$/.test(topic.id) ||
      !topic.title.trim() || !topic.coverage.trim() ||
      url.protocol !== "https:" || url.hostname !== "developers.telnyx.com" ||
      words < MIN_FAQ_LONG_ANSWER_WORDS || words > MAX_FAQ_LONG_ANSWER_WORDS) {
      throw new Error(`Invalid authored FAQ topic: ${topic.id}`);
    }
    ids.add(topic.id);
  }
}

// Return detached discovery objects without detailed answer or URL fields.
export function listFaqTopics(): FaqTopicSummary[] {
  return TOPICS.map(({ id, title, coverage }) => ({ id, title, coverage }));
}

// Exact identifier lookup only. Return a copy so callers cannot alter catalogue
// data for later requests; an unknown id is handled as an MCP tool error.
export function findFaqTopic(topicId: string): Readonly<FaqTopic> | undefined {
  const topic = TOPICS.find((entry) => entry.id === topicId);
  return topic ? { ...topic } : undefined;
}

validateCatalogue();
