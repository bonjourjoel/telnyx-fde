// Single local test entry point shared by npm run test and deployment preflight.
// Uses Node's native test runner sequentially; never loads .env or calls Telnyx.

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// The full local suite is maintained here only, including the two legacy names.
const LOCAL_TEST_FILES = [
  "scripts/check-caller-tickets.ts",
  "scripts/check-http.ts",
  "scripts/check-kv.test.ts",
  "scripts/check-runtime-binding.test.ts",
  "scripts/check-mcp.test.ts",
  "scripts/check-mcp-registration.test.ts",
  "scripts/check-resource-upsert.test.ts",
  "scripts/check-assistant.test.ts",
  "scripts/check-phone-routing.test.ts",
  "scripts/check-commands.test.ts",
] as const;
// Resolve the suite from the project root regardless of the caller's directory.
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

// Stream the test output and reject any failure so deploy cannot continue.
// Run Node directly to avoid npm.cmd shell handling and quoting on Windows.
export function runLocalTests(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...LOCAL_TEST_FILES],
      { cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: true });
    child.once("error", () => reject(new Error("Could not start local tests.")));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Local tests failed. Deployment stopped."));
    });
  });
}

// Imports from deploy are inert; the npm command explicitly runs this entry point.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalTests().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Local tests failed.");
    process.exitCode = 1;
  });
}
