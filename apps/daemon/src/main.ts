// Daemon entry point: the always-on process (launched at login later; `pnpm daemon` for now).
// Everything that waits for you is in the inbox (shadow.db), answered here, over the socket, or over local HTTP
// (api.json says where); a run that needs you waits there and goes on when it is answered, even after a restart.
// Record and Stop are also a floating button in Chrome (and the extension's toolbar icon), on the desktop and in the
// menu bar; each opens the description form first (record-control.ts). Type commands on stdin:
//   record | stop                       record a task: its form's questions first (the goal, how often, what changes,
//                                       what stays, never); stop turns it into a workflow (its questions go to the inbox)
//   compile <session>                   turn a kept recording into a workflow again
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
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Skill } from "@shadow/core";
import { bundlePath, dataDir, logDir, migrateLegacyDataDir, socketPath } from "@shadow/ipc";
import { configFromEnv, createLlm, type Llm, type LlmConfig, UsageMeter } from "@shadow/llm";
import { openMemory } from "@shadow/memory";
import type { RunLogEvent } from "@shadow/player";
import { aiLimitsFromEnv, dataChannel, llmExecutor } from "@shadow/player/node";
import { createRepairer } from "@shadow/player/repair";
import type { Prompter, Question } from "@shadow/recorder";
import { type Api, createApi } from "./api.ts";
import { chooseFiles, givenInputs, splitArgs } from "./choose-file.ts";
import { startDaemon } from "./daemon.ts";
import { createScreenDescriber } from "./describe.ts";
import { askFolderAccess, watchDirsFromEnv } from "./fs-watch.ts";
import { startHttp } from "./http.ts";
import { defaultSearchDirs } from "./locate-file.ts";
import { createLogger } from "./logger.ts";
import { finishRecording } from "./record.ts";
import { createRecordControl, type RecordControl } from "./record-control.ts";
import { maskTermsOf, readConsent, readForm, recordingDir, sweepRecordings } from "./recording-store.ts";
import { rehearse } from "./rehearse.ts";
import { runSkillOn } from "./runner.ts";
import { createScreenReader, type ScreenReader, screenToolsFrom } from "./screen.ts";
import { createService, type Execute, type ServiceEvent } from "./service.ts";
import { createAppControl, type KeySource, llmFromKeychain } from "./settings.ts";
import { findSkills, listSkills, saveSkill, versions } from "./skill-store.ts";
import { type InboxItem, openStore, type RunRow } from "./store.ts";
import { listTraces } from "./trace-store.ts";
import { startTriggers } from "./triggers.ts";
import { transcribeRecording, transcriberFrom } from "./voice.ts";

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
// Packaged (scripts/package.ts): the daemon runs from inside Shadow.app, with the app, the window's pages and the
// native host next to it. In development they are in the repo.
const bundle = bundlePath();
const macApp = bundle ?? join(import.meta.dirname, "../../mac/build/Shadow.app");
const uiDir =
  process.env.SHADOW_UI_DIR ??
  (bundle ? join(bundle, "Contents/Resources/ui") : join(import.meta.dirname, "../../ui/dist"));
const nativeHost = bundle ? join(bundle, "Contents/Resources/native-host") : join(home, "native-host");
let api: Api | undefined; // set once the service exists; api.call messages before then are answered "not ready"
let record: RecordControl | undefined; // the same: Record pressed before then is ignored
let screen: ScreenReader | undefined; // screenshots arriving before then are dropped
let onWake: () => void = () => {}; // set once the triggers exist: a wake looks at them at once
const daemon = await startDaemon({
  socketPath: path,
  log,
  dataDir: home,
  watchDirs,
  onRecordCommand: (command) =>
    command === "start" ? record?.press() : command === "stop" ? void record?.stop() : void record?.discard(),
  onSystem: (event) => {
    if (event === "wake") onWake();
  },
  onShot: (shot) => screen?.add(shot),
  onShotSkip: (skip) => screen?.skip(skip),
  api: { call: (method, params) => (api ? api.call(method, params) : Promise.reject(new Error("not ready"))) },
});
// Development mode: a daemon started in a terminal stops when the terminal closes. The LaunchAgent (pnpm
// setup:daemon, or the packaged app) keeps it running at login and after a crash.
if (process.stderr.isTTY && !existsSync(join(homedir(), "Library", "LaunchAgents", "com.shadow.daemon.plist"))) {
  console.error(
    "[daemon] development mode: Shadow stops when this terminal closes. pnpm setup:daemon keeps it running at login.",
  );
}
const memory = openMemory(join(home, "memory.db"));
const store = openStore(join(home, "shadow.db"));
// One model client for everything (compile, llm steps, repair), and one meter counting what it spends. The key comes
// from .env in development, else from the Keychain (settings.ts); a key pasted in Settings replaces the client.
const usage = new UsageMeter();
const envConfig = configFromEnv();
let model: Llm | undefined = envConfig ? createLlm(envConfig) : undefined;
let keySource: KeySource = envConfig ? "env" : "none";
if (!model) {
  model = await llmFromKeychain();
  if (model) keySource = "keychain";
}
// data.pick rules are free; llm steps call the model on every run, so they are capped (calls per run, input size)
// and their answers are cached by question and data.
const data = dataChannel();
const llmStep = () =>
  llmExecutor({ llm: model, cacheDir: join(home, "ai-cache"), limits: aiLimitsFromEnv(), meter: usage });
let llm = llmStep();
const applyKey = (config: LlmConfig) => {
  model = createLlm(config);
  keySource = "keychain";
  llm = llmStep();
  log(`model: a new key is in use (${config.profiles.smart.model})`);
};
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
  model
    ? `models (${keySource}): ${Object.entries(model.config.profiles)
        .map(([name, p]) => `${name} ${p.model}`)
        .join(", ")}`
    : "no model configured: skills are compiled by code only (paste a key in Settings, or .env.example)",
);

// One leg of a run (service.ts): through the extension and Shadow.app, with recovery. The service's hooks make a
// run that needs you end its leg as waiting, so nothing waits in memory here.
const execute: Execute = (skill, leg) =>
  runSkillOn(
    daemon,
    skill,
    { runId: leg.runId, provided: leg.provided, resume: leg.resume, signal: leg.signal },
    {
      log: leg.log,
      data,
      llm,
      approve: leg.hooks.approve,
      ask: leg.hooks.ask,
      // A walk-through: every step waits for you, with its target outlined. A failing step just fails: nothing is
      // repaired while you are looking.
      walk: leg.walk ? leg.hooks.walk : undefined,
      describer,
      // A failed step pauses the run: repair, then resume (docs/design.md, section 9).
      recovery: leg.walk
        ? undefined
        : {
            repairer: createRepairer({ llm: model, meter: usage, signal: leg.signal }),
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
    model: model ? "configured" : "none",
    keySource,
    api: httpPort,
    bundle,
  }),
});
// Recording: the description form, then the recording, then Stop turns it into a workflow. Its questions (the
// form's, from the terminal, and the drill's) wait in the inbox.
const prompter: Prompter = {
  ask: (question: Question, about) =>
    service.ask({
      title: question.text,
      options: question.options?.map((o) => o.label),
      // Your own words are always welcome, unless an option is a whole step or a schedule that words can't stand for.
      freeText: !(question.options ?? []).some((o) => typeof o.value === "object" && o.value !== null),
      default: question.default,
      // A design-agent question is shown on the draft, next to its step.
      step: about?.step,
      draft: about?.draft,
      // The recording being turned into a workflow: the Record screen shows only its questions.
      sessionId: record?.view().sessionId,
    }),
};
// Screenshots (when the form allowed them): their words are read and masked on the Mac by Shadow.app's binary, and
// only the masked words are kept (screen.ts). Packaged, the app is the bundle the daemon runs inside.
const macBinary = join(macApp, "Contents/MacOS/Shadow");
const screenTools = screenToolsFrom(macBinary);
screen = createScreenReader({
  dataDir: home,
  tools: screenTools,
  never: (sessionId) => maskTermsOf(readForm(home, sessionId)),
  log,
});
const screenReader = screen;
const transcribe = transcriberFrom(macBinary);
// Masked pictures described by the vision model, for the design agent (describe_step_screenshot) and the repair agent (describe_screen): only
// with the "pictures" consent, and masked by the same tools as the recording's screenshots.
const describer = createScreenDescriber({
  dataDir: home,
  tools: screenToolsFrom(macBinary),
  llm: () => model,
  consent: () => readConsent(home),
  log,
});
record = createRecordControl({
  dataDir: home,
  daemon,
  ask: (question) => service.ask(question),
  screenReady: () => screenTools !== undefined,
  finish: async (sessionId, progress) => {
    // Every screenshot is read and masked, and the narration turned into text, before the recording becomes a workflow:
    // both at the same time (both run in Shadow.app, on the Mac).
    progress("Reading the words on your screen and turning your voice into text");
    await Promise.all([
      screenReader.idle(),
      transcribeRecording({
        dataDir: home,
        sessionId,
        transcribe,
        never: maskTermsOf(readForm(home, sessionId)),
        log,
      }),
    ]);
    return finishRecording(sessionId, {
      dataDir: home,
      prompter,
      llm: model,
      memory,
      locate: { searchDirs: defaultSearchDirs(watchDirs) },
      meter: usage,
      describer,
      // The design agent's safe test run: in the automation window, its log next to the recording.
      // Queued with the runs: one leg at a time in the automation window.
      rehearse: (skill, effects, onLine, recorded, final) =>
        service.exclusive(() =>
          rehearse(daemon, skill, {
            effects,
            recorded,
            local: Boolean(final),
            twice: final?.twice ?? false,
            hooks: { data, llm },
            logDir: recordingDir(home, sessionId),
            onLine: (line) => {
              onLine(line);
              progress(line);
            },
          }),
        ),
      progress,
      mac: () => daemon.mac(),
      log,
    });
  },
  log,
});
const recordControl = record;
recordControl.subscribe((event) => daemon.publish(event));
// A recording's folder (events, screenshots, audio) is deleted a day after its workflow is saved, or a day after Stop
// if it never was: looked at now and every hour.
const sweep = () => {
  try {
    const gone = sweepRecordings(home, { active: recordControl.view().sessionId });
    if (gone.length > 0) log(`deleted ${gone.length} recording(s) older than a day`);
  } catch (error) {
    log.error("could not delete old recordings:", (error as Error).message);
  }
};
sweep();
setInterval(sweep, 60 * 60_000).unref();
const app = createAppControl({
  dataDir: home,
  logDir: logDir(),
  bundle,
  nativeHost,
  model: () => model,
  keySource: () => keySource,
  applyKey,
  memory,
});
api = createApi(service, recordControl, app);
const http = await startHttp({
  api,
  subscribe: (listener) => {
    const offService = service.subscribe(listener);
    const offRecord = recordControl.subscribe(listener);
    return () => {
      offService();
      offRecord();
    };
  },
  infoFile: join(home, "api.json"),
  // The window's pages: built by `pnpm ui` (apps/ui/dist); inside the app when packaged.
  staticDir: uiDir,
  log,
});
httpPort = http.port;
// The window in a browser, for development. The link carries the token, so it is printed only to a terminal, never
// to the log file.
if (process.stderr.isTTY) console.error(`[daemon] open Shadow: http://127.0.0.1:${http.port}/#token=${http.token}`);

// The question or step question the next typed line answers.
let focus: string | undefined;

// The status line on the button in Chrome and on the desktop.
type Phase = "compiling" | "question" | "saved" | "empty" | "failed" | "busy" | "replay" | "form";
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

// Live workflows start on their own (triggers.ts): looked at now (times missed while Shadow was off), every 30 s
// (which also notices the clock jumping after the Mac wakes), and right after a workflow goes live, pauses or gets a
// new Frequency.
const triggers = startTriggers({ dataDir: home, store, service, log });
let looking = Promise.resolve();
const lookAtTriggers = () => {
  looking = looking.then(() => triggers.tick()).catch((error: Error) => log.error("triggers:", error.message));
};
lookAtTriggers();
setInterval(lookAtTriggers, 30_000);
service.subscribe((event) => {
  if (event.type === "workflow") lookAtTriggers();
});
// The Mac woke up: a schedule missed while it slept runs now (per its `missed` setting), not up to 30 s later.
onWake = () => {
  log("the Mac woke up: looking at the triggers");
  lookAtTriggers();
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

// A skill file by path, or a recorded skill by its id, or by the start of it when only one skill matches (run
// upload-invoice finds upload-invoice-k3f9q2), at its latest version in the store. Returns what the service takes:
// the file's absolute path, or the id; else why there is none.
function skillRef(ref: string): { target?: string; why?: string } {
  const asPath = resolve(userCwd, ref);
  if (ref.endsWith(".json")) return existsSync(asPath) ? { target: asPath } : { why: `no skill ${ref} (see "skills")` };
  const found = findSkills(home, ref);
  if (found.length > 1)
    return { why: `${found.length} skills start with ${ref}: ${found.join(", ")}. Type the whole id.` };
  const id = found[0];
  if (id === undefined) return { why: `no skill ${ref} (see "skills")` };
  // A skill saved before ids got their tag is named exactly what you typed; newer recordings of it are not run.
  const newer = id === ref ? listSkills(home).filter((s) => s.id.startsWith(`${ref}-`)) : [];
  if (newer.length > 0)
    log(`running ${ref}; also recorded: ${newer.map((s) => s.id).join(", ")} (type the whole id to run one)`);
  return { target: id };
}

async function run(args: string[]) {
  const [ref, ...given] = args;
  if (!ref) return log("usage: run <skill-id | skill.json> [name=value ... | path]");
  const { target, why } = skillRef(ref);
  if (!target) return log(why);
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
  if (recordControl.view().phase === "compiling") {
    log("still turning the last recording into a workflow; answer its questions first");
    return;
  }
  if (command === "run") void run(args);
  else if (command === "rollback" && args[0]) {
    try {
      const rolled = service.rollback(args[0]);
      log(`rolled back: ${rolled.id} v${rolled.version} is ${rolled.summary}`);
    } catch (error) {
      log((error as Error).message);
    }
  } else if ((command === "live" || command === "pause" || command === "resume-workflow") && args[0]) {
    try {
      const state =
        command === "live"
          ? service.goLive(args[0])
          : command === "pause"
            ? service.pause(args[0])
            : service.resume(args[0]);
      log(`${args[0]} is ${state.state}`);
    } catch (error) {
      log((error as Error).message);
    }
  } else if (command === "record") void recordControl.describeInInbox();
  else if (command === "stop") void recordControl.stop();
  else if (command === "compile" && args[0]) void recordControl.compile(args[0]);
  else if (command === "skills")
    for (const w of service.workflows()) {
      const next = w.nextRunAt ? `, next ${new Date(w.nextRunAt).toLocaleString()}` : "";
      const why = w.state.state === "paused" && w.state.reason ? ` (${w.state.reason})` : "";
      log(`${w.id}  v${w.versions.join(",v")}  ${w.name}  [${w.state.state}${why}${next}]`);
    }
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
      "commands: record, stop, compile <session>, run <skill>, inbox, approve, deny, resume, skip, cancel [run], rollback <skill>, live <skill>, pause <skill>, resume-workflow <skill>, runs, skills, traces, status",
    );
});

// Shadow.app: the floating Record / Stop button on the desktop, Mac-app recording and the ax channel. Started
// through `open`, so macOS asks for Accessibility in its own name (not your terminal's). It quits when the daemon does.
function startMacApp() {
  if (process.env.SHADOW_MAC === "off") return;
  if (!existsSync(macApp)) return log("no desktop button: build it with pnpm setup:mac");
  const args = ["--socket", resolve(path), "--api", join(home, "api.json"), "--log", join(logDir(), "app.log")];
  execFile("open", ["-g", macApp, "--args", ...args], (error) => {
    if (error) log("could not start Shadow.app:", error.message);
  });
}

const shutdown = async () => {
  triggers.stop();
  await http.close();
  await daemon.close();
  memory.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
