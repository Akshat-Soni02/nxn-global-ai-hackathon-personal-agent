// Starts the daemon at login, from this repo (docs/design.md, "Deployment"): a LaunchAgent, so launchd starts it when
// you log in and again if it exits, with no terminal open. The daemon then opens Shadow.app (menu bar, window).
// This is the development path; the packaged app registers the daemon inside itself instead (milestone 9).
// Usage: pnpm setup:daemon [--uninstall | --print]
//   --print      show the LaunchAgent file without installing it
//   --uninstall  stop the daemon and remove the LaunchAgent
// Its output (and anything it prints) goes to ~/Library/Logs/Shadow/launchd.log; its own log is daemon.log there.
// Only one daemon runs at a time: stop this one (--uninstall) before running `pnpm daemon` in a terminal.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { logDir } from "../packages/ipc/src/paths.ts";

const LABEL = "com.shadow.daemon";
const repo = join(import.meta.dirname, "..");
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const domain = `gui/${userInfo().uid}`;
const tsx = join(repo, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repo, "apps", "daemon", "src", "main.ts");
const logs = logDir();
// Homebrew's node lives in a versioned folder that `brew upgrade` removes: use its stable link when it is this node.
const node =
  ["/opt/homebrew/bin/node", "/usr/local/bin/node"].find(
    (link) => existsSync(link) && realpathSync(link) === realpathSync(process.execPath),
  ) ?? process.execPath;

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const string = (s: string) => `<string>${xml(s)}</string>`;

function launchAgent(options: { node: string; tsx: string; entry: string; workdir: string; logs: string }): string {
  // launchd starts programs with a bare PATH: give the daemon the node it was installed with, and the system tools.
  const path = [
    ...new Set([
      dirname(options.node),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${string(LABEL)}
  <key>ProgramArguments</key>
  <array>${string(options.node)}${string(options.tsx)}${string(options.entry)}</array>
  <key>WorkingDirectory</key>${string(options.workdir)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>${string(path.join(":"))}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key>${string("Interactive")}
  <key>StandardOutPath</key>${string(join(options.logs, "launchd.log"))}
  <key>StandardErrorPath</key>${string(join(options.logs, "launchd.log"))}
</dict>
</plist>
`;
}

const launchctl = (...args: string[]) => {
  try {
    execFileSync("launchctl", args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const plist = launchAgent({ node, tsx, entry, workdir: join(repo, "apps", "daemon"), logs });
if (process.argv.includes("--print")) {
  process.stdout.write(plist);
  process.exit(0);
}
if (process.argv.includes("--uninstall")) {
  launchctl("bootout", `${domain}/${LABEL}`);
  rmSync(plistPath, { force: true });
  console.log(`stopped the daemon and removed ${plistPath}`);
  process.exit(0);
}
if (!existsSync(tsx)) throw new Error(`no ${tsx}: run pnpm install first`);
if (!existsSync(join(repo, "apps", "ui", "dist", "index.html"))) {
  console.log("note: the window isn't built yet: run pnpm build (or pnpm ui) so the daemon can serve it");
}
mkdirSync(dirname(plistPath), { recursive: true });
mkdirSync(logs, { recursive: true });
writeFileSync(plistPath, plist);
// Replace a running one: it may point at an older checkout or node.
launchctl("bootout", `${domain}/${LABEL}`);
if (!launchctl("bootstrap", domain, plistPath)) {
  throw new Error(
    "launchctl bootstrap failed: is a daemon already running in a terminal? Stop it, then run this again",
  );
}
console.log(`the daemon starts at login and is running now (${plistPath})`);
console.log(`logs: ${join(logs, "daemon.log")} · stop it with: pnpm setup:daemon --uninstall`);
