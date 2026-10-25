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
    // A `security` that could not start or exited early closes its stdin; an unhandled stream error would crash the
    // daemon, and the exit code already says it failed.
    child.stdin?.on("error", () => {});
    if (stdin !== undefined) child.stdin?.end(stdin);
    else child.stdin?.end();
  });

// A quoted argument for `security -i`: the key is escaped so it reads as one argument.
const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Since Oct 25 the signed-in account's refresh token sits beside the key, under its own account name (account.ts).
export const KEYCHAIN_SESSION = "shadow-account";

export async function readSecret(account: string, run: SecurityRunner = runSecurity): Promise<string | undefined> {
  const { stdout, code } = await run(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"]);
  if (code !== 0) return undefined; // 44: not found
  const value = stdout.trim();
  return value || undefined;
}

export async function writeSecret(
  account: string,
  label: string,
  value: string,
  run: SecurityRunner = runSecurity,
): Promise<void> {
  // -U updates the item if it exists. The command goes to security's interactive mode, not argv.
  const command = `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(account)} -l ${quote(label)} -w ${quote(value)}\n`;
  const { code } = await run(["-i"], command);
  if (code !== 0) throw new Error("the Keychain refused to store it");
}

export async function deleteSecret(account: string, run: SecurityRunner = runSecurity): Promise<void> {
  await run(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account]);
}

export function readApiKey(run: SecurityRunner = runSecurity): Promise<string | undefined> {
  return readSecret(KEYCHAIN_ACCOUNT, run);
}

export async function writeApiKey(key: string, run: SecurityRunner = runSecurity): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed || /\s/.test(trimmed)) throw new Error("that doesn't look like an API key");
  await writeSecret(KEYCHAIN_ACCOUNT, "Shadow: Nebius Token Factory key", trimmed, run).catch(() => {
    throw new Error("the Keychain refused to store the key");
  });
}

export async function deleteApiKey(run: SecurityRunner = runSecurity): Promise<void> {
  await deleteSecret(KEYCHAIN_ACCOUNT, run);
}
