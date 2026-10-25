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
import { applyEdits, describeEdit, type EditInput, Skill, triggerOf } from "@shadow/core";
import {
  type Answer,
  type Resume,
  type RunLogEvent,
  type RunOutcome,
  WAIT,
  type Wait,
  type Waiting,
} from "@shadow/player";
import { deleteDraft, draftSkill, readDraft, writeDraft } from "./draft-store.ts";
import { goLiveProblems, nextTime, readState, triggerKey, writeState } from "./lifecycle.ts";
import { markReviewed, readReview } from "./review-store.ts";
import { newRunId } from "./runner.ts";
import { listSkills, loadSkill, rollbackSkill, saveSkill, versions } from "./skill-store.ts";
import type { Checkpoint, InboxItem, RunRow, RunState, Store } from "./store.ts";
import type { DraftView, Question, Review, ServiceEvent, StateFile, WorkflowSummary } from "./types.ts";

// Auto-pause (docs/design.md, "Workflow lifecycle"): this many failed runs in a row, started by the trigger.
export const AUTO_PAUSE_AFTER = 3;

// One leg of a run, as main.ts runs it (runSkillOn). `hooks` must be passed to the run as they are: they make a run
// that needs the user end its leg as `waiting` instead of waiting in memory.
export type Execute = (
  skill: Skill,
  leg: {
    runId: string;
    provided: Record<string, unknown>;
    resume?: Resume;
    // A walk-through (docs/design.md, "7. Test"): every step waits for the user, with its target highlighted.
    walk: boolean;
    log(event: RunLogEvent): void;
    hooks: { approve(): Promise<Wait>; ask(): Promise<Wait>; waitForUser(): Promise<Wait>; walk(): Promise<Wait> };
    // Fires when the user stops the run (cancel while it runs).
    signal?: AbortSignal;
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
  // Walks through a workflow: a run that stops before every step with its target highlighted, and goes on with
  // "do it" / "next", "skip" or "stop" from the inbox. Reads run on "next"; acting steps only on "do it".
  walk(id: string, provided?: Record<string, unknown>): RunRow;
  // Answers an inbox item. A waiting run's item makes the run go on (queued). Throws when it can't be answered.
  answer(itemId: string, answer: unknown): void;
  cancel(runId: string): RunRow;
  rollback(skillId: string): { id: string; version: number; summary: string };
  // Puts a question in the inbox and resolves with the answer.
  // onItem: the inbox item's id, as soon as it exists (a question the daemon may answer itself: connectors.ts).
  ask(question: Question, onItem?: (itemId: string) => void): Promise<string>;
  subscribe(listener: (event: ServiceEvent) => void): () => void;
  // Startup: runs the daemon left going are interrupted; questions asked before the restart can't be answered.
  recover(): { interrupted: string[]; expired: string[] };
  // A workflow's lifecycle (lifecycle.ts). goLive and resume run the checks and throw with what is missing.
  state(id: string): StateFile;
  goLive(id: string): StateFile;
  // The review of the latest design (skills/<id>/review.json), and "Looks right" (spec 4.3).
  review(id: string): Review | null;
  looksRight(id: string): Review | null;
  pause(id: string, reason?: string): StateFile;
  resume(id: string): StateFile;
  // Sets the Frequency: the trigger step's `when`, saved as the next version (by: user). On a live workflow the new
  // trigger counts from now.
  setTrigger(id: string, when: unknown[]): { version: number };
  // A trigger fired (triggers.ts): starts a run, unless the workflow's previous run is still going or waiting for
  // the user; then a skipped run says why.
  fire(skillId: string, trigger: "schedule" | "folder", provided?: Record<string, unknown>): RunRow;
  // The workflow's run that is still going or waiting for the user, if any.
  busy(skillId: string): RunRow | undefined;
  // Work that needs the automation window to itself (the design's test run): queued with the runs' legs, so the two
  // never share the window (each one's end closes the other's tabs).
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  // The editor (docs/design.md, "6. Edit"): a draft beside the workflow, as a base version plus edit operations,
  // autosaved after every change. editDraft refuses an edit the workflow can't take (check.ts) and says why.
  draft(id: string): DraftView;
  editDraft(id: string, edits: EditInput[]): DraftView;
  undoDraft(id: string): DraftView;
  redoDraft(id: string): DraftView;
  discardDraft(id: string): DraftView;
  // Saves the draft as the next version (by: user) and drops the draft. A live workflow's new version must pass the
  // go-live checks.
  publishDraft(id: string, summary?: string): { version: number };
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
  const hooks = { approve: wait, ask: wait, waitForUser: wait, walk: wait };
  // Runs that are going (or queued to go), by id: cancel stops them through their signal.
  const going = new Map<string, AbortController>();

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

  async function leg(
    run: RunRow,
    skill: Skill,
    provided: Record<string, unknown>,
    resume?: Resume,
    file?: string,
    // A walk-through of a draft: the tree itself goes into the checkpoint, since no version holds it.
    tree?: Skill,
  ) {
    let version = skill.version;
    let repaired = run.repaired;
    const before = spent();
    // Stopped while it waited in the queue: it never starts.
    const stop = going.get(run.id) ?? new AbortController();
    going.set(run.id, stop);
    if (stop.signal.aborted) {
      going.delete(run.id);
      updateRun(run.id, { status: "cancelled", endedAt: now(), error: "you stopped it", checkpoint: undefined });
      return;
    }
    let outcome: RunOutcome;
    try {
      outcome = await options.execute(skill, {
        runId: run.id,
        provided,
        resume,
        walk: run.trigger === "walk",
        hooks,
        signal: stop.signal,
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
    } finally {
      going.delete(run.id);
    }
    // Stopped by the user: whatever the step in progress said, the run was cancelled.
    if (stop.signal.aborted) outcome = { ...outcome, status: "cancelled", error: "you stopped it" };
    const costUsd = run.costUsd + Math.max(0, spent() - before);
    if (outcome.status === "waiting" && outcome.waiting && outcome.resume) {
      const checkpoint: Checkpoint = { version, inputs: provided, resume: outcome.resume, waiting: outcome.waiting };
      if (file) checkpoint.file = file;
      if (tree) checkpoint.skill = tree;
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
    if (run.trigger !== "manual" && run.trigger !== "walk") autoPause(run.skillId);
  }

  // ── The lifecycle (lifecycle.ts): draft, live, paused ──
  const setState = (id: string, next: StateFile): StateFile => {
    writeState(dataDir, id, next);
    emit({ type: "workflow", id, state: next });
    return next;
  };
  const latest = (id: string): Skill => {
    const skill = loadSkill(dataDir, id);
    if (!skill) throw new Error(`no workflow ${id}`);
    return skill;
  };
  const goLive = (id: string): StateFile => {
    const review = readReview(dataDir, id);
    // A version saved on top of the design (a new Frequency, an edit) doesn't lift it: Looks right does.
    if (review && !review.reviewed && review.version <= latest(id).version) {
      throw new Error("can't go live yet: look at what the design changed, then press Looks right");
    }
    // A design that can't do the task yet (a file the recording shows that no step makes) never starts on its own; a
    // version you edited after it may have fixed that (checkpoint 6).
    if (review?.cantRun?.length && review.version === latest(id).version) {
      throw new Error(`can't go live: it can't do the task yet: ${review.cantRun.join("; ")}`);
    }
    const problems = goLiveProblems(latest(id));
    if (problems.length > 0) throw new Error(`can't go live: ${problems.join("; ")}`);
    return setState(id, { state: "live", since: now() });
  };
  const pause = (id: string, reason = "paused by you", auto = false): StateFile => {
    latest(id);
    return setState(id, { state: "paused", since: now(), reason, auto });
  };
  // After a triggered run ends: AUTO_PAUSE_AFTER failed runs in a row, started by the trigger, pause the workflow.
  // Runs started by hand don't count; a run that succeeded, found nothing to do or was denied ends the streak.
  function autoPause(id: string) {
    if (readState(dataDir, id).state !== "live") return;
    const finished = store
      .listRuns({ skillId: id, limit: 50 })
      .filter(
        (r) => r.trigger !== "manual" && r.trigger !== "walk" && !["running", "waiting", "skipped"].includes(r.status),
      );
    let streak = 0;
    for (const r of finished) {
      if (r.status !== "failed" && r.status !== "interrupted") break;
      streak++;
    }
    if (streak < AUTO_PAUSE_AFTER) return;
    const reason = `its last ${streak} runs failed${finished[0]?.error ? ` (last: ${finished[0].error})` : ""}`;
    pause(id, reason, true);
    addItem({
      kind: "paused",
      skillId: id,
      title: `Paused ${id}: ${reason}`,
      detail: { reason, options: ["resume", "keep paused"] },
    });
  }
  // The draft as the editor shows it: without a draft file, the latest version with nothing changed.
  const draftView = (id: string): DraftView => {
    const current = latest(id);
    const found = draftSkill(dataDir, id);
    const skill = found?.skill ?? current;
    return {
      id,
      base: found?.draft.base ?? current.version,
      latest: current.version,
      skill,
      changes: (found?.draft.ops ?? []).map(describeEdit),
      canUndo: (found?.draft.ops.length ?? 0) > 0,
      canRedo: (found?.draft.undone.length ?? 0) > 0,
      problems: goLiveProblems(skill),
    };
  };

  // When a live workflow next starts on its own: the soonest of its schedules.
  const nextRunAt = (skill: Skill, state: StateFile): number | undefined => {
    if (state.state !== "live") return undefined;
    const times = triggerOf(skill).when.flatMap((t, i) => {
      if (t.type !== "schedule") return [];
      const from = Math.max(now(), store.getMark(skill.id, triggerKey(i, t)) ?? state.since);
      const next = nextTime(t.cron, from);
      return next === undefined ? [] : [next];
    });
    return times.length > 0 ? Math.min(...times) : undefined;
  };

  const service: Service = {
    workflows: () =>
      listSkills(dataDir).map((s) => {
        const state = readState(dataDir, s.id);
        const skill = loadSkill(dataDir, s.id);
        return {
          ...s,
          lastRun: store.listRuns({ skillId: s.id, limit: 1 })[0],
          state,
          when: skill ? triggerOf(skill).when : [],
          nextRunAt: skill ? nextRunAt(skill, state) : undefined,
        };
      }),
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
    health() {
      // The next workflow to start on its own, for the menu bar.
      const next = service
        .workflows()
        .filter((w) => w.nextRunAt !== undefined)
        .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
      return {
        ...options.health?.(),
        waitingForYou: store.listItems({ open: true }).length,
        running: store.listRuns({ status: "running", limit: 10 }).map((r) => r.id),
        next: next ? { id: next.id, name: next.name, at: next.nextRunAt } : undefined,
      };
    },

    start(ref, provided = {}, trigger = "manual") {
      const file = ref.endsWith(".json") ? ref : undefined;
      // A walk-through walks the draft when there is one: that is what the editor's Walk through is for.
      const draft = !file && trigger === "walk" ? draftSkill(dataDir, ref)?.skill : undefined;
      const skill = file ? Skill.parse(JSON.parse(readFileSync(file, "utf8"))) : (draft ?? loadSkill(dataDir, ref));
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
      enqueue(() => leg(run, skill, provided, undefined, file, draft));
      return run;
    },

    walk: (id, provided = {}) => service.start(id, provided, "walk"),

    // ── The editor's draft (draft-store.ts) ──
    draft: (id) => draftView(id),
    editDraft(id, edits) {
      const current = readDraft(dataDir, id) ?? { base: latest(id).version, ops: [], undone: [], updatedAt: now() };
      const base = loadSkill(dataDir, id, current.base);
      if (!base) throw new Error(`the draft was made on v${current.base}, which is gone`);
      const applied = applyEdits(base, [...current.ops, ...edits]);
      if (!applied.ok) throw new Error(applied.problems.join("; "));
      writeDraft(dataDir, id, { ...current, ops: [...current.ops, ...edits], undone: [], updatedAt: now() });
      return draftView(id);
    },
    undoDraft(id) {
      const current = readDraft(dataDir, id);
      const last = current?.ops.at(-1);
      if (!current || !last) return draftView(id);
      writeDraft(dataDir, id, {
        ...current,
        ops: current.ops.slice(0, -1),
        undone: [...current.undone, last],
        updatedAt: now(),
      });
      return draftView(id);
    },
    redoDraft(id) {
      const current = readDraft(dataDir, id);
      const last = current?.undone.at(-1);
      if (!current || !last) return draftView(id);
      writeDraft(dataDir, id, {
        ...current,
        ops: [...current.ops, last],
        undone: current.undone.slice(0, -1),
        updatedAt: now(),
      });
      return draftView(id);
    },
    discardDraft(id) {
      deleteDraft(dataDir, id);
      return draftView(id);
    },
    publishDraft(id, summary) {
      const current = readDraft(dataDir, id);
      if (!current || current.ops.length === 0) throw new Error("the draft has no changes");
      // The operations are replayed onto the latest version (a repair may have landed under the draft).
      const onto = latest(id);
      const applied = applyEdits(onto, current.ops);
      if (!applied.ok)
        throw new Error(`the changes no longer apply to v${onto.version}: ${applied.problems.join("; ")}`);
      const state = readState(dataDir, id);
      if (state.state === "live") {
        const problems = goLiveProblems(applied.skill);
        if (problems.length > 0)
          throw new Error(`a live workflow's new version must still run on its own: ${problems.join("; ")}`);
      }
      const version = onto.version + 1;
      const what = summary?.trim() || current.ops.map(describeEdit).join("; ");
      const saved = saveSkill(dataDir, {
        ...applied.skill,
        history: [...applied.skill.history, { version, by: "user", summary: what, at: new Date(now()).toISOString() }],
      });
      deleteDraft(dataDir, id);
      emit({ type: "workflow", id, state });
      return { version: saved.skill.version };
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
      if (item.kind === "paused") {
        // "resume" makes it live again (the checks run first); anything else leaves it paused.
        if (raw === "resume" && item.skillId) goLive(item.skillId);
        store.answerItem(itemId, raw ?? "keep paused", now());
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
      const tree = checkpoint.skill ? Skill.parse(checkpoint.skill) : undefined;
      const skill = tree ?? loadVersion(run.skillId, checkpoint.version, checkpoint.file);
      // The checkpoint stays until the leg ends, so a run interrupted before then can still be looked at.
      const going = updateRun(run.id, { status: "running" });
      enqueue(() => leg(going, skill, checkpoint.inputs, resume, checkpoint.file, tree));
    },

    cancel(runId) {
      const run = store.getRun(runId);
      if (!run) throw new Error(`no run ${runId}`);
      // Running (or queued to run): stop it. It ends as cancelled at its next step; the step in progress is let go.
      if (run.status === "running") {
        const stop = going.get(runId) ?? new AbortController();
        going.set(runId, stop);
        stop.abort();
        return run;
      }
      if (run.status !== "waiting") throw new Error(`the run already ended: ${run.status}`);
      for (const item of store.listItems({ open: true, runId })) {
        store.answerItem(item.id, { cancelled: true }, now());
        emit({ type: "inbox", item: store.getItem(item.id) as InboxItem });
      }
      return updateRun(runId, { status: "cancelled", endedAt: now(), error: "cancelled", checkpoint: undefined });
    },

    state: (id) => readState(dataDir, id),
    goLive,
    review: (id) => readReview(dataDir, id) ?? null,
    looksRight: (id) => {
      const marked = markReviewed(dataDir, id) ?? null;
      emit({ type: "workflow", id, state: readState(dataDir, id) });
      return marked;
    },
    pause: (id, reason) => pause(id, reason),
    resume: goLive,

    setTrigger(id, when) {
      const current = latest(id);
      const trigger = triggerOf(current);
      const edited = applyEdits(current, [{ op: "set", step: trigger.id, field: "when", value: when }]);
      if (!edited.ok) throw new Error(edited.problems.join("; "));
      const version = current.version + 1;
      const describe = (edited.skill.steps[0]?.type === "trigger" ? edited.skill.steps[0].when : [])
        .map((t) =>
          t.type === "schedule" ? `schedule ${t.cron}` : t.type === "folder_watch" ? `folder ${t.dir}` : "by hand",
        )
        .join(", ");
      const saved = saveSkill(dataDir, {
        ...edited.skill,
        history: [
          ...edited.skill.history,
          { version, by: "user", summary: `Frequency: ${describe}`, at: new Date(now()).toISOString() },
        ],
      });
      // A live workflow's new trigger counts from now, not from when it first went live.
      const state = readState(dataDir, id);
      if (state.state === "live") setState(id, { state: "live", since: now() });
      else emit({ type: "workflow", id, state });
      return { version: saved.skill.version };
    },

    exclusive: <T>(work: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => enqueue(() => work().then(resolve, reject))),
    busy: (skillId) =>
      store.listRuns({ skillId, limit: 20 }).find((r) => r.status === "running" || r.status === "waiting"),

    fire(skillId, trigger, provided = {}) {
      const busy = service.busy(skillId);
      if (busy) {
        const at = now();
        const skipped = store.startRun({
          id: newRunId(skillId, new Date(at)),
          skillId,
          version: latest(skillId).version,
          trigger,
          startedAt: at,
        });
        return updateRun(skipped.id, {
          status: "skipped",
          endedAt: at,
          error:
            busy.status === "waiting"
              ? "skipped: the last run still waits for you"
              : "skipped: the last run is still going",
        });
      }
      return service.start(skillId, provided, trigger);
    },

    rollback(skillId) {
      const saved = rollbackSkill(dataDir, skillId);
      return {
        id: saved.skill.id,
        version: saved.skill.version,
        summary: saved.skill.history.at(-1)?.summary ?? "",
      };
    },

    ask(question, onItem) {
      const item = addItem({
        kind: "question",
        title: question.title,
        detail: {
          options: question.options,
          freeText: question.freeText ?? true,
          default: question.default,
          step: question.step,
          draft: question.draft,
          sessionId: question.sessionId,
          ...(question.connect ? { connect: question.connect } : {}),
          ...(question.why ? { why: question.why } : {}),
        },
      });
      const answered = new Promise<string>((resolve) => questions.set(item.id, resolve));
      onItem?.(item.id);
      return answered;
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
  return service;
}

// What the user reads for a waiting run.
function itemFor(waiting: Waiting): Pick<InboxItem, "kind" | "title" | "detail"> {
  if (waiting.kind === "approval")
    return { kind: "approval", title: `Approve: ${waiting.intent}`, detail: { waiting } };
  if (waiting.kind === "ask") {
    const options = waiting.ask.kind === "confirm" ? ["yes", "no"] : undefined;
    return { kind: "ask", title: waiting.question, detail: { waiting, options } };
  }
  if (waiting.kind === "walk") {
    // An acting step (click, type, send) waits for "do it"; a step that only reads or opens a page for "next".
    return {
      kind: "walk",
      title: `${waiting.acting ? "Do it" : "Next"}: ${waiting.intent}`,
      detail: { waiting, options: waiting.acting ? ["do it", "skip", "stop"] : ["next", "skip", "stop"] },
    };
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
  if (waiting.kind === "walk") {
    const text = String(raw).trim().toLowerCase();
    if (text === "stop") return undefined;
    if (text === "skip") return add({ kind: "walk", choice: "skip" });
    if (["do it", "do", "next", "yes", "ok"].includes(text)) return add({ kind: "walk", choice: "do" });
    throw new Error("answer do it (or next), skip or stop");
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
  if (status === "succeeded" || status === "denied" || status === "nothing_to_do" || status === "cancelled")
    return status;
  return "failed"; // failed, a pause no one resumed, or a wait without a checkpoint
}

const episode = (file: string) => Number(/\.repair-(\d+)\.json$/.exec(file)?.[1] ?? 0);
