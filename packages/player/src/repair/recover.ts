// Running a workflow with recovery (docs/design.md, section 9 and "Plugging into a run"): a step that fails every
// attempt pauses the run, with the tab or window as it is. Repair classifies the failure and, for drift, fixes it; a
// fix is saved as the next version and the run resumes from where it stopped. A site that is down is retried
// later; anything that needs the user waits for them (retry the step, skip it because they did it by hand, or stop).
// Used by the daemon and by `pnpm replay`; each supplies the hooks.
import { type Availability, type EditInput, type Skill, walkSteps, whereIn } from "@shadow/core";
import { type RunOptions, runSkill } from "../run.ts";
import {
  type Failure,
  type Proposal,
  type Resume,
  type RunDeps,
  type RunLogEvent,
  type RunOutcome,
  WAIT,
  type Wait,
} from "../types.ts";
import type { RepairEnv } from "./env.ts";
import type { Repairer, RepairOutcome } from "./repair.ts";

export interface Recovery {
  // One per run: it keeps the run's repair limits.
  repairer: Repairer;
  // Saves a repaired version; the run goes on with what is returned.
  // `edits` are the fix as edit operations, so a repair built on an older version can be applied to the latest.
  saveVersion(skill: Skill, edits?: EditInput[]): Skill | Promise<Skill>;
  // The run needs the user: something to do first (log in), or a fix repair couldn't find. "retry" runs the stuck
  // step again, "skip" goes on after it (the user did it by hand), "stop" ends the run. WAIT: nobody can answer now,
  // so the run ends as `waiting` (kind "recovery"); its resume, with skip for "skip", goes on later.
  // With a proposal (a fix that needs their OK), "use" saves it and goes on with it.
  waitForUser(
    message: string,
    failure: Failure,
    proposal?: Proposal,
  ): Promise<"retry" | "skip" | "stop" | "use" | Wait>;
  // The browser tab, for web failures.
  page?: RepairEnv["page"];
  // Site notes, by skill.
  recall?(query: string, skillId: string): Promise<string[]>;
  note?(fact: string, skillId: string): Promise<void>;
  // A masked picture of the page (web) or the frontmost window (ax), described (only with pictures consent).
  describeScreen?(question: string, channel: "web" | "ax"): Promise<string>;
  available?(): Availability;
  // One connected app tool's arguments, for repair's app_tool look.
  appTool?: RepairEnv["appTool"];
  // The connected app that covers a page, for app-first repair.
  appFor?: RepairEnv["appFor"];
  // What the recording showed at a step, for the failure report.
  recorded?: RepairEnv["recorded"];
  // Each repair episode, to store next to the run log.
  onEpisode?(n: number, record: { failure: string; outcome: RepairOutcome["kind"]; transcript: unknown[] }): void;
  // A transient failure is retried after these waits; then it needs the user.
  retryAfterMs?: number[];
  sleep?(ms: number): Promise<void>;
}

export async function runWithRecovery(
  skill: Skill,
  deps: RunDeps,
  options: RunOptions & { recovery: Recovery },
): Promise<RunOutcome> {
  const { recovery } = options;
  const runId = options.runId ?? `${skill.id}-${Date.now()}`;
  const runLog: RunLogEvent[] = [];
  const logged: RunDeps = {
    ...deps,
    onFailure: () => "pause",
    log: (e) => {
      runLog.push(e);
      deps.log?.(e);
    },
  };
  const retryAfter = recovery.retryAfterMs ?? [30_000, 120_000];
  const sleep = recovery.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let current = skill;
  let resume: Resume | undefined = options.resume;
  // Retargeted outward steps the repair's try didn't run: approval the first time they run. Kept across a wait.
  let approveOnce: string[] = options.resume?.approveOnce ?? [];
  let transient = 0;
  let episodes = 0;
  // A waiting run carries approveOnce in its resume, so going on later can't skip a retargeted step's approval.
  const keep = (outcome: RunOutcome): RunOutcome =>
    outcome.resume && approveOnce.length > 0 ? { ...outcome, resume: { ...outcome.resume, approveOnce } } : outcome;

  for (;;) {
    const outcome = await runSkill(withApproval(current, approveOnce), logged, { ...options, runId, resume });
    if (outcome.status === "waiting") return keep(outcome);
    if (outcome.status !== "paused" || outcome.pausedBy !== "failure" || !outcome.failure || !outcome.resume) {
      return outcome;
    }
    // Stopped by the user: nothing is repaired or retried.
    if (options.signal?.aborted) return { ...outcome, status: "cancelled", error: "you stopped it" };
    const failure = outcome.failure;
    const skillId = current.id;
    const env: RepairEnv = {
      runId,
      deps: { ...deps, onFailure: undefined },
      page: failure.step.type === "action" && failure.step.channel === "web" ? recovery.page : undefined,
      runLog,
      recall: recovery.recall && ((query) => recovery.recall?.(query, skillId) ?? Promise.resolve([])),
      note: recovery.note && ((fact) => recovery.note?.(fact, skillId) ?? Promise.resolve()),
      describeScreen:
        recovery.describeScreen &&
        ((question) =>
          recovery.describeScreen?.(
            question,
            failure.step.type === "action" && failure.step.channel === "ax" ? "ax" : "web",
          ) ?? Promise.resolve("")),
      available: recovery.available?.(),
      appTool: recovery.appTool,
      appFor: recovery.appFor,
      recorded: recovery.recorded,
    };
    const before = recovery.repairer.spent.costUsd;
    const repaired = await recovery.repairer.repair(current, failure, env);
    if (repaired.episode) {
      recovery.onEpisode?.(++episodes, {
        failure: failure.path,
        outcome: repaired.kind,
        transcript: repaired.episode.transcript,
      });
    }
    const event = (summary: string, extra: Partial<Extract<RunLogEvent, { type: "repair" }>> = {}) =>
      logged.log?.({
        type: "repair",
        path: failure.path,
        outcome: repaired.kind,
        class: repaired.classification.class,
        summary,
        costUsd: recovery.repairer.spent.costUsd - before,
        ...extra,
      });

    if (repaired.kind === "commit") {
      current = await recovery.saveVersion(repaired.skill, repaired.edits);
      event(repaired.summary, { by: repaired.by, version: current.version });
      approveOnce = repaired.approveOnce;
      // The try ran to the end of the workflow: the run is done.
      if (!repaired.resume) return { status: "succeeded", vars: failure.vars };
      resume = repaired.resume;
      continue;
    }
    // A fix that needs their OK: it waits for it, and "use" saves it and goes on.
    if (repaired.kind === "propose") {
      const proposal: Proposal = {
        summary: repaired.summary,
        what: repaired.what,
        skill: repaired.skill,
        edits: repaired.edits,
      };
      const message = `${whereIn(current, failure.stepId)} failed: ${failure.result.error}. Shadow can fix it: ${repaired.summary}`;
      const choice = await recovery.waitForUser(message, failure, proposal);
      if (choice === WAIT) {
        return keep({
          ...outcome,
          status: "waiting",
          waiting: {
            kind: "recovery",
            path: failure.path,
            stepId: failure.stepId,
            message,
            error: failure.result.error,
            proposal,
          },
        });
      }
      if (choice === "use") {
        current = await recovery.saveVersion(repaired.skill, repaired.edits);
        event(repaired.summary, { by: "agent", version: current.version });
        if (!repaired.resume) return { status: "succeeded", vars: failure.vars };
        resume = repaired.resume;
        continue;
      }
      if (choice === "stop") return { ...outcome, status: "failed" };
      resume = { ...outcome.resume, skip: choice === "skip" };
      continue;
    }

    event(repaired.reason);
    if (repaired.kind === "resolve") {
      if (repaired.class === "nothing_to_do") {
        return { status: "nothing_to_do", vars: outcome.vars, failedStep: failure.path, error: repaired.reason };
      }
      if (repaired.class === "data") return { ...outcome, status: "failed" };
      if (repaired.class === "transient" && transient < retryAfter.length) {
        await sleep(retryAfter[transient++] as number);
        if (options.signal?.aborted) return { ...outcome, status: "cancelled", error: "you stopped it" };
        resume = outcome.resume;
        continue;
      }
    }

    // Needs the user: something to do first, or a fix repair couldn't find.
    const message =
      repaired.kind === "escalate"
        ? `couldn't repair ${whereIn(current, failure.stepId)}: ${repaired.reason}.${repaired.whatToShow ? ` Do it by hand: ${repaired.whatToShow}.` : ""}`
        : repaired.need
          ? `${whereIn(current, failure.stepId)} needs you: ${repaired.need}.`
          : `${whereIn(current, failure.stepId)} failed: ${failure.result.error}.`;
    const choice = await recovery.waitForUser(message, failure);
    if (choice === WAIT) {
      return keep({
        ...outcome,
        status: "waiting",
        waiting: { kind: "recovery", path: failure.path, stepId: failure.stepId, message, error: failure.result.error },
      });
    }
    if (choice === "stop") return { ...outcome, status: "failed" };
    resume = { ...outcome.resume, skip: choice === "skip" };
  }
}

function withApproval(skill: Skill, ids: string[]): Skill {
  if (ids.length === 0) return skill;
  const copy = structuredClone(skill);
  for (const { step } of walkSteps(copy.steps)) {
    if (ids.includes(step.id) && "requires_approval" in step) step.requires_approval = true;
  }
  return copy;
}
