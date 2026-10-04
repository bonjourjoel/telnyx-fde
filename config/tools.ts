// Desired shared-tool definitions for API deployment. Build requests ourselves,
// never resend merged GET definitions or their read-only shared/id fields.

import {
  MAX_SUBJECT_LENGTH, MAX_DESCRIPTION_LENGTH, WRITABLE_DYNAMIC_VARIABLE_KEYS,
  type WritableDynamicVariableKey,
} from "../src/contracts";
import { TELNYX_PHONE_NUMBER, TECHNICIAN_PHONE_NUMBER } from "./telephony";

// Stable logical names used in deployment-state.json and later workflow refs.
export const SUPPORT_TOOL_NAMES = ["SET_SUPPORT_VARIABLES", "CREATE_TICKET", "TRANSFER", "HANGUP"] as const;
export type SupportToolName = (typeof SUPPORT_TOOL_NAMES)[number];

// Exact top-level CreateSharedToolRequest shape, with the native configuration.
export interface SharedToolDefinition {
  type: "update_dynamic_variables" | "webhook" | "transfer" | "hangup";
  display_name: string;
  timeout_ms: number;
  update_dynamic_variables?: Record<string, unknown>;
  webhook?: Record<string, unknown>;
  transfer?: Record<string, unknown>;
  hangup?: Record<string, unknown>;
}

// Descriptions guide collection while retaining the single contracts allowlist.
const VARIABLE_DESCRIPTIONS: Record<WritableDynamicVariableKey, string> = {
  selected_ticket_status_text: "Copy the selected ticket's exact backend status_text, including its reference and status.",
  ticket_subject: "Collect a concise ticket subject without credentials.",
  ticket_description: "Collect a concise support description without credentials.",
};

// Validate local deployment inputs before provisioning or issuing any writes.
export function validateTelephony(): void {
  if (!/^\+[1-9]\d{6,14}$/.test(TELNYX_PHONE_NUMBER) || !/^\+[1-9]\d{6,14}$/.test(TECHNICIAN_PHONE_NUMBER)) {
    throw new Error("invalid telephony configuration");
  }
}

// Build the complete desired tool payloads from the actual deployed URL.
export function buildSharedTools(functionUrl: string, projectName: string): Record<SupportToolName, SharedToolDefinition> {
  validateTelephony();
  const base = new URL(functionUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
    base.pathname !== "/" || !/^[a-zA-Z0-9_-]+$/.test(projectName)) {
    throw new Error("invalid shared-tool deployment configuration");
  }
  // Project-prefixed labels identify owned library resources unambiguously.
  const label = (name: SupportToolName) => `${projectName}: ${name}`;
  return {
    SET_SUPPORT_VARIABLES: {
      type: "update_dynamic_variables", display_name: label("SET_SUPPORT_VARIABLES"), timeout_ms: 5000,
      update_dynamic_variables: {
        name: "SET_SUPPORT_VARIABLES", description: "Update only the listed support conversation inputs.",
        updatable_variables: WRITABLE_DYNAMIC_VARIABLE_KEYS.map((name) => ({
          name, type: "string", description: VARIABLE_DESCRIPTIONS[name],
        })),
      },
    },
    CREATE_TICKET: {
      type: "webhook", display_name: label("CREATE_TICKET"), timeout_ms: 10000,
      webhook: {
        name: "CREATE_TICKET", description: "Create a support ticket only after explicit caller confirmation.",
        url: new URL("/tickets/create", base).href, method: "POST", async: false,
        body_parameters: {
          type: "object", properties: {
            ticket_subject: { type: "string", minLength: 1, maxLength: MAX_SUBJECT_LENGTH, description: "Confirmed ticket subject." },
            ticket_description: { type: "string", minLength: 1, maxLength: MAX_DESCRIPTION_LENGTH, description: "Confirmed concise description without secrets." },
          }, required: ["ticket_subject", "ticket_description"],
        },
        preset_body_fields: { conversation_channel: "{{telnyx_conversation_channel}}",
          caller_phone: "{{telnyx_end_user_target}}", operation_id: "{{operation_id}}" },
        store_fields_as_variables: [
          { name: "created_ticket_id", value_path: "ticket_id" },
          { name: "created_ticket_reference", value_path: "ticket_reference" },
        ],
      },
    },
    TRANSFER: {
      type: "transfer", display_name: label("TRANSFER"), timeout_ms: 5000,
      transfer: { targets: [{ name: "Demo technician", to: TECHNICIAN_PHONE_NUMBER }], from: TELNYX_PHONE_NUMBER },
    },
    HANGUP: {
      type: "hangup", display_name: label("HANGUP"), timeout_ms: 5000,
      hangup: { description: "End the support conversation after the final message." },
    },
  };
}
