// Minimal support workflow and local validation of its graph and tool references.
// Speak messages and conversation instructions were approved by Joel for step 9.

import * as z from "zod/v4";

// Approved wording stays separate from graph construction for easy review.
export const CONVERSATION_PROMPT = "This is a minimal configuration test. Have a short conversation with the user in English. Ask one question at a time. Ticket follow-up, FAQ answers, ticket creation, and technician transfers are not enabled in this test yet. If the user requests one of these actions, explain this briefly. When the user wants to finish, let the workflow deliver the goodbye message.";
export const END_CONVERSATION_CONDITION = "The user has clearly asked to end the conversation or said that they need no further help.";
export const GOODBYE_MESSAGE = "Thank you for calling Telnyx developer support. Goodbye.";

// Explicit request schemas exclude resolved tools and other response-only fields.
const PositionSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const NodeFields = { id: z.string().min(1), name: z.string().min(1), position: PositionSchema };
const NodeSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...NodeFields, type: z.literal("speak"), message: z.string().min(1) }),
  z.strictObject({ ...NodeFields, type: z.literal("prompt"), instructions: z.string().min(1),
    instructions_mode: z.literal("append"), shared_tool_ids: z.array(z.string().min(1)), tools_mode: z.literal("replace") }),
  z.strictObject({ ...NodeFields, type: z.literal("tool"), shared_tool_id: z.string().min(1) }),
]);
const EdgeSchema = z.strictObject({ id: z.string().min(1), start_node_id: z.string().min(1),
  target: z.strictObject({ type: z.literal("node"), node_id: z.string().min(1) }),
  condition: z.discriminatedUnion("type", [z.strictObject({ type: z.literal("default") }),
    z.strictObject({ type: z.literal("llm"), prompt: z.string().min(1) })]) });
const FlowSchema = z.strictObject({ start_node_id: z.string().min(1), nodes: z.array(NodeSchema).min(1), edges: z.array(EdgeSchema) });
export type ConversationFlow = z.infer<typeof FlowSchema>;

// Check the same graph invariants enforced by Telnyx before provisioning writes.
// Prompt nodes cannot have default edges; deterministic steps must not dead-end.
export function validateConversationFlow(value: unknown, sharedToolIds: readonly string[]): ConversationFlow {
  const parsed = FlowSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid conversation flow format");
  const flow = parsed.data;
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  const edgeIds = new Set(flow.edges.map((edge) => edge.id));
  if (nodes.size !== flow.nodes.length || edgeIds.size !== flow.edges.length || !nodes.has(flow.start_node_id)) {
    throw new Error("invalid conversation flow identifiers");
  }
  for (const edge of flow.edges) {
    if (!nodes.has(edge.start_node_id) || !nodes.has(edge.target.node_id)) throw new Error("invalid conversation flow edge reference");
  }
  for (const node of flow.nodes) {
    const outgoing = flow.edges.filter((edge) => edge.start_node_id === node.id);
    const defaults = outgoing.filter((edge) => edge.condition.type === "default").length;
    if (node.type === "prompt" && defaults) throw new Error("prompt nodes cannot have default edges");
    if ((node.type === "speak" || (node.type === "tool" && outgoing.length > 0)) && defaults !== 1) {
      throw new Error("deterministic nodes require exactly one default edge");
    }
    const references = node.type === "tool" ? [node.shared_tool_id] : node.type === "prompt" ? node.shared_tool_ids : [];
    if (references.some((id) => !sharedToolIds.includes(id))) throw new Error("unknown workflow shared tool reference");
  }
  // Every configured step must be reachable from the entry point.
  const reachable = new Set([flow.start_node_id]);
  for (const id of reachable) for (const edge of flow.edges) {
    if (edge.start_node_id === id) reachable.add(edge.target.node_id);
  }
  if (reachable.size !== nodes.size) throw new Error("unreachable conversation flow node");
  return flow;
}

// Stable ids and readable canvas coordinates survive every complete graph update.
// The prompt exposes no business tools; Telnyx still offers its transition tool.
export function buildMinimalWorkflow(hangupToolId: string): ConversationFlow {
  return validateConversationFlow({
    start_node_id: "greeting",
    nodes: [
      { type: "speak", id: "greeting", name: "GREETING", message: "{{greeting_text}}", position: { x: 0, y: 0 } },
      { type: "prompt", id: "conversation", name: "CONVERSATION", instructions: CONVERSATION_PROMPT,
        instructions_mode: "append", shared_tool_ids: [], tools_mode: "replace", position: { x: 300, y: 0 } },
      { type: "speak", id: "goodbye", name: "GOODBYE", message: GOODBYE_MESSAGE, position: { x: 600, y: 0 } },
      { type: "tool", id: "hangup", name: "HANGUP", shared_tool_id: hangupToolId, position: { x: 900, y: 0 } },
    ],
    edges: [
      { id: "greeting_to_conversation", start_node_id: "greeting", target: { type: "node", node_id: "conversation" }, condition: { type: "default" } },
      { id: "conversation_to_goodbye", start_node_id: "conversation", target: { type: "node", node_id: "goodbye" }, condition: { type: "llm", prompt: END_CONVERSATION_CONDITION } },
      { id: "goodbye_to_hangup", start_node_id: "goodbye", target: { type: "node", node_id: "hangup" }, condition: { type: "default" } },
    ],
  }, [hangupToolId]);
}
