// Approved single-offer ticket intake prompt and short result messages.
// The workflow's Tool nodes own creation and hangup; the intake Prompt only
// summarizes the request, asks for the caller's agreement, and stores both
// fields through the permitted native updater before the creation transition.

// Single ticket offer: summarize, ask for agreement, store fields, then route.
export const TICKET_INTAKE_PROMPT = `- FIRST ACTION:
Briefly summarize the caller's request, then ask:
"Would you like me to create a support ticket?"
Wait for the caller's answer about ticket creation.

- IF ANSWER FOR TICKET CREATION IS YES:
If the caller explicitly agrees, call SET_SUPPORT_VARIABLES with a short ticket_subject and a faithful ticket_description based on the request.
If SET_SUPPORT_VARIABLES succeeds, then call transition__ticket_intake_create.
If SET_SUPPORT_VARIABLES fails, call transition__ticket_intake_failed.

- IF ANSWER FOR TICKET CREATION IS NO:
If the caller declines, cancels, or wants to finish, call transition__ticket_intake_cancel.`;

// These prefixes are combined with the common farewell in one short Speak.
export const TICKET_CREATED_MESSAGE = "Your ticket reference is {{created_ticket_reference}}.";
// A timeout can follow a committed write, so do not claim no ticket was created.
export const TICKET_ERROR_MESSAGE = "I couldn't confirm ticket creation.";
// Missing usable identity or operation context blocks the single offer.
export const TICKET_UNAVAILABLE_MESSAGE = "I can't create a ticket during this call.";
