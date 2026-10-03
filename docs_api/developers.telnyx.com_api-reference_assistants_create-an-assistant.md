*** https://developers.telnyx.com/api-reference/assistants/create-an-assistant:

> ## Documentation Index
> Fetch the complete documentation index at: https://developers.telnyx.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Create an assistant

> Creates a new AI assistant from the provided configuration, including its model, instructions, and attached tools, and returns the created assistant.



## OpenAPI

````yaml /openapi/source/external/inference/inference-embedding.json post /ai/assistants
openapi: 3.1.0
info:
  version: 2.0.0
  title: Telnyx API
  x-latency-category: responsive
  x-endpoint-cost: light
  description: SIP trunking, SMS, MMS, Call Control and Telephony Data Services.
  contact:
    email: support@telnyx.com
servers:
  - url: https://api.telnyx.com/v2
    description: Version 2.0.0 of the Telnyx API
security:
  - bearerAuth: []
tags:
  - name: Chat
    description: Generate text with LLMs
  - name: Assistants
    description: Configure AI assistant specifications
  - name: Conversations
    description: Manage historical AI assistant conversations
  - name: File-based Text-to-Speech
    description: Turn audio into text or text into audio.
  - name: Embeddings
    description: Embed documents and perform text searches
  - name: Clusters
    description: Identify common themes and patterns in your embedded documents
  - name: Fine Tuning
    description: Customize LLMs for your unique needs
  - name: OpenAI Embeddings
    description: >-
      OpenAI-compatible embeddings endpoints for generating vector
      representations of text
paths:
  /ai/assistants:
    post:
      tags:
        - Assistants
      summary: Create an assistant
      description: >-
        Creates a new AI assistant from the provided configuration, including
        its model, instructions, and attached tools, and returns the created
        assistant.
      operationId: create_new_assistant_public_assistants_post
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateAssistantRequest'
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Assistant'
          headers:
            Idempotent-Replayed:
              $ref: '#/components/headers/IdempotentReplayed'
        '400':
          description: >-
            Bad Request / Validation Failed (10015). Invalid, duplicate, empty,
            malformed, or overlong Idempotency-Key headers are rejected by Edge
            with HTTP 400 and error code 10015. The assistant configuration is
            validated too: enabling `privacy_settings.in_transit_data_locality`
            is refused when the organization's data-locality region has no
            in-region inference, or when any model the assistant could use — its
            `model`, its `fallback_config`, or a conversation-flow node override
            — is not Telnyx-hosted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '409':
          $ref: '#/components/responses/IdempotencyConflictResponse'
        '413':
          description: >-
            Payload Too Large. A request sent with an Idempotency-Key whose body
            exceeds the endpoint's Edge replay-protection limit (256 KB) is
            rejected before it reaches the service. Requests sent without the
            header are not subject to this limit.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '422':
          description: >-
            Validation Error. Reusing an Idempotency-Key with a different
            request body also returns 422 with error code 10027.
          content:
            application/json:
              schema:
                anyOf:
                  - $ref: '#/components/schemas/HTTPValidationError'
                  - $ref: '#/components/schemas/ErrorResponse'
        '503':
          description: >-
            Service unavailable (10016), including unavailable Edge idempotency
            protection for a keyed request.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
      x-codeSamples:
        - lang: JavaScript
          source: |-
            import Telnyx from 'telnyx';

            const client = new Telnyx({
              apiKey: process.env['TELNYX_API_KEY'], // This is the default and can be omitted
            });

            const inferenceEmbedding = await client.ai.assistants.create({
              instructions: 'instructions',
              name: 'name',
            });

            console.log(inferenceEmbedding.id);
        - lang: Python
          source: |
            import os
            from telnyx import Telnyx

            client = Telnyx(
                api_key=os.environ.get("TELNYX_API_KEY"),  # This is the default and can be omitted
            )
            inference_embedding = client.ai.assistants.create(
                instructions="instructions",
                name="name",
            )
            print(inference_embedding.id)
        - lang: Go
          source: "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\n\t\"github.com/team-telnyx/telnyx-go\"\n\t\"github.com/team-telnyx/telnyx-go/option\"\n)\n\nfunc main() {\n\tclient := telnyx.NewClient(\n\t\toption.WithAPIKey(\"My API Key\"),\n\t)\n\tinferenceEmbedding, err := client.AI.Assistants.New(context.TODO(), telnyx.AIAssistantNewParams{\n\t\tInstructions: \"instructions\",\n\t\tName:         \"name\",\n\t})\n\tif err != nil {\n\t\tpanic(err.Error())\n\t}\n\tfmt.Printf(\"%+v\\n\", inferenceEmbedding.ID)\n}\n"
        - lang: Java
          source: |-
            package com.telnyx.sdk.example;

            import com.telnyx.sdk.client.TelnyxClient;
            import com.telnyx.sdk.client.okhttp.TelnyxOkHttpClient;
            import com.telnyx.sdk.models.ai.assistants.AssistantCreateParams;
            import com.telnyx.sdk.models.ai.assistants.InferenceEmbedding;

            public final class Main {
                private Main() {}

                public static void main(String[] args) {
                    TelnyxClient client = TelnyxOkHttpClient.fromEnv();

                    AssistantCreateParams params = AssistantCreateParams.builder()
                        .instructions("instructions")
                        .name("name")
                        .build();
                    InferenceEmbedding inferenceEmbedding = client.ai().assistants().create(params);
                }
            }
        - lang: Ruby
          source: >-
            require "telnyx"


            telnyx = Telnyx::Client.new(api_key: "My API Key")


            inference_embedding = telnyx.ai.assistants.create(instructions:
            "instructions", name: "name")


            puts(inference_embedding)
        - lang: PHP
          source: >-
            <?php


            require_once dirname(__DIR__) . '/vendor/autoload.php';


            use Telnyx\Client;

            use Telnyx\AI\Assistants\EnabledFeatures;

            use Telnyx\Core\Exceptions\APIException;


            $client = new Client(apiKey: getenv('TELNYX_API_KEY') ?: 'My API
            Key');


            try {
              $inferenceEmbedding = $client->ai->assistants->create(
                instructions: 'instructions',
                name: 'name',
                conversationFlow: [
                  'nodes' => [
                    [
                      'id' => 'n_intake',
                      'instructions' => 'Greet the caller and ask what they\'re calling about.',
                      'externalLlm' => [
                        'baseURL' => 'base_url',
                        'model' => 'model',
                        'authenticationMethod' => 'token',
                        'certificateRef' => 'certificate_ref',
                        'forwardMetadata' => true,
                        'llmAPIKeyRef' => 'llm_api_key_ref',
                        'tokenRetrievalURL' => 'token_retrieval_url',
                      ],
                      'instructionsMode' => 'replace',
                      'llmAPIKeyRef' => 'my-key-ref',
                      'model' => 'moonshotai/Kimi-K2.6',
                      'name' => 'Intake',
                      'position' => ['x' => 120, 'y' => 80],
                      'sharedToolIDs' => ['tool-faq-kb'],
                      'toolsMode' => 'replace',
                      'transcription' => [
                        'apiKeyRef' => 'api_key_ref',
                        'language' => 'language',
                        'model' => 'deepgram/flux',
                        'region' => 'region',
                        'settings' => [
                          'eagerEotThreshold' => 0.3,
                          'enableEndpointDetection' => true,
                          'endOfTurnConfidenceThreshold' => 0,
                          'eotThreshold' => 0.5,
                          'eotTimeoutMs' => 500,
                          'interimResults' => true,
                          'keyterm' => 'keyterm',
                          'maxEndpointDelayMs' => 500,
                          'maxTurnSilence' => 100,
                          'minTurnSilence' => 100,
                          'numerals' => true,
                          'smartFormat' => true,
                        ],
                      ],
                      'type' => 'prompt',
                      'voiceSettings' => [
                        'voice' => 'voice',
                        'apiKeyRef' => 'api_key_ref',
                        'backgroundAudio' => [
                          'type' => 'predefined_media',
                          'value' => 'silence',
                          'volume' => 0.1,
                        ],
                        'expressiveMode' => true,
                        'languageBoost' => 'auto',
                        'similarityBoost' => 0,
                        'speed' => 0,
                        'style' => 0,
                        'temperature' => 0,
                        'useSpeakerBoost' => true,
                        'voiceSpeed' => 0,
                      ],
                    ],
                    [
                      'id' => 'n_billing',
                      'instructions' => 'Focus on billing questions. Look up the caller\'s latest invoice with the billing tool before answering.',
                      'externalLlm' => [
                        'baseURL' => 'base_url',
                        'model' => 'model',
                        'authenticationMethod' => 'token',
                        'certificateRef' => 'certificate_ref',
                        'forwardMetadata' => true,
                        'llmAPIKeyRef' => 'llm_api_key_ref',
                        'tokenRetrievalURL' => 'token_retrieval_url',
                      ],
                      'instructionsMode' => 'append',
                      'llmAPIKeyRef' => 'my-key-ref',
                      'model' => 'moonshotai/Kimi-K2.6',
                      'name' => 'Billing',
                      'position' => ['x' => 420, 'y' => 80],
                      'sharedToolIDs' => ['tool-billing-lookup'],
                      'toolsMode' => 'append',
                      'transcription' => [
                        'apiKeyRef' => 'api_key_ref',
                        'language' => 'language',
                        'model' => 'deepgram/flux',
                        'region' => 'region',
                        'settings' => [
                          'eagerEotThreshold' => 0.3,
                          'enableEndpointDetection' => true,
                          'endOfTurnConfidenceThreshold' => 0,
                          'eotThreshold' => 0.5,
                          'eotTimeoutMs' => 500,
                          'interimResults' => true,
                          'keyterm' => 'keyterm',
                          'maxEndpointDelayMs' => 500,
                          'maxTurnSilence' => 100,
                          'minTurnSilence' => 100,
                          'numerals' => true,
                          'smartFormat' => true,
                        ],
                      ],
                      'type' => 'prompt',
                      'voiceSettings' => [
                        'voice' => 'voice',
                        'apiKeyRef' => 'api_key_ref',
                        'backgroundAudio' => [
                          'type' => 'predefined_media',
                          'value' => 'silence',
                          'volume' => 0.1,
                        ],
                        'expressiveMode' => true,
                        'languageBoost' => 'auto',
                        'similarityBoost' => 0,
                        'speed' => 0,
                        'style' => 0,
                        'temperature' => 0,
                        'useSpeakerBoost' => true,
                        'voiceSpeed' => 0,
                      ],
                    ],
                  ],
                  'startNodeID' => 'n_intake',
                  'edges' => [
                    [
                      'id' => 'e_intake_to_billing',
                      'condition' => [
                        'prompt' => 'The caller is asking about a bill or charge.',
                        'type' => 'llm',
                      ],
                      'startNodeID' => 'n_intake',
                      'target' => ['nodeID' => 'n_billing', 'type' => 'node'],
                    ],
                    [
                      'id' => 'e_intake_to_escalation_assistant',
                      'condition' => [
                        'prompt' => 'The caller has explicitly asked for a human.',
                        'type' => 'llm',
                      ],
                      'startNodeID' => 'n_intake',
                      'target' => [
                        'assistantID' => 'assistant-human-handoff',
                        'type' => 'assistant',
                        'position' => ['x' => 600, 'y' => 80],
                        'voiceMode' => 'distinct',
                      ],
                    ],
                  ],
                ],
                description: 'description',
                dynamicVariables: ['foo' => 'bar'],
                dynamicVariablesWebhookTimeoutMs: 1,
                dynamicVariablesWebhookURL: 'dynamic_variables_webhook_url',
                enabledFeatures: [EnabledFeatures::TELEPHONY],
                externalLlm: [
                  'baseURL' => 'base_url',
                  'model' => 'model',
                  'authenticationMethod' => 'token',
                  'certificateRef' => 'certificate_ref',
                  'forwardMetadata' => true,
                  'llmAPIKeyRef' => 'llm_api_key_ref',
                  'tokenRetrievalURL' => 'token_retrieval_url',
                ],
                fallbackConfig: [
                  'externalLlm' => [
                    'baseURL' => 'base_url',
                    'model' => 'model',
                    'authenticationMethod' => 'token',
                    'certificateRef' => 'certificate_ref',
                    'forwardMetadata' => true,
                    'llmAPIKeyRef' => 'llm_api_key_ref',
                    'tokenRetrievalURL' => 'token_retrieval_url',
                  ],
                  'llmAPIKeyRef' => 'llm_api_key_ref',
                  'model' => 'model',
                ],
                greeting: 'greeting',
                insightSettings: ['insightGroupID' => 'insight_group_id'],
                integrations: [
                  ['integrationID' => 'integration_id', 'allowedList' => ['string']]
                ],
                interruptionSettings: [
                  'disableGreetingInterruption' => true,
                  'enable' => true,
                  'startSpeakingPlan' => [
                    'transcriptionEndpointingPlan' => [
                      'onNoPunctuationSeconds' => 0,
                      'onNumberSeconds' => 0,
                      'onPunctuationSeconds' => 0,
                    ],
                    'waitSeconds' => 0,
                  ],
                ],
                llmAPIKeyRef: 'llm_api_key_ref',
                mcpServers: [['id' => 'id', 'allowedTools' => ['string']]],
                messagingSettings: [
                  'conversationInactivityMinutes' => 1,
                  'defaultMessagingProfileID' => 'default_messaging_profile_id',
                  'deliveryStatusWebhookURL' => 'delivery_status_webhook_url',
                ],
                model: 'model',
                observabilitySettings: [
                  'host' => 'host',
                  'promptLabel' => 'prompt_label',
                  'promptName' => 'prompt_name',
                  'promptSync' => 'enabled',
                  'promptVersion' => 1,
                  'publicKeyRef' => 'public_key_ref',
                  'secretKeyRef' => 'secret_key_ref',
                  'status' => 'enabled',
                ],
                postConversationSettings: ['enabled' => true],
                privacySettings: ['dataRetention' => true],
                tags: ['string'],
                telephonySettings: [
                  'defaultTexmlAppID' => 'default_texml_app_id',
                  'noiseSuppression' => 'krisp',
                  'noiseSuppressionConfig' => [
                    'attenuationLimit' => 0, 'mode' => 'advanced'
                  ],
                  'recordingSettings' => [
                    'channels' => 'single',
                    'enabled' => true,
                    'format' => 'wav',
                    'stopOnConversationEnd' => true,
                  ],
                  'supportsUnauthenticatedWebCalls' => true,
                  'timeLimitSecs' => 30,
                  'userIdleReplySecs' => 0,
                  'userIdleTimeoutSecs' => 10,
                  'voicemailDetection' => [
                    'onVoicemailDetected' => [
                      'action' => 'stop_assistant',
                      'voicemailMessage' => [
                        'message' => 'message', 'prompt' => 'prompt', 'type' => 'prompt'
                      ],
                    ],
                  ],
                ],
                toolIDs: ['string'],
                tools: [
                  [
                    'type' => 'webhook',
                    'webhook' => [
                      'description' => 'description',
                      'name' => 'name',
                      'url' => 'https://example.com/api/v1/function',
                      'async' => true,
                      'asyncTimeoutMs' => 1,
                      'bodyParameters' => [
                        'properties' => ['age' => 'bar', 'location' => 'bar'],
                        'required' => ['age', 'location'],
                        'type' => 'object',
                      ],
                      'headers' => [['name' => 'name', 'value' => 'value']],
                      'method' => 'GET',
                      'pathParameters' => [
                        'properties' => ['id' => 'bar'],
                        'required' => ['id'],
                        'type' => 'object',
                      ],
                      'queryParameters' => [
                        'properties' => ['page' => 'bar'],
                        'required' => ['page'],
                        'type' => 'object',
                      ],
                      'storeFieldsAsVariables' => [['name' => 'x', 'valuePath' => 'x']],
                      'timeoutMs' => 500,
                    ],
                  ],
                ],
                transcription: [
                  'apiKeyRef' => 'api_key_ref',
                  'language' => 'language',
                  'model' => 'deepgram/flux',
                  'region' => 'region',
                  'settings' => [
                    'eagerEotThreshold' => 0.3,
                    'enableEndpointDetection' => true,
                    'endOfTurnConfidenceThreshold' => 0,
                    'eotThreshold' => 0.5,
                    'eotTimeoutMs' => 500,
                    'interimResults' => true,
                    'keyterm' => 'keyterm',
                    'maxEndpointDelayMs' => 500,
                    'maxTurnSilence' => 100,
                    'minTurnSilence' => 100,
                    'numerals' => true,
                    'smartFormat' => true,
                  ],
                ],
                voiceSettings: [
                  'voice' => 'voice',
                  'apiKeyRef' => 'api_key_ref',
                  'backgroundAudio' => [
                    'type' => 'predefined_media', 'value' => 'silence', 'volume' => 0.1
                  ],
                  'expressiveMode' => true,
                  'languageBoost' => 'auto',
                  'similarityBoost' => 0,
                  'speed' => 0,
                  'style' => 0,
                  'temperature' => 0,
                  'useSpeakerBoost' => true,
                  'voiceSpeed' => 0,
                ],
                widgetSettings: [
                  'agentThinkingText' => 'agent_thinking_text',
                  'audioVisualizerConfig' => ['color' => 'verdant', 'preset' => 'preset'],
                  'defaultState' => 'expanded',
                  'giveFeedbackURL' => 'give_feedback_url',
                  'logoIconURL' => 'logo_icon_url',
                  'position' => 'fixed',
                  'reportIssueURL' => 'report_issue_url',
                  'speakToInterruptText' => 'speak_to_interrupt_text',
                  'startCallText' => 'start_call_text',
                  'theme' => 'light',
                  'viewHistoryURL' => 'view_history_url',
                ],
              );

              var_dump($inferenceEmbedding);
            } catch (APIException $e) {
              echo $e->getMessage();
            }
        - lang: CLI
          source: |-
            telnyx ai:assistants create \
              --api-key 'My API Key' \
              --instructions instructions \
              --name name
components:
  parameters:
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: false
      description: >-
        Optional opaque, unquoted key for safely retrying the same logical
        request. Keys must contain 1 to 255 letters, numbers, hyphens, or
        underscores. Generate a unique UUID v4 for each operation and reuse it
        only when retrying that operation with the same request. Invalid
        headers—including duplicate, empty, malformed, or overlong values—return
        400 with error code 10015. A request already in progress with the same
        key returns 409; reusing the key with a different request returns 422.
        Only successful responses are replayed, for up to 24 hours. Do not
        include sensitive data in the key.
      schema:
        type: string
        minLength: 1
        maxLength: 255
        pattern: ^[A-Za-z0-9_-]{1,255}$
      example: 8e03978e-40d5-43e8-bc93-6894a57f9326
  schemas:
    CreateAssistantRequest:
      properties:
        name:
          type: string
        model:
          type: string
          description: >-
            ID of the model to use when `external_llm` is not set. You can use
            the [Get models
            API](https://developers.telnyx.com/api-reference/openai-chat/get-available-models-openai-compatible)
            to see available models. If `external_llm` is provided, the
            assistant uses `external_llm` instead of this field. If neither
            `model` nor `external_llm` is provided, Telnyx applies the default
            model.
        instructions:
          type: string
          description: >-
            System instructions for the assistant. These may be templated with
            [dynamic
            variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
        tools:
          $ref: '#/components/schemas/AssistantTools'
          description: >-
            Deprecated for new integrations. Inline tool definitions available
            to the assistant. Prefer `tool_ids` to attach shared tools created
            with the AI Tools endpoints.
        mcp_servers:
          type: array
          items:
            $ref: '#/components/schemas/AssistantMCPServer'
          default: []
          description: >-
            MCP servers attached to the assistant. Create MCP servers with
            `/ai/mcp_servers`, then reference them by `id` here.
        a2a_agents:
          type: array
          items:
            $ref: '#/components/schemas/AssistantA2AAgent'
          default: []
          description: >-
            A2A agents this assistant can delegate to. Tools are not stored
            here: at the start of every conversation each agent's card is
            fetched and one tool is derived per skill the card advertises, named
            `a2a_<name>_<skill_id>`. The following limits are not enforced when
            the assistant is saved, and anything past them is dropped when the
            conversation starts: 64 agents per assistant, 64 skills per card,
            128 derived tools per assistant, and a 6 second budget for all card
            fetches combined. An agent whose card cannot be fetched costs the
            assistant that capability for the conversation; it does not fail the
            call.
        tool_ids:
          title: Ids of shared tools
          items:
            type: string
          type: array
          description: >-
            IDs of shared tools to attach to the assistant. New integrations
            should prefer `tool_ids` over inline `tools`.
        description:
          type: string
        greeting:
          type: string
          description: >-
            Text that the assistant will use to start the conversation. This may
            be templated with [dynamic
            variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables).
            Use an empty string to have the assistant wait for the user to speak
            first. Use the special value
            `<assistant-speaks-first-with-model-generated-message>` to have the
            assistant generate the greeting based on the system instructions.
        llm_api_key_ref:
          type: string
          description: >-
            This is only needed when using third-party inference providers
            selected by `model`. The `identifier` for an integration secret
            [/v2/integration_secrets](https://developers.telnyx.com/api-reference/integration-secrets/create-a-secret)
            that refers to your LLM provider's API key. For bring-your-own
            endpoint authentication, use `external_llm.llm_api_key_ref` instead.
            Warning: Free plans are unlikely to work with this integration.
        external_llm:
          $ref: '#/components/schemas/ExternalLLMReq'
        fallback_config:
          $ref: '#/components/schemas/FallbackConfigReq'
        voice_settings:
          $ref: '#/components/schemas/VoiceSettings'
        transcription:
          $ref: '#/components/schemas/TranscriptionSettings'
        telephony_settings:
          $ref: '#/components/schemas/TelephonySettings'
        messaging_settings:
          $ref: '#/components/schemas/MessagingSettings'
        enabled_features:
          items:
            $ref: '#/components/schemas/EnabledFeatures'
          type: array
        insight_settings:
          $ref: '#/components/schemas/InsightSettings'
        privacy_settings:
          $ref: '#/components/schemas/PrivacySettings'
        dynamic_variables_webhook_url:
          type: string
          description: >-
            If `dynamic_variables_webhook_url` is set, Telnyx sends a POST
            request to this URL at the start of the conversation to resolve
            dynamic variables. **Gotcha:** the webhook response must wrap
            variables under a top-level `dynamic_variables` object, e.g.
            `{"dynamic_variables": {"customer_name": "Jane"}}`. Returning a flat
            object will be ignored and variables will fall back to their
            defaults. See the [dynamic variables
            guide](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
            for the full request/response format and timeout behavior.
        dynamic_variables_webhook_timeout_ms:
          type: integer
          minimum: 1
          maximum: 10000
          default: 1500
          description: >-
            Timeout in milliseconds for the dynamic variables webhook. Must be
            between 1 and 10000 ms. If the webhook does not respond within this
            timeout, the call proceeds with default values. See the [dynamic
            variables
            guide](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables).
        dynamic_variables:
          type: object
          description: Map of dynamic variables and their default values
          additionalProperties: true
        widget_settings:
          $ref: '#/components/schemas/WidgetSettings'
        interruption_settings:
          $ref: '#/components/schemas/InterruptionSettings'
        integrations:
          type: array
          items:
            $ref: '#/components/schemas/AssistantIntegration'
          default: []
          description: >-
            Connected integrations attached to the assistant. The catalog of
            available integrations is at `/ai/integrations`; the user's
            connected integrations are at `/ai/integrations/connections`. Each
            item references a catalog integration by `integration_id`.
        observability_settings:
          $ref: '#/components/schemas/ObservabilityReq'
        tags:
          type: array
          items:
            type: string
          default: []
          description: >-
            Tags associated with the assistant. Tags can also be managed with
            the assistant tag endpoints.
        post_conversation_settings:
          $ref: '#/components/schemas/PostConversationSettingsReq'
        delegation_settings:
          $ref: '#/components/schemas/DelegationSettings'
        websocket_settings:
          $ref: '#/components/schemas/WebsocketSettings'
        conversation_flow:
          $ref: '#/components/schemas/ConversationFlowReq'
      type: object
      required:
        - name
        - instructions
      title: CreateAssistantRequest
    Assistant:
      properties:
        id:
          type: string
        name:
          type: string
        created_at:
          type: string
          format: date-time
        version_id:
          type: string
          description: >-
            Identifier for the assistant version returned by version-aware
            assistant endpoints.
        version_created_at:
          type: string
          format: date-time
          description: Timestamp when this assistant version was created.
        description:
          type: string
        model:
          type: string
          description: >-
            ID of the model to use when `external_llm` is not set. You can use
            the [Get models
            API](https://developers.telnyx.com/api-reference/openai-chat/get-available-models-openai-compatible)
            to see available models. If `external_llm` is provided, the
            assistant uses `external_llm` instead of this field. If neither
            `model` nor `external_llm` is provided, Telnyx applies the default
            model.
        instructions:
          type: string
          description: >-
            System instructions for the assistant. These may be templated with
            [dynamic
            variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
        tools:
          $ref: '#/components/schemas/AssistantTools'
          description: >-
            The assistant's tools. Responses merge the assistant's shared Tools
            Library tools into this array alongside inline tools, each flagged
            `shared: true`; inline tools carry `shared: false`. On update, a
            sent `tools` array fully replaces the inline tools only — shared
            tools stay attached unless `tool_ids` changes. Each tool type except
            `function`, `webhook`, and `client_side_tool` allows at most one
            instance per assistant across both sources.
        mcp_servers:
          type: array
          items:
            $ref: '#/components/schemas/AssistantMCPServer'
          default: []
          description: >-
            MCP servers attached to the assistant. Create MCP servers with
            `/ai/mcp_servers`, then reference them by `id` here.
        a2a_agents:
          type: array
          items:
            $ref: '#/components/schemas/AssistantA2AAgent'
          default: []
          description: >-
            A2A agents this assistant can delegate to. Tools are not stored
            here: at the start of every conversation each agent's card is
            fetched and one tool is derived per skill the card advertises, named
            `a2a_<name>_<skill_id>`. The following limits are not enforced when
            the assistant is saved, and anything past them is dropped when the
            conversation starts: 64 agents per assistant, 64 skills per card,
            128 derived tools per assistant, and a 6 second budget for all card
            fetches combined. An agent whose card cannot be fetched costs the
            assistant that capability for the conversation; it does not fail the
            call.
        greeting:
          type: string
          description: >-
            Text that the assistant will use to start the conversation. This may
            be templated with [dynamic
            variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables).
            Use an empty string to have the assistant wait for the user to speak
            first. Use the special value
            `<assistant-speaks-first-with-model-generated-message>` to have the
            assistant generate the greeting based on the system instructions.
        llm_api_key_ref:
          type: string
          description: >-
            This is only needed when using third-party inference providers
            selected by `model`. The `identifier` for an integration secret
            [/v2/integration_secrets](https://developers.telnyx.com/api-reference/integration-secrets/create-a-secret)
            that refers to your LLM provider's API key. For bring-your-own
            endpoint authentication, use `external_llm.llm_api_key_ref` instead.
            Warning: Free plans are unlikely to work with this integration.
        external_llm:
          $ref: '#/components/schemas/ExternalLLM'
        fallback_config:
          $ref: '#/components/schemas/FallbackConfig'
        voice_settings:
          $ref: '#/components/schemas/VoiceSettings'
        transcription:
          $ref: '#/components/schemas/TranscriptionSettings'
        telephony_settings:
          $ref: '#/components/schemas/TelephonySettings'
        messaging_settings:
          $ref: '#/components/schemas/MessagingSettings'
        enabled_features:
          items:
            $ref: '#/components/schemas/EnabledFeatures'
          type: array
          uniqueItems: true
          title: Enabled Features
        insight_settings:
          $ref: '#/components/schemas/InsightSettings'
        privacy_settings:
          $ref: '#/components/schemas/PrivacySettings'
        dynamic_variables_webhook_url:
          type: string
          description: >-
            If `dynamic_variables_webhook_url` is set, Telnyx sends a POST
            request to this URL at the start of the conversation to resolve
            dynamic variables. **Gotcha:** the webhook response must wrap
            variables under a top-level `dynamic_variables` object, e.g.
            `{"dynamic_variables": {"customer_name": "Jane"}}`. Returning a flat
            object will be ignored and variables will fall back to their
            defaults. See the [dynamic variables
            guide](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
            for the full request/response format and timeout behavior.
        dynamic_variables_webhook_timeout_ms:
          type: integer
          minimum: 1
          maximum: 10000
          default: 1500
          description: >-
            Timeout in milliseconds for the dynamic variables webhook. Must be
            between 1 and 10000 ms. If the webhook does not respond within this
            timeout, the call proceeds with default values. See the [dynamic
            variables
            guide](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables).
        dynamic_variables:
          type: object
          description: Map of dynamic variables and their values
          additionalProperties: true
        import_metadata:
          $ref: '#/components/schemas/ImportMetadata'
        widget_settings:
          $ref: '#/components/schemas/WidgetSettings'
        interruption_settings:
          $ref: '#/components/schemas/InterruptionSettings'
        integrations:
          type: array
          items:
            $ref: '#/components/schemas/AssistantIntegration'
          default: []
          description: >-
            Connected integrations attached to the assistant. The catalog of
            available integrations is at `/ai/integrations`; the user's
            connected integrations are at `/ai/integrations/connections`. Each
            item references a catalog integration by `integration_id`.
        observability_settings:
          $ref: '#/components/schemas/Observability'
        version_name:
          type: string
          maxLength: 50
          default: New assistant
          description: Human-readable name for the assistant version.
        related_mission_ids:
          type: array
          items:
            type: string
          default: []
          description: IDs of missions related to this assistant.
        tags:
          type: array
          items:
            type: string
          default: []
          description: >-
            Tags associated with the assistant. Tags can also be managed with
            the assistant tag endpoints.
        post_conversation_settings:
          $ref: '#/components/schemas/PostConversationSettings'
        delegation_settings:
          $ref: '#/components/schemas/DelegationSettings'
        websocket_settings:
          $ref: '#/components/schemas/WebsocketSettings'
        conversation_flow:
          $ref: '#/components/schemas/ConversationFlow'
      type: object
      required:
        - id
        - name
        - created_at
        - model
        - instructions
    ErrorResponse:
      type: object
      properties:
        errors:
          type: array
          items:
            $ref: '#/components/schemas/ErrorObject'
      required:
        - errors
    HTTPValidationError:
      properties:
        detail:
          items:
            $ref: '#/components/schemas/ValidationError'
          type: array
          title: Detail
      type: object
      title: HTTPValidationError
      example:
        detail:
          - loc:
              - body
              - name
            msg: Field required
            type: missing
    AssistantTools:
      description: >-
        Deprecated for new integrations. Inline tool definitions available to
        the assistant. Prefer `tool_ids` to attach shared tools created with the
        AI Tools endpoints. On update, a sent `tools` array fully replaces the
        assistant's inline tools; omit the field to leave them unchanged. Each
        tool type except `function`, `webhook`, and `client_side_tool` allows at
        most one instance per assistant, counted across inline `tools` and
        shared `tool_ids` combined.
      type: array
      items:
        oneOf:
          - $ref: '#/components/schemas/FunctionTool'
          - $ref: '#/components/schemas/WebhookTool'
          - $ref: '#/components/schemas/ClientSideTool'
          - $ref: '#/components/schemas/RetrievalTool'
          - $ref: '#/components/schemas/HandoffTool'
          - $ref: '#/components/schemas/HangupTool'
          - $ref: '#/components/schemas/TransferTool'
          - $ref: '#/components/schemas/InviteTool'
          - $ref: '#/components/schemas/SIPReferTool'
          - $ref: '#/components/schemas/DTMFTool'
          - $ref: '#/components/schemas/SendMessageTool'
          - $ref: '#/components/schemas/SkipTurnTool'
          - $ref: '#/components/schemas/PayTool'
          - $ref: '#/components/schemas/UpdateDynamicVariablesTool'
    AssistantMCPServer:
      type: object
      title: AssistantMCPServer
      description: >-
        Reference to an MCP server attached to an assistant. Create and manage
        MCP servers with the `/ai/mcp_servers` endpoints, then attach them to
        assistants by ID.
      properties:
        id:
          type: string
          description: >-
            ID of the MCP server to attach. This must be the `id` of an MCP
            server returned by the `/ai/mcp_servers` endpoints.
        allowed_tools:
          type: array
          items:
            type: string
          description: >-
            Optional per-assistant allowlist of MCP tool names. When omitted,
            the assistant uses the MCP server's configured `allowed_tools`.
      required:
        - id
    AssistantA2AAgent:
      type: object
      title: AssistantA2AAgent
      description: >-
        A remote agent, reachable over the A2A (Agent2Agent) protocol, that an
        assistant can delegate to. Tools are not configured here: at the start
        of every conversation the agent's card is fetched and one tool is
        derived per skill the card advertises.
      properties:
        name:
          type: string
          maxLength: 43
          description: >-
            Identifies the agent and seeds the names of the tools derived from
            its card (`a2a_<name>_<skill_id>`). Characters outside
            `[A-Za-z0-9_]` are replaced with `_` before the tool name is built,
            so two agents whose names differ only in punctuation collide and are
            rejected.
          example: billing_agent
        url:
          type: string
          description: >-
            The agent's base URL, or the URL of its agent card. At most 2,048
            bytes once UTF-8 encoded. `/.well-known/agent-card.json` is appended
            to the path unless it already ends in `.json`. Must be an `http://`
            or `https://` URL for an externally reachable host: internal
            destinations (`localhost`, private and reserved IP ranges, `.local`
            domains) are rejected, and the hostname may not contain a `{{...}}`
            placeholder. Placeholders in the path are allowed.
          example: https://agents.example.com
        headers:
          type: array
          items:
            $ref: '#/components/schemas/A2AAgentHeader'
          description: >-
            Headers sent when fetching this agent's card and on every call made
            to it. Use them to authenticate to the agent.
        async:
          type: boolean
          default: false
          description: >-
            When `true`, the assistant hands the turn straight back to the model
            and the agent's answer is delivered into the conversation once it
            arrives, instead of the caller waiting for it in silence.
        timeout_ms:
          type: integer
          minimum: 1
          maximum: 4294967295
          description: >-
            Total budget, in milliseconds, for one call to this agent, including
            any time spent polling a task that is still running. Omit to inherit
            the assistant's tool timeout.
          example: 30000
        poll_interval_ms:
          type: integer
          minimum: 1
          maximum: 4294967295
          description: >-
            How often, in milliseconds, to poll an agent task that has not
            finished yet. Defaults to 500.
          example: 500
        messages:
          type: array
          description: >-
            Filler messages spoken while a call to this agent is in progress.
            `request_start` messages are spoken immediately when the call
            begins. `request_response_delayed` messages are spoken after
            `timing_ms` has elapsed only if the agent has not answered yet.
            Filler messages are not used when `async` is `true`.
          items:
            oneOf:
              - title: A2AAgentRequestStartMessage
                type: object
                required:
                  - type
                  - content
                properties:
                  type:
                    type: string
                    const: request_start
                    description: >-
                      Speak the filler message immediately when the call to the
                      agent begins.
                  content:
                    type: string
                    minLength: 1
                    description: The text the assistant speaks.
                  timing_ms:
                    type: integer
                    minimum: 100
                    maximum: 120000
                    description: >-
                      An optional delay value. This value is ignored for
                      `request_start` messages.
                additionalProperties: false
              - title: A2AAgentRequestResponseDelayedMessage
                type: object
                required:
                  - type
                  - content
                  - timing_ms
                properties:
                  type:
                    type: string
                    const: request_response_delayed
                    description: >-
                      Speak the filler message only if the agent has not
                      answered yet after `timing_ms`.
                  content:
                    type: string
                    minLength: 1
                    description: The text the assistant speaks.
                  timing_ms:
                    type: integer
                    minimum: 100
                    maximum: 120000
                    description: >-
                      How long to wait, in milliseconds, before speaking this
                      message.
                additionalProperties: false
      required:
        - name
        - url
    ExternalLLMReq:
      properties:
        model:
          type: string
          description: Model identifier to use with the external LLM endpoint.
        base_url:
          type: string
          description: Base URL for the external LLM endpoint.
        llm_api_key_ref:
          type: string
          description: Integration secret identifier for the external LLM API key.
        authentication_method:
          $ref: '#/components/schemas/AuthenticationMethod'
        certificate_ref:
          type: string
          description: >-
            Integration secret identifier for the client certificate used with
            certificate authentication.
        token_retrieval_url:
          type: string
          description: >-
            URL used to retrieve an access token when certificate authentication
            is enabled.
        forward_metadata:
          type: boolean
          default: false
          description: >-
            When `true`, Telnyx forwards the assistant's dynamic variables to
            the external LLM endpoint as a top-level `extra_metadata` object on
            the chat completion request body. Defaults to `false`. Example
            payload sent to the external endpoint: `{"extra_metadata":
            {"customer_name": "Jane", "account_id": "acct_789",
            "telnyx_agent_target": "+13125550100", "telnyx_end_user_target":
            "+13125550123"}}`. Distinct from OpenAI's native `metadata` field,
            which has its own size and type limits.
      type: object
      required:
        - model
        - base_url
      title: ExternalLLMReq
    FallbackConfigReq:
      properties:
        model:
          type: string
          description: >-
            Fallback Telnyx-hosted model to use when the primary LLM provider is
            unavailable.
        llm_api_key_ref:
          type: string
          description: Integration secret identifier for the fallback model API key.
        external_llm:
          $ref: '#/components/schemas/ExternalLLMReq'
      type: object
      title: FallbackConfigReq
    VoiceSettings:
      properties:
        voice:
          type: string
          description: >-
            The voice to be used by the voice assistant. Check the full list of
            [available
            voices](https://developers.telnyx.com/docs/tts-stt/tts-available-voices)
            via our voices API.

            To use ElevenLabs, you must reference your ElevenLabs API key as an
            integration secret under the `api_key_ref` field. See [integration
            secrets
            documentation](https://developers.telnyx.com/api-reference/integration-secrets/create-a-secret)
            for details. For Telnyx voices, use `Telnyx.<model_id>.<voice_id>`
            (e.g. Telnyx.KokoroTTS.af_heart). For Soniox voices, use
            `Soniox.tts-rt-v2.<voice_id>` (e.g. Soniox.tts-rt-v2.Emma); every
            Soniox voice speaks all supported languages.

            The voice portion of the identifier supports [dynamic
            variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
            using mustache syntax (e.g. `Telnyx.Ultra.{{voice_id}}`). The
            variable is resolved at call time from your dynamic variables
            webhook, allowing you to select the voice dynamically per call.
        voice_speed:
          type: number
          default: 1
          description: >-
            The speed of the voice in the range [0.6, 1.5]. 1.0 is the default
            speed. Larger numbers make the voice faster, smaller numbers make it
            slower. Applies to Telnyx `Ultra` voices; values outside this range
            are rejected by the synthesis engine. Soniox voices support a speed
            range of 0.7 to 1.3.
        api_key_ref:
          type: string
          description: >-
            The `identifier` for an integration secret
            [/v2/integration_secrets](https://developers.telnyx.com/api-reference/integration-secrets/create-a-secret)
            that refers to your ElevenLabs API key. Warning: Free plans are
            unlikely to work with this integration.
        temperature:
          type: number
          default: 0.5
          description: >-
            Determines how stable the voice is and the randomness between each
            generation. Lower values create a broader emotional range; higher
            values produce more consistent, monotonous output. Only applicable
            when using ElevenLabs.
        similarity_boost:
          type: number
          default: 0.75
          description: >-
            Determines how closely the AI should adhere to the original voice
            when attempting to replicate it. Only applicable when using
            ElevenLabs.
        use_speaker_boost:
          type: boolean
          default: true
          description: >-
            Amplifies similarity to the original speaker voice. Increases
            computational load and latency slightly. Only applicable when using
            ElevenLabs.
        style:
          type: number
          default: 0
          description: >-
            Determines the style exaggeration of the voice. Amplifies speaker
            style but consumes additional resources when set above 0. Only
            applicable when using ElevenLabs.
        speed:
          type: number
          default: 1
          description: >-
            Adjusts speech velocity. 1.0 is default speed; values less than 1.0
            slow speech; values greater than 1.0 accelerate it. Only applicable
            when using ElevenLabs.
        language_boost:
          type:
            - string
            - 'null'
          description: >-
            Enhances recognition for specific languages and dialects during
            MiniMax TTS synthesis. Default is null (no boost). Set to 'auto' for
            automatic language detection. Only applicable when using MiniMax
            voices.
          enum:
            - null
            - auto
            - Chinese
            - Chinese,Yue
            - English
            - Arabic
            - Russian
            - Spanish
            - French
            - Portuguese
            - German
            - Turkish
            - Dutch
            - Ukrainian
            - Vietnamese
            - Indonesian
            - Japanese
            - Italian
            - Korean
            - Thai
            - Polish
            - Romanian
            - Greek
            - Czech
            - Finnish
            - Hindi
            - Bulgarian
            - Danish
            - Hebrew
            - Malay
            - Persian
            - Slovak
            - Swedish
            - Croatian
            - Filipino
            - Hungarian
            - Norwegian
            - Slovenian
            - Catalan
            - Nynorsk
            - Tamil
            - Afrikaans
          default: null
        expressive_mode:
          type: boolean
          default: false
          description: >-
            Enables emotionally expressive speech using SSML emotion tags. When
            enabled, the assistant uses audio tags like angry, excited, content,
            and sad to add emotional nuance. Only supported for Telnyx Ultra
            voices.
        background_audio:
          description: >-
            Optional background audio to play on the call. Use a predefined
            media bed, or supply a looped MP3 URL. If a media URL is chosen in
            the portal, customers can preview it before saving.
          oneOf:
            - type: object
              properties:
                type:
                  type: string
                  enum:
                    - predefined_media
                  description: Select from predefined media options.
                value:
                  type: string
                  enum:
                    - silence
                    - office
                  default: silence
                  description: >-
                    The predefined media to use. `silence` disables background
                    audio.
                volume:
                  type: number
                  minimum: 0.1
                  maximum: 1
                  multipleOf: 0.1
                  default: 1
                  description: >-
                    Volume level for the predefined background audio. Supports
                    values from 0.1 to 1.0 in 0.1 increments.
              required:
                - type
                - value
            - type: object
              properties:
                type:
                  type: string
                  enum:
                    - media_url
                  description: >-
                    Provide a direct URL to an MP3 file. The audio will loop
                    during the call.
                value:
                  type: string
                  format: uri
                  description: HTTPS URL to an MP3 file.
              required:
                - type
                - value
            - type: object
              properties:
                type:
                  type: string
                  enum:
                    - media_name
                  description: >-
                    Reference a previously uploaded media by its name from
                    Telnyx Media Storage.
                value:
                  type: string
                  description: >-
                    The `name` of a media asset created via [Media Storage
                    API](https://developers.telnyx.com/api/media-storage/create-media-storage).
                    The audio will loop during the call.
              required:
                - type
                - value
      type: object
      required:
        - voice
    TranscriptionSettings:
      properties:
        model:
          type: string
          enum:
            - deepgram/flux
            - deepgram/nova-3
            - deepgram/nova-2
            - azure/fast
            - assemblyai/universal-3-5-pro
            - assemblyai/universal-streaming
            - xai/grok-stt
            - soniox/stt-rt-v4
            - soniox/stt-rt-v5
            - nvidia/parakeet-v3
            - omi-health/omi-med-stt-v1
            - humain/realtime
            - reson8/turns
            - cohere/ar-stt
            - distil-whisper/distil-large-v2
            - openai/whisper-large-v3-turbo
          description: >-
            The speech to text model to be used by the voice assistant. All
            Deepgram models are run on-premise.


            - `deepgram/flux` is optimized for turn-taking with multilingual
            language hints.

            - `deepgram/nova-3` is multilingual with automatic language
            detection.

            - `deepgram/nova-2` is Deepgram's previous-generation multilingual
            model.

            - `azure/fast` is a multilingual Azure transcription model.

            - `assemblyai/universal-3-5-pro` is a multilingual streaming model
            with configurable turn detection. The legacy alias
            `assemblyai/universal-streaming` is still accepted and resolves to
            the same model.

            - `xai/grok-stt` is a multilingual Grok STT model.

            - `soniox/stt-rt-v4` and `soniox/stt-rt-v5` are multilingual
            streaming models with automatic language detection, configurable
            endpointing, term biasing (`context`), and `language_hints`.

            - `nvidia/parakeet-v3` is a multilingual transcription model with
            automatic language detection.

            - `omi-health/omi-med-stt-v1` is an English-only medical
            transcription model (Parakeet-based).

            - `humain/realtime` is a streaming model with native Arabic and
            Arabic/English code-switching support.

            - `reson8/turns` is a turn-based streaming model covering 10
            European languages with automatic language detection.

            - `cohere/ar-stt` is a non-streaming Arabic and English
            transcription model.
        language:
          type: string
          description: >-
            The language of the audio to be transcribed. If not set, or if set
            to `auto`, supported models will automatically detect the language.
            For `deepgram/flux`, supported values are: `auto` (Telnyx language
            detection controls the language hint), `multi` (no language hint),
            and language-specific hints `en`, `es`, `fr`, `de`, `hi`, `ru`,
            `pt`, `ja`, `it`, and `nl`. For `soniox/stt-rt-v4` and
            `soniox/stt-rt-v5`, `auto` omits the language hint and lets Soniox
            auto-detect; ISO 639-1 codes (e.g. `en`, `es`) bias detection toward
            that language; `settings.language_hints` can pin multiple languages
            at once instead. For `humain/realtime`, supported values are `ar`,
            `en`, `codeswitch` (Arabic/English code-switching), and `auto`
            (resolves server-side to code-switching). Unlike other models,
            `humain/realtime` does not fall back to `auto` when `language` is
            omitted — omitting it applies `en` instead. For `reson8/turns`,
            supported values are `auto` (or unset) for automatic language
            detection, and the language codes `nl`, `en`, `fr`, `fy`, `de`,
            `it`, `pl`, `pt`, `es`, and `sv` to fix the transcription language.
            For `cohere/ar-stt`, supported values are `ar` and `en`; unlike
            other models, this model does not auto-detect and defaults to `ar`
            when `language` is omitted.
        api_key_ref:
          title: Api Key Ref
          type: string
          description: >-
            Integration secret identifier for the transcription provider API
            key. Currently used for Azure transcription regions that require a
            customer-provided API key.
        region:
          title: Region
          type: string
          description: >-
            Region on third party cloud providers (currently Azure) if using one
            of their models. Some regions require `api_key_ref`.
        settings:
          $ref: '#/components/schemas/TranscriptionSettingsConfig'
      type: object
    TelephonySettings:
      properties:
        default_texml_app_id:
          type: string
          description: >-
            Default Texml App used for voice calls with your assistant. This
            will be created automatically on assistant creation.
        supports_unauthenticated_web_calls:
          type: boolean
          description: >-
            When enabled, allows users to interact with your AI assistant
            directly from your website without requiring authentication. This is
            required for FE widgets that work with assistants that have
            telephony enabled.
        noise_suppression:
          type: string
          enum:
            - aicoustics
            - krisp
            - deepfilternet
            - disabled
          description: >-
            The noise suppression engine to use. 'aicoustics' is STT-optimized
            and recommended for AI assistants (configure through
            noise_suppression_config). Use 'disabled' to turn off noise
            suppression.
        noise_suppression_config:
          type: object
          description: >-
            Configuration for noise suppression. Applicable fields depend on the
            engine: 'attenuation_limit' and 'mode' only when noise_suppression
            is 'deepfilternet'; 'family', 'size' and 'enhancement_level' only
            when noise_suppression is 'aicoustics'.
          properties:
            attenuation_limit:
              type: integer
              minimum: 0
              maximum: 100
              default: 100
              description: >-
                Attenuation limit for noise suppression. Range: 0-100. Only
                applicable when noise_suppression is 'deepfilternet'.
            mode:
              type: string
              enum:
                - advanced
              description: >-
                Mode for noise suppression configuration. Only applicable when
                noise_suppression is 'deepfilternet'.
            family:
              type: string
              enum:
                - quail
              description: >-
                AiCoustics model family optimized for Voice AI and STT. Only
                applicable when noise_suppression is 'aicoustics'.
            size:
              type: string
              enum:
                - vf
                - vf_2_0_l
              description: >-
                AiCoustics model size. 'vf' tracks the latest model release;
                'vf_2_0_l' is pinned to version 2.0 for consistent, predictable
                behavior. Only applicable when noise_suppression is
                'aicoustics'.
            enhancement_level:
              type: number
              minimum: 0
              maximum: 1
              default: 0.8
              description: >-
                AiCoustics enhancement intensity. Range: 0-1. Only applicable
                when noise_suppression is 'aicoustics'.
        time_limit_secs:
          type: integer
          minimum: 30
          maximum: 14400
          default: 1800
          description: >-
            Maximum duration in seconds for the AI assistant to participate on
            the call. When this limit is reached the assistant will be stopped.
            This limit does not apply to portions of a call without an active
            assistant (for instance, a call transferred to a human
            representative).
        user_idle_timeout_secs:
          type: integer
          minimum: 10
          maximum: 14400
          description: >-
            Maximum duration in seconds of end user silence on the call. When
            this limit is reached the assistant will be stopped. This limit does
            not apply to portions of a call without an active assistant (for
            instance, a call transferred to a human representative).
        user_idle_reply_secs:
          type: integer
          minimum: 0
          default: 10
          description: >-
            Duration in seconds of end user silence before the assistant checks
            in on the user. When this limit is reached the assistant will prompt
            the user to respond. This is distinct from user_idle_timeout_secs
            which stops the assistant entirely.
        fallback_destination:
          type: string
          description: >-
            Destination number or SIP URI to transfer the caller to when the AI
            conversation ends abnormally, for example because of an
            assistant-side error, so the caller is not left in dead air. This
            only fires for abnormal ends: it does not fire when the conversation
            ends on purpose (the caller hung up, the assistant completed
            normally, the caller hung up after a relay handoff, or voicemail was
            detected), and it does not fire when the assistant already
            transferred or bridged the call.
        send_message_history_updates:
          type: boolean
          description: >-
            Whether the assistant sends a
            `call.ai_gather.message_history_updated` webhook with the full
            message history every time the conversation history changes. Leave
            unset to inherit the `send_message_history_updates` value from the
            `ai_assistant_start` or `gather_using_ai` command that started the
            conversation. Setting it here is authoritative: `true` turns the
            webhooks on even when the start command did not request them, and
            `false` turns them off even when it did. Messages exchanged during a
            private warm transfer acceptance phase are never included.
        voicemail_detection:
          type: object
          description: >-
            Configuration for voicemail detection (AMD - Answering Machine
            Detection) on outgoing calls. These settings only apply if AMD is
            enabled on the Dial command. See [TeXML Dial
            documentation](https://developers.telnyx.com/api-reference/texml-rest-commands/initiate-an-outbound-call)
            for enabling AMD. Recommended settings: MachineDetection=Enable,
            AsyncAmd=true, DetectionMode=Premium.
          properties:
            on_voicemail_detected:
              type: object
              description: Action to take when voicemail is detected.
              properties:
                action:
                  type: string
                  enum:
                    - stop_assistant
                    - leave_message_and_stop_assistant
                    - continue_assistant
                  description: The action to take when voicemail is detected.
                voicemail_message:
                  type: object
                  description: >-
                    Configuration for the voicemail message to leave. Only
                    applicable when action is
                    'leave_message_and_stop_assistant'.
                  properties:
                    type:
                      type: string
                      enum:
                        - prompt
                        - message
                      description: >-
                        The type of voicemail message. Use 'prompt' to have the
                        assistant generate a message based on a prompt, or
                        'message' to leave a specific message.
                    prompt:
                      type: string
                      description: >-
                        The prompt to use for generating the voicemail message.
                        Only applicable when type is 'prompt'.
                    message:
                      type: string
                      description: >-
                        The specific message to leave as voicemail. Only
                        applicable when type is 'message'.
        disable_dtmf:
          type: boolean
          default: false
          description: >-
            Disable inbound DTMF for the entire call. Must be set to true if a
            'pay' tool is configured anywhere on the assistant — on the main
            tool array or on any workflow node — enforced at write time.
        recording_settings:
          type: object
          description: Configuration for call recording format and channel settings.
          properties:
            enabled:
              type: boolean
              default: true
              description: >-
                Whether call recording is enabled. When set to false, calls will
                not be recorded regardless of other recording configuration.
            channels:
              type: string
              enum:
                - single
                - dual
              default: dual
              description: >-
                The number of channels for the recording. 'single' for mono,
                'dual' for stereo.
            format:
              type: string
              enum:
                - wav
                - mp3
              default: mp3
              description: The format of the recording file.
            stop_on_conversation_end:
              type: boolean
              default: false
              description: >-
                When enabled, the call recording will stop when the conversation
                ends (for example, when the assistant hangs up or the call is
                transferred). When disabled, recording continues until the call
                itself ends.
      type: object
      title: TelephonySettings
    MessagingSettings:
      properties:
        default_messaging_profile_id:
          type: string
          description: >-
            Default Messaging Profile used for messaging exchanges with your
            assistant. This will be created automatically on assistant creation.
        delivery_status_webhook_url:
          type: string
          description: >-
            The URL where webhooks related to delivery statused for assistant
            messages will be sent.
        conversation_inactivity_minutes:
          type: integer
          minimum: 1
          maximum: 10000000
          description: >-
            If more than this many minutes have passed since the last message,
            the assistant will start a new conversation instead of continuing
            the existing one.
      type: object
    EnabledFeatures:
      type: string
      enum:
        - telephony
        - messaging
      description: >-
        If `telephony` is enabled, the assistant will be able to make and
        receive calls. If `messaging` is enabled, the assistant will be able to
        send and receive messages.
    InsightSettings:
      properties:
        insight_group_id:
          type: string
          description: >-
            Reference to an Insight Group. Insights in this group will be run
            automatically for all the assistant's conversations.
      type: object
    PrivacySettings:
      properties:
        data_retention:
          type: boolean
          description: >-
            If true, conversation history and insights will be stored. If false,
            they will not be stored. This in‑tool toggle governs solely the
            retention of conversation history and insights via the AI assistant.
            It has no effect on any separate recording, transcription, or
            storage configuration that you have set at the account, number, or
            application level. All such external settings remain in force
            regardless of your selection here.
        in_transit_data_locality:
          type: boolean
          default: false
          description: >-
            Requires every model call made for a web chat turn to be received
            and served inside your organization's data-locality region, rather
            than only stored there. Applies to web chat only — voice and
            messaging assistants are unaffected. Enabling it requires a
            data-locality region with in-region inference (USA, EU, AUS, UAE;
            see [Inference
            regions](https://developers.telnyx.com/docs/inference/models/regions))
            and Telnyx-hosted models for the assistant, its fallback, and any
            conversation-flow node that overrides the model; the request is
            rejected otherwise. Once enabled, send chat requests to your
            region's API hostname: a request entering the platform in another
            region is rejected rather than forwarded, because forwarding it
            would already have moved the content across the border. Defaults to
            false.
      type: object
    WidgetSettings:
      type: object
      properties:
        theme:
          type: string
          enum:
            - light
            - dark
          description: The visual theme for the widget.
        audio_visualizer_config:
          $ref: '#/components/schemas/AudioVisualizerConfig'
        start_call_text:
          type: string
          description: Custom text displayed on the start call button.
        default_state:
          type: string
          enum:
            - expanded
            - collapsed
          description: The default state of the widget.
        position:
          type: string
          enum:
            - fixed
            - static
          description: The positioning style for the widget.
        view_history_url:
          type:
            - string
            - 'null'
          description: URL to view conversation history.
        report_issue_url:
          type:
            - string
            - 'null'
          description: URL for users to report issues.
        give_feedback_url:
          type:
            - string
            - 'null'
          description: URL for users to give feedback.
        agent_thinking_text:
          type: string
          description: Text displayed while the agent is processing.
        speak_to_interrupt_text:
          type: string
          description: Text prompting users to speak to interrupt.
        logo_icon_url:
          type:
            - string
            - 'null'
          description: URL to a custom logo icon for the widget.
      title: WidgetSettings
      description: Configuration settings for the assistant's web widget.
    InterruptionSettings:
      type: object
      title: InterruptionSettings
      description: >-
        Settings for interruptions and how the assistant decides the user has
        finished speaking. These timings are most relevant when using non
        turn-taking transcription models. For turn-taking models like
        `deepgram/flux`, end-of-turn behavior is controlled by the transcription
        end-of-turn settings under `transcription.settings` (`eot_threshold`,
        `eot_timeout_ms`, `eager_eot_threshold`).
      properties:
        enable:
          type: boolean
          default: true
          description: Whether users can interrupt the assistant while it is speaking.
        disable_greeting_interruption:
          type: boolean
          description: >-
            When true, disables user interruptions while the assistant greeting
            is playing.
        start_speaking_plan:
          $ref: '#/components/schemas/StartSpeakingPlan'
        interrupt_prediction_threshold:
          type:
            - number
            - 'null'
          default: 0
          minimum: 0
          maximum: 1
          description: >-
            Interrupt-prediction sensitivity, from 0.0 to 1.0. Set to null or
            0.0 to disable interrupt prediction.
    AssistantIntegration:
      type: object
      title: AssistantIntegration
      description: >-
        Reference to a connected integration attached to an assistant. Discover
        available integrations with `/ai/integrations` and connected
        integrations with `/ai/integrations/connections`.
      properties:
        integration_id:
          type: string
          description: >-
            Catalog integration ID to attach. This is the `id` from the
            integrations catalog at `/ai/integrations` (the same value also
            appears as `integration_id` on entries returned by
            `/ai/integrations/connections`). It is **not** the connection-level
            `id` from `/ai/integrations/connections`.
        allowed_list:
          type: array
          items:
            type: string
          description: >-
            Optional per-assistant allowlist of integration tool names. When
            omitted or empty, all tools allowed by the connected integration are
            available to the assistant.
      required:
        - integration_id
    ObservabilityReq:
      properties:
        status:
          $ref: '#/components/schemas/ObservabilityStatus'
          default: disabled
        secret_key_ref:
          title: Secret Key Ref
          type: string
        public_key_ref:
          title: Public Key Ref
          type: string
        host:
          title: Host
          type: string
        prompt_name:
          title: Prompt Name
          type: string
        prompt_version:
          title: Prompt Version
          type: integer
          minimum: 1
        prompt_label:
          title: Prompt Label
          type: string
        prompt_sync:
          $ref: '#/components/schemas/PromptSyncStatus'
          default: disabled
      type: object
      title: ObservabilityReq
    PostConversationSettingsReq:
      type: object
      description: >-
        Configuration for post-conversation processing. When enabled, the
        assistant receives one additional LLM turn after the conversation ends,
        allowing it to execute final tool calls such as sending a summary or
        updating a record via webhook or function tools. Integration and MCP
        server tools are not available post-conversation; call-control tools
        (e.g. hangup, transfer) are also unavailable. Beta feature.
      properties:
        enabled:
          type: boolean
          description: >-
            Whether post-conversation processing is enabled. When true, the
            assistant will be invoked after the conversation ends to perform any
            final tool calls. Defaults to false.
          default: false
    DelegationSettings:
      type: object
      title: DelegationSettings
      description: >-
        Splits the conversation between a frontend model that talks to the
        caller and a backend model that does the work. On the GPT-Live route the
        frontend model cannot call tools at all — when it needs something done
        it raises a delegation and waits. On the chat completion route the
        frontend keeps a single `delegate` tool that returns immediately, so the
        conversation carries on while the backend works. Either way the
        backend's answer is spoken as commentary or kept as silent context,
        depending on `speak_results`. Beta feature.
      properties:
        enabled:
          type: boolean
          default: true
          description: >-
            Whether the assistant delegates work to a backend model. Defaults to
            `true`: a GPT-Live assistant with delegation disabled can hold a
            conversation but can never look anything up or run a tool.
        mode:
          type: string
          enum:
            - telnyx
            - client
          default: telnyx
          description: >-
            Who answers a delegation. `telnyx` runs the backend model on Telnyx
            with the assistant's own tools, MCP servers and observability.
            `client` relays the delegation to a server you host over the
            WebSocket configured in `websocket_settings`: Telnyx sends a
            `session.delegation.created` frame and waits for your
            `session.delegation.completed` answer. That answer is text only,
            since the socket offers no tool vocabulary. If no socket is
            connected the delegation is refused and the assistant tells the
            caller it cannot look things up right now. Defaults to `telnyx`.
        model:
          type: string
          description: >-
            The backend model that answers delegations. Must be a model
            available for AI Assistants. When enabling `telnyx` delegation,
            explicitly set this field or `external_llm.model`; a configuration
            without either backend model is rejected. Only applies when `mode`
            is `telnyx`.
        llm_api_key_ref:
          type: string
          description: >-
            Integration secret identifier for the backend model's API key.
            Required for models from providers other than Telnyx, OpenAI and
            Anthropic. A raw `api_key` is rejected rather than ignored, so that
            no plaintext credential is stored on the assistant.
        instructions:
          type: string
          description: >-
            Extra instructions for the backend model, in addition to the
            assistant's own. Use this for the business rules the backend needs
            and the talking model does not.
        speak_results:
          type: boolean
          default: true
          description: >-
            Whether the backend's answer is spoken to the caller. When `true`
            the result is appended as commentary and paraphrased aloud; when
            `false` it is kept as silent context that informs later answers
            without being read out. Defaults to `true`.
        external_llm:
          allOf:
            - $ref: '#/components/schemas/ExternalLLM'
          description: >-
            Run the backend on your own OpenAI-compatible endpoint instead of a
            Telnyx-hosted model. As above, a raw `api_key` here is rejected —
            reference an integration secret with `external_llm.llm_api_key_ref`
            instead.
    WebsocketSettings:
      type: object
      title: WebsocketSettings
      description: >-
        Streams conversation and telephony events to a WebSocket server you
        host, and accepts messages injected back into the conversation. Telnyx
        opens the connection as a client, once per conversation. Delivery is
        best effort throughout: while the connection is down events are dropped
        rather than queued, and no socket failure is ever allowed to affect the
        call. Beta feature.
      properties:
        enabled:
          type: boolean
          default: false
          description: >-
            Whether Telnyx opens a WebSocket to `url` for each of this
            assistant's conversations. Defaults to `false`.
        url:
          type: string
          description: >-
            The `ws://` or `wss://` endpoint Telnyx connects to. Required when
            `enabled` is `true`. Must be externally reachable — localhost,
            private IP ranges and `.local` domains are rejected.
        auth_ref:
          type: string
          description: >-
            Integration secret identifier whose value Telnyx sends as an
            `Authorization: Bearer <value>` header on the upgrade request.
            Resolved on every connection attempt, so a rotated secret is picked
            up by the next reconnect.
    ConversationFlowReq:
      description: |-
        Conversation flow as supplied by API clients (create / update).

        A directed graph of `FlowNodeReq` connected by `FlowEdge`s. Validation
        enforces unique node/edge IDs, that `start_node_id` references a real
        node, and that every edge's endpoints reference real nodes.
      example:
        edges:
          - condition:
              prompt: The caller is asking about a bill or charge.
              type: llm
            id: e_intake_to_billing
            start_node_id: n_intake
            target:
              node_id: n_billing
              type: node
          - condition:
              prompt: The caller has explicitly asked for a human.
              type: llm
            id: e_intake_to_escalation_assistant
            start_node_id: n_intake
            target:
              assistant_id: assistant-human-handoff
              position:
                x: 600
                'y': 80
              type: assistant
              voice_mode: distinct
        nodes:
          - type: prompt
            id: n_intake
            instructions: Greet the caller and ask what they're calling about.
            name: Intake
            position:
              x: 120
              'y': 80
            shared_tool_ids:
              - tool-faq-kb
          - type: prompt
            id: n_billing
            instructions: >-
              Focus on billing questions. Look up the caller's latest invoice
              with the billing tool before answering.
            instructions_mode: append
            model: moonshotai/Kimi-K2.6
            name: Billing
            position:
              x: 420
              'y': 80
            shared_tool_ids:
              - tool-billing-lookup
            tools_mode: append
        start_node_id: n_intake
      properties:
        edges:
          description: >-
            Directed transitions between nodes. May be empty for a single-node
            flow.
          items:
            $ref: '#/components/schemas/FlowEdge'
          title: Edges
          type: array
        nodes:
          description: >-
            All nodes in the flow. Must contain `start_node_id`. Each node is a
            prompt node (`type: prompt`), a tool node (`type: tool`), or a speak
            node (`type: speak`).
          items:
            discriminator:
              mapping:
                prompt:
                  $ref: '#/components/schemas/FlowNodeReq'
                tool:
                  $ref: '#/components/schemas/ToolNodeReq'
                speak:
                  $ref: '#/components/schemas/SpeakNodeReq'
              propertyName: type
            oneOf:
              - $ref: '#/components/schemas/FlowNodeReq'
              - $ref: '#/components/schemas/ToolNodeReq'
              - $ref: '#/components/schemas/SpeakNodeReq'
          title: Nodes
          type: array
        start_node_id:
          description: ID of the node where the conversation begins.
          example: n_intake
          title: Start Node Id
          type: string
      required:
        - start_node_id
        - nodes
      title: ConversationFlowReq
      type: object
    ExternalLLM:
      properties:
        model:
          type: string
          description: Model identifier to use with the external LLM endpoint.
        base_url:
          type: string
          description: Base URL for the external LLM endpoint.
        llm_api_key_ref:
          type: string
          description: Integration secret identifier for the external LLM API key.
        authentication_method:
          $ref: '#/components/schemas/AuthenticationMethod'
        certificate_ref:
          type: string
          description: >-
            Integration secret identifier for the client certificate used with
            certificate authentication.
        token_retrieval_url:
          type: string
          description: >-
            URL used to retrieve an access token when certificate authentication
            is enabled.
        forward_metadata:
          type: boolean
          default: false
          description: >-
            When `true`, Telnyx forwards the assistant's dynamic variables to
            the external LLM endpoint as a top-level `extra_metadata` object on
            the chat completion request body. Defaults to `false`. Example
            payload sent to the external endpoint: `{"extra_metadata":
            {"customer_name": "Jane", "account_id": "acct_789",
            "telnyx_agent_target": "+13125550100", "telnyx_end_user_target":
            "+13125550123"}}`. Distinct from OpenAI's native `metadata` field,
            which has its own size and type limits.
      type: object
      required:
        - model
        - base_url
      title: ExternalLLM
    FallbackConfig:
      properties:
        model:
          type: string
          description: >-
            Fallback Telnyx-hosted model to use when the primary LLM provider is
            unavailable.
        llm_api_key_ref:
          type: string
          description: Integration secret identifier for the fallback model API key.
        external_llm:
          $ref: '#/components/schemas/ExternalLLM'
      type: object
      title: FallbackConfig
    ImportMetadata:
      properties:
        import_provider:
          type: string
          enum:
            - elevenlabs
            - vapi
            - retell
          description: Provider the assistant was imported from.
        import_id:
          type: string
          description: ID of the assistant in the provider's system.
      type: object
    Observability:
      properties:
        status:
          $ref: '#/components/schemas/ObservabilityStatus'
          default: disabled
        secret_key_ref:
          title: Secret Key Ref
          type: string
        public_key_ref:
          title: Public Key Ref
          type: string
        host:
          title: Host
          type: string
        prompt_name:
          title: Prompt Name
          type: string
        prompt_version:
          title: Prompt Version
          type: integer
          minimum: 1
        prompt_label:
          title: Prompt Label
          type: string
        prompt_sync:
          $ref: '#/components/schemas/PromptSyncStatus'
          default: disabled
      type: object
      title: Observability
    PostConversationSettings:
      type: object
      description: >-
        Configuration for post-conversation processing. When enabled, the
        assistant receives one additional LLM turn after the conversation ends,
        allowing it to execute final tool calls such as sending a summary or
        updating a record via webhook or function tools. Integration and MCP
        server tools are not available post-conversation; call-control tools
        (e.g. hangup, transfer) are also unavailable. Beta feature.
      properties:
        enabled:
          type: boolean
          description: >-
            Whether post-conversation processing is enabled. When true, the
            assistant will be invoked after the conversation ends to perform any
            final tool calls. Defaults to false.
          default: false
    ConversationFlow:
      description: Conversation flow as returned by the API.
      example:
        edges:
          - condition:
              prompt: The caller is asking about a bill or charge.
              type: llm
            id: e_intake_to_billing
            start_node_id: n_intake
            target:
              node_id: n_billing
              type: node
          - condition:
              prompt: The caller has explicitly asked for a human.
              type: llm
            id: e_intake_to_escalation_assistant
            start_node_id: n_intake
            target:
              assistant_id: assistant-human-handoff
              position:
                x: 600
                'y': 80
              type: assistant
              voice_mode: distinct
        nodes:
          - type: prompt
            id: n_intake
            instructions: Greet the caller and ask what they're calling about.
            name: Intake
            position:
              x: 120
              'y': 80
            shared_tool_ids:
              - tool-faq-kb
          - type: prompt
            id: n_billing
            instructions: >-
              Focus on billing questions. Look up the caller's latest invoice
              with the billing tool before answering.
            instructions_mode: append
            model: moonshotai/Kimi-K2.6
            name: Billing
            position:
              x: 420
              'y': 80
            shared_tool_ids:
              - tool-billing-lookup
            tools_mode: append
        start_node_id: n_intake
      properties:
        edges:
          description: Directed transitions between nodes.
          items:
            $ref: '#/components/schemas/FlowEdge'
          title: Edges
          type: array
        nodes:
          description: All nodes in the flow.
          items:
            discriminator:
              mapping:
                prompt:
                  $ref: '#/components/schemas/FlowNode'
                speak:
                  $ref: '#/components/schemas/SpeakNode'
                tool:
                  $ref: '#/components/schemas/ToolNode'
              propertyName: type
            oneOf:
              - $ref: '#/components/schemas/FlowNode'
              - $ref: '#/components/schemas/ToolNode'
              - $ref: '#/components/schemas/SpeakNode'
          title: Nodes
          type: array
        start_node_id:
          description: ID of the node where the conversation begins.
          title: Start Node Id
          type: string
      required:
        - start_node_id
        - nodes
      title: ConversationFlow
      type: object
    ErrorObject:
      type: object
      properties:
        code:
          type: string
          description: >-
            Telnyx error code. Edge idempotency errors use 10015, 10027, or
            10036; idempotency protection outages use 10016; replay-cap 413s
            surface 10007. Fallback 404/500 responses from the framework may use
            string status codes ('404', '500') instead.
          enum:
            - '10007'
            - '10015'
            - '10016'
            - '10027'
            - '10036'
            - '404'
            - '500'
        title:
          type: string
        detail:
          type: string
        source:
          type: object
          properties:
            pointer:
              type: string
      required:
        - code
        - title
    ValidationError:
      properties:
        loc:
          items:
            anyOf:
              - type: string
              - type: integer
          type: array
          title: Location
        msg:
          type: string
          title: Message
        type:
          type: string
          title: Error Type
      type: object
      required:
        - loc
        - msg
        - type
      title: ValidationError
    FunctionTool:
      properties:
        type:
          type: string
          enum:
            - function
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        function:
          $ref: '#/components/schemas/FunctionDefinition'
      type: object
      required:
        - type
        - function
      title: FunctionTool
    WebhookTool:
      properties:
        type:
          type: string
          enum:
            - webhook
        timeout_ms:
          type: integer
          default: 5000
          maximum: 60000
          description: >-
            The maximum number of milliseconds to wait for the webhook to
            respond before the tool call is aborted. Set this at the tool level,
            as a sibling of `type` — a `timeout_ms` nested inside the `webhook`
            object is stored but not applied, and the tool runs at this default
            instead. Applies when `webhook.async` is false.
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        webhook:
          $ref: '#/components/schemas/WebhookToolParams'
      type: object
      required:
        - type
        - webhook
      title: WebhookTool
    ClientSideTool:
      title: ClientSideTool
      type: object
      properties:
        type:
          type: string
          enum:
            - client_side_tool
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        client_side_tool:
          $ref: '#/components/schemas/ClientSideToolParams'
      required:
        - type
        - client_side_tool
    RetrievalTool:
      properties:
        type:
          type: string
          enum:
            - retrieval
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        retrieval:
          $ref: '#/components/schemas/BucketIds'
      type: object
      required:
        - type
        - retrieval
      title: RetrievalTool
    HandoffTool:
      description: >-
        The handoff tool allows the assistant to hand off control of the
        conversation to another AI assistant. By default, this will happen
        transparently to the end user.
      properties:
        type:
          type: string
          enum:
            - handoff
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        handoff:
          $ref: '#/components/schemas/HandoffToolParams'
      type: object
      required:
        - type
        - handoff
      title: HandoffTool
    HangupTool:
      properties:
        type:
          type: string
          enum:
            - hangup
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        hangup:
          $ref: '#/components/schemas/HangupToolParams'
      type: object
      required:
        - type
        - hangup
      title: HangupTool
    TransferTool:
      properties:
        type:
          type: string
          enum:
            - transfer
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        transfer:
          $ref: '#/components/schemas/InferenceEmbeddingTransferToolParams'
      type: object
      required:
        - type
        - transfer
      title: TransferTool
    InviteTool:
      properties:
        type:
          type: string
          enum:
            - invite
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        invite:
          $ref: '#/components/schemas/InviteToolConfig'
          title: InviteToolConfig
      type: object
      required:
        - type
        - invite
      title: InviteTool
    SIPReferTool:
      properties:
        type:
          type: string
          enum:
            - refer
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        refer:
          $ref: '#/components/schemas/SIPReferToolParams'
      type: object
      required:
        - type
        - refer
      title: SIPReferTool
    DTMFTool:
      properties:
        type:
          type: string
          enum:
            - send_dtmf
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        send_dtmf:
          type: object
          additionalProperties: true
      type: object
      required:
        - type
        - send_dtmf
      title: DTMFTool
    SendMessageTool:
      description: >-
        The send_message tool allows the assistant to send SMS or MMS messages
        to the end user. The 'to' and 'from' addresses are automatically
        determined from the conversation context, and the message text is
        generated by the assistant unless a message_template is provided for
        runtime variable substitution.
      properties:
        type:
          type: string
          enum:
            - send_message
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        send_message:
          type: object
          properties:
            message_template:
              type:
                - string
                - 'null'
              description: >-
                Optional message template with dynamic variable support using
                mustache syntax (e.g., {{variable_name}}). When set, the
                assistant will use this template for the SMS body instead of
                generating one. Dynamic variables like
                {{telnyx_end_user_target}}, {{telnyx_agent_target}}, and custom
                webhook-provided variables will be resolved at runtime.
          additionalProperties: true
      type: object
      required:
        - type
        - send_message
      title: SendMessageTool
    SkipTurnTool:
      properties:
        type:
          type: string
          enum:
            - skip_turn
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        skip_turn:
          $ref: '#/components/schemas/SkipTurnToolParams'
      type: object
      required:
        - type
        - skip_turn
      title: SkipTurnTool
    PayTool:
      description: >-
        (BETA) The pay tool allows the assistant to collect card payments from
        the caller via DTMF during the conversation. Recording is automatically
        paused while the pay tool is active and resumes when the payment flow
        completes. The connector_name must reference a pay connector configured
        in the Telnyx API.
      properties:
        type:
          type: string
          enum:
            - pay
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        pay:
          $ref: '#/components/schemas/PayToolParams'
      type: object
      required:
        - type
        - pay
      title: PayTool
    UpdateDynamicVariablesTool:
      description: >-
        The update_dynamic_variables tool lets the assistant write values into
        the conversation's dynamic-variables context during the call. Updated
        variables are available to later `{{variable}}` interpolation (prompts,
        speak nodes, message templates) and to flow edge conditions. Declare
        each variable the assistant is allowed to set under
        `updatable_variables`.
      properties:
        type:
          type: string
          enum:
            - update_dynamic_variables
        shared:
          type: boolean
          description: >-
            Whether this tool comes from the shared Tools Library. Responses
            merge shared tools into `tools` with `shared: true`; inline tools
            carry `shared: false`. Read-only: set by the server, not accepted in
            requests. When updating an assistant, omit `shared: true` tools from
            the request `tools` array and manage them through `tool_ids` instead
            — re-sending their definitions creates an inline duplicate (rejected
            with error code 10015 when the type allows only one instance per
            assistant).
          readOnly: true
        update_dynamic_variables:
          $ref: '#/components/schemas/UpdateDynamicVariablesToolParams'
      type: object
      required:
        - type
        - update_dynamic_variables
      title: UpdateDynamicVariablesTool
    A2AAgentHeader:
      type: object
      title: A2AAgentHeader
      description: >-
        A header sent when fetching an A2A agent's card and on every call made
        to that agent.
      properties:
        name:
          type: string
          description: >-
            HTTP header name. May only contain alphanumeric characters, hyphens,
            and underscores, or a `{{dynamic_variable}}` placeholder surrounded
            by those characters.
          example: X-Api-Key
        value:
          type: string
          description: >-
            Header value, stored exactly as written. It may be a literal, a
            `{{dynamic_variable}}`, or an
            `{{#integration_secret}}identifier{{/integration_secret}}` section
            that resolves to a stored integration secret when the conversation
            starts. Control characters are not allowed. The encrypted
            `{{variable | encryption_secret_ref}}` form used for per-caller
            credentials is not resolved here and is rejected when the assistant
            is saved.
          example: '{{#integration_secret}}my_agent_api_key{{/integration_secret}}'
      required:
        - name
        - value
    AuthenticationMethod:
      type: string
      enum:
        - token
        - certificate
      default: token
      description: Authentication method used when connecting to the external LLM endpoint.
      title: AuthenticationMethod
    TranscriptionSettingsConfig:
      properties:
        smart_format:
          title: Smart Format
          type: boolean
        numerals:
          title: Numerals
          type: boolean
        eot_threshold:
          title: Eot Threshold
          type: number
          description: >-
            Available only for deepgram/flux. Confidence required to trigger an
            end of turn. Higher values = more reliable turn detection but
            slightly increased latency.
          minimum: 0.5
          maximum: 0.9
          default: 0.8
        eot_timeout_ms:
          title: Eot Timeout Ms
          type: integer
          description: >-
            Available only for deepgram/flux. Maximum milliseconds of silence
            before forcing an end of turn, regardless of confidence.
          minimum: 500
          maximum: 10000
          default: 5000
        eager_eot_threshold:
          title: Eager Eot Threshold
          type: number
          minimum: 0.3
          maximum: 0.9
          default: 0.8
          description: >-
            Available only for deepgram/flux. Confidence threshold for eager end
            of turn detection. Must be lower than or equal to eot_threshold.
            Setting this equal to eot_threshold effectively disables eager end
            of turn.
        keyterm:
          title: Keyterm
          type: string
          description: >-
            Available only for deepgram/nova-3 and deepgram/flux. A
            comma-separated list of key terms to boost for recognition during
            transcription. Helps improve accuracy for domain-specific
            terminology, proper nouns, or uncommon words. This field may be
            templated with [dynamic
            variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
            using mustache syntax (e.g. `Telnyx,{{customer_name}},VoIP`).
            Variables are resolved at call time before the value is sent to the
            speech-to-text engine.
        end_of_turn_confidence_threshold:
          title: End Of Turn Confidence Threshold
          type: number
          minimum: 0
          maximum: 1
          default: 0.4
          description: >-
            Available only for assemblyai/universal-3-5-pro (and its legacy
            alias assemblyai/universal-streaming). Confidence level required to
            trigger an end of turn. Higher values require more certainty before
            ending a turn.
        min_turn_silence:
          title: Min Turn Silence
          type: integer
          minimum: 100
          maximum: 5000
          default: 400
          description: >-
            Available only for assemblyai/universal-3-5-pro (and its legacy
            alias assemblyai/universal-streaming). Minimum duration of silence
            in milliseconds before a turn can end. Must be less than or equal to
            max_turn_silence.
        max_turn_silence:
          title: Max Turn Silence
          type: integer
          minimum: 100
          maximum: 5000
          default: 1280
          description: >-
            Available only for assemblyai/universal-3-5-pro (and its legacy
            alias assemblyai/universal-streaming). Maximum duration of silence
            in milliseconds before forcing an end of turn.
        interim_results:
          title: Interim Results
          type: boolean
          default: false
          description: >-
            Available only for soniox/stt-rt-v4 and soniox/stt-rt-v5. When true,
            Soniox streams interim (non-final) results in addition to finalized
            transcripts.
        enable_endpoint_detection:
          title: Enable Endpoint Detection
          type: boolean
          default: false
          description: >-
            Available only for soniox/stt-rt-v4 and soniox/stt-rt-v5. When true,
            Soniox emits end-of-utterance events at the cadence configured by
            `max_endpoint_delay_ms`.
        max_endpoint_delay_ms:
          title: Max Endpoint Delay Ms
          type: integer
          minimum: 500
          maximum: 3000
          description: >-
            Available only for soniox/stt-rt-v4 and soniox/stt-rt-v5. Maximum
            silence (in milliseconds) before Soniox emits an end-of-utterance
            event. Only honored when `enable_endpoint_detection` is true.
        context:
          title: Context
          type: string
          maxLength: 10000
          description: >-
            Available only for soniox/stt-rt-v4 and soniox/stt-rt-v5. A
            comma-separated list of terms to boost for recognition during
            transcription, for staff names, building names, or other
            domain-specific vocabulary. This field may be templated with
            [dynamic
            variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
            using mustache syntax (e.g. `Telnyx,{{customer_name}},VoIP`).
            Variables are resolved at call time before the value is sent to
            Soniox.
        language_hints:
          title: Language Hints
          type: array
          items:
            type: string
          description: >-
            Available only for soniox/stt-rt-v4 and soniox/stt-rt-v5. A list of
            ISO 639-1 language codes (e.g. `["nl", "fr"]`) to pin recognition to
            multiple languages at once, overriding the single hint derived from
            `language`.
      type: object
      title: TranscriptionSettingsConfig
    AudioVisualizerConfig:
      type: object
      properties:
        color:
          type: string
          enum:
            - verdant
            - twilight
            - bloom
            - mystic
            - flare
            - glacier
          description: The color theme for the audio visualizer.
        preset:
          type: string
          description: The preset style for the audio visualizer.
      title: AudioVisualizerConfig
    StartSpeakingPlan:
      type: object
      title: StartSpeakingPlan
      description: >-
        Controls when the assistant starts speaking after the user stops. These
        thresholds primarily apply to non turn-taking transcription models. For
        turn-taking models like `deepgram/flux`, end-of-turn detection is driven
        by the transcription end-of-turn settings under `transcription.settings`
        instead.
      properties:
        wait_seconds:
          type: number
          format: float
          default: 0.4
          minimum: 0
          description: Minimum seconds to wait before the assistant starts speaking.
        transcription_endpointing_plan:
          $ref: '#/components/schemas/TranscriptionEndpointingPlan'
    ObservabilityStatus:
      type: string
      enum:
        - enabled
        - disabled
      title: ObservabilityStatus
    PromptSyncStatus:
      type: string
      enum:
        - enabled
        - disabled
      title: PromptSyncStatus
      description: >-
        Whether to auto-publish the assistant's instructions as a Langfuse
        prompt.


        When ENABLED + prompt_name set, every assistant create/update pushes

        `instructions` to Langfuse via create_prompt and stores the returned

        version in prompt_version.
    FlowEdge:
      description: |-
        Directed transition from one node to a target, gated by a condition.

        The target is either another node in the same flow (`NodeTarget`) or a
        different assistant (`AssistantTarget`). Multiple edges may share a
        `start_node_id`. On calls, `expression` conditions are evaluated before
        the model turn and take precedence over `llm` conditions regardless of
        declaration order, while `llm` conditions are offered to the assistant's
        model as transition tools and fire when the model selects one. On chat
        channels, an `expression` condition that is true when the turn begins
        routes before the reply is generated; all conditioned edges that remain
        are considered together in declaration order after the reply, and the
        first true one wins.
      properties:
        condition:
          description: >-
            Condition that gates the transition. Discriminated by `type`: `llm`,
            `expression`.
          discriminator:
            mapping:
              expression:
                $ref: '#/components/schemas/ExpressionCondition'
              llm:
                $ref: '#/components/schemas/LLMCondition'
              default:
                $ref: '#/components/schemas/DefaultCondition'
            propertyName: type
          oneOf:
            - $ref: '#/components/schemas/LLMCondition'
            - $ref: '#/components/schemas/ExpressionCondition'
            - $ref: '#/components/schemas/DefaultCondition'
          title: Condition
        id:
          description: Caller-supplied unique identifier for this edge within the flow.
          example: e_age_gate
          title: Id
          type: string
        start_node_id:
          description: ID of the node this edge transitions away from.
          title: Start Node Id
          type: string
        target:
          description: >-
            Destination of the transition. Discriminated by `type`: `node` (jump
            to another node in this flow) or `assistant` (hand off to a
            different assistant).
          discriminator:
            mapping:
              assistant:
                $ref: '#/components/schemas/AssistantTarget'
              node:
                $ref: '#/components/schemas/NodeTarget'
            propertyName: type
          oneOf:
            - $ref: '#/components/schemas/NodeTarget'
            - $ref: '#/components/schemas/AssistantTarget'
          title: Target
      required:
        - id
        - start_node_id
        - target
        - condition
      title: FlowEdge
      type: object
    FlowNodeReq:
      description: |-
        One step in a conversation flow, as supplied by API clients.

        Each node carries the prompt, tool scope, and optional overrides for
        model/voice/transcription. Unset overrides cascade from the assistant.
      example:
        id: n_intake
        instructions: Greet the caller and ask what they're calling about.
        name: Intake
        position:
          x: 120
          'y': 80
        shared_tool_ids:
          - tool-faq-kb
        type: prompt
      properties:
        external_llm:
          $ref: '#/components/schemas/ExternalLLMReq'
          description: >-
            Override for `Assistant.external_llm` while this node is active. Use
            this to route a node's turns to a different external LLM (different
            `model`, `base_url`, credentials). Part of the LLM bundle — see
            `model` for cascade semantics. Mutually exclusive with `model` on
            the node (a single LLM identity per node).
        id:
          description: Caller-supplied unique identifier for this node within the flow.
          example: n_intake
          title: Id
          type: string
        instructions:
          description: Prompt that drives the LLM while this node is active. Required.
          example: Greet the caller and ask what they're calling about.
          title: Instructions
          type: string
        instructions_mode:
          default: replace
          description: >-
            How `instructions` combine with the assistant-level instructions.
            `replace` (default): the node's instructions are used alone.
            `append`: the node's instructions are concatenated after the
            assistant's instructions.
          enum:
            - replace
            - append
          title: Instructions Mode
          type: string
        llm_api_key_ref:
          description: >-
            Override for `Assistant.llm_api_key_ref` while this node is active.
            Part of the LLM bundle — see `model` for cascade semantics.
          example: my-key-ref
          title: Llm Api Key Ref
          type: string
        model:
          description: >-
            Override for `Assistant.model` while this node is active. Part of
            the LLM bundle (`model` + `llm_api_key_ref` + `external_llm`): when
            any of the three is set on the node, all three are taken from the
            node and the assistant-level LLM identity is not consulted. When
            none of the three is set, the assistant's bundle cascades unchanged.
          example: moonshotai/Kimi-K2.6
          title: Model
          type: string
        name:
          description: Optional human-readable label, displayed in authoring UIs.
          example: Intake
          title: Name
          type: string
        position:
          $ref: '#/components/schemas/NodePosition'
          description: >-
            Optional canvas coordinates used by authoring UIs to lay out the
            graph. Ignored by the runtime; round-trips so frontends can persist
            graph layout across reloads.
          example:
            x: 120
            'y': 80
        shared_tool_ids:
          description: >-
            IDs of shared (org-level) tools available at this node. Knowledge
            bases are attached the same way — via a shared retrieval tool. Tools
            not listed here are not callable while this node is active.
          example:
            - tool-faq-kb
            - tool-billing-lookup
          items:
            type: string
          title: Shared Tool Ids
          type: array
        tools_mode:
          default: replace
          description: >-
            How `shared_tool_ids` combine with the assistant-level tool set.
            `replace` (default): only the node's tools are callable. `append`:
            the node's tools are added to the assistant's tools. Ignored when
            `shared_tool_ids` is null.
          enum:
            - replace
            - append
          title: Tools Mode
          type: string
        transcription:
          $ref: '#/components/schemas/TranscriptionSettings'
          description: >-
            Per-node transcription override (model/language/region). Unset
            fields cascade from the assistant-level transcription.
        type:
          const: prompt
          default: prompt
          description: >-
            Node kind discriminator. `prompt` (default) is an LLM-driven step;
            `tool` is a standalone tool execution and `speak` a scripted message
            (see `ToolNodeReq` / `SpeakNodeReq`).
          title: Type
          type: string
        voice_settings:
          $ref: '#/components/schemas/VoiceSettings'
          description: >-
            Per-node voice override. Only fields set here override the
            assistant-level voice settings; unset fields cascade.
      required:
        - id
        - instructions
      title: FlowNodeReq
      type: object
    ToolNodeReq:
      description: |-
        A standalone tool step in a conversation flow, as supplied by clients.

        Unlike a prompt node, a tool node has no instructions or model — it
        isn't an LLM turn. Reaching it deterministically runs one shared tool
        (arguments filled from matching dynamic variables by name), then routes
        via outgoing `llm` / `expression` edges, with exactly one `default`
        fallback edge required when the node has any outgoing edges (the
        tool's outcome is readable as `telnyx_last_tool_status_code` in
        `expression` conditions).
      example:
        id: n_charge
        message: One moment while I process your payment.
        name: Charge card
        position:
          x: 300
          'y': 200
        shared_tool_id: tool-charge-card
        type: tool
      properties:
        id:
          description: Caller-supplied unique identifier for this node within the flow.
          example: n_charge
          title: Id
          type: string
        message:
          description: >-
            Optional message delivered to the user verbatim immediately before
            the tool executes — an announcement such as 'One moment while I look
            that up.' No LLM turn and no customer turn: the message is
            spoken/sent, then the tool runs, in the same deterministic step.
            `{{variable}}` placeholders are interpolated from the conversation's
            dynamic variables (unresolved → empty string); the tool's own result
            is not yet available when the message is rendered. Omit for a silent
            tool step.
          example: One moment while I process your payment.
          minLength: 1
          pattern: \S
          title: Message
          type: string
        name:
          description: Optional human-readable label, displayed in authoring UIs.
          example: Charge card
          title: Name
          type: string
        position:
          $ref: '#/components/schemas/NodePosition'
          description: >-
            Optional canvas coordinates used by authoring UIs to lay out the
            graph. Ignored by the runtime; round-trips so frontends can persist
            graph layout across reloads.
          example:
            x: 300
            'y': 200
        shared_tool_id:
          description: >-
            ID of the single shared (org-level) tool this node executes. When
            the flow reaches this node the tool runs as a deliberate step (no
            LLM turn); its outgoing `llm` / `expression` edges route the flow on
            the tool's outcome. Arguments are filled from the conversation's
            dynamic variables by name — a dynamic variable whose name matches
            one of the tool's parameters supplies that argument. Cross-validated
            against the org's shared tools on write.
          example: tool-charge-card
          title: Shared Tool Id
          type: string
        type:
          const: tool
          default: tool
          description: Node kind discriminator. Always `tool` for a tool node.
          title: Type
          type: string
      required:
        - id
        - shared_tool_id
      title: ToolNodeReq
      type: object
    SpeakNodeReq:
      properties:
        type:
          type: string
          const: speak
          title: Type
          description: Node kind discriminator. Always `speak` for a speak node.
          default: speak
        id:
          type: string
          title: Id
          description: Caller-supplied unique identifier for this node within the flow.
          example: n_greeting
        name:
          title: Name
          description: Optional human-readable label, displayed in authoring UIs.
          type: string
          example: Greeting
        message:
          type: string
          title: Message
          description: >-
            Message delivered to the user verbatim when the flow reaches this
            node. No LLM turn — the text is spoken/sent exactly as written.
            `{{variable}}` placeholders are interpolated from the conversation's
            dynamic variables; an unresolved placeholder renders as an empty
            string. After delivering, the flow routes via the node's outgoing
            `llm` / `expression` edges (commonly a single unconditional edge).
          example: Thanks for calling, {{caller_name}}. Connecting you now.
        position:
          $ref: '#/components/schemas/NodePosition'
          description: >-
            Optional canvas coordinates used by authoring UIs to lay out the
            graph. Ignored by the runtime; round-trips so frontends can persist
            graph layout across reloads.
          example:
            x: 60
            'y': 80
      type: object
      required:
        - id
        - message
      title: SpeakNodeReq
      description: >-
        A standalone scripted-message step in a flow, as supplied by clients.


        Unlike a prompt node, a speak node has no instructions or model — it
        isn't

        an LLM turn. Reaching it delivers `message` to the user verbatim (with

        `{{variable}}` interpolation), then routes via outgoing `llm` /

        `expression` edges.
      example:
        id: n_greeting
        message: Thanks for calling, {{caller_name}}. Connecting you now.
        name: Greeting
        position:
          x: 60
          'y': 80
        type: speak
    FlowNode:
      description: One step in a conversation flow, as returned by the API.
      properties:
        external_llm:
          $ref: '#/components/schemas/ExternalLLM'
          description: >-
            Override for `Assistant.external_llm` while this node is active. Use
            this to route a node's turns to a different external LLM (different
            `model`, `base_url`, credentials). Part of the LLM bundle — see
            `model` for cascade semantics. Mutually exclusive with `model` on
            the node (a single LLM identity per node).
        id:
          type: string
          title: Id
          description: Caller-supplied unique identifier for this node within the flow.
        instructions:
          description: Prompt that drives the LLM while this node is active. Required.
          title: Instructions
          type: string
        instructions_mode:
          default: replace
          description: >-
            How `instructions` combine with the assistant-level instructions.
            `replace` (default): the node's instructions are used alone.
            `append`: the node's instructions are concatenated after the
            assistant's instructions.
          enum:
            - replace
            - append
          title: Instructions Mode
          type: string
        llm_api_key_ref:
          description: >-
            Override for `Assistant.llm_api_key_ref` while this node is active.
            Part of the LLM bundle — see `model` for cascade semantics.
          title: Llm Api Key Ref
          type: string
        model:
          description: >-
            Override for `Assistant.model` while this node is active. Part of
            the LLM bundle (`model` + `llm_api_key_ref` + `external_llm`): when
            any of the three is set on the node, all three are taken from the
            node and the assistant-level LLM identity is not consulted. When
            none of the three is set, the assistant's bundle cascades unchanged.
          title: Model
          type: string
        name:
          title: Name
          description: Optional human-readable label, displayed in authoring UIs.
          type: string
        position:
          $ref: '#/components/schemas/NodePosition'
          description: >-
            Optional canvas coordinates used by authoring UIs to lay out the
            graph. Ignored by the runtime; round-trips so frontends can persist
            graph layout across reloads.
        shared_tool_ids:
          description: >-
            IDs of shared (org-level) tools available at this node. Knowledge
            bases are attached the same way — via a shared retrieval tool. Tools
            not listed here are not callable while this node is active.
          items:
            type: string
          title: Shared Tool Ids
          type: array
        tools:
          description: >-
            Full tool definitions for this node, resolved from `shared_tool_ids`
            server-side. Populated on responses so clients can render the flow
            without a follow-up fetch per shared tool. Ignored on input — set
            `shared_tool_ids` to configure a node's tools.
          items:
            $ref: '#/components/schemas/AssistantTools'
          title: Tools
          type: array
        tools_mode:
          default: replace
          description: >-
            How `shared_tool_ids` combine with the assistant-level tool set.
            `replace` (default): only the node's tools are callable. `append`:
            the node's tools are added to the assistant's tools. Ignored when
            `shared_tool_ids` is null.
          enum:
            - replace
            - append
          title: Tools Mode
          type: string
        transcription:
          $ref: '#/components/schemas/TranscriptionSettings'
          description: Per-node transcription override (response form).
        type:
          const: prompt
          default: prompt
          description: Node kind discriminator. `prompt` is an LLM-driven step.
          title: Type
          type: string
        voice_settings:
          $ref: '#/components/schemas/VoiceSettings'
          description: Per-node voice override (response form).
      required:
        - id
        - instructions
      title: FlowNode
      type: object
    SpeakNode:
      properties:
        type:
          type: string
          const: speak
          title: Type
          description: Node kind discriminator. Always `speak` for a speak node.
          default: speak
        id:
          type: string
          title: Id
          description: Caller-supplied unique identifier for this node within the flow.
        name:
          title: Name
          description: Optional human-readable label, displayed in authoring UIs.
          type: string
        message:
          type: string
          title: Message
          description: >-
            Message delivered to the user verbatim when the flow reaches this
            node. No LLM turn — the text is spoken/sent exactly as written.
            `{{variable}}` placeholders are interpolated from the conversation's
            dynamic variables; an unresolved placeholder renders as an empty
            string. After delivering, the flow routes via the node's outgoing
            `llm` / `expression` edges (commonly a single unconditional edge).
        position:
          $ref: '#/components/schemas/NodePosition'
          description: >-
            Optional canvas coordinates used by authoring UIs to lay out the
            graph. Ignored by the runtime; round-trips so frontends can persist
            graph layout across reloads.
      type: object
      required:
        - id
        - message
      title: SpeakNode
      description: A standalone scripted-message step in a flow, as returned by the API.
    ToolNode:
      description: A standalone tool step in a conversation flow, as returned by the API.
      properties:
        id:
          type: string
          title: Id
          description: Caller-supplied unique identifier for this node within the flow.
        name:
          title: Name
          description: Optional human-readable label, displayed in authoring UIs.
          type: string
        position:
          $ref: '#/components/schemas/NodePosition'
          description: >-
            Optional canvas coordinates used by authoring UIs to lay out the
            graph. Ignored by the runtime; round-trips so frontends can persist
            graph layout across reloads.
        shared_tool_id:
          description: >-
            ID of the single shared (org-level) tool this node executes. When
            the flow reaches this node the tool runs as a deliberate step (no
            LLM turn); its outgoing `llm` / `expression` edges route the flow on
            the tool's outcome. Arguments are filled from the conversation's
            dynamic variables by name — a dynamic variable whose name matches
            one of the tool's parameters supplies that argument. Cross-validated
            against the org's shared tools on write.
          title: Shared Tool Id
          type: string
        tool:
          $ref: '#/components/schemas/AssistantTools'
          description: >-
            Full tool definition resolved from `shared_tool_id` server-side.
            Populated on responses so clients can render the node without a
            follow-up fetch. Ignored on input — set `shared_tool_id`.
        type:
          const: tool
          default: tool
          description: Node kind discriminator. Always `tool` for a tool node.
          title: Type
          type: string
        message:
          description: >-
            Optional message delivered to the user verbatim immediately before
            the tool executes — an announcement such as 'One moment while I look
            that up.' No LLM turn and no customer turn: the message is
            spoken/sent, then the tool runs, in the same deterministic step.
            `{{variable}}` placeholders are interpolated from the conversation's
            dynamic variables (unresolved → empty string); the tool's own result
            is not yet available when the message is rendered. Omit for a silent
            tool step.
          example: One moment while I process your payment.
          minLength: 1
          pattern: \S
          title: Message
          type: string
      required:
        - id
        - shared_tool_id
      title: ToolNode
      type: object
    FunctionDefinition:
      properties:
        name:
          type: string
        description:
          type: string
        parameters:
          type: object
          additionalProperties: true
      type: object
      required:
        - name
      title: FunctionDefinition
    WebhookToolParams:
      properties:
        name:
          type: string
          description: The name of the tool.
        description:
          type: string
          description: The description of the tool.
        url:
          description: >-
            The URL of the external tool to be called. This URL is going to be
            used by the assistant. The URL can be templated like:
            `https://example.com/api/v1/{id}`, where `{id}` is a placeholder for
            a value that will be provided by the assistant if `path_parameters`
            are provided with the `id` attribute.
          type: string
          example: https://example.com/api/v1/function
        method:
          description: The HTTP method to be used when calling the external tool.
          type: string
          enum:
            - GET
            - POST
            - PUT
            - DELETE
            - PATCH
          default: POST
        headers:
          description: The headers to be sent to the external tool.
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              value:
                description: >-
                  The value of the header. Note that we support mustache
                  templating for the value. For example you can use `Bearer
                  {{#integration_secret}}test-secret{{/integration_secret}}` to
                  pass the value of the integration secret as the bearer token.
                  [Telnyx signature
                  headers](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks)
                  will be automatically added to the request.
                type: string
        body_parameters:
          description: >-
            The body parameters the webhook tool accepts, described as a JSON
            Schema object. These parameters will be passed to the webhook as the
            body of the request. See the [JSON Schema
            reference](https://json-schema.org/understanding-json-schema) for
            documentation about the format
          type: object
          properties:
            properties:
              description: The properties of the body parameters.
              type: object
              additionalProperties: true
            required:
              description: The required properties of the body parameters.
              type: array
              items:
                type: string
            type:
              type: string
              enum:
                - object
          example:
            properties:
              age:
                description: The age of the customer.
                type: integer
              location:
                description: The location of the customer.
                type: string
            required:
              - age
              - location
            type: object
        path_parameters:
          description: >-
            The path parameters the webhook tool accepts, described as a JSON
            Schema object. These parameters will be passed to the webhook as the
            path of the request if the URL contains a placeholder for a value.
            See the [JSON Schema
            reference](https://json-schema.org/understanding-json-schema) for
            documentation about the format
          type: object
          properties:
            properties:
              description: The properties of the path parameters.
              type: object
              additionalProperties: true
            required:
              description: The required properties of the path parameters.
              type: array
              items:
                type: string
            type:
              type: string
              enum:
                - object
          example:
            properties:
              id:
                description: The id of the customer.
                type: string
            required:
              - id
            type: object
        query_parameters:
          description: >-
            The query parameters the webhook tool accepts, described as a JSON
            Schema object. These parameters will be passed to the webhook as the
            query of the request. See the [JSON Schema
            reference](https://json-schema.org/understanding-json-schema) for
            documentation about the format
          type: object
          properties:
            properties:
              description: The properties of the query parameters.
              type: object
              additionalProperties: true
            required:
              description: The required properties of the query parameters.
              type: array
              items:
                type: string
            type:
              type: string
              enum:
                - object
          example:
            properties:
              page:
                description: The page number.
                type: integer
            required:
              - page
            type: object
        preset_body_fields:
          type: object
          additionalProperties: true
          description: >-
            Body fields supplied by the assistant configuration rather than by
            the model. They are never advertised in the tool definition, so the
            LLM can neither see nor set them, and they take precedence over a
            `body_parameters` value of the same name. Values support mustache
            templating, so they can hold dynamic variables (`{{customer_id}}`)
            and integration secrets
            (`{{#integration_secret}}my-secret{{/integration_secret}}`). Not
            sent on `GET` requests, which carry no body.
          example:
            account_id: '{{customer_id}}'
            source: telnyx-assistant
        preset_query_params:
          type: object
          additionalProperties: true
          description: >-
            Query string parameters supplied by the assistant configuration
            rather than by the model. They are never advertised in the tool
            definition, so the LLM can neither see nor set them, and they take
            precedence over a `query_parameters` value of the same name. Values
            support mustache templating, so they can hold dynamic variables
            (`{{telnyx_end_user_target}}`) and integration secrets
            (`{{#integration_secret}}my-secret{{/integration_secret}}`). Unlike
            values templated directly into the `url`, these are percent-encoded,
            so a value such as `+15551234567` survives the round trip.
          example:
            caller: '{{telnyx_end_user_target}}'
            channel: voice
        async:
          type: boolean
          default: false
          description: >-
            If async, the assistant will move forward without waiting for your
            server to respond.
        async_timeout_ms:
          type: integer
          minimum: 1
          maximum: 15000
          description: >-
            Maximum time in milliseconds that the conversation worker waits for
            an async webhook response before returning "Submitted" to the LLM.
            If unset, the platform default (currently 300ms) is used.
        store_fields_as_variables:
          type: array
          description: >-
            A list of mappings that extract values from the webhook response and
            store them as dynamic variables. Each mapping specifies a dynamic
            variable name and a dot-notation path to the value in the response
            body.
          items:
            type: object
            required:
              - name
              - value_path
            properties:
              name:
                type: string
                minLength: 1
                description: >-
                  The name of the dynamic variable to store the extracted value
                  in.
              value_path:
                type: string
                minLength: 1
                description: >-
                  A dot-notation path to the value in the webhook response body
                  (e.g. 'customer.name' or 'id').
            additionalProperties: false
        messages:
          type: array
          description: >-
            Filler messages spoken while a synchronous webhook request is in
            progress. `request_start` messages are spoken immediately when the
            request begins. `request_response_delayed` messages are spoken after
            `timing_ms` has elapsed only if the webhook response is still
            pending. Filler messages are not used for asynchronous webhooks.
          items:
            oneOf:
              - title: WebhookToolRequestStartMessage
                type: object
                required:
                  - type
                  - content
                properties:
                  type:
                    type: string
                    const: request_start
                    description: >-
                      Speak the filler message immediately when the webhook
                      request begins.
                  content:
                    type: string
                    minLength: 1
                    description: The text the assistant speaks.
                  timing_ms:
                    type: integer
                    minimum: 100
                    maximum: 120000
                    description: >-
                      An optional delay value. This value is ignored for
                      `request_start` messages.
                additionalProperties: false
              - title: WebhookToolRequestResponseDelayedMessage
                type: object
                required:
                  - type
                  - content
                  - timing_ms
                properties:
                  type:
                    type: string
                    const: request_response_delayed
                    description: >-
                      Speak the filler message after the configured delay if the
                      webhook response is still pending.
                  content:
                    type: string
                    minLength: 1
                    description: The text the assistant speaks.
                  timing_ms:
                    type: integer
                    minimum: 100
                    maximum: 120000
                    description: >-
                      The delay in milliseconds from the start of the webhook
                      request.
                additionalProperties: false
          example:
            - type: request_start
              content: Let me look that up for you.
            - type: request_response_delayed
              content: Still working on that.
              timing_ms: 5000
      type: object
      required:
        - url
        - name
        - description
      title: WebhookToolParams
    ClientSideToolParams:
      title: ClientSideToolParams
      type: object
      properties:
        name:
          type: string
          description: The name of the tool.
        description:
          type: string
          description: The description of the tool.
        parameters:
          description: >-
            The parameters the tool accepts, described as a JSON Schema object.
            See the [JSON Schema
            reference](https://json-schema.org/understanding-json-schema) for
            documentation about the format
          type: object
          properties:
            properties:
              description: The properties of the parameters.
              type: object
              additionalProperties: true
            required:
              description: The required properties of the parameters.
              type: array
              items:
                type: string
            type:
              type: string
              enum:
                - object
          example:
            properties:
              age:
                description: The age of the customer.
                type: integer
              location:
                description: The location of the customer.
                type: string
            required:
              - age
              - location
            type: object
      required:
        - name
        - description
        - parameters
    BucketIds:
      properties:
        bucket_ids:
          items:
            type: string
          type: array
          description: >-
            List of [embedded storage
            buckets](https://developers.telnyx.com/api-reference/embeddings/embed-documents)
            to use for retrieval-augmented generation.
        max_num_results:
          description: >-
            The maximum number of results to retrieve as context for the
            language model.
          type: integer
      type: object
      required:
        - bucket_ids
      title: BucketIds
    HandoffToolParams:
      properties:
        voice_mode:
          type: string
          enum:
            - unified
            - distinct
          description: >-
            With the unified voice mode all assistants share the same voice,
            making the handoff transparent to the user. With the distinct voice
            mode all assistants retain their voice configuration, providing the
            experience of a conference call with a team of assistants.
        ai_assistants:
          type: array
          description: List of possible assistants that can receive a handoff.
          items:
            type: object
            properties:
              name:
                type: string
                description: >-
                  Helpful name for giving context on when to handoff to the
                  assistant.
                example: Scheduling Specialist
              id:
                type: string
                description: The ID of the assistant to hand off to.
                example: assistant-1234567890abcdef
            required:
              - name
              - id
      required:
        - ai_assistants
      type: object
      title: HandoffToolParams
    HangupToolParams:
      properties:
        description:
          type: string
          default: This tool is used to hang up the call.
          description: >-
            The description of the function that will be passed to the
            assistant.
      type: object
      title: HangupToolParams
    InferenceEmbeddingTransferToolParams:
      properties:
        targets:
          oneOf:
            - type: array
              items:
                type: object
                properties:
                  name:
                    type: string
                    description: The name of the target.
                    example: Support
                  to:
                    type: string
                    description: The destination number or SIP URI of the call.
                    example: '+13129457420'
                  message:
                    type: string
                    description: >-
                      The warm transfer message to deliver to this specific
                      target. When set, it takes precedence over the message the
                      assistant composes from `warm_transfer_instructions`.
                    example: >-
                      I have a caller asking about a billing issue on invoice
                      4471.
                  extension:
                    type: string
                    description: >-
                      DTMF digits to send automatically after the transfer
                      destination answers. Useful for reaching an extension
                      behind an IVR (e.g. `"200"` to dial extension 200 once the
                      called party picks up). Allowed characters: `0-9`, `A-D`,
                      `w` (0.5s pause), `W` (1s pause), `*`, `#`. Maximum 64
                      characters. When omitted, no automatic DTMF is sent.
                    example: wwww200
                  sip_auth_username:
                    type: string
                    description: >-
                      SIP Authentication username used for SIP challenges.
                      Applies when `to` is a SIP URI.
                    example: sipuser
                  sip_auth_password:
                    type: string
                    description: >-
                      SIP Authentication password used for SIP challenges.
                      Applies when `to` is a SIP URI.
                    example: sippass
                required:
                  - to
            - type: string
              description: >-
                A dynamic variable string like `{{ targets }}` where `targets`
                is returned by the dynamic variables webhook and resolves to an
                array of target objects at runtime.
              example: '{{ targets }}'
          description: >-
            The different possible targets of the transfer. The assistant will
            be able to choose one of the targets to transfer the call to. This
            can also be a dynamic variable string like `{{ targets }}` where
            `targets` is returned by the dynamic variables webhook and resolves
            to an array of target objects at runtime.
        from:
          type: string
          example: '+35319605860'
          description: Number or SIP URI placing the call.
        diversion:
          type: string
          example: '{{telnyx_agent_target}}'
          description: >-
            The number the inbound call was received on, forwarded so an
            unverified non-Telnyx `from` can be used as the caller id --
            typically to transfer out as the original caller by pairing `from:
            "{{telnyx_end_user_target}}"` with `diversion:
            "{{telnyx_agent_target}}"`. The caller id is only accepted while
            that number is still on an active inbound call to this `diversion`
            number, and the `diversion` number must be one you own or have
            verified.
        warm_transfer_instructions:
          type: string
          example: >-
            Briefly greet the transfer recipient and provide any relevant
            information from the call. Let them know you will bridge the call
            right after.
          description: >-
            Natural language instructions for your agent for how to provide
            context for the transfer recipient.
        warm_transfer_acceptance:
          type: object
          description: >-
            Requires the transfer destination to accept the call before the
            caller is bridged. When enabled, the assistant speaks privately with
            the destination after they answer — delivering the warm transfer
            message and asking whether they take the call — while the caller
            keeps hearing ringback. The assistant then finalizes the transfer
            with the built-in `complete_transfer` tool: an accept bridges the
            calls, a decline hangs up the destination and returns the assistant
            to the caller with the reason the destination gave. Requires either
            `warm_transfer_instructions` or a `message` on every target,
            otherwise the assistant fails to save. Only available for calls
            started with `ai_assistant_start`; single-caller conversations only
            (a conference or additional invited participants fall back to a
            regular warm transfer).
          properties:
            enabled:
              type: boolean
              default: false
              description: >-
                Whether the destination must accept the transfer before the
                calls are bridged.
            end_user_target_context_mode:
              type: string
              enum:
                - private
                - shared
              default: private
              description: >-
                Controls whether the private exchange between the assistant and
                the transfer destination is kept out of the conversation. With
                `private` (default) the exchange never reaches the conversation
                history, AI conversations, webhooks or insights, and the
                transfer tool result is rewritten with the outcome only. With
                `shared` the exchange stays in the conversation like any other
                messages.
        description:
          type: string
          description: >-
            A description of the transfer tool. By default, Telnyx generates
            this automatically based on the configured targets. Typically only
            set when importing an assistant from another provider that allowed a
            custom description; in that case the provided value is preserved.
            Most users should leave this empty and let Telnyx manage it.
          example: Transfer the call to a human agent.
        warm_message_delay_ms:
          type:
            - integer
            - 'null'
          example: 2000
          description: >-
            Optional delay in milliseconds before playing the warm message audio
            when the transferred call is answered. When set, the audio_url is
            not included in the dial command; instead, playback starts after the
            specified delay. When not set, existing behavior (audio_url in dial)
            is preserved.
        custom_headers:
          description: >-
            Custom headers to be added to the SIP INVITE for the transfer
            command.
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              value:
                description: >-
                  The value of the header. Note that we support mustache
                  templating for the value. For example you can use
                  `{{#integration_secret}}test-secret{{/integration_secret}}` to
                  pass the value of the integration secret.
                type: string
        voicemail_detection:
          type: object
          description: >-
            Configuration for voicemail detection (AMD - Answering Machine
            Detection) on the transferred call. Allows the assistant to detect
            when a voicemail system answers the transferred call and take
            appropriate action.
          properties:
            detection_mode:
              type: string
              enum:
                - disabled
                - premium
              description: >-
                The AMD detection mode to use. 'premium' enables premium
                answering machine detection. 'disabled' turns off AMD detection.
            on_voicemail_detected:
              type: object
              description: >-
                Action to take when voicemail is detected on the transferred
                call.
              properties:
                action:
                  type: string
                  enum:
                    - stop_transfer
                    - leave_message_and_stop_transfer
                  description: >-
                    The action to take when voicemail is detected.
                    'stop_transfer' hangs up immediately.
                    'leave_message_and_stop_transfer' leaves a message then
                    hangs up.
                voicemail_message:
                  type: object
                  description: >-
                    Configuration for the voicemail message to leave. Only
                    applicable when action is 'leave_message_and_stop_transfer'.
                  properties:
                    type:
                      type: string
                      enum:
                        - message
                        - warm_transfer_instructions
                      description: >-
                        The type of voicemail message. Use 'message' to leave a
                        specific TTS message, or 'warm_transfer_instructions' to
                        play the warm transfer audio.
                    message:
                      type: string
                      description: >-
                        The specific message to leave as voicemail (converted to
                        speech). Only applicable when type is 'message'.
            detection_config:
              type: object
              description: >-
                Advanced AMD detection configuration parameters. All values are
                optional - Telnyx will use defaults if not specified.
              properties:
                greeting_silence_duration_millis:
                  type: integer
                  minimum: 500
                  maximum: 50000
                  description: >-
                    Duration of silence after the greeting to wait before
                    considering the greeting complete.
                greeting_total_analysis_time_millis:
                  type: integer
                  minimum: 500
                  maximum: 300000
                  description: Maximum time to spend analyzing the greeting.
                after_greeting_silence_millis:
                  type: integer
                  minimum: 100
                  maximum: 5000
                  description: >-
                    Duration of silence after greeting detection before
                    finalizing the result.
                between_words_silence_millis:
                  type: integer
                  minimum: 10
                  maximum: 5000
                  description: Maximum silence duration between words during greeting.
                greeting_duration_millis:
                  type: integer
                  minimum: 100
                  maximum: 10000
                  description: Expected duration of greeting speech.
                initial_silence_millis:
                  type: integer
                  minimum: 100
                  maximum: 500000
                  description: >-
                    Maximum silence duration at the start of the call before
                    speech.
                maximum_number_of_words:
                  type: integer
                  minimum: 1
                  maximum: 50
                  description: Maximum number of words expected in a human greeting.
                maximum_word_length_millis:
                  type: integer
                  minimum: 50
                  maximum: 5000
                  description: Maximum duration of a single word.
                silence_threshold:
                  type: integer
                  minimum: 1
                  maximum: 1000
                  description: Audio level threshold for silence detection.
                total_analysis_time_millis:
                  type: integer
                  minimum: 500
                  maximum: 60000
                  description: Total time allowed for AMD analysis.
                min_word_length_millis:
                  type: integer
                  minimum: 1
                  maximum: 1000
                  description: Minimum duration for audio to be considered a word.
      type: object
      required:
        - targets
        - from
      title: TransferToolParams
    InviteToolConfig:
      properties:
        from:
          type: string
          example: '+35319605860'
          description: Number or SIP URI placing the call.
        targets:
          oneOf:
            - type: array
              items:
                type: object
                properties:
                  name:
                    type: string
                    description: The name of the target.
                    example: Support
                  to:
                    type: string
                    description: The destination number or SIP URI of the call.
                    example: '+13129457420'
                required:
                  - to
            - type: string
              description: >-
                A dynamic variable string like `{{ targets }}` where `targets`
                is returned by the dynamic variables webhook and resolves to an
                array of target objects at runtime.
              example: '{{ targets }}'
            - type: 'null'
          description: >-
            The different possible targets of the invite. The assistant will be
            able to choose one of the targets to invite to the call. This can
            also be a dynamic variable string like `{{ targets }}` where
            `targets` is returned by the dynamic variables webhook and resolves
            to an array of target objects at runtime. If omitted or null, the
            invite tool can still be configured and targets may be supplied
            dynamically at runtime.
        custom_headers:
          description: Custom headers to be added to the SIP INVITE for the invite command.
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              value:
                description: >-
                  The value of the header. Note that we support mustache
                  templating for the value. For example you can use
                  `{{#integration_secret}}test-secret{{/integration_secret}}` to
                  pass the value of the integration secret.
                type: string
        voicemail_detection:
          type: object
          description: >-
            Configuration for voicemail detection (AMD - Answering Machine
            Detection) on the invited call.
          properties:
            detection_mode:
              type: string
              enum:
                - disabled
                - premium
              description: >-
                The AMD detection mode to use. 'premium' enables premium
                answering machine detection. 'disabled' turns off AMD detection.
            on_voicemail_detected:
              type: object
              description: Action to take when voicemail is detected on the invited call.
              properties:
                action:
                  type: string
                  enum:
                    - stop_invite
                  description: The action to take when voicemail is detected.
      type: object
      required:
        - from
      title: InviteToolConfig
    SIPReferToolParams:
      properties:
        targets:
          type: array
          description: >-
            The different possible targets of the SIP refer. The assistant will
            be able to choose one of the targets to refer the call to.
          items:
            type: object
            properties:
              name:
                type: string
                description: The name of the target.
                example: Support
              sip_address:
                type: string
                description: The SIP URI to which the call will be referred.
                example: sip:username@sip.non-telnyx-address.com
              sip_auth_username:
                type: string
                description: SIP Authentication username used for SIP challenges.
              sip_auth_password:
                type: string
                description: SIP Authentication password used for SIP challenges.
            required:
              - name
              - sip_address
        sip_headers:
          description: >-
            SIP headers to be added to the SIP REFER. Currently only
            User-to-User and Diversion headers are supported.
          type: array
          items:
            type: object
            properties:
              name:
                type: string
                enum:
                  - User-to-User
                  - Diversion
              value:
                description: >-
                  The value of the header. Note that we support mustache
                  templating for the value. For example you can use
                  `{{#integration_secret}}test-secret{{/integration_secret}}` to
                  pass the value of the integration secret.
                type: string
        custom_headers:
          description: Custom headers to be added to the SIP REFER.
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              value:
                description: >-
                  The value of the header. Note that we support mustache
                  templating for the value. For example you can use
                  `{{#integration_secret}}test-secret{{/integration_secret}}` to
                  pass the value of the integration secret.
                type: string
      type: object
      required:
        - targets
      title: SIPReferToolParams
    SkipTurnToolParams:
      properties:
        description:
          type: string
          default: >-
            This tool is used to skip the assistant turn without producing a
            response.
          description: >-
            The description of the function that will be passed to the
            assistant.
      type: object
      title: SkipTurnToolParams
    PayToolParams:
      properties:
        connector_name:
          type: string
          description: >-
            The name of the pay connector configured in the Telnyx API. Must
            reference an existing pay connector for this organization.
        currency:
          type: string
          default: USD
          description: Default currency for payments processed by this tool.
        payment_method:
          type: string
          default: credit-card
          description: Default payment method for payments processed by this tool.
        description:
          type:
            - string
            - 'null'
          default: null
          description: >-
            Optional description of the pay tool that will be passed to the
            assistant.
      required:
        - connector_name
      type: object
      title: PayToolParams
    UpdateDynamicVariablesToolParams:
      description: Configuration for an update_dynamic_variables tool.
      properties:
        name:
          type: string
          pattern: ^[a-zA-Z0-9_-]+$
          description: >-
            The function name surfaced to the LLM. Must match the OpenAI
            function-name pattern `^[a-zA-Z0-9_-]+$` and be unique across the
            assistant's function, webhook, and client_side tools.
          example: collect_details
        description:
          type: string
          description: >-
            Description of the tool passed to the assistant, guiding when to
            call it and which variables to update.
          example: Collect caller details into conversation variables.
        updatable_variables:
          type: array
          description: >-
            The dynamic variables the assistant is allowed to write. At least
            one is required.
          minItems: 1
          items:
            type: object
            properties:
              name:
                type: string
                minLength: 1
                pattern: ^(?!telnyx_)[a-zA-Z0-9._-]+$
                description: >-
                  The dynamic-variable key to update. Must match
                  `^[a-zA-Z0-9._-]+$` and may not start with the reserved
                  `telnyx_` prefix (reserved for system variables). The
                  `pattern` encodes both rules via a negative lookahead.
                example: customer_name
              type:
                type: string
                description: Optional hint for the variable's value type (e.g. `string`).
                example: string
              description:
                type: string
                description: >-
                  Optional description of the variable, guiding the assistant on
                  what value to capture.
                example: The caller's full name.
            required:
              - name
            additionalProperties: false
      required:
        - name
        - description
        - updatable_variables
      type: object
      title: UpdateDynamicVariablesToolParams
    TranscriptionEndpointingPlan:
      type: object
      title: TranscriptionEndpointingPlan
      description: >-
        Endpointing thresholds used to decide when the user has finished
        speaking. Applies to non turn-taking transcription models. For
        `deepgram/flux`, use `transcription.settings.eot_threshold` /
        `eot_timeout_ms` / `eager_eot_threshold`.
      properties:
        on_punctuation_seconds:
          type: number
          format: float
          default: 0.1
          description: Seconds to wait after the transcript ends with punctuation.
        on_no_punctuation_seconds:
          type: number
          format: float
          default: 1.5
          description: Seconds to wait after the transcript ends without punctuation.
        on_number_seconds:
          type: number
          format: float
          default: 0.5
          description: Seconds to wait after the transcript ends with a number.
    ExpressionCondition:
      description: |-
        Edge condition evaluated as a deterministic expression AST.

        The expression is computed against runtime dynamic variables and must
        evaluate to a boolean. Prefer this over `LLMCondition` when the rule is
        a clean function of known variables — it's cheaper and predictable.
      example:
        expression:
          left:
            name: user_age
            type: variable
          op: '>='
          right:
            type: number_literal
            value: 18
          type: comparison
        type: expression
      properties:
        expression:
          $ref: '#/components/schemas/Expression'
        type:
          const: expression
          title: Type
          type: string
      required:
        - type
        - expression
      title: ExpressionCondition
      type: object
    LLMCondition:
      description: |-
        Edge condition routed by the assistant's LLM from a natural-language
        prompt.

        How the edge is decided depends on the channel. On calls, each outgoing
        `llm` condition is offered to the assistant's model as a transition tool
        alongside the assistant's tools, and the edge fires when the model
        selects it; the platform does not evaluate the prompt itself, and
        instructions that forbid or discourage tool calls can stop these edges
        from firing. On chat channels, the edge prompts are evaluated in a
        separate model call after the reply, which does not use the assistant's
        instructions. Use this for fuzzy intents that aren't expressible as a
        deterministic expression (e.g. 'user wants to escalate to a human').
      example:
        prompt: The user has confirmed their booking details.
        type: llm
      properties:
        prompt:
          description: >-
            Natural-language criterion the model routes on. On calls this is
            offered to the model as the transition tool's description; on chat
            channels it is judged as a statement in the post-reply evaluation
            call.
          example: The user has confirmed their booking details.
          title: Prompt
          type: string
        type:
          const: llm
          title: Type
          type: string
      required:
        - type
        - prompt
      title: LLMCondition
      type: object
    DefaultCondition:
      properties:
        type:
          type: string
          const: default
          title: Type
      type: object
      required:
        - type
      title: DefaultCondition
      description: >-
        Fallback edge condition: fires only when no other edge's condition is
        true.


        Evaluated after every conditioned (`llm` / `expression`) edge regardless

        of declaration order, so it routes the flow whenever none of the node's

        other outgoing edges match. Valid **only** on edges leaving a `tool` or

        `speak` node, where the deterministic step auto-advances and must always

        have somewhere to go. A tool/speak node with any outgoing edge is
        required

        to carry exactly one `default` edge so it never dead-ends; a tool/speak

        node with no outgoing edges is a valid terminal step. Carries no
        parameters.
      example:
        type: default
    AssistantTarget:
      description: |-
        Edge target referencing a different assistant.

        When the edge fires, the conversation hands off to `assistant_id`: the
        active assistant on the conversation row is rewritten and the new
        assistant's flow starts at its own `start_node_id`. The current turn's
        LLM response is delivered to the user as-is; subsequent turns route
        to the new assistant.
      properties:
        assistant_id:
          description: ID of the assistant the conversation transitions to.
          example: assistant-billing
          title: Assistant Id
          type: string
        position:
          $ref: '#/components/schemas/NodePosition'
          description: >-
            Optional canvas coordinates for rendering the target assistant as a
            node in authoring UIs. Pure presentation — the runtime ignores it;
            round-trips so frontends can persist graph layout across reloads.
            When multiple edges target the same assistant, each edge's
            `position` is independent (frontends typically use the first
            non-null one).
          example:
            x: 600
            'y': 80
        type:
          const: assistant
          title: Type
          type: string
        voice_mode:
          default: unified
          description: >-
            Voice behavior when handing off to the target assistant, mirroring
            the handoff tool's `voice_mode`. `unified` (default) keeps the
            current voice across the handoff; `distinct` lets the target
            assistant speak with its own configured voice. Only applies to
            assistant targets — node targets override voice via the node's own
            `voice_settings`.
          enum:
            - unified
            - distinct
          title: Voice Mode
          type: string
      required:
        - type
        - assistant_id
      title: AssistantTarget
      type: object
    NodeTarget:
      description: |-
        Edge target referencing another node within the same flow.

        The runtime transitions the active node to `node_id` and continues
        processing within the current assistant's flow.
      properties:
        node_id:
          description: ID of the node this edge transitions into.
          example: n_billing
          title: Node Id
          type: string
        type:
          const: node
          title: Type
          type: string
      required:
        - type
        - node_id
      title: NodeTarget
      type: object
    NodePosition:
      description: >-
        2D coordinates for a node, used by authoring UIs to lay out the graph.


        Purely a presentation aid. The runtime ignores `position`; it
        round-trips

        through the API so frontends can persist the graph layout customers

        arrange in the editor.
      properties:
        x:
          description: Horizontal coordinate in the authoring canvas.
          title: X
          type: number
        'y':
          description: Vertical coordinate in the authoring canvas.
          title: 'Y'
          type: number
      required:
        - x
        - 'y'
      title: NodePosition
      type: object
    Expression:
      title: Expression
      description: >-
        A node in a deterministic expression AST. Exactly one variant is
        selected by the `type` discriminator. Terminal variants
        (`number_literal`, `string_literal`, `bool_literal`, `variable`) bottom
        out the recursion; `arithmetic`, `bool_op`, and `comparison` nest
        further sub-expressions.


        Extracted into a single named schema so the recursive union is defined
        once (was previously inlined at every operand site).
      oneOf:
        - $ref: '#/components/schemas/ComparisonExpression'
        - $ref: '#/components/schemas/BooleanOpExpression'
        - $ref: '#/components/schemas/ArithmeticExpression'
        - $ref: '#/components/schemas/DynamicVariableExpression'
        - $ref: '#/components/schemas/StringLiteralExpression'
        - $ref: '#/components/schemas/NumberLiteralExpression'
        - $ref: '#/components/schemas/BooleanLiteralExpression'
      discriminator:
        mapping:
          arithmetic:
            $ref: '#/components/schemas/ArithmeticExpression'
          bool_literal:
            $ref: '#/components/schemas/BooleanLiteralExpression'
          bool_op:
            $ref: '#/components/schemas/BooleanOpExpression'
          comparison:
            $ref: '#/components/schemas/ComparisonExpression'
          number_literal:
            $ref: '#/components/schemas/NumberLiteralExpression'
          string_literal:
            $ref: '#/components/schemas/StringLiteralExpression'
          variable:
            $ref: '#/components/schemas/DynamicVariableExpression'
        propertyName: type
    ComparisonExpression:
      description: |-
        Compare two sub-expressions with a relational or membership operator.

        Evaluates to a boolean. Used in edge conditions to gate transitions on
        runtime values, e.g. `user_age >= 18` or `tier == "gold"`.
      example:
        left:
          name: user_age
          type: variable
        op: '>='
        right:
          type: number_literal
          value: 18
        type: comparison
      properties:
        left:
          $ref: '#/components/schemas/Expression'
        op:
          description: >-
            Relational/membership operator. `contains` / `not_contains` apply to
            strings (substring) and arrays (membership).
          enum:
            - '=='
            - '!='
            - <
            - <=
            - '>'
            - '>='
            - contains
            - not_contains
          title: Op
          type: string
        right:
          $ref: '#/components/schemas/Expression'
        type:
          const: comparison
          title: Type
          type: string
      required:
        - type
        - op
        - left
        - right
      title: ComparisonExpression
      type: object
    BooleanOpExpression:
      description: |-
        Combine sub-expressions with a logical operator (`and` / `or` / `not`).

        `and` and `or` accept two or more operands; `not` accepts exactly one.
      example:
        op: and
        operands:
          - name: is_premium
            type: variable
          - left:
              name: user_age
              type: variable
            op: '>='
            right:
              type: number_literal
              value: 18
            type: comparison
        type: bool_op
      properties:
        op:
          description: Logical operator. `not` is unary; `and`/`or` are n-ary (>=2).
          enum:
            - and
            - or
            - not
          title: Op
          type: string
        operands:
          description: >-
            Operand sub-expressions. Length must be exactly 1 for `not` and >= 2
            for `and`/`or`.
          items:
            $ref: '#/components/schemas/Expression'
          title: Operands
          type: array
        type:
          const: bool_op
          title: Type
          type: string
      required:
        - type
        - op
        - operands
      title: BooleanOpExpression
      type: object
    ArithmeticExpression:
      description: >-
        Numeric expression: applies an arithmetic operator to two
        sub-expressions.


        Useful for derived numeric checks, e.g. `cart_total + shipping > 50`.

        Both operands should resolve to numbers at runtime.
      example:
        left:
          name: cart_total
          type: variable
        op: +
        right:
          name: shipping_cost
          type: variable
        type: arithmetic
      properties:
        left:
          $ref: '#/components/schemas/Expression'
        op:
          description: Arithmetic operator applied to `left` and `right`.
          enum:
            - +
            - '-'
            - '*'
            - /
            - '%'
          title: Op
          type: string
        right:
          $ref: '#/components/schemas/Expression'
        type:
          const: arithmetic
          title: Type
          type: string
      required:
        - type
        - op
        - left
        - right
      title: ArithmeticExpression
      type: object
    DynamicVariableExpression:
      description: |-
        Reference a dynamic variable by name.

        Resolved at runtime from the assistant's dynamic-variables context (see
        `Assistant.dynamic_variables` and the dynamic-variables webhook).
      example:
        name: user_age
        type: variable
      properties:
        name:
          description: Variable name to look up in the runtime context.
          example: user_age
          title: Name
          type: string
        type:
          const: variable
          title: Type
          type: string
      required:
        - type
        - name
      title: DynamicVariableExpression
      type: object
    StringLiteralExpression:
      description: Constant string value.
      example:
        type: string_literal
        value: gold
      properties:
        type:
          const: string_literal
          title: Type
          type: string
        value:
          description: Literal string value.
          example: gold
          title: Value
          type: string
      required:
        - type
        - value
      title: StringLiteralExpression
      type: object
    NumberLiteralExpression:
      description: >-
        Constant numeric value (float; integers are accepted and stored as
        float).
      example:
        type: number_literal
        value: 18
      properties:
        type:
          const: number_literal
          title: Type
          type: string
        value:
          description: Literal numeric value.
          example: 18
          title: Value
          type: number
      required:
        - type
        - value
      title: NumberLiteralExpression
      type: object
    BooleanLiteralExpression:
      description: Constant boolean value. Useful for unconditional ('always') edges.
      example:
        type: bool_literal
        value: true
      properties:
        type:
          const: bool_literal
          title: Type
          type: string
        value:
          description: Literal boolean value.
          title: Value
          type: boolean
      required:
        - type
        - value
      title: BooleanLiteralExpression
      type: object
  headers:
    IdempotentReplayed:
      description: >-
        Present with value `true` when Edge replayed a stored successful
        response for the supplied Idempotency-Key. Omitted for first-time
        requests and error responses.
      schema:
        type: boolean
        enum:
          - true
        example: true
  responses:
    IdempotencyConflictResponse:
      description: >-
        A request with the same Idempotency-Key is still being processed
        (10036). Retry later with the same key and request.
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ErrorResponse'
          example:
            errors:
              - code: '10036'
                title: Resource is being processed
                detail: >-
                  A request with this Idempotency-Key is already being
                  processed.
                source:
                  pointer: /header/Idempotency-Key
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer

````



