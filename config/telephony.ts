// Phone destinations explicitly supplied by Joel for the support assistant.
// These constants are intentionally versioned; deployment logs redact them.

// Purchased and assigned Telnyx number, also used as the transfer caller ID.
export const TELNYX_PHONE_NUMBER = "+33221857507";

// Joel's chosen demonstration technician destination. Never call it at deploy.
export const TECHNICIAN_PHONE_NUMBER = "+33783240697";

// Explicit country permission for the configured French technician. Changing
// the destination's country requires reviewing this routing permission too.
export const TECHNICIAN_COUNTRY = "FR";

// The phone application has a stable name. Its outbound profile is the existing
// Portal profile; deployment preserves its countries and adds the required one.
export function buildPhoneRoutingConfig(functionUrl: string, projectName: string) {
  const origin = new URL(functionUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash ||
    !/^[A-Za-z0-9_-]+$/.test(projectName)) throw new Error("Invalid phone routing configuration.");
  return { phone_number: TELNYX_PHONE_NUMBER, application_name: projectName + "-voice",
    voice_url: new URL("/voice-entry", origin).href,
    required_outbound_countries: [TECHNICIAN_COUNTRY] };
}

// Configuration shared by the deployment module and its offline checks.
export type PhoneRoutingConfig = ReturnType<typeof buildPhoneRoutingConfig>;
