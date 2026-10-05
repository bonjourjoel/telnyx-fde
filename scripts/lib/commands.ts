// Public npm command descriptions and usage, shared by help and verification.
// package.json remains the executable command registry; metadata adds prose only.

// Arguments and optional notes stay next to each description for easy upkeep.
interface CommandUsage { description: string; arguments?: string; note?: string }

// One description per public package script. No credentials or real phones.
export const COMMAND_USAGE: Readonly<Record<string, CommandUsage>> = {
  help: { description: "Show available project commands." },
  typecheck: { description: "Check TypeScript without emitting files." },
  test: { description: "Run all local tests; no Telnyx account access." },
  deploy: { description: "Typecheck, test, deploy and reconcile existing Telnyx resources." },
  resetactor: { description: "Clear the Portal demo's tickets and reference counter.", arguments: "[-- --phone]",
    note: "--phone targets caller_phone from ignored reset-actor.local.json." },
  seedticketsweb: { description: "Load the ready-made tickets into the Portal demo Actor." },
  seedticketsphone: { description: "Load the same tickets for one phone caller.", arguments: "-- <E164_PHONE>",
    note: "Phone number is required; creates the caller Actor if needed. Use --silent to suppress npm's argument banner." },
  "technician:get": { description: "Read technician_available from the existing support/config KV key.",
    note: "Values take effect on the next call; no redeploy is needed." },
  "technician:true": { description: "Set technician_available to true in the existing support/config KV key.",
    note: "Required for the workflow to offer a technician; takes effect on the next call." },
  "technician:false": { description: "Set technician_available to false in the existing support/config KV key.",
    note: "Disables the technician offer; takes effect on the next call." },
};

// Refuse missing descriptions or stale entries instead of silently omitting
// commands. Tests check this against the actual package.json script keys.
export function renderCommandHelp(scripts: Record<string, unknown>): string {
  const names = Object.keys(scripts);
  if (names.some(name => typeof scripts[name] !== "string" || !Object.hasOwn(COMMAND_USAGE, name)) ||
    Object.keys(COMMAND_USAGE).some(name => !Object.hasOwn(scripts, name))) throw new Error("Command help does not match package scripts.");
  const lines = ["Usage: npm.cmd run <command> [-- <arguments>]", ""];
  for (const name of Object.keys(COMMAND_USAGE)) {
    const entry = COMMAND_USAGE[name];
    lines.push(`npm.cmd run ${name}${entry.arguments ? " " + entry.arguments : ""}`, `  ${entry.description}`);
    if (entry.note) lines.push(`  ${entry.note}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
