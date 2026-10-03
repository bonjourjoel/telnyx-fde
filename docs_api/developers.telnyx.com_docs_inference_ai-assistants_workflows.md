*** https://developers.telnyx.com/docs/inference/ai-assistants/workflows:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Conversation Workflows

> Build multi-step Telnyx AI Assistant conversations as a graph of prompt, speak, and tool nodes with LLM, variable, and default edges for conditional routing.

Conversation workflows let you turn a single AI Assistant into a guided, multi-step experience. Instead of asking one prompt to handle every part of a call or chat, you can design a graph of conversation steps, define when the assistant should move between them, and tune the assistant's behavior at each step.

Use workflows when your assistant needs to guide people through a process, such as intake, qualification, booking, verification, escalation, or support triage.

## Why use workflows?

A single prompt works well for open-ended conversations. Workflows are better when the customer journey has structure.

With workflows, you can:

* **Break complex conversations into focused steps**: Give each stage its own name and instructions, such as `Intake`, `Billing`, `Schedule appointment`, or `Escalate to specialist`.
* **Route with natural language or deterministic rules**: Move between steps when the LLM decides a condition is met, or when a dynamic variable matches a configured value.
* **Tune behavior per step**: Append or replace the assistant's main instructions, and optionally override the model or voice for a specific node.
* **Route to another assistant**: Route from one workflow to another assistant when the conversation should be handled by a different specialist.
* **Debug what happened later**: Conversation transcripts can show the workflow node associated with assistant messages, so you can connect real conversations back to the workflow design.

## How workflows work

A workflow is a directed graph stored on the AI Assistant as `conversation_flow`.

The graph has two main building blocks:

* **Nodes**: Conversation steps. A node is a **prompt node** (an LLM-driven step with its own label, instructions, instruction mode, model override, and voice override), a **speak node** (a deterministic step that plays a fixed scripted message with no LLM turn), or a **tool node** (a deterministic step that runs a single shared tool with no LLM turn).
* **Edges**: Transitions between nodes, or from a node to another assistant. Each edge has a condition that decides when that path should be taken. Conditions can be natural-language (**LLM**), deterministic (**variable comparison**), or a **default** fallback.

When a conversation starts, Telnyx begins at the workflow's start node. How routing is decided depends on the edge's condition type. Variable-comparison edges are evaluated by Telnyx against your dynamic variables. LLM-condition edges are decided by the assistant's model. On calls, this happens in the same turn that produces the reply — the edge's prompt is offered to the model as a tool choice, and the transition fires when the model selects it. On chat channels, the edge prompts are evaluated in a separate model call after the reply (see [LLM conditions](#llm-conditions)). If no edge fires, the conversation stays on the current node — except for speak and tool nodes, which advance automatically once their step completes.

<Note>
  Workflows are optional. Assistants without a workflow continue to use their standard assistant-level instructions, model, voice, tools, and settings.
</Note>

## What you can build with workflows

Conversation workflows support the building blocks you need for guided, adaptive customer journeys:

* **Start from a defined entry point**: Choose which node begins the workflow.
* **Create focused conversation stages**: Add prompt nodes for each step and give each one its own instructions.
* **Play scripted lines verbatim**: Add speak nodes for greetings, disclosures, or compliance statements that must be delivered word-for-word, with no model turn.
* **Run tools as standalone steps**: Add tool nodes that execute a shared tool deterministically — no model turn — and route on the outcome.
* **Control how prompts combine**: Append node instructions to the assistant's base instructions, or replace the base instructions for a specific step.
* **Tune individual steps**: Override the model, voice, tools, or transcription behavior for a node when that step needs different capabilities.
* **Connect steps with conditional routing**: Use LLM conditions for natural-language decisions and variable comparisons for deterministic decisions.
* **React to tool outcomes**: Route based on whether a configured tool succeeds or fails.
* **Move across assistants**: Send a conversation from one workflow into another assistant when a specialist configuration should take over.
* **Review workflow context in transcripts**: Use conversation history to understand which workflow step produced assistant messages.

## Create a workflow in the Portal

1. Open **AI Assistants** in the Telnyx Portal.
2. Select an assistant.
3. Open the **Workflow** tab.
4. Enable workflows if the assistant does not already have one.
5. Add nodes for each major stage of the conversation.
6. Connect nodes with edges and configure the condition for each edge.
7. Save the assistant.

The workflow canvas lets you pan, zoom, drag nodes, and inspect nodes or edges from the side panel.

<img src="https://mintcdn.com/telnyx/kwpUfZn-MF78Ulju/assets/images/ai-assistant-workflow-front-desk-editor.png?fit=max&auto=format&n=kwpUfZn-MF78Ulju&q=85&s=7cde05a4b6132c2a1029f91f5b38619b" alt="Workflow editor for a Front Desk Receptionist assistant showing a start node, transfer node, FAQ node, conditional edges, and a node inspector panel" width="1904" height="1158" data-path="assets/images/ai-assistant-workflow-front-desk-editor.png" />

For example, a front desk assistant can start at **Greeting & Identify Intent**, route office-hours questions to **Answer FAQ**, and route callers who need a person or department to **Transfer Call**.

<Warning>
  If an assistant is still using the legacy handoff tool flow, the Portal shows the legacy handoff graph instead of the new workflow editor. Remove or migrate the legacy handoff setup before building a new conversation workflow for that assistant.
</Warning>

## Configure workflow nodes

A workflow node represents one active stage of the conversation.

### Node types

Workflows support three kinds of nodes:

* **Prompt node**: An LLM-driven step. The assistant generates its response from the node's instructions (combined with the assistant's base instructions), using the node's model, voice, and tool settings. Most workflow steps are prompt nodes. This is the default node type.
* **Speak node**: A deterministic step that plays a fixed, scripted message and then advances. The assistant does **not** call the model on a speak node, so the wording is exactly what you configure. Use speak nodes for greetings, disclosures, hold messages, compliance statements, or any line that must be delivered verbatim.
* **Tool node**: A deterministic step that runs a single shared (org-level) tool and then advances. The assistant does **not** call the model on a tool node — reaching the node executes the tool directly. Use tool nodes for actions that must happen at a known point in the flow, such as charging a card, posting a booking, or ending the call, rather than leaving the timing to the model's judgment.

Add a node from the **Add Node** menu and choose **Prompt node**, **Speak node**, or **Tool node**. You can also drag an edge from an existing node to an empty area of the canvas and pick the node type from the menu.

#### Speak node message

A speak node centers on a single **Message** field that defines the line to deliver.

* The message is delivered verbatim — there is no model turn, so the caller hears exactly what you type.
* The message supports `{{variable}}` placeholders. Both system variables and custom dynamic variables defined on the assistant are interpolated at runtime, with inline highlighting and autocomplete in the editor.
* A speak node must always have **exactly one outgoing [default edge](#default-conditions)**. Because a speak node does not make a routing decision itself, it advances along this default edge after delivering the message.

```text theme={null}
Thanks for calling Acme, {{first_name}}. This call may be recorded for quality and training.
```

The message uses the assistant's (or flow's) configured voice to deliver the scripted line.

#### Tool node execution

A tool node runs one shared (org-level) tool as a deliberate step in the flow. When the conversation reaches a tool node, the tool executes immediately — there is no model turn — and the flow continues along the node's outgoing edges.

* **Tool**: The node references a shared tool by its ID (`shared_tool_id`). In the Portal, pick the tool from the dropdown in the node editor.
* **Arguments**: Arguments are resolved from the conversation's context — a dynamic variable whose name matches one of the tool's parameters supplies that argument's value.
* **Optional announcement**: A tool node can carry an optional **message** delivered just before the tool runs — for example, *One moment while I confirm that for you.* The message is delivered verbatim, supports `{{variable}}` placeholders, and is spoken before the tool executes, so the tool's result is not available in it.
* **Routing on the outcome**: After the tool runs, its HTTP status code is written to the reserved system variable `telnyx_last_tool_status_code`, so a [variable-comparison edge](#variable-comparison-conditions) can route on the result — compare against `200` for success (see the API example below for the exact condition shape), or route to a fallback node otherwise. A tool node with outgoing edges must carry exactly one [default edge](#default-conditions) to take when no other condition matches.
* **Terminal tool nodes**: A tool node with **no** outgoing edges is a valid end step — the tool runs and the flow stops there. Use this for tool nodes whose action ends the conversation, such as a hangup tool.

Some tool types have fixed behavior regardless of edges:

* A **hangup** tool node ends the call; it accepts no outgoing edges.
* A **transfer** tool node hands the call off to another destination; it accepts at most one outgoing default edge, used only if the transfer fails.

The instructions, tool availability, model, and voice settings described below apply to **prompt nodes**, which generate their response with the model.

### Node name

Use short, descriptive names. Node names are visible in the workflow canvas and can appear in conversation transcript context.

Good node names:

* `Greeting & Identify Intent`
* `Answer FAQ`
* `Transfer Call`
* `Collect appointment details`

### Node instructions

Each node has instructions that control the assistant while that node is active.

You can choose how the node instructions combine with the assistant's main instructions:

* **Append to assistant instructions**: Keep the assistant's base behavior and add step-specific guidance.
* **Replace assistant instructions**: Use only the node's instructions for this step.

Append mode is usually the safest default because it preserves global policies, tone, and business rules. Replace mode is useful for tightly-scoped steps where the assistant should follow a very different prompt.

### Tool availability

Each node controls which of the assistant's tools the model can call while that node is active. This lets you configure every tool once on the assistant, then expose only the relevant subset at each step.

A node's **Tools** tab shows two groups:

* **Inherited tools**: Every tool configured on the assistant. Each tool has a toggle so you can enable or disable it for this specific node. Tools are enabled by default, so a new node starts with the full assistant toolset until you turn tools off.
* **Added for this node**: Tools attached to this node only. Use the **Select a new tool** dropdown to add a node-specific tool that should not be available elsewhere in the workflow.

For example, a `Take Message` node might disable the **Transfer** tool while keeping a `take-message` webhook and a **Hang Up** tool enabled, so the assistant can only capture and close out the message during that step.

<img src="https://mintcdn.com/telnyx/kwpUfZn-MF78Ulju/assets/images/ai-assistant-workflow-node-tools.png?fit=max&auto=format&n=kwpUfZn-MF78Ulju&q=85&s=342a7b79afe1075b3cfafaf03b66b006" alt="Workflow node inspector open to the Tools tab for a Take Message node, showing inherited tools with per-node toggles (Transfer off, take-message webhook and Hang Up on) and a Select a new tool dropdown" width="1907" height="1081" data-path="assets/images/ai-assistant-workflow-node-tools.png" />

<Tip>
  Scoping tools per node is one of the most effective ways to make each step reliable. When a node only exposes the tools that fit its job, the model has fewer choices to weigh, calls the right tool more consistently, and is far less likely to fire an unrelated action (such as transferring a caller during an FAQ answer).
</Tip>

### Model override

A node can use the assistant's default LLM, or override it with another Telnyx-supported model.

Use model overrides when one step needs different reasoning or latency characteristics. For example:

* Use a faster model for intake.
* Use a stronger model for complex qualification or policy-heavy decisions.
* Keep the assistant default everywhere except one high-value decision point.

### Voice override

A node can inherit the assistant's default voice, or use a node-specific voice configuration.

Voice overrides are useful when different conversation stages should feel different. For example:

* Use the standard brand voice during greeting and intent detection.
* Switch to a calmer voice for sensitive support flows.
* Use a different voice when routing to a specialist assistant persona.

## Configure workflow edges

An edge defines where the conversation can go next.

Each edge has:

* **Source node**: The node the conversation is leaving.
* **Target type**: Another workflow node, or another assistant.
* **Condition type**: The logic that decides whether the edge should be followed — an **LLM** condition, a **variable comparison**, or a **default** fallback.

### Evaluation order

When a node has several outgoing edges, how order matters depends on the condition types involved. Variable-comparison edges are evaluated by Telnyx in declaration order, and the first one that is true wins — the remaining edges are not considered, even if their conditions would also be true. The default edge is the exception: it is considered last, regardless of where it sits in the list, so it only fires when no conditioned edge has matched. Among LLM-condition edges, the channel decides: on calls they are offered to the model as transition tools in the same declaration order, but the model selects which one to call, so a later-declared edge can still fire even when an earlier one also matches; on chat channels the post-reply evaluation returns a verdict for every LLM edge, and the first true verdict in declaration order wins.

A variable-comparison edge and an LLM edge do not compete in a single ordered pass. On calls, variable-comparison edges are evaluated before the model turn begins, and a matching edge moves the conversation before the model is offered any LLM-condition transition tools — so a variable-comparison edge takes precedence over an LLM edge on calls regardless of where each sits in the `edges` array. On chat channels, a variable-comparison edge that is true when the turn begins routes the conversation before the reply is generated, the same pre-emption; after the reply, all conditioned edges that remain are considered together in declaration order, so an LLM edge declared before a comparison edge that only became true during the turn wins there.

The declaration order is the `edges` array order in the assistant's `conversation_flow` object. When you create or update an assistant through the [Assistants API](/api-reference/assistants/create-an-assistant), you control this order directly: for variable-comparison edges, the first edge in the array is the one evaluated first.

Because order decides which variable-comparison edge wins, declare those edges in priority order. For example, when a tool returns availability for several days and each day has its own variable-comparison edge, list the edge for the first day you want to book first; the first matching day in the list is the one the conversation takes.

```text theme={null}
Check availability (tool node)
├── Book Tuesday   when tuesday_available == true    ← evaluated first
├── Book Friday    when friday_available == true
└── Offer callback when default                     ← evaluated last
```

### LLM conditions

Use an LLM condition when the routing decision depends on conversation meaning.

How an LLM-condition edge is decided depends on the channel the conversation runs on:

* **On calls**, LLM-condition edges are decided by the same model turn that produces the assistant's reply. Telnyx does not run a separate evaluation of the edge prompt after the response. Instead, each LLM-condition edge leaving the active node is offered to the model alongside the assistant's tools as a tool named `transition__<edge_id>`, with the edge's prompt as the tool description. The transition happens only when the model selects that tool; if the model replies without selecting a transition tool, the conversation stays on the current node.

* **On chat channels** (web chat and the chat API), the reply is produced first, and then every LLM-condition edge leaving the active node is evaluated in a single separate model call: the edge prompts are listed as statements with the recent conversation history, and the model returns a true/false verdict for each edge. The first edge whose verdict is true, in declaration order, wins. Because this evaluation call does not use the assistant's instructions, forbidding tool calls in instructions does not stop chat LLM edges from firing.

<Warning>
  On calls, instructions are load-bearing for LLM-edge routing. Because the transition fires through a tool call, instructions that tell the assistant never to call tools (for example, "do not use the transfer tool; the call moves on by itself") can also stop workflow edges from firing: the model obeys the instruction, acknowledges the request, and the workflow silently stays on the node. If a call workflow routes transfers, hangups, or other actions through LLM edges, the instructions must permit the model to call the routing tool — or direct it explicitly, for example "when the caller asks to be transferred, call the transition tool." Whether an instruction actually blocks routing depends on the model, so test every routing path with the assistant's production model.
</Warning>

Example conditions:

```text theme={null}
The caller has a general office-hours, location, or FAQ question.
```

```text theme={null}
The caller wants to speak with a specific person or department.
```

```text theme={null}
The user has asked to speak with a human agent.
```

LLM conditions are best for intent, sentiment, completeness, and other natural language judgments.

### Variable comparison conditions

Use a variable comparison when the routing decision should be deterministic.

Variable comparison conditions can use system variables and custom dynamic variables defined on the assistant.

Examples:

* `telnyx_conversation_channel == "phone_call"`
* `customer_tier == "enterprise"`
* `telnyx_conversation_duration_secs >= 30`
* `telnyx_shaken_stir_attestation != "a"`
* `telnyx_last_tool_status_code == "200"` (the tool node's last execution succeeded, voice)
* `telnyx_last_tool_status_code == 200` (the same check on chat channels, where the status code is a number)

Variable comparisons are best for account state, channel-specific behavior, elapsed conversation time, authentication flags, or data returned by a dynamic variables webhook.

### Default conditions

A **default** condition is a fallback edge that is followed whenever no other outgoing edge's condition matches. It has no prompt or expression to configure — it simply defines where the conversation goes by default.

Default conditions are required for nodes that do not make their own routing decision:

* A **speak node** delivers a scripted message and then advances. It must have **exactly one** outgoing default edge so the conversation always has a defined next step.
* A **tool node** runs its tool and then advances. If it has any outgoing edges, it must have **exactly one** default edge to take when no conditioned edge matches. A tool node with no outgoing edges at all is also valid — the tool runs and the flow ends there.
* Default conditions are only valid on edges that **leave a speak or tool node**. They are not used on edges leaving a prompt node, which route based on LLM or variable comparison conditions.

When you draw the first edge out of a speak node in the Portal, it is automatically created as a default edge. If a speak node already has its default edge, any additional edges you draw fall back to an LLM condition that you can configure.

The Portal gives tool nodes the same treatment, oriented around the tool's result: the first edge you draw from a tool node is created as a variable comparison against `telnyx_last_tool_status_code` (success when the tool's HTTP status code is `200`), and a second edge is created as the default fallback. This matches what voice assistants need; on chat channels use a number literal, as shown in the API example below.

<Warning>
  A speak node with zero default edges, or more than one, is invalid and cannot be saved. Make sure every speak node has exactly one outgoing default edge. A tool node with outgoing edges follows the same rule — exactly one default edge among them.
</Warning>

## Configure workflows with the API

You can also configure workflows programmatically through the [Assistants API](/api-reference/assistants/create-an-assistant). Workflows are stored on the assistant as `conversation_flow`.

The API accepts the full workflow graph when you create or update an assistant. To change one node or edge, send the updated `conversation_flow` object with the assistant update request.

<Note>
  Assistant updates treat `conversation_flow` atomically. If you omit the field, the existing workflow is unchanged. If you send `conversation_flow: null`, the workflow is cleared.
</Note>

A simplified workflow payload looks like this:

```json theme={null}
{
  "conversation_flow": {
    "start_node_id": "n_greeting",
    "nodes": [
      {
        "id": "n_greeting",
        "name": "Greeting & Identify Intent",
        "instructions": "Quickly determine whether the caller needs a person, a department, or a general FAQ answer.",
        "instructions_mode": "append"
      },
      {
        "id": "n_faq",
        "name": "Answer FAQ",
        "instructions": "Answer hours, location, and general information questions. If they need more detail, offer to connect them to the right person.",
        "instructions_mode": "append"
      },
      {
        "id": "n_transfer",
        "name": "Transfer Call",
        "instructions": "Confirm the destination department or person, then verbally confirm the transfer before connecting the caller.",
        "instructions_mode": "append"
      }
    ],
    "edges": [
      {
        "id": "e_greeting_to_faq",
        "start_node_id": "n_greeting",
        "target": { "type": "node", "node_id": "n_faq" },
        "condition": {
          "type": "llm",
          "prompt": "The caller has a general office-hours, location, or FAQ question."
        }
      },
      {
        "id": "e_greeting_to_transfer",
        "start_node_id": "n_greeting",
        "target": { "type": "node", "node_id": "n_transfer" },
        "condition": {
          "type": "llm",
          "prompt": "The caller wants to speak with a specific person or department."
        }
      }
    ]
  }
}
```

### Speak nodes and default edges in the API

A speak node uses `"type": "speak"` and carries its scripted text in the `message` field instead of `instructions`. Its single outgoing edge uses a `default` condition.

```json theme={null}
{
  "conversation_flow": {
    "start_node_id": "n_disclosure",
    "nodes": [
      {
        "type": "speak",
        "id": "n_disclosure",
        "name": "Recording Disclosure",
        "message": "Thanks for calling Acme, {{first_name}}. This call may be recorded for quality and training."
      },
      {
        "type": "prompt",
        "id": "n_intake",
        "name": "Identify Intent",
        "instructions": "Find out what the caller needs and route them accordingly.",
        "instructions_mode": "append"
      }
    ],
    "edges": [
      {
        "id": "e_disclosure_to_intake",
        "start_node_id": "n_disclosure",
        "target": { "type": "node", "node_id": "n_intake" },
        "condition": { "type": "default" }
      }
    ]
  }
}
```

The prompt node's `"type"` field is optional and defaults to `"prompt"`. A `default` condition takes no `prompt` or `expression`, and is only valid on an edge that leaves a speak or tool node.

### Tool nodes in the API

A tool node uses `"type": "tool"` and references a shared tool by `shared_tool_id`. The node below runs a webhook tool that books an appointment, announces it first with the optional `message` field, and routes on the outcome: a variable-comparison edge checks the `telnyx_last_tool_status_code` system variable for success, and a `default` edge covers the failure path.

```json theme={null}
{
  "conversation_flow": {
    "start_node_id": "n_confirm",
    "nodes": [
      {
        "type": "prompt",
        "id": "n_confirm",
        "name": "Confirm details",
        "instructions": "Confirm the appointment details, then let the caller know the booking is being made.",
        "instructions_mode": "append"
      },
      {
        "type": "tool",
        "id": "n_book",
        "name": "Book appointment",
        "message": "One moment while I book that for you.",
        "shared_tool_id": "e5d1a3aa-6e8d-4e23-9b7c-9d5b6e4c1a90"
      },
      {
        "type": "prompt",
        "id": "n_done",
        "name": "Confirm booking",
        "instructions": "The booking is complete. Confirm the date and time to the caller and ask if they need anything else.",
        "instructions_mode": "append"
      },
      {
        "type": "prompt",
        "id": "n_retry",
        "name": "Booking failed",
        "instructions": "Apologize and offer to take the caller's details and complete the booking manually.",
        "instructions_mode": "append"
      }
    ],
    "edges": [
      {
        "id": "e_confirm_to_book",
        "start_node_id": "n_confirm",
        "target": { "type": "node", "node_id": "n_book" },
        "condition": {
          "type": "llm",
          "prompt": "The caller has confirmed the details and the booking can be made."
        }
      },
      {
        "id": "e_book_success",
        "start_node_id": "n_book",
        "target": { "type": "node", "node_id": "n_done" },
        "condition": {
          "type": "expression",
          "expression": {
            "type": "comparison",
            "op": "==",
            "left": { "type": "variable", "name": "telnyx_last_tool_status_code" },
            "right": { "type": "string_literal", "value": "200" }
          }
        }
      },
      {
        "id": "e_book_default",
        "start_node_id": "n_book",
        "target": { "type": "node", "node_id": "n_retry" },
        "condition": { "type": "default" }
      }
    ]
  }
}
```

The `message` field is optional; omit it to run the tool silently. The success comparison above is the condition shape the Portal creates for voice assistants. On chat channels the status code is recorded as a number instead of a string, so compare against a number literal (`200`) there.

## Route to another assistant

An edge can target another assistant instead of another node in the same workflow.

Use assistant routing when a conversation should move to a different specialist configuration, such as:

* A sales assistant routing qualified technical questions to a solutions assistant.
* A front-desk assistant routing billing questions to a billing assistant.
* A general support assistant routing high-risk cases to a stricter compliance assistant.

This keeps each assistant focused while still letting customers move through a connected experience.

## Example workflow patterns

### Front desk receptionist

Use one assistant to greet callers, identify intent, and route to the right next step.

```text theme={null}
Greeting & Identify Intent
├── Answer FAQ       when the caller asks about hours, location, or general information
└── Transfer Call    when the caller wants a person or department
```

### Appointment booking

Guide the customer through a sequence of required information before confirmation.

```text theme={null}
Collect request
→ Collect availability
→ Confirm details
→ Final confirmation
```

Use variable comparisons for deterministic gates, such as whether a required dynamic variable exists, and LLM conditions for softer gates, such as whether the customer has verbally confirmed the details.

### Escalation after timeout

Use the conversation duration system variable to escalate when the assistant has spent too long in a step.

```text theme={null}
Troubleshooting
├── Continue troubleshooting  when the issue is not resolved
└── Route to specialist       when telnyx_conversation_duration_secs >= 300
```

### Multi-assistant specialization

Use a workflow edge to route from a general assistant into another assistant.

```text theme={null}
Main support assistant
├── Billing assistant
├── Technical support assistant
└── Sales assistant
```

This pattern is useful when each destination needs its own model, voice, instructions, tools, or operational ownership.

## Test and debug workflows

After saving a workflow, test the assistant with realistic conversations that exercise each route.

When reviewing conversation history:

* Check whether the assistant followed the expected path.
* Look for assistant messages labeled with workflow node context.
* Open the workflow from transcript context when you need to inspect the node that produced a response.
* Review dynamic variable values and webhook behavior if a variable comparison did not route as expected.
* If an LLM-condition edge did not fire on a call, check the assistant's instructions for text that forbids or discourages tool calls — on calls the edge fires through a tool call, so such instructions stop routing (see [LLM conditions](#llm-conditions)). On chat channels, check the edge's prompt and the recent conversation history instead: the evaluation call judges only the prompt against that history.

In this example, the assistant starts in **Greeting & Identify Intent**, the caller asks about hours, and the workflow routes the response through **Answer FAQ**.

<img src="https://mintcdn.com/telnyx/kwpUfZn-MF78Ulju/assets/images/ai-assistant-workflow-front-desk-transcript.png?fit=max&auto=format&n=kwpUfZn-MF78Ulju&q=85&s=d22ccc2eb8327e8d1c07cbf55ca5b3aa" alt="Conversation transcript showing a Front Desk Receptionist workflow moving from Greeting & Identify Intent to Answer FAQ after the user asks about hours" width="873" height="702" data-path="assets/images/ai-assistant-workflow-front-desk-transcript.png" />

## Best practices

### Keep nodes focused

Each node should represent one clear job. If a node's instructions cover multiple unrelated tasks, split it into separate nodes.

### Limit each node to the tools it needs

Configure all of your tools on the assistant, then disable the ones that do not apply on each node. A focused, node-specific toolset gives the model a clear purpose, reduces the chance it calls the wrong tool, and keeps each step predictable. As a rule of thumb, only leave a tool enabled on a node if that step is supposed to be able to use it.

### Prefer append mode for global rules

Use append mode when the node should keep the assistant's normal safety rules, brand voice, and business constraints. Use replace mode only when the node truly needs a standalone prompt.

### Write edge conditions as clear decisions

For LLM conditions, describe the moment when the edge should fire. Avoid vague conditions like `billing`. Prefer explicit criteria, such as `The caller has a general office-hours, location, or FAQ question.`

### Don't forbid the routing tool in instructions

On calls, LLM-condition edges stop firing when instructions tell the assistant never to call tools — the transition depends on the model selecting the routing tool that the workflow offers it (see [LLM conditions](#llm-conditions)). A prohibition scoped to one named tool is not safe either: wording like "do not use the transfer tool" can suppress the workflow's routing tool as well. Keep such instructions off call assistants that run workflows, or replace them with wording that directs the routing action, such as "when the caller asks to be transferred, call the transition tool."

### Use variable comparisons for hard rules

If the condition depends on structured data, use a variable comparison instead of an LLM condition. This makes routing predictable and easier to debug.

### Avoid too many paths from one node

A node with many outgoing edges is harder to reason about and test. If the routing logic gets complex, add an intermediate triage node.

### Test every path before production

Run through the happy path, fallback path, escalation path, and at least one negative case for every important node.

## Related resources

* [Dynamic Variables](/docs/inference/ai-assistants/dynamic-variables): Personalize prompts and route with runtime data.
* [Version Testing and Traffic Distribution](/docs/inference/ai-assistants/version-testing-traffic-distribution): Test assistant changes before sending all traffic to a new version.
* [Integrations](/docs/inference/ai-assistants/integrations): Connect assistants to external systems and data sources.


