// Display project npm usage without loading .env, deployment state, or APIs.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { renderCommandHelp } from "./lib/commands";

// The actual package script list is checked against the shared help metadata.
async function main(): Promise<void> {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (!packageJson.scripts || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts)) throw new Error("Invalid package scripts.");
  console.log(renderCommandHelp(packageJson.scripts));
}

// Imports from tests are inert and failed reads expose no file contents.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Could not read command help. Check package.json and command descriptions."); process.exitCode = 1; });
}
