// The Token Factory API key in the macOS Keychain (docs/design.md, "Models" and "Deployment"): the packaged app has
// no .env, so the key the user pastes on first run (or in Settings) lives in their login keychain, under Shadow's
// name, and the daemon reads it when it starts. macOS's own `security` tool does the reading and writing; the key
// is handed to it on stdin (its interactive mode), never on the command line, so it never shows in a process list.
import { execFile } from "node:child_process";

export const KEYCHAIN_SERVICE = "com.shadow.mac";
export const KEYCHAIN_ACCOUNT = "token-factory";

// Runs `security` with commands on stdin; resolves with stdout and the exit code.
export type SecurityRunner = (args: string[], stdin?: string) => Promise<{ stdout: string; code: number }>;

export const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve) => {
    const child = execFile("/usr/bin/security", args, { timeout: 10_000 }, (error, stdout) => {
      const code = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({ stdout: String(stdout ?? ""), code });
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
    else child.stdin?.end();
  });

// A quoted argument for `security -i`: the key is escaped so it reads as one argument.
const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function readApiKey(run: SecurityRunner = runSecurity): Promise<string | undefined> {
  const { stdout, code } = await run(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"]);
  if (code !== 0) return undefined; // 44: not found
  const key = stdout.trim();
  return key || undefined;
}

export async function writeApiKey(key: string, run: SecurityRunner = runSecurity): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed || /\s/.test(trimmed)) throw new Error("that doesn't look like an API key");
  // -U updates the item if it exists. The command goes to security's interactive mode, not argv.
  const command = `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(KEYCHAIN_ACCOUNT)} -l ${quote("Shadow: Nebius Token Factory key")} -w ${quote(trimmed)}\n`;
  const { code } = await run(["-i"], command);
  if (code !== 0) throw new Error("the Keychain refused to store the key");
}

export async function deleteApiKey(run: SecurityRunner = runSecurity): Promise<void> {
  await run(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT]);
}
