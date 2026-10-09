// Daemon entry point: the always-on process (launched at login later; `pnpm daemon` for now).
// Record and Stop are also a floating button in Chrome (and the extension's toolbar icon). Type commands on stdin:
//   record | stop                       record a task; stop compiles it into a skill (questions are asked here)
//   compile <session>                   recompile a kept trace
//   run <skill-id | skill.json> [name=value ... | path]   replay a skill (web steps go through the extension); a
//                                       file it needs can be given here, else it is asked for before the first step
//   approve | deny                      answer a pending approval
//   skills | traces | status

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Skill } from "@taskplayer/core";
import { dataDir, socketPath } from "@taskplayer/ipc";
import { openMemory } from "@taskplayer/memory";
import type { RunLogEvent } from "@taskplayer/player";
import { aiLimitsFromEnv, dataChannel, llmExecutor } from "@taskplayer/player/node";
import type { Prompter, Question } from "@taskplayer/recorder";
import { chooseFiles, givenInputs, splitArgs } from "./choose-file.ts";
import { startDaemon } from "./daemon.ts";
import { askFolderAccess, watchDirsFromEnv } from "./fs-watch.ts";
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
const daemon = await startDaemon({
  socketPath: path,
  log,
  dataDir: home,
  watchDirs,
  onRecordCommand: (command) => (command === "start" ? startRecording() : stopRecording()),
});
const memory = openMemory(join(home, "memory.db"));
const chat = chatFromEnv();
// data.pick rules are free; llm steps call the model on every run, so they are capped (calls per run, input size)
// and their answers are cached by question and data.
const data = dataChannel();
const llm = llmExecutor({ ask: askFromEnv(), cacheDir: join(home, "ai-cache"), limits: aiLimitsFromEnv() });
log("listening on", path);
// macOS asks once for Desktop, Documents and Downloads: now, rather than when you press Record.
for (const folder of askFolderAccess(watchDirs)) {
  log(
    `!! macOS blocked ${folder}: file moves there are not recorded. Allow your terminal in Privacy & Security > Files and Folders`,
  );
}
startMacApp();
log("data in", home, watchDirs.length > 0 ? `| watching ${watchDirs.join(", ")}` : "| file capture off");
log(
  chat
    ? `model: ${process.env.NEMOTRON_MODEL}`
    : "no model configured: skills are compiled by code only (.env.example)",
);

let answer: ((line: string) => void) | undefined; // a drill question is waiting for you
let pendingApproval: ((approved: boolean) => void) | undefined; // a replay step is waiting for approve/deny
let compiling = false; // from stop until the skill is saved: no new recording meanwhile (its questions are open here)
let running = false;

// The status line on the button in Chrome. The questions themselves are asked here, in the terminal.
type Phase = "compiling" | "question" | "saved" | "empty" | "failed" | "busy" | "replay";
const status = (phase: Phase, text: string) =>
  daemon.broadcast({ id: randomUUID(), type: "record.status", phase, text });

const prompter: Prompter = {
  ask(question: Question) {
    status("question", `Answer in the daemon terminal: ${question.text}`);
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
  status("compiling", chat ? "Compiling with Nemotron…" : "Compiling…");
  try {
    const locate = { searchDirs: defaultSearchDirs(watchDirs) };
    const saved = await finishRecording(sessionId, { dataDir: home, prompter, chat, memory, locate, log });
    if (saved) {
      log(`replay it with: run ${saved.skill.id}`);
      status("saved", `Saved ${saved.skill.id}. Replay: run ${saved.skill.id}`);
    } else status("empty", "Nothing to save: no steps were recorded");
  } catch (error) {
    log("compile failed:", error instanceof Error ? error.message : error);
    log(`the trace is kept: retry with "compile ${sessionId}"`);
    status("failed", "Compile failed: see the daemon terminal");
  } finally {
    compiling = false;
  }
}

// `record` / `stop`, typed here or pressed in Chrome.
function startRecording() {
  if (compiling) return refuse();
  daemon.startRecording();
}
async function stopRecording() {
  if (compiling) return refuse();
  compiling = true; // covers the wait for late events too, so a new recording can't start in between
  try {
    const sessionId = await daemon.stopRecording();
    if (sessionId) await compileSession(sessionId);
  } finally {
    compiling = false;
  }
}
function refuse() {
  log("still compiling the last recording; answer its questions first");
  status("busy", "Still compiling the last recording: answer its questions in the daemon terminal");
}

function printRun(e: RunLogEvent) {
  if (e.type === "run.start") log(`▶ ${e.skillId} v${e.version}`);
  if (e.type === "step.result") {
    const r = e.result;
    const match = r.matchScore !== undefined ? ` match ${r.matchScore}` : "";
    log(`  ${r.ok ? "✓" : "✗"} ${e.path} (try ${e.attempt}, ${e.ms} ms)${match}${r.ok ? "" : `  ${r.error}`}`);
  }
  if (e.type === "loop.start") log(`  ↻ ${e.path}: ${e.items} item(s)`);
  if (e.type === "loop.item_failed") log(`  ↷ ${e.path}[${e.index}] skipped: ${e.error}`);
  if (e.type === "branch") log(`  ⑂ ${e.path}: ${e.took === "steps" ? "condition holds" : "else"}`);
  if (e.type === "step.skipped") log(`  – ${e.path} skipped (${e.reason})`);
  if (e.type === "run.end")
    log(`■ ${e.status} in ${e.ms} ms${e.failedStep ? ` at ${e.failedStep}` : ""}${e.error ? `: ${e.error}` : ""}`);
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
  const [ref, ...given] = args;
  if (!ref) return log("usage: run <skill-id | skill.json> [name=value ... | path]");
  if (running) return log("a run is already in progress");
  const file = skillFile(ref);
  if (!file) return log(`no skill ${ref} (see "skills")`);
  running = true;
  try {
    // Which files to use, settled before the first step: given with the command, else asked here (Enter takes the
    // newest like the recorded one; or drag one in from Finder). A wrong file stops the run before anything runs.
    const skill = Skill.parse(JSON.parse(readFileSync(file, "utf8")));
    const provided = givenInputs(skill, given);
    await chooseFiles(skill, provided, (question) => prompter.ask(question), log);
    status("replay", `Replaying ${skill.id}…`);
    const outcome = await runSkillFile(
      daemon,
      file,
      provided,
      {
        log: printRun,
        data,
        llm,
        approve: (step) =>
          new Promise((resolve) => {
            log(`approval needed for ${step.id}: "${step.intent}". Type approve or deny.`);
            pendingApproval = resolve;
          }),
        // A step's question: typed here, like the drill's. A yes/no question takes yes or no.
        ask: async (ask, step) => {
          if (ask.kind === "confirm") {
            const reply = await prompter.ask({
              id: `ask-${step.id}`,
              text: ask.question,
              options: [{ label: "yes" }, { label: "no" }],
              default: "yes",
            });
            return !/^(n|no|2)$/i.test(reply.trim());
          }
          return prompter.ask({ id: `ask-${step.id}`, text: ask.question });
        },
      },
      join(home, "runs"),
    );
    if (outcome.status === "succeeded") status("saved", `Replayed ${skill.id}`);
    else
      status(
        "failed",
        `Replay ${outcome.status}${outcome.failedStep ? ` at ${outcome.failedStep}` : ""}: see the terminal`,
      );
  } catch (error) {
    log("run failed:", (error as Error).message);
    status("failed", "Replay failed: see the daemon terminal");
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
  const [command, ...args] = splitArgs(line);
  if (!command) return;
  if (command === "approve" || command === "deny") {
    if (!pendingApproval) return log("nothing to approve");
    pendingApproval(command === "approve");
    pendingApproval = undefined;
    return;
  }
  if (compiling) return refuse();
  if (command === "run") void run(args);
  else if (command === "record") startRecording();
  else if (command === "stop") void stopRecording();
  else if (command === "compile" && args[0]) void compileSession(args[0]);
  else if (command === "skills") for (const s of listSkills(home)) log(`${s.id}  v${s.versions.join(",v")}  ${s.name}`);
  else if (command === "traces")
    for (const t of listTraces(home)) log(`${t.sessionId}  ${t.modified.toLocaleString()}`);
  else if (command === "status")
    log(`${daemon.extensions.size} extension(s) connected${running ? ", run in progress" : ""}`);
  else log("commands: record, stop, compile <session>, run <skill>, approve, deny, skills, traces, status");
});

// Task Player.app: the floating Record / Stop button on the desktop, Mac-app recording and the ax channel. Started
// through `open`, so macOS asks for Accessibility in its own name (not your terminal's). It quits when the daemon does.
function startMacApp() {
  const app = join(import.meta.dirname, "../../mac/build/Task Player.app");
  if (process.env.TASKPLAYER_MAC === "off") return;
  if (!existsSync(app)) return log("no desktop button: build it with pnpm setup:mac");
  execFile("open", ["-g", app, "--args", "--socket", resolve(path)], (error) => {
    if (error) log("could not start Task Player.app:", error.message);
  });
}

const shutdown = () =>
  daemon.close().then(() => {
    memory.close();
    process.exit(0);
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
