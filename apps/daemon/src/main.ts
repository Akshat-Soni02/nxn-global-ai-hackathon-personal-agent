// Daemon entry point: the always-on process (launched at login later; `pnpm daemon` for now).
// Until the menu bar exists, type commands on stdin:
//   record | stop | status
//   run <skill.json> [name=value ...]   replay a skill (web steps go through the extension)
//   approve | deny                      answer a pending approval
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { socketPath } from "@taskplayer/ipc";
import type { RunLogEvent } from "@taskplayer/player";
import { startDaemon } from "./daemon.ts";
import { runSkillFile } from "./runner.ts";

const log = (...args: unknown[]) => console.error("[daemon]", ...args);
// `pnpm daemon` runs inside apps/daemon; resolve paths typed at the prompt from where pnpm was started.
const userCwd = process.env.INIT_CWD ?? process.cwd();
const path = socketPath();
const daemon = await startDaemon({ socketPath: path, log });
log("listening on", path);

let pendingApproval: ((approved: boolean) => void) | undefined;
let running = false;

function printRun(e: RunLogEvent) {
  if (e.type === "run.start") log(`▶ ${e.skillId} v${e.version}`);
  if (e.type === "step.result") {
    const r = e.result;
    const match = r.matchScore !== undefined ? ` match ${r.matchScore}` : "";
    log(`  ${r.ok ? "✓" : "✗"} ${e.stepId} (try ${e.attempt}, ${e.ms} ms)${match}${r.ok ? "" : `  ${r.error}`}`);
  }
  if (e.type === "run.end") log(`■ ${e.status} in ${e.ms} ms${e.error ? `: ${e.error}` : ""}`);
}

async function run(args: string[]) {
  const [file, ...pairs] = args;
  if (!file) return log("usage: run <skill.json> [name=value ...]");
  if (running) return log("a run is already in progress");
  const provided = Object.fromEntries(pairs.map((p) => [p.split("=")[0], p.split("=").slice(1).join("=")]));
  running = true;
  try {
    await runSkillFile(daemon, resolve(userCwd, file), provided, {
      log: printRun,
      approve: (step) =>
        new Promise((resolve) => {
          log(`approval needed for ${step.id}: "${step.intent}". Type approve or deny.`);
          pendingApproval = resolve;
        }),
    });
  } catch (error) {
    log("run failed:", (error as Error).message);
  } finally {
    running = false;
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const [command, ...args] = line.trim().split(/\s+/);
  if (command === "approve" || command === "deny") {
    if (!pendingApproval) return log("nothing to approve");
    pendingApproval(command === "approve");
    pendingApproval = undefined;
  } else if (command === "run") void run(args);
  else if (command === "record") daemon.startRecording();
  else if (command === "stop") daemon.stopRecording();
  else if (command === "status")
    log(`${daemon.extensions.size} extension(s) connected${running ? ", run in progress" : ""}`);
  else if (command) log("commands: run <skill.json>, approve, deny, record, stop, status");
});

const shutdown = () => daemon.close().then(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
