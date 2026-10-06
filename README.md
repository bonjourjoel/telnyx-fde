# AI Assistant & Edge Compute Coding Challenge

Joël Abenhaïm - Telnyx developer support line

## Deliverables

1. [Source code](https://github.com/bonjourjoel/telnyx-fde)
2. [README.md](./README.md)
3. [OpenCode configuration with the Telnyx plugin](./opencode.json)
4. [Setup instructions](#setup-instructions)
5. [Software architecture](#architecture)
6. [Observability](#observability) and [sample bug fix story](#observability---one-thing-that-broke-during-development-and-how-i-found-it)
7. [Demo script](#demo-script)
8. [Testing instructions](#testing-instructions)

## Setup instructions

> Note: These instructions have been tested on Windows 11.

Prerequisites: Node.js 24, npm, and the Telnyx Edge CLI (`telnyx-edge`).

1. Clone the repository and open a terminal in the project directory.
2. Install dependencies with `npm ci`.
3. Copy `.env.example` to `.env`.
4. Create a Telnyx API key and set `TELNYX_API_KEY` in `.env`.
5. Deploy with `npm run deploy`.

## npm commands and deployment script

The project provides npm scripts for deployment, local tests, and feature flag management.

Run `npm run help` to list the available commands.

The main command, `npm run deploy`, runs a self-contained infrastructure-as-code script that performs the following steps:

- Run the TypeScript check and the complete local test suite.
- Load `.env` and validate the required configuration.
- Validate the existing Telnyx runtime binding and renew it if its token is invalid or expired.
- Locate or create the project's KV namespace and wait for provisioning.
- Initialize missing configuration fields while preserving existing values.
- Ensure the required backend secrets are available, preserving the existing caller HMAC key.
- Update the deployment manifest with the required bindings.
- Deploy the Edge Function and Actor code using `telnyx-edge ship`.
- Wait for the public `/health` endpoint to respond successfully.
- Register or update the MCP server and its three-tool allowlist.
- Create or update the four shared assistant tools.
- Verify the configured model is available, then create or update the assistant with the complete conversation workflow.
- Retrieve the assistant's TeXML and store it in KV.
- Create or update the phone routing application, reuse the existing outbound voice profile, and assign the existing phone number.
- Verify the resulting configuration and save resource identifiers in `deployment-state.json`.
- Display the public URLs and phone number.

Subsequent deployments reuse existing resources and preserve tickets, feature flags, and caller identities.

## Architecture

### Architecture - Overview

```text
Caller (phone or Portal voice test)
                |
                v
     Telnyx Assistant / Workflow
                |
      /init, /tickets/create, /mcp
                |
                v
    Single TypeScript Edge Function
                |
                +--> KV: backend configuration
                |
                +--> CallerTickets Actor
                |         |
                |         v
                |    Persistent tickets
                |
                +--> MCP server: FAQ catalogue
```

The Telnyx assistant manages the conversation through its workflow. A single Edge Function provides initialization, ticket creation, and the custom MCP server.

KV stores backend configuration. The Actor persists tickets and serializes modifications to prevent concurrent updates from losing data. The MCP server exposes three tools for reading the public documentation catalogue.

### Architecture - List of nodes

- GREETING: Speak
- MAIN_ROUTING: Prompt
- CONTEXT_UNAVAILABLE: Speak
- TICKET_SELECTION: Prompt
- TICKET_STATUS: Speak
- TICKET_STATUS_ERROR: Speak
- FAQ_SHORT: Prompt
- FAQ_ERROR: Speak
- RESOLUTION: Speak
- TECHNICIAN_OFFER: Prompt
- TRANSFER_MESSAGE: Speak
- TRANSFER: Tool
- TRANSFER_FAILED: Speak
- TICKET_INTAKE: Prompt
- TICKET_UNAVAILABLE: Speak
- CREATE_TICKET: Tool
- TICKET_CREATED: Speak
- TICKET_ERROR: Speak
- GOODBYE: Speak
- HANGUP: Tool

### Architecture - Workflow 1: Initialization and greeting

```text
Before the workflow:

POST /init
    |
    +--> KV: read backend configuration
    +--> Actor: read the caller's tickets
    |
    v
Return dynamic variables

Conversation workflow:

GREETING [Speak]
    |
    v
MAIN_ROUTING [Prompt]
    |
    +--> Initialization failed --> CONTEXT_UNAVAILABLE --> FAQ_SHORT
    |
    +--> No tickets -----------> FAQ_SHORT
    |
    +--> Tickets available: caller chooses
             |
             +--> Ticket follow-up --> TICKET_SELECTION
             +--> New question ----> FAQ_SHORT
             +--> Cancel ----------> GOODBYE
```

Before the conversation workflow starts, Telnyx calls `/init`. The backend verifies the webhook signature, reads the configuration from KV, and retrieves tickets from the caller's Actor. Phone callers have their own Actor; Portal tests use a stable demo identity configured by the backend.

The webhook returns dynamic variables containing a personalized greeting, up to three open or recently updated tickets, the technician availability flag, and the context needed for ticket creation.

GREETING reads the prepared greeting. MAIN_ROUTING then directs callers with no tickets to the FAQ. When tickets are available, it lets the caller choose between ticket follow-up, a new question, or ending the call. If initialization fails, the assistant explains that records could not be retrieved and allows a new question.

Technical elements:

- **Dynamic Webhook Variables:** `/init` supplies context before the workflow starts.
- **Telnyx Edge Function:** hosts the initialization endpoint.
- **KV:** stores backend configuration, including the technician availability flag.
- **Stateful Actor:** provides persistent tickets for the resolved caller identity.
- **Speak node:** delivers the prepared greeting.
- **Prompt node and conditional edges:** combine deterministic initialization/ticket checks with intent-based routing.
- **Structured logs:** record initialization operations, outcomes, and durations without phone numbers or ticket text.

### Architecture - Workflow 2: Existing ticket follow-up

```text
MAIN_ROUTING: caller requests ticket follow-up
    |
    v
TICKET_SELECTION [Prompt]
    |
    +--> One ticket: status already prepared
    |        |
    |        v
    |    TICKET_STATUS [Speak] --> HANGUP [Tool]
    |
    +--> Multiple tickets: read menu and ask for selection
    |        |
    |        +--> Ambiguous choice: ask for clarification
    |        |
    |        +--> Clear choice: call SET_SUPPORT_VARIABLES
    |                 |
    |                 +--> Success --> TICKET_STATUS --> HANGUP
    |                 +--> Failure --> TICKET_STATUS_ERROR --> HANGUP
    |
    +--> Cancellation --> GOODBYE [Speak] --> HANGUP [Tool]
```

After the caller requests ticket follow-up, the assistant uses the tickets retrieved during initialization. When exactly one ticket is presented, the backend has already prepared its status text. A deterministic transition skips the selection prompt and goes directly to the status announcement.

With multiple tickets, the assistant reads a numbered menu and accepts a selection by number, reference, or subject. An ambiguous choice requires clarification. Once the selection is clear, the assistant calls SET_SUPPORT_VARIABLES to store the ticket’s exact backend-provided status text, including its reference, status, and progress summary.

TICKET_STATUS reads that text and the goodbye message together, then hangs up. If storing the selected status fails, the assistant delivers an error message and goodbye before hanging up. Cancellation also ends the call.

Technical elements:

- **Stateful Actor:** supplies the persistent ticket records read during initialization.
- **Dynamic variables:** carry the ticket list and `selected_ticket_status_text`.
- **Variable comparison edge:** bypasses selection when the status text is already populated.
- **Prompt node and LLM transitions:** handle selection, clarification, cancellation, and update failure.
- **Update Dynamic Variables tool:** stores the selected ticket’s exact status text before the success transition.
- **Speak nodes:** deliver the status or error message, including goodbye.
- **Hangup Tool node:** ends the call after the closing message.

### Architecture - Workflow 3: FAQ lookup

```text
FAQ_SHORT [Prompt]
    |
    v
Call list_topics
    |
    +--> Matching topic: call read_short_answer
    |        |
    |        +--> Success: announce the documentation title
    |        |        |
    |        |        v
    |        |    GOODBYE [Speak] --> HANGUP [Tool]
    |        |
    |        +--> Tool error --> FAQ_ERROR [Speak] --> HANGUP
    |
    +--> No matching topic --> RESOLUTION [Speak]
    |                              |
    |                              v
    |                         TECHNICIAN_OFFER
    |
    +--> Tool error --> FAQ_ERROR [Speak] --> HANGUP
```

The assistant asks for the caller’s question if it is not already known, then calls list_topics through the custom MCP server. It compares the question with the catalogue’s coverage descriptions. If a topic matches, it calls read_short_answer using the returned topic identifier and announces the exact documentation page title, without reading the URL.

It then transitions immediately to GOODBYE and HANGUP, without offering a longer explanation or waiting for another caller response.

If no topic covers the question, RESOLUTION explains this and continues to the technician branch. An MCP failure instead produces an unavailable-service message and ends the call; it is never treated as proof that the FAQ lacks coverage.

Technical elements:

- **Custom MCP server:** hosted at `/mcp` by the Telnyx Edge Function.
- **Three public MCP tools:** `list_topics`, `read_short_answer`, and `read_long_answer`. This voice branch uses only the first two.
- **Verified documentation catalogue:** supplies coverage descriptions, titles, and URLs without external searches.
- **Prompt node and LLM transitions:** handle topic matching and the success, absent-coverage, and error paths.
- **Speak and Hangup nodes:** deliver closing messages and end the call.
- **Structured MCP logs:** record tool operations, outcomes, and durations without logging the caller’s question.

### Architecture - Workflow 4: Technician offer and transfer

```text
RESOLUTION [Speak]
    |
    v
TECHNICIAN_OFFER [Prompt]
    |
    +--> Technician unavailable --> TICKET_INTAKE
    |
    +--> Technician available: ask whether to connect
             |
             +--> Caller agrees --> TRANSFER_MESSAGE [Speak]
             |                          |
             |                          v
             |                      TRANSFER [Tool]
             |                          |
             |                          +--> Success: call transferred
             |                          |
             |                          +--> Failure
             |                                  |
             |                                  v
             |                           TRANSFER_FAILED [Speak]
             |                                  |
             |                                  v
             |                             TICKET_INTAKE
             |
             +--> Caller declines --> TICKET_INTAKE
             |
             +--> Caller cancels --> GOODBYE [Speak] --> HANGUP [Tool]
```

When the FAQ does not cover the question, the workflow checks the technician availability flag loaded from KV during initialization. If it is false, a deterministic transition skips the offer and goes directly to ticket intake.

Otherwise, the assistant asks whether the caller wants to speak with a technician. Explicit agreement leads to a scripted transfer announcement, then the transfer tool connects the call to the configured technician number. A successful transfer exits the workflow without an automatic hangup.

If Telnyx reports a transfer failure, the assistant announces that it could not connect and continues to ticket intake, without retrying. Declining the technician also leads to ticket intake; cancellation ends the call.

Technical elements:

- **KV feature flag:** controls technician availability without redeployment; changes apply on the next call.
- **Dynamic variable:** `technician_available` carries the backend configuration into the workflow.
- **Variable comparison edge:** skips the offer before the model turn when the flag is false.
- **Prompt node and LLM transitions:** distinguish explicit agreement, refusal, and cancellation.
- **Speak nodes:** deliver the transfer announcement and failure message verbatim.
- **Standalone Transfer Tool node:** uses the existing shared transfer tool and configured phone target.
- **Default failure edge:** routes a failed transfer to ticket intake, with no success hangup edge or automatic retry.

### Architecture - Workflow 5: Ticket creation

```text
TICKET_INTAKE [Prompt]
    |
    +--> Creation unavailable --> TICKET_UNAVAILABLE [Speak] --> HANGUP
    |
    +--> Summarize the request and offer ticket creation
             |
             +--> Caller agrees: call SET_SUPPORT_VARIABLES
             |        |
             |        +--> Success --> CREATE_TICKET [Tool]
             |        |                    |
             |        |                    +--> HTTP "200" + id + reference
             |        |                    |        |
             |        |                    |        v
             |        |                    |    TICKET_CREATED [Speak]
             |        |                    |        |
             |        |                    |        v
             |        |                    |    HANGUP [Tool]
             |        |                    |
             |        |                    +--> Otherwise --> TICKET_ERROR
             |        |                                          |
             |        |                                          v
             |        |                                        HANGUP
             |        |
             |        +--> Failure --> TICKET_ERROR [Speak] --> HANGUP
             |
             +--> Decline or cancel --> GOODBYE [Speak] --> HANGUP
```

A deterministic guard first checks whether ticket creation is available. If it is, the assistant briefly summarizes the request, asks whether to create a support ticket, and waits for the caller’s answer. Silence or ambiguity does not authorize creation.

After explicit agreement, SET_SUPPORT_VARIABLES stores a short subject and a faithful description of the request. Only a successful update allows the workflow to enter CREATE_TICKET, which sends a synchronous, signed webhook to `/tickets/create`. The backend validates the fields and calls the same caller Actor used during initialization. The Actor checks the operation identifier, assigns a reference, and persists the new ticket with status `open`. A repeated operation returns the existing ticket.

The success branch requires HTTP status `"200"` and both returned identifiers. It announces the reference and goodbye together, then hangs up. Other results produce a message saying creation could not be confirmed. No automatic retry runs, and a timeout is never presented as proof that no ticket exists.

Technical elements:

- **Prompt node and explicit consent:** authorize creation only after the caller agrees to the ticket offer.
- **Dynamic variables and comparison guard:** control creation availability and carry the subject and description.
- **Update Dynamic Variables tool:** stores the ticket fields before creation.
- **Standalone webhook Tool node:** waits for the backend response and stores its identifiers as variables.
- **Telnyx Edge Function:** verifies the webhook signature, validates fields, and resolves the caller identity.
- **Stateful Actor:** serializes the read-modify-write operation, persists tickets, and deduplicates repeated operation identifiers.
- **Conditional success edge:** checks the HTTP status and returned identifiers before announcing success.
- **Speak and Hangup nodes:** deliver the result and goodbye, then end the call.
- **Structured logs:** record backend operations, outcomes, and durations without phone numbers or ticket text.

## Observability

### Observability - Overview

Logging is centralized by design in `src/logging.ts`. All backend components use this shared module to produce consistent structured logs containing the request identifier, operation, outcome, duration, and any error.

A common mechanism controls their content to exclude secrets and personal data, supporting GDPR compliance.

From the start of development, the coding assistant was instructed to instrument important operations this way. Logs provide visibility into webhooks, KV, Actors, and MCP tools, helping locate the information needed for debugging.

HTTP invocation logs and Telnyx metrics complement this visibility with HTTP status codes, request volume, errors, and latency, including p95.

### Observability - How to monitor operations and failures

A coding assistant following the project's `AGENTS.md` instructions can analyze logs and conversation transcripts to reconstruct a past voice assistant session. This helps investigate errors, workflow behavior, caller and assistant dialogue, and delays.

The coding assistant can then cross-reference the logs with:

- the developer’s written account of what happened
- the source code

It's a very efficient way to debug the application.

### Observability - How to be aware of malfunctions

**Method 1: Check Function availability**

```powershell
Invoke-WebRequest -Uri "https://telnyx-fde-0768c5c4-b.telnyxcompute.com/health" -TimeoutSec 5
```

This checks availability, not business dependencies.

**Method 2: Filter runtime error messages**

```powershell
telnyx-edge logs telnyx-fde --tail --type runtime |
    Select-String -Pattern '\berrors?\b|\bfailed\b|\bfailure\b'
```

This is a text filter.

**Method 3: Filter application failures and rejected requests**

```powershell
telnyx-edge logs telnyx-fde --tail --type runtime |
    Select-String -Pattern '"outcome"\s*:\s*"(error|rejected)"'
```

Matching entries include `error_code` when available.

**Method 4: Automate detection**

Run checks every X seconds, with a Y-second timeout and an email alert on failure. Not implemented in the POC.

### Observability - One thing that broke during development and how I found it

1. I am at step 8 of development. The assistant tells me it does not know what format the "type" field should have in the mcp_create API request.

2. We decide to run tests. They fail. It tells me it is blocked and that what remains to do must be done manually. This bothers me because I want an idempotent deploy.ts script that I can rerun.

3. I ask where it read the documentation, for the URL and an excerpt, to understand what is blocking it. It gives me this URL:
   https://developers.telnyx.com/api-reference/mcp-servers/create-mcp-server
   This is an API reference.

4. I remember seeing this documentation somewhere. I tell it that it has the wrong documentation and that it needs to read the explanatory documentation for creating an MCP server, rather than the API reference, which seems incomplete.

5. It finds the right value, "http", on this page:
   https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant/index#model-context-protocol-mcp-servers
   Using "http" for the "type" field in the MCP registration request (POST /v2/ai/mcp_servers), used by deploy.ts, resolved the HTTP 400 error. The request returned HTTP 200, and running the registration script again reused the same resource without creating a duplicate.

**Conclusion:** the problem was solved thanks to:

a) Having read through the documentation myself before starting, to get an intuition about what is covered and feasible.

b) Having pushed the coding agent to explain the precise blocker, without trusting it blindly.

c) Having used my knowledge and authority to guide it toward a solution.

**Evidence:**

Original API reference doc (incomplete):
https://developers.telnyx.com/api-reference/mcp-servers/create-mcp-server

Original error (exact log):
{"method":"POST","endpoint":"/ai/mcp_servers","http_status":400,"detail":"10015; Bad Request; The request failed because it was not well-formed."}

Documentation screenshot showing HTTP and SSE:
https://developers.telnyx.com/assets/images/mcp_server.png

Correction:
Changed the MCP registration request's "type" from "custom" to "http".

Observed results (summary, not verbatim console output):

- Creation: POST returned HTTP 200; action=created; matching_count=1.
- Second run: GET requests only; action=reused; matching_count=1.
- Both runs returned the same ID: d4701ec6-2bf2-42eb-80bb-77e81f4171f6.

## Demo script

**Introduction**

Demo explanation: I built a voice assistant that simulates Telnyx technical support for developers. This is a demonstration application, not a production service, designed to incorporate all the technical elements required by the challenge.

**Step 1: FAQ question**

Demo explanation: I’ll ask a question covered by the documentation catalogue. The assistant will use our custom MCP server to find the relevant documentation page.

Customer: How do dynamic variables work?

Assistant: Calls list_topics to identify a matching topic, then read_short_answer to retrieve its documentation title. Announces the title, says goodbye, and ends the call.

**Step 2: Ticket creation**

Preparation: Run `npm run technician:false` before starting this voice test so the assistant skips the technician offer.

Demo explanation: I’ll describe a problem outside the FAQ and explicitly agree to ticket creation. The backend will store the ticket in the demo caller’s Stateful Actor.

Customer: My invoice was charged twice.

Assistant: Finds no matching FAQ topic, summarizes the problem, and asks whether to create a support ticket.

Customer: Yes, please create a support ticket.

Assistant: Stores the subject and description using SET_SUPPORT_VARIABLES, then calls CREATE_TICKET. After the backend confirms creation, announces the ticket reference, says goodbye, and ends the call.

**Step 3: Ticket follow-up on a new call**

Demo explanation: I’ll start a new voice test. The initialization webhook retrieves the ticket created in the previous session from the same Stateful Actor and personalizes the greeting.

Assistant: Greets the caller, mentions the existing ticket, and offers ticket follow-up or a new question.

Customer: I’d like to follow up on the ticket about my invoice being charged twice.

Assistant: If only one ticket is presented, announces its status directly. If several tickets are presented, asks which one to follow up on. Reads the selected ticket’s stored status and progress summary, says goodbye, and ends the call.

**Step 4: Print the technical logs**

```powershell
Write-Host "Recent runtime logs"
telnyx-edge logs telnyx-fde --type runtime --since 10m --last 200

Write-Host "Telnyx metrics"
telnyx-edge metrics telnyx-fde --since 1h --json
```

## Testing instructions

Public Function URL: [https://telnyx-fde-0768c5c4-b.telnyxcompute.com](https://telnyx-fde-0768c5c4-b.telnyxcompute.com)

Open the [Telnyx Portal](https://portal.telnyx.com/), go to **AI Assistants**, select the project’s assistant, and start the voice test. Access to the assistant in the project’s account is required.

Allow microphone access and speak English. Set microphone input and speaker volume to around 50%, or use a headset with a microphone to avoid audio feedback.

You can ask a Telnyx documentation question, request ticket creation for a question outside the FAQ, or follow up on an existing ticket in a new session.

**Public MCP server**

The MCP endpoint is publicly accessible without authentication:

[https://telnyx-fde-0768c5c4-b.telnyxcompute.com/mcp](https://telnyx-fde-0768c5c4-b.telnyxcompute.com/mcp)

Connect using an MCP client supporting **Streamable HTTP**. The server exposes three tools: `list_topics`, `read_short_answer`, and `read_long_answer`.

To test them using the project's official MCP SDK client, run from the repository root after installing dependencies:

```powershell
node --import tsx scripts/check-mcp.ts --url https://telnyx-fde-0768c5c4-b.telnyxcompute.com/mcp
```

The script discovers and calls all three tools, and checks invalid inputs.

**Current phone limitation**

Configured phone number: `+33221857507`.

The number has been purchased and connected, but my Telnyx account is still awaiting verification or upgrade. Inbound calls are rejected with SIP 486 / D61 (`USER_BUSY`) and produce a busy tone before reaching the backend. Voice testing is therefore currently available through the Portal only.
