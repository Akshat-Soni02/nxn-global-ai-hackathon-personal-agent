// Registers apps/native-host with Chrome so the extension can reach the daemon.
// Writes a launcher (Chrome starts hosts with a bare PATH, so it pins the absolute node binary) and the host manifest.
// Usage: pnpm setup:native-host [--uninstall]
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXTENSION_ID, NATIVE_HOST_NAME } from "../packages/core/src/messages.ts";
import { APP_SUPPORT_DIR } from "../packages/ipc/src/paths.ts";

const repo = join(import.meta.dirname, "..");
const hostScript = join(repo, "apps/native-host/dist/native-host.mjs");
const launcher = join(APP_SUPPORT_DIR, "native-host");
const manifestDir = join(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
const manifestPath = join(manifestDir, `${NATIVE_HOST_NAME}.json`);

if (process.argv.includes("--uninstall")) {
  rmSync(manifestPath, { force: true });
  rmSync(launcher, { force: true });
  console.log("removed", manifestPath, "and", launcher);
  process.exit(0);
}

execSync("pnpm --filter @taskplayer/native-host build", { cwd: repo, stdio: "inherit" });
if (!existsSync(hostScript)) throw new Error(`build did not produce ${hostScript}`);

mkdirSync(APP_SUPPORT_DIR, { recursive: true });
writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${hostScript}" "$@"\n`);
chmodSync(launcher, 0o755);

mkdirSync(manifestDir, { recursive: true });
const manifest = {
  name: NATIVE_HOST_NAME,
  description: "Task Player bridge between the Chrome extension and the daemon",
  path: launcher,
  type: "stdio",
  allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log("launcher:", launcher);
console.log("manifest:", manifestPath);
console.log("Reload the extension in chrome://extensions to connect.");
