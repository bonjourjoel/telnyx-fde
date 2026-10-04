// Serve the stored assistant startup TeXML for incoming phone calls. This
// public instruction URL performs no caller resolution or business operation.

import { assistantStartupId, VOICE_TEXML_KEY } from "../voice-texml";
import { HttpError, observe, type HttpContext } from "./common";
import { SupportConfigError, diagnoseKvError } from "../kv-errors";

// Telnyx instruction requests are form encoded. Their body is intentionally
// unused: signed /init remains responsible for caller identity and ticket reads.
export async function handleVoiceEntry(_req: Request, context: HttpContext): Promise<Response> {
  const xml = await observe(context, "voice_texml_read", async () => {
    if (!context.env.SUPPORT_CONFIG?.get) throw new SupportConfigError({ code: "binding_missing" });
    let value: unknown;
    try { value = await context.env.SUPPORT_CONFIG.get<unknown>(VOICE_TEXML_KEY, { type: "json" }); }
    catch (error) { throw new SupportConfigError(diagnoseKvError(error)); }
    if (!assistantStartupId(value)) throw new HttpError(503, "voice_texml_unavailable");
    return value as string;
  });
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "no-store" } });
}
