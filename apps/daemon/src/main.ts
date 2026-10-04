// Daemon entry point: the always-on process (launched at login later; `pnpm daemon` for now).
// Until the menu bar exists, type commands on stdin:
//   record | stop                       record a task; stop compiles it into a skill (questions are asked here)
//   compile <session>                   recompile a kept trace
//   run <skill-id | skill.json> [name=value ...]   replay a skill (web steps go through the extension)
//   approve | deny                      answer a pending approval
//   skills | traces | status
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { dataDir, socketPath } from "@taskplayer/ipc";
import { openMemory } from "@taskplayer/memory";
import type { RunLogEvent } from "@taskplayer/player";
import { aiLimitsFromEnv, dataChannel } from "@taskplayer/player/node";
import type { Prompter, Question } from "@taskplayer/recorder";
import { startDaemon } from "./daemon.ts";
import { watchDirsFromEnv } from "./fs-watch.ts";
import { defaultSearchDirs } from "./locate-file.ts";
import { askFromEnv, chatFromEnv, finishRecording } from "./record.ts";
import { runSkillFile } from "./runner.ts";
import { listSkills, skillDir, versions } from "./skill-store.ts";
import { listTraces } from "./trace-store.ts";

// NEBIUS_BASE_URL, NEBIUS_API_KEY and NEMOTRON_MODEL from the repo's .env, if there is one (see .env.example).
try {
  process.loadEnvFile(join(import.meta.dirname, "../../../.env"));
} catch {
  // no .env: compile falls back to code only
}

const log = (...args: unknown[]) => console.error("[daemon]", ...args);
// `pnpm daemon` runs inside apps/daemon; resolve paths typed at the prompt from where pnpm was started.
const userCwd = process.env.INIT_CWD ?? process.cwd();
const path = socketPath();
const home = dataDir();
const watchDirs = watchDirsFromEnv();
const daemon = await startDaemon({ socketPath: path, log, dataDir: home, watchDirs });
const memory = openMemory(join(home, "memory.db"));
const chat = chatFromEnv();
// data.pick rules are free; data.ai calls the model on every run, so it is capped (calls per run, input size) and
// its answers are cached by question and data.
const data = dataChannel({ ask: askFromEnv(), cacheDir: join(home, "ai-cache"), limits: aiLimitsFromEnv() });
log("listening on", path);
log("data in", home, watchDirs.length > 0 ? `| watching ${watchDirs.join(", ")}` : "| file capture off");
log(
  chat
    ? `model: ${process.env.NEMOTRON_MODEL}`
    : "no model configured: skills are compiled by code only (.env.example)",
);

let answer: ((line: string) => void) | undefined; // a drill question is waiting for you
let pendingApproval: ((approved: boolean) => void) | undefined; // a replay step is waiting for approve/deny
let compiling = false;
let running = false;

const prompter: Prompter = {
  ask(question: Question) {
    const choices = question.options?.map((o, i) => `${i + 1}) ${o.label}`).join("   ");
    console.error(`\n? ${question.text}`);
    if (choices) console.error(`  ${choices}`);
    if (question.default) console.error(`  (Enter = ${question.default})`);
    return new Promise((resolve) => {
      answer = resolve;
    });
  },
};

async function compileSession(sessionId: string) {
  compiling = true;
  try {
    const locate = { searchDirs: defaultSearchDirs(watchDirs) };
    const saved = await finishRecording(sessionId, { dataDir: home, prompter, chat, memory, locate, log });
    if (saved) log(`replay it with: run ${saved.skill.id}`);
  } catch (error) {
    log("compile failed:", error instanceof Error ? error.message : error);
    log(`the trace is kept: retry with "compile ${sessionId}"`);
  } finally {
    compiling = false;
  }
}

function printRun(e: RunLogEvent) {
  if (e.type === "run.start") log(`▶ ${e.skillId} v${e.version}`);
  if (e.type === "step.result") {
    const r = e.result;
    const match = r.matchScore !== undefined ? ` match ${r.matchScore}` : "";
    log(`  ${r.ok ? "✓" : "✗"} ${e.stepId} (try ${e.attempt}, ${e.ms} ms)${match}${r.ok ? "" : `  ${r.error}`}`);
  }
  if (e.type === "run.end") log(`■ ${e.status} in ${e.ms} ms${e.error ? `: ${e.error}` : ""}`);
}

// A recorded skill by id (its latest version in the skill store), or a skill file by path.
function skillFile(ref: string): string | undefined {
  const asPath = resolve(userCwd, ref);
  if (ref.endsWith(".json") && existsSync(asPath)) return asPath;
  try {
    const latest = versions(home, ref).at(-1);
    return latest === undefined ? undefined : join(skillDir(home, ref), `v${latest}.json`);
  } catch {
    return undefined; // not a valid skill id
  }
}

async function run(args: string[]) {
  const [ref, ...pairs] = args;
  if (!ref) return log("usage: run <skill-id | skill.json> [name=value ...]");
  if (running) return log("a run is already in progress");
  const file = skillFile(ref);
  if (!file) return log(`no skill ${ref} (see "skills")`);
  const provided = Object.fromEntries(pairs.map((p) => [p.split("=")[0], p.split("=").slice(1).join("=")]));
  running = true;
  try {
    await runSkillFile(
      daemon,
      file,
      provided,
      {
        log: printRun,
        data,
        approve: (step) =>
          new Promise((resolve) => {
            log(`approval needed for ${step.id}: "${step.intent}". Type approve or deny.`);
            pendingApproval = resolve;
          }),
      },
      join(home, "runs"),
    );
  } catch (error) {
    log("run failed:", (error as Error).message);
  } finally {
    running = false;
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (answer) {
    const reply = answer;
    answer = undefined;
    reply(line);
    return;
  }
  const [command, ...args] = line.trim().split(/\s+/);
  if (!command) return;
  if (command === "approve" || command === "deny") {
    if (!pendingApproval) return log("nothing to approve");
    pendingApproval(command === "approve");
    pendingApproval = undefined;
    return;
  }
  if (compiling) return log("still compiling the last recording; wait for it to finish");
  if (command === "run") void run(args);
  else if (command === "record") daemon.startRecording();
  else if (command === "stop")
    void daemon.stopRecording().then((sessionId) => {
      if (sessionId) return compileSession(sessionId);
    });
  else if (command === "compile" && args[0]) void compileSession(args[0]);
  else if (command === "skills")
    for (const s of listSkills(home)) log(`${s.id}  v${s.versions.join(",v")}  ${s.intent}`);
  else if (command === "traces")
    for (const t of listTraces(home)) log(`${t.sessionId}  ${t.modified.toLocaleString()}`);
  else if (command === "status")
    log(`${daemon.extensions.size} extension(s) connected${running ? ", run in progress" : ""}`);
  else log("commands: record, stop, compile <session>, run <skill>, approve, deny, skills, traces, status");
});

const shutdown = () =>
  daemon.close().then(() => {
    memory.close();
    process.exit(0);
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
