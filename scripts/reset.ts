// Removes Shadow from this Mac as far as a script can, so it can be set up and tested from scratch: the daemon, a
// local shadow-api and the app (stopped), the login agent, macOS permissions (for Shadow's bundle id only), Chrome's
// bridge, the API key and the Shadow sign-in in the Keychain, the data and logs (workflows, recordings, memory,
// connectors.json), and the build output. What only you can do is listed at the end.
//
// Usage: pnpm reset:shadow [--backup] [--dry-run] [--keep-key] [--keep-signin] [--keep-build]
//   --backup       move the data and logs to ~/shadow-backup/<date time>/ instead of deleting them
//   --dry-run      say what would be done, change nothing
//   --keep-key     leave the Token Factory key in the Keychain (the repo's .env is never touched)
//   --keep-signin  stay signed in to Shadow (the device token in the Keychain)
//   --keep-build   leave apps/mac/build and dist (a rebuild changes the app's signature, so macOS asks again anyway)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const known = new Set(["--backup", "--dry-run", "--keep-key", "--keep-signin", "--keep-build", "--help", "-h"]);
const unknown = [...args].filter((a) => !known.has(a));
if (args.has("--help") || args.has("-h") || unknown.length > 0) {
  if (unknown.length > 0) console.error(`unknown option: ${unknown.join(" ")}\n`);
  console.log("Usage: pnpm reset:shadow [--backup] [--dry-run] [--keep-key] [--keep-signin] [--keep-build]");
  process.exit(unknown.length > 0 ? 1 : 0);
}
const backup = args.has("--backup");
const dryRun = args.has("--dry-run");

const home = homedir();
const repo = join(import.meta.dirname, "..");
const BUNDLE_ID = "com.shadow.mac";
const LABEL = "com.shadow.daemon";
const KEYCHAIN = { service: "com.shadow.mac", account: "token-factory" };
// Since Oct 25: the signed-in account's refresh token (apps/daemon/src/keychain.ts, KEYCHAIN_SESSION).
const SIGNIN = { service: "com.shadow.mac", account: "shadow-account" };
const BACKUP_ROOT = join(home, "shadow-backup");
const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
const backupDir = join(BACKUP_ROOT, stamp);

// What each step did, for the summary.
const done: string[] = [];
const failed: string[] = [];
const say = (line: string) => console.log(`${dryRun ? "[dry run] " : ""}${line}`);

// Runs a command; never throws (a step that fails is reported and the rest go on).
function run(cmd: string, argv: string[]): { ok: boolean; out: string } {
  if (dryRun) {
    say(`would run: ${cmd} ${argv.join(" ")}`);
    return { ok: true, out: "" };
  }
  try {
    const out = execFileSync(cmd, argv, { stdio: ["ignore", "pipe", "pipe"] }).toString();
    return { ok: true, out };
  } catch (error) {
    const e = error as { stderr?: Buffer; message: string };
    return { ok: false, out: e.stderr?.toString().trim() || e.message };
  }
}

// Deletes a path, or moves it into the backup folder (under `as`) when --backup is given.
function clear(path: string, as: string) {
  if (!existsSync(path)) return;
  if (dryRun) {
    say(backup ? `would move ${path} → ${join(backupDir, as)}` : `would delete ${path}`);
    return;
  }
  try {
    if (backup) {
      mkdirSync(backupDir, { recursive: true });
      const to = join(backupDir, as);
      try {
        renameSync(path, to);
      } catch {
        cpSync(path, to, { recursive: true }); // across volumes: copy, then remove
        rmSync(path, { recursive: true, force: true });
      }
      done.push(`moved ${path} → ${to}`);
    } else {
      rmSync(path, { recursive: true, force: true });
      done.push(`deleted ${path}`);
    }
  } catch (error) {
    failed.push(`${path}: ${(error as Error).message}`);
  }
}

console.log(
  `Removing Shadow from this Mac${backup ? `, data backed up to ${backupDir}` : ", data deleted (no --backup)"}.\n`,
);

// 1. Stop the daemon and the app. The login agent first, so launchd doesn't start the daemon again.
const domain = `gui/${userInfo().uid}`;
run("launchctl", ["bootout", `${domain}/${LABEL}`]);
clear(join(home, "Library", "LaunchAgents", `${LABEL}.plist`), "LaunchAgents-com.shadow.daemon.plist");
for (const pattern of [
  "apps/daemon/src/main.ts",
  // A local shadow-api (pnpm --filter @shadow/api dev, or its bundle).
  "apps/api/src/main.ts",
  "apps/api/dist/server.mjs",
  "Shadow.app/Contents/Resources/daemon.js",
  "Shadow.app/Contents/MacOS/Shadow",
]) {
  const result = run("pkill", ["-f", pattern]);
  if (result.ok && !dryRun) done.push(`stopped processes matching ${pattern}`);
}
// `pnpm daemon` and `pnpm --filter @shadow/api dev` run `tsx src/main.ts` from inside their app's folder: their
// command line names no app, so they are found by the folder they run in (this repo's, never another project's).
const listed = run("pgrep", ["-f", "src/main.ts"]);
for (const pid of dryRun ? [] : listed.out.split("\n").filter(Boolean)) {
  const cwd = run("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]).out.match(/^n(.+)$/m)?.[1] ?? "";
  const app = ["daemon", "api"].find((a) => cwd === join(repo, "apps", a));
  if (!app) continue;
  if (run("kill", [pid]).ok) done.push(`stopped the ${app === "api" ? "local shadow-api" : "daemon"} (pid ${pid})`);
}
if (dryRun) say(`would stop \`tsx src/main.ts\` processes running in ${join(repo, "apps", "daemon")} or apps/api`);

// 2. macOS permissions, for Shadow's bundle id only (other apps' permissions are untouched).
for (const service of [
  "Accessibility",
  "ScreenCapture",
  "Microphone",
  "SpeechRecognition",
  "AppleEvents",
  "ListenEvent",
  "PostEvent",
]) {
  const result = run("tccutil", ["reset", service, BUNDLE_ID]);
  if (dryRun) continue;
  // tccutil also fails when Shadow has no entry for that permission: nothing to reset, not an error.
  done.push(result.ok ? `reset ${service} for ${BUNDLE_ID}` : `${service}: nothing to reset for ${BUNDLE_ID}`);
}

// 3. Chrome's bridge to the daemon (the native messaging host), and the old Task Player one.
const hosts = join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
for (const name of ["com.shadow.daemon.json", "com.taskplayer.daemon.json"]) {
  const path = join(hosts, name);
  if (!existsSync(path)) continue;
  if (dryRun) say(`would delete ${path}`);
  else {
    rmSync(path, { force: true });
    done.push(`deleted ${path}`);
  }
}

// 4. The Token Factory key in the Keychain.
if (args.has("--keep-key")) done.push("kept the Keychain key (--keep-key)");
else {
  const result = run("security", ["delete-generic-password", "-s", KEYCHAIN.service, "-a", KEYCHAIN.account]);
  if (!dryRun) {
    if (result.ok) done.push(`deleted the Keychain key (${KEYCHAIN.service} / ${KEYCHAIN.account})`);
    else done.push("no Keychain key to delete");
  }
}
// The Shadow sign-in (a device token). Signing in again is a browser round trip; the service keeps the account.
if (args.has("--keep-signin")) done.push("kept the Shadow sign-in (--keep-signin)");
else {
  const result = run("security", ["delete-generic-password", "-s", SIGNIN.service, "-a", SIGNIN.account]);
  if (!dryRun) done.push(result.ok ? "signed out of Shadow (deleted the device token)" : "not signed in to Shadow");
}

// 5. Data and logs: workflows, recordings, memory, the runs database, consents, logs; and the pre-rename folder.
clear(join(home, "Library", "Application Support", "Shadow"), "Shadow");
clear(join(home, "Library", "Logs", "Shadow"), "Logs");
clear(join(home, "Library", "Application Support", "TaskPlayer"), "TaskPlayer");

// 6. The packaged app, if it was installed.
clear("/Applications/Shadow.app", "Shadow.app");

// 7. Build output.
if (args.has("--keep-build")) done.push("kept the build output (--keep-build)");
else {
  clear(join(repo, "apps", "mac", "build"), "mac-build");
  clear(join(repo, "dist"), "dist");
}

// What's left, checked.
const left: string[] = [];
if (!dryRun) {
  const agents = run("launchctl", ["list"]);
  if (agents.ok && /com\.shadow/.test(agents.out))
    left.push("launchctl still lists com.shadow.* (log out and in, or see Login Items below)");
  if (existsSync(join(hosts, "com.shadow.daemon.json"))) left.push("Chrome's bridge file is still there");
  if (existsSync(join(home, "Library", "Application Support", "Shadow")))
    left.push("~/Library/Application Support/Shadow is still there");
}

if (dryRun) console.log("\nNothing was changed: the lines above are what a real run does.");
else {
  console.log("\nDone:");
  for (const line of done) console.log(`  ✓ ${line}`);
}
if (failed.length > 0) {
  console.log("\nCouldn't do:");
  for (const line of failed) console.log(`  ✗ ${line}`);
}
if (left.length > 0) {
  console.log("\nStill there:");
  for (const line of left) console.log(`  ! ${line}`);
}

console.log(`
What only you can do (macOS and Chrome don't let a script do these):
  1. Chrome: open chrome://extensions and Remove the Shadow extension.
  2. System Settings → Privacy & Security → Accessibility, Screen Recording, Microphone: if a "Shadow" row is still
     listed (a stale one from an earlier build), select it and press −.
  3. System Settings → Privacy & Security → Files and Folders: remove Desktop / Documents / Downloads access from the
     app that ran the daemon (your terminal, or "node"). These were granted to it, not to Shadow, so the script
     leaves them alone rather than reset your terminal's access.
  4. System Settings → General → Login Items & Extensions: if Shadow is listed (the packaged app registers itself),
     switch it off or remove it.
  5. System Settings → Notifications → Shadow: switch it off if it's still listed (it goes once the app is gone).
  6. Your repo's .env (NEBIUS_API_KEY) is never touched: delete the key there yourself if you want a key-less start.

Then set up fresh:
  pnpm install && pnpm build && pnpm setup:mac && pnpm setup:native-host
  load apps/extension/dist unpacked in chrome://extensions (Details → Allow access to file URLs)
  To try sign-in and connected apps locally, start shadow-api first, in its own terminal:
    STORE=memory AUTH=dev QUOTAS=off NEBIUS_API_KEY=<key> [COMPOSIO_API_KEY=<key> | TOOLS=fake] pnpm --filter @shadow/api dev
  and put SHADOW_API_URL=http://localhost:8080 in the repo's .env. Then: pnpm daemon
${backup && !dryRun ? `\nThe backup is in ${backupDir}` : ""}`);
