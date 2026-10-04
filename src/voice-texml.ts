// Shared validation for the assistant startup XML fetched during deployment
// and served from KV. Only the observed Connect/AIAssistant document is accepted.

// Separate routing instructions from support/config and persistent tickets.
export const VOICE_TEXML_KEY = "voice/texml";

// Bound the small startup document and reject unsupported XML instructions.
const MAX_TEXML_LENGTH = 16_384;
const STARTUP_TEXML = /^\s*(?:<\?xml\s+version=["']1\.0["']\s+encoding=["']UTF-8["']\s*\?>\s*)?<Response>\s*<Connect>\s*<AIAssistant\s+id=(["'])([A-Za-z0-9_-]{1,100})\1\s*(?:\/>|>\s*<\/AIAssistant>)\s*<\/Connect>\s*<\/Response>\s*$/;

// This is a deliberately narrow startup grammar, not a general XML parser.
// Extra verbs, attributes, entities and declarations need explicit review.
export function assistantStartupId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_TEXML_LENGTH) return null;
  return STARTUP_TEXML.exec(value)?.[2] ?? null;
}
