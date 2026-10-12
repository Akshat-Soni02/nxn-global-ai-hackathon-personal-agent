// Daemon entry point: the always-on process (launched at login later; `pnpm daemon` for now).
// Everything that waits for you is in the inbox (shadow.db), answered here, over the socket, or over local HTTP
// (api.json says where); a run that needs you waits there and goes on when it is answered, even after a restart.
// Record and Stop are also a floating button in Chrome (and the extension's toolbar icon). Type commands on stdin:
//   record | stop                       record a task; stop compiles it into a skill (its questions go to the inbox)
//   compile <session>                   recompile a kept trace
//   run <skill-id | skill.json> [name=value ... | path]   replay a skill (web steps go through the extension); a
//                                       file it needs can be given here, else it is asked for before the first step
//   inbox                               what waits for you
//   approve | deny                      answer the oldest approval
//   resume | skip | cancel              a run that needs you: try the stuck step again, go on after it (you did it by
//                                       hand in the automation window), or end the run
//   cancel <run-id>                     end a waiting run
//   rollback <skill-id>                 undo the latest version (e.g. a repair): the one before becomes the next
//   runs | skills | traces | status
// A question (the drill, which file, a step's question) is answered by typing the answer.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Skill } from "@shadow/core";
import { dataDir, logDir, migrateLegacyDataDir, socketPath } from "@shadow/ipc";
import { configFromEnv, createLlm, UsageMeter } from "@shadow/llm";
import { openMemory } from "@shadow/memory";
import type { RunLogEvent } from "@shadow/player";
import { aiLimitsFromEnv, dataChannel, llmExecutor } from "@shadow/player/node";
import { createRepairer } from "@shadow/player/repair";
import type { Prompter, Question } from "@shadow/recorder";
import { type Api, createApi } from "./api.ts";
import { chooseFiles, givenInputs, splitArgs } from "./choose-file.ts";
import { startDaemon } from "./daemon.ts";
import { askFolderAccess, watchDirsFromEnv } from "./fs-watch.ts";
import { startHttp } from "./http.ts";
import { defaultSearchDirs } from "./locate-file.ts";
import { createLogger } from "./logger.ts";
import { finishRecording } from "./record.ts";
import { runSkillOn } from "./runner.ts";
import { createService, type Execute, type ServiceEvent } from "./service.ts";
import { listSkills, saveSkill, versions } from "./skill-store.ts";
import { type InboxItem, openStore, type RunRow } from "./store.ts";
import { listTraces } from "./trace-store.ts";

// NEBIUS_API_KEY (and optional model overrides) from the repo's .env, if there is one (see .env.example).
try {
  process.loadEnvFile(join(import.meta.dirname, "../../../.env"));
} catch {
  // no .env: compile falls back to code only
}

// Printed here, and written to the log folder (~/Library/Logs/Shadow, which Console.app shows).
const log = createLogger({ dir: logDir() });
// Data from before the rename (Task Player → Shadow) moves to the new folder, once.
if (!process.env.SHADOW_HOME && migrateLegacyDataDir())
  log("moved your data from Application Support/TaskPlayer to Shadow");
// `pnpm daemon` runs inside apps/daemon; resolve paths typed at the prompt from where pnpm was started.
const userCwd = process.env.INIT_CWD ?? process.cwd();
const path = socketPath();
const home = dataDir();
const watchDirs = watchDirsFromEnv();
let api: Api | undefined; // set once the service exists; api.call messages before then are answered "not ready"
const daemon = await startDaemon({
  socketPath: path,
  log,
  dataDir: home,
  watchDirs,
  onRecordCommand: (command) => (command === "start" ? startRecording() : stopRecording()),
  api: { call: (method, params) => (api ? api.call(method, params) : Promise.reject(new Error("not ready"))) },
});
const memory = openMemory(join(home, "memory.db"));
const store = openStore(join(home, "shadow.db"));
// One model client for everything (compile, llm steps, repair), and one meter counting what it spends.
const llmConfig = configFromEnv();
const model = llmConfig ? createLlm(llmConfig) : undefined;
const usage = new UsageMeter();
// data.pick rules are free; llm steps call the model on every run, so they are capped (calls per run, input size)
// and their answers are cached by question and data.
const data = dataChannel();
const llm = llmExecutor({ llm: model, cacheDir: join(home, "ai-cache"), limits: aiLimitsFromEnv(), meter: usage });
log("listening on", path);
// macOS asks once for Desktop, Documents and Downloads: now, rather than when you press Record.
for (const folder of askFolderAccess(watchDirs)) {
  log.warn(
    `macOS blocked ${folder}: file moves there are not recorded. Allow your terminal in Privacy & Security > Files and Folders`,
  );
}
startMacApp();
log("data in", home, watchDirs.length > 0 ? `| watching ${watchDirs.join(", ")}` : "| file capture off");
log(
  llmConfig
    ? `models: ${Object.entries(llmConfig.profiles)
        .map(([name, p]) => `${name} ${p.model}`)
        .join(", ")}`
    : "no model configured: skills are compiled by code only (.env.example)",
);

// One leg of a run (service.ts): through the extension and Shadow.app, with recovery. The service's hooks make a
// run that needs you end its leg as waiting, so nothing waits in memory here.
const execute: Execute = (skill, leg) =>
  runSkillOn(
    daemon,
    skill,
    { runId: leg.runId, provided: leg.provided, resume: leg.resume },
    {
      log: leg.log,
      data,
      llm,
      approve: leg.hooks.approve,
      ask: leg.hooks.ask,
      // A failed step pauses the run: repair, then resume (docs/design.md, section 9).
      recovery: {
        repairer: createRepairer({ llm: model, meter: usage }),
        memory,
        saveVersion: (repaired) => saveSkill(home, repaired).skill,
        waitForUser: leg.hooks.waitForUser,
      },
    },
    join(home, "runs"),
  );

let httpPort: number | undefined;
const service = createService({
  dataDir: home,
  store,
  execute,
  spent: () => usage.usage.costUsd,
  health: () => ({
    extensions: daemon.extensions.size,
    macApp: daemon.mac(),
    model: llmConfig ? "configured" : "none",
    api: httpPort,
  }),
});
api = createApi(service);
const http = await startHttp({
  api,
  subscribe: (listener) => service.subscribe(listener),
  infoFile: join(home, "api.json"),
  // The window's pages: built by `pnpm ui` (apps/ui/dist); inside the app when packaged.
  staticDir: process.env.SHADOW_UI_DIR ?? join(import.meta.dirname, "../../ui/dist"),
  log,
});
httpPort = http.port;
// The window in a browser, for development. The link carries the token, so it is printed only to a terminal, never
// to the log file.
if (process.stderr.isTTY) console.error(`[daemon] open Shadow: http://127.0.0.1:${http.port}/#token=${http.token}`);

let compiling = false; // from stop until the skill is saved: no new recording meanwhile (its questions are open)
// The question or step question the next typed line answers.
let focus: string | undefined;

// The status line on the button in Chrome and on the desktop.
type Phase = "compiling" | "question" | "saved" | "empty" | "failed" | "busy" | "replay";
const status = (phase: Phase, text: string) =>
  daemon.broadcast({ id: randomUUID(), type: "record.status", phase, text });

// Everything the service does reaches socket subscribers, this terminal, and the button.
service.subscribe((event: ServiceEvent) => {
  daemon.publish(event);
  if (event.type === "step") printRun(event.event);
  if (event.type === "inbox") {
    if (event.item.answeredAt === undefined) announce(event.item);
    else if (focus === event.item.id) focus = nextFocus();
  }
  if (event.type === "run") showRun(event.run);
});

const recovered = service.recover();
if (recovered.interrupted.length > 0)
  log(`the daemon stopped during ${recovered.interrupted.length} run(s); see "runs"`);
const open = service.inbox({ open: true });
if (open.length > 0) {
  log(`${open.length} thing(s) wait for you:`);
  for (const item of [...open].reverse()) announce(item);
}

// The drill and "which file?" put their questions in the inbox.
const prompter: Prompter = {
  ask: (question: Question) =>
    service.ask({ title: question.text, options: question.options?.map((o) => o.label), default: question.default }),
};

function announce(item: InboxItem) {
  const options = (item.detail.options as string[] | undefined) ?? [];
  if (item.kind === "question" || item.kind === "ask") {
    console.error(`\n? ${item.title}`);
    if (options.length > 0) console.error(`  ${options.map((o, i) => `${i + 1}) ${o}`).join("   ")}`);
    if (item.detail.default) console.error(`  (Enter = ${item.detail.default})`);
    focus ??= item.id;
    status("question", `Answer in Shadow: ${item.title}`);
  } else if (item.kind === "approval") {
    log(`⏸ ${item.path}: ${item.title}. Type approve or deny.`);
    status("question", `${item.skillId} is waiting for your approval`);
  } else if (item.kind === "recovery") {
    log(`⏸ ${item.title}`);
    log("  type resume (try that step again), skip (you did it by hand: go on after it) or cancel");
    status("question", `${item.skillId} needs you: ${item.title}`);
  } else if (item.kind === "repaired") {
    log(`  ${item.title} (undo it with: rollback ${item.skillId})`);
  }
}

// The oldest open question or step question.
function nextFocus(): string | undefined {
  return service
    .inbox({ open: true })
    .filter((i) => i.kind === "question" || i.kind === "ask")
    .at(-1)?.id;
}
function oldest(kind: InboxItem["kind"]): InboxItem | undefined {
  return service
    .inbox({ open: true })
    .filter((i) => i.kind === kind)
    .at(-1);
}
function reply(itemId: string, answer: unknown) {
  try {
    service.answer(itemId, answer);
  } catch (error) {
    log((error as Error).message);
  }
}

function showRun(run: RunRow) {
  if (run.status === "running") status("replay", `Replaying ${run.skillId}…`);
  else if (run.status === "succeeded") status("saved", `Replayed ${run.skillId}`);
  else if (run.status === "nothing_to_do") status("saved", `Nothing to do for ${run.skillId} this time`);
  else if (run.status !== "waiting")
    status("failed", `Replay ${run.status}${run.failedStep ? ` at ${run.failedStep}` : ""}: see the terminal`);
}

async function compileSession(sessionId: string) {
  compiling = true;
  status("compiling", model ? "Compiling with Nemotron…" : "Compiling…");
  try {
    const locate = { searchDirs: defaultSearchDirs(watchDirs) };
    const saved = await finishRecording(sessionId, { dataDir: home, prompter, llm: model, memory, locate, log });
    if (saved) {
      log(`replay it with: run ${saved.skill.id}`);
      status("saved", `Saved ${saved.skill.id}. Replay: run ${saved.skill.id}`);
    } else status("empty", "Nothing to save: no steps were recorded");
  } catch (error) {
    log.error("compile failed:", error instanceof Error ? error.message : error);
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
  status("busy", "Still compiling the last recording: answer its questions first");
}

function printRun(e: RunLogEvent) {
  if (e.type === "run.start") log(`▶ ${e.skillId} v${e.version}${e.resumedAt ? ` (going on at ${e.resumedAt})` : ""}`);
  if (e.type === "step.result") {
    const r = e.result;
    const match = r.matchScore !== undefined ? ` match ${r.matchScore}` : "";
    log(`  ${r.ok ? "✓" : "✗"} ${e.path} (try ${e.attempt}, ${e.ms} ms)${match}${r.ok ? "" : `  ${r.error}`}`);
  }
  if (e.type === "loop.start") log(`  ↻ ${e.path}: ${e.items} item(s)`);
  if (e.type === "loop.item_failed") log(`  ↷ ${e.path}[${e.index}] skipped: ${e.error}`);
  if (e.type === "branch") log(`  ⑂ ${e.path}: ${e.took === "steps" ? "condition holds" : "else"}`);
  if (e.type === "step.skipped") log(`  – ${e.path} skipped (${e.reason})`);
  if (e.type === "repair") {
    const what =
      e.outcome === "commit"
        ? `repaired (${e.by}), saved as v${e.version}: ${e.summary}`
        : `${e.outcome} (${e.class}): ${e.summary}`;
    log(`  ⚒ ${e.path} ${what}${e.costUsd > 0 ? ` · $${e.costUsd.toFixed(4)}` : ""}`);
  }
  if (e.type === "run.end")
    log(`■ ${e.status} in ${e.ms} ms${e.failedStep ? ` at ${e.failedStep}` : ""}${e.error ? `: ${e.error}` : ""}`);
}

// A skill file by path, or a recorded skill by id (its latest version in the store). Returns what the service takes:
// the file's absolute path, or the id.
function skillRef(ref: string): string | undefined {
  const asPath = resolve(userCwd, ref);
  if (ref.endsWith(".json")) return existsSync(asPath) ? asPath : undefined;
  try {
    return versions(home, ref).length > 0 ? ref : undefined;
  } catch {
    return undefined; // not a valid skill id
  }
}

async function run(args: string[]) {
  const [ref, ...given] = args;
  if (!ref) return log("usage: run <skill-id | skill.json> [name=value ... | path]");
  const target = skillRef(ref);
  if (!target) return log(`no skill ${ref} (see "skills")`);
  try {
    // Which files to use, settled before the first step: given with the command, else asked (Enter takes the newest
    // like the recorded one; or drag one in from Finder). A wrong file stops the run before anything runs.
    const file = target.endsWith(".json")
      ? target
      : join(home, "skills", target, `v${versions(home, target).at(-1)}.json`);
    const skill = Skill.parse(JSON.parse(readFileSync(file, "utf8")));
    const provided = givenInputs(skill, given);
    await chooseFiles(skill, provided, (question) => prompter.ask(question), log);
    const started = service.start(target, provided);
    log(`run ${started.id}`);
  } catch (error) {
    log("run failed:", (error as Error).message);
    status("failed", "Replay failed: see the daemon terminal");
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (focus) {
    const item = focus;
    focus = undefined;
    reply(item, line);
    focus ??= nextFocus();
    return;
  }
  const [command, ...args] = splitArgs(line);
  if (!command) return;
  if (command === "approve" || command === "deny") {
    const item = oldest("approval");
    if (!item) return log("nothing to approve");
    return reply(item.id, command);
  }
  if (command === "resume" || command === "skip" || (command === "cancel" && args.length === 0)) {
    const item = oldest("recovery");
    if (!item) return log("no run needs you");
    return reply(item.id, command === "resume" ? "retry" : command === "skip" ? "skip" : "stop");
  }
  if (command === "cancel" && args[0]) {
    try {
      log(`cancelled ${service.cancel(args[0]).id}`);
    } catch (error) {
      log((error as Error).message);
    }
    return;
  }
  if (command === "inbox") {
    const items = service.inbox({ open: true });
    if (items.length === 0) return log("nothing waits for you");
    for (const item of [...items].reverse()) log(`${item.kind.padEnd(9)} ${item.skillId ?? ""} ${item.title}`);
    return;
  }
  if (command === "runs") {
    for (const r of service.runs({ limit: 10 })) {
      const cost = r.costUsd > 0 ? ` $${r.costUsd.toFixed(4)}` : "";
      log(
        `${r.id}  v${r.version}  ${r.status}${r.failedStep ? ` at ${r.failedStep}` : ""}${r.repaired ? " (repaired)" : ""}${cost}`,
      );
    }
    return;
  }
  if (compiling) return refuse();
  if (command === "run") void run(args);
  else if (command === "rollback" && args[0]) {
    try {
      const rolled = service.rollback(args[0]);
      log(`rolled back: ${rolled.id} v${rolled.version} is ${rolled.summary}`);
    } catch (error) {
      log((error as Error).message);
    }
  } else if (command === "record") startRecording();
  else if (command === "stop") void stopRecording();
  else if (command === "compile" && args[0]) void compileSession(args[0]);
  else if (command === "skills") for (const s of listSkills(home)) log(`${s.id}  v${s.versions.join(",v")}  ${s.name}`);
  else if (command === "traces")
    for (const t of listTraces(home)) log(`${t.sessionId}  ${t.modified.toLocaleString()}`);
  else if (command === "status") {
    const health = service.health();
    log(`${daemon.extensions.size} extension(s) connected; API on port ${http.port}`);
    log(`${health.waitingForYou} thing(s) wait for you; running: ${(health.running as string[]).join(", ") || "none"}`);
    const spent = usage.usage;
    log(
      `model use since start: ${spent.calls} call(s), ${spent.input + spent.output} tokens, $${spent.costUsd.toFixed(4)}; today's runs: $${service.usage().todayUsd.toFixed(4)}`,
    );
  } else
    log(
      "commands: record, stop, compile <session>, run <skill>, inbox, approve, deny, resume, skip, cancel [run], rollback <skill>, runs, skills, traces, status",
    );
});

// Shadow.app: the floating Record / Stop button on the desktop, Mac-app recording and the ax channel. Started
// through `open`, so macOS asks for Accessibility in its own name (not your terminal's). It quits when the daemon does.
function startMacApp() {
  const app = join(import.meta.dirname, "../../mac/build/Shadow.app");
  if (process.env.SHADOW_MAC === "off") return;
  if (!existsSync(app)) return log("no desktop button: build it with pnpm setup:mac");
  const args = ["--socket", resolve(path), "--api", join(home, "api.json"), "--log", join(logDir(), "app.log")];
  execFile("open", ["-g", app, "--args", ...args], (error) => {
    if (error) log("could not start Shadow.app:", error.message);
  });
}

const shutdown = async () => {
  await http.close();
  await daemon.close();
  memory.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
