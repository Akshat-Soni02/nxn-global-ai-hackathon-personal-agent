// The daemon as a service (docs/design.md, "The daemon as a service"): runs, the inbox, and going on with a waiting
// run, behind one set of methods. The terminal, the Unix socket and local HTTP all call these; none of them holds
// state of its own.
//
// A run that needs the user doesn't wait in memory: its approval, question or recovery answers WAIT, the run ends its
// leg as `waiting`, and its checkpoint is saved on its row with an inbox item. Answering the item starts the next leg
// from the checkpoint. So a run can wait for hours, or across a daemon restart.
//
// One leg acts at a time (there is one automation window): legs queue behind each other. Waiting runs hold nothing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Skill } from "@shadow/core";
import {
  type Answer,
  type Resume,
  type RunLogEvent,
  type RunOutcome,
  WAIT,
  type Wait,
  type Waiting,
} from "@shadow/player";
import { newRunId } from "./runner.ts";
import { listSkills, loadSkill, rollbackSkill, versions } from "./skill-store.ts";
import type { Checkpoint, InboxItem, RunRow, RunState, Store } from "./store.ts";
import type { Question, ServiceEvent, WorkflowSummary } from "./types.ts";

// One leg of a run, as main.ts runs it (runSkillOn). `hooks` must be passed to the run as they are: they make a run
// that needs the user end its leg as `waiting` instead of waiting in memory.
export type Execute = (
  skill: Skill,
  leg: {
    runId: string;
    provided: Record<string, unknown>;
    resume?: Resume;
    log(event: RunLogEvent): void;
    hooks: { approve(): Promise<Wait>; ask(): Promise<Wait>; waitForUser(): Promise<Wait> };
  },
) => Promise<RunOutcome>;

export type { Question, ServiceEvent, WorkflowSummary } from "./types.ts";

export interface ServiceOptions {
  dataDir: string;
  store: Store;
  execute: Execute;
  // Where run logs are (runs/<id>.jsonl and their repair transcripts).
  runsDir?: string;
  // Dollars the model has spent since the daemon started (UsageMeter), to count each run's cost.
  spent?: () => number;
  // What main.ts knows about the outside: connected extension and app, model configured.
  health?: () => Record<string, unknown>;
  now?: () => number;
}

export interface Service {
  workflows(): WorkflowSummary[];
  workflow(id: string): { id: string; versions: number[]; latest: Skill } | undefined;
  runs(options?: { skillId?: string; status?: RunState; limit?: number }): RunRow[];
  run(id: string): { run: RunRow; events: unknown[]; repairs: unknown[] } | undefined;
  inbox(options?: { open?: boolean }): InboxItem[];
  usage(): { todayUsd: number };
  health(): Record<string, unknown>;
  // Starts a run: a workflow id from the store, or the absolute path of a workflow file. Resolves when it is queued.
  start(ref: string, provided?: Record<string, unknown>, trigger?: string): RunRow;
  // Answers an inbox item. A waiting run's item makes the run go on (queued). Throws when it can't be answered.
  answer(itemId: string, answer: unknown): void;
  cancel(runId: string): RunRow;
  rollback(skillId: string): { id: string; version: number; summary: string };
  // Puts a question in the inbox and resolves with the answer.
  ask(question: Question): Promise<string>;
  subscribe(listener: (event: ServiceEvent) => void): () => void;
  // Startup: runs the daemon left going are interrupted; questions asked before the restart can't be answered.
  recover(): { interrupted: string[]; expired: string[] };
  // Resolves when no leg is queued or acting (tests, shutdown).
  idle(): Promise<void>;
}

export function createService(options: ServiceOptions): Service {
  const { store, dataDir } = options;
  const runsDir = options.runsDir ?? join(dataDir, "runs");
  const now = options.now ?? Date.now;
  const spent = options.spent ?? (() => 0);
  const listeners = new Set<(event: ServiceEvent) => void>();
  const emit = (event: ServiceEvent) => {
    for (const listener of listeners) listener(event);
  };
  const questions = new Map<string, (answer: string) => void>();
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => {});
  };
  const wait = async (): Promise<Wait> => WAIT;
  const hooks = { approve: wait, ask: wait, waitForUser: wait };

  const updateRun = (id: string, patch: Partial<Omit<RunRow, "id">>) => {
    const run = store.updateRun(id, patch);
    emit({ type: "run", run });
    return run;
  };
  const addItem = (item: Parameters<Store["addItem"]>[0]) => {
    const added = store.addItem(item);
    emit({ type: "inbox", item: added });
    return added;
  };

  // The workflow a run is on: its version in the store, else the file it was started from.
  const loadVersion = (skillId: string, version: number, file?: string): Skill => {
    const stored = versions(dataDir, skillId).includes(version) ? loadSkill(dataDir, skillId, version) : undefined;
    if (stored) return stored;
    if (file) {
      const fromFile = Skill.parse(JSON.parse(readFileSync(file, "utf8")));
      if (fromFile.version === version) return fromFile;
    }
    throw new Error(`${skillId} v${version} is no longer available`);
  };

  async function leg(run: RunRow, skill: Skill, provided: Record<string, unknown>, resume?: Resume, file?: string) {
    let version = skill.version;
    let repaired = run.repaired;
    const before = spent();
    let outcome: RunOutcome;
    try {
      outcome = await options.execute(skill, {
        runId: run.id,
        provided,
        resume,
        hooks,
        log: (event) => {
          if (event.type === "repair" && event.outcome === "commit" && event.version !== undefined) {
            version = event.version;
            repaired = true;
            addItem({
              kind: "repaired",
              runId: run.id,
              skillId: run.skillId,
              path: event.path,
              title: `Repaired ${run.skillId}: now v${event.version}. ${event.summary}`,
              detail: { version: event.version, summary: event.summary, by: event.by },
            });
          }
          emit({ type: "step", runId: run.id, event });
        },
      });
    } catch (error) {
      outcome = { status: "failed", vars: {}, error: (error as Error).message };
    }
    const costUsd = run.costUsd + Math.max(0, spent() - before);
    if (outcome.status === "waiting" && outcome.waiting && outcome.resume) {
      const checkpoint: Checkpoint = { version, inputs: provided, resume: outcome.resume, waiting: outcome.waiting };
      if (file) checkpoint.file = file;
      updateRun(run.id, { status: "waiting", version, repaired, costUsd, checkpoint, failedStep: outcome.failedStep });
      addItem({ ...itemFor(outcome.waiting), runId: run.id, skillId: run.skillId, path: outcome.waiting.path });
      return;
    }
    updateRun(run.id, {
      status: finalState(outcome.status),
      version,
      repaired,
      costUsd,
      endedAt: now(),
      failedStep: outcome.failedStep,
      error: outcome.error,
      checkpoint: undefined,
    });
  }

  return {
    workflows: () =>
      listSkills(dataDir).map((s) => ({ ...s, lastRun: store.listRuns({ skillId: s.id, limit: 1 })[0] })),
    workflow(id) {
      const all = versions(dataDir, id);
      const latest = loadSkill(dataDir, id);
      return latest ? { id, versions: all, latest } : undefined;
    },
    runs: (filter) => store.listRuns(filter),
    run(id) {
      const run = store.getRun(id);
      if (!run) return undefined;
      const log = join(runsDir, `${id}.jsonl`);
      const events = existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
      const repairs = existsSync(runsDir)
        ? readdirSync(runsDir)
            .filter((f) => f.startsWith(`${id}.repair-`))
            .sort((a, b) => episode(a) - episode(b))
            .map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf8")))
        : [];
      return { run, events, repairs };
    },
    inbox: (filter) => store.listItems({ open: filter?.open }),
    usage() {
      const day = new Date(now());
      day.setHours(0, 0, 0, 0);
      return { todayUsd: store.spentSince(day.getTime()) };
    },
    health: () => ({
      ...options.health?.(),
      waitingForYou: store.listItems({ open: true }).length,
      running: store.listRuns({ status: "running", limit: 10 }).map((r) => r.id),
    }),

    start(ref, provided = {}, trigger = "manual") {
      const file = ref.endsWith(".json") ? ref : undefined;
      const skill = file ? Skill.parse(JSON.parse(readFileSync(file, "utf8"))) : loadSkill(dataDir, ref);
      if (!skill) throw new Error(`no workflow ${ref}`);
      const startedAt = now();
      const run = store.startRun({
        id: newRunId(skill.id, new Date(startedAt)),
        skillId: skill.id,
        version: skill.version,
        trigger,
        startedAt,
      });
      emit({ type: "run", run });
      enqueue(() => leg(run, skill, provided, undefined, file));
      return run;
    },

    answer(itemId, raw) {
      const item = store.getItem(itemId);
      if (!item) throw new Error(`no inbox item ${itemId}`);
      if (item.answeredAt !== undefined) throw new Error("already answered");

      if (item.kind === "question") {
        if (typeof raw !== "string") throw new Error("the answer is text");
        if (!store.answerItem(itemId, raw, now())) throw new Error("already answered");
        emit({ type: "inbox", item: store.getItem(itemId) as InboxItem });
        questions.get(itemId)?.(raw);
        questions.delete(itemId);
        return;
      }
      if (item.kind === "repaired") {
        store.answerItem(itemId, raw ?? "seen", now());
        emit({ type: "inbox", item: store.getItem(itemId) as InboxItem });
        return;
      }

      // A waiting run's item: the answer goes into its checkpoint, and the run goes on.
      const run = item.runId ? store.getRun(item.runId) : undefined;
      const checkpoint = run?.checkpoint;
      if (run?.status !== "waiting" || !checkpoint) throw new Error("this run isn't waiting any more");
      const resume = resumeWith(checkpoint, raw);
      if (!store.answerItem(itemId, raw, now())) throw new Error("already answered");
      emit({ type: "inbox", item: store.getItem(itemId) as InboxItem });
      if (!resume) {
        updateRun(run.id, { status: "cancelled", endedAt: now(), error: "you stopped it", checkpoint: undefined });
        return;
      }
      const skill = loadVersion(run.skillId, checkpoint.version, checkpoint.file);
      // The checkpoint stays until the leg ends, so a run interrupted before then can still be looked at.
      const going = updateRun(run.id, { status: "running" });
      enqueue(() => leg(going, skill, checkpoint.inputs, resume, checkpoint.file));
    },

    cancel(runId) {
      const run = store.getRun(runId);
      if (!run) throw new Error(`no run ${runId}`);
      if (run.status === "running") throw new Error("can't stop a run in the middle of a step yet");
      if (run.status !== "waiting") throw new Error(`the run already ended: ${run.status}`);
      for (const item of store.listItems({ open: true, runId })) {
        store.answerItem(item.id, { cancelled: true }, now());
        emit({ type: "inbox", item: store.getItem(item.id) as InboxItem });
      }
      return updateRun(runId, { status: "cancelled", endedAt: now(), error: "cancelled", checkpoint: undefined });
    },

    rollback(skillId) {
      const saved = rollbackSkill(dataDir, skillId);
      return {
        id: saved.skill.id,
        version: saved.skill.version,
        summary: saved.skill.history.at(-1)?.summary ?? "",
      };
    },

    ask(question) {
      const item = addItem({
        kind: "question",
        title: question.title,
        detail: { options: question.options, default: question.default },
      });
      return new Promise((resolve) => questions.set(item.id, resolve));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    recover() {
      const interrupted = store.interruptRunning(now());
      const expired: string[] = [];
      for (const item of store.listItems({ open: true })) {
        if (item.kind !== "question") continue;
        store.answerItem(item.id, { expired: "the daemon restarted" }, now());
        expired.push(item.id);
      }
      return { interrupted, expired };
    },

    idle: async () => {
      // A leg can queue another (an answer while one runs): wait until the queue stops growing.
      for (let seen: Promise<void> | undefined; seen !== queue; ) {
        seen = queue;
        await queue;
      }
    },
  };
}

// What the user reads for a waiting run.
function itemFor(waiting: Waiting): Pick<InboxItem, "kind" | "title" | "detail"> {
  if (waiting.kind === "approval")
    return { kind: "approval", title: `Approve: ${waiting.intent}`, detail: { waiting } };
  if (waiting.kind === "ask") {
    const options = waiting.ask.kind === "confirm" ? ["yes", "no"] : undefined;
    return { kind: "ask", title: waiting.question, detail: { waiting, options } };
  }
  return { kind: "recovery", title: waiting.message, detail: { waiting, options: ["retry", "skip", "stop"] } };
}

// The checkpoint's resume with the user's answer in it; undefined when the answer stops the run.
function resumeWith(checkpoint: Checkpoint, raw: unknown): Resume | undefined {
  const { resume, waiting } = checkpoint;
  const add = (answer: Answer): Resume => ({ ...resume, answers: [...(resume.answers ?? []), answer] });
  if (waiting.kind === "approval") return add({ kind: "approval", approved: yes(raw) });
  if (waiting.kind === "ask") {
    const value = waiting.ask.kind === "confirm" ? yes(raw) : String(raw);
    return add({ kind: "ask", value });
  }
  if (raw === "retry") return resume;
  if (raw === "skip") return { ...resume, skip: true };
  if (raw === "stop") return undefined;
  throw new Error("answer retry, skip or stop");
}

// approve / deny, yes / no, true / false.
function yes(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw && typeof raw === "object" && "approved" in raw) return yes((raw as { approved: unknown }).approved);
  const text = String(raw).trim().toLowerCase();
  if (["yes", "y", "approve", "approved", "true", "ok"].includes(text)) return true;
  if (["no", "n", "deny", "denied", "false"].includes(text)) return false;
  throw new Error(`answer yes or no, not ${JSON.stringify(raw)}`);
}

function finalState(status: RunOutcome["status"]): RunState {
  if (status === "succeeded" || status === "denied" || status === "nothing_to_do") return status;
  return "failed"; // failed, a pause no one resumed, or a wait without a checkpoint
}

const episode = (file: string) => Number(/\.repair-(\d+)\.json$/.exec(file)?.[1] ?? 0);
