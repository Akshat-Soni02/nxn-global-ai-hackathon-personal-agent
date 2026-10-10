// Running a workflow with recovery (docs/design.md, section 9 and "Plugging into a run"): a step that fails every
// attempt pauses the run, with the tab or window as it is. Repair classifies the failure and, for drift, fixes it; a
// fix is saved as the next version and the run resumes from where it stopped. A site that is down is retried
// later; anything that needs the user waits for them (retry the step, skip it because they did it by hand, or stop).
// Used by the daemon and by `pnpm replay`; each supplies the hooks.
import { type Availability, type Skill, walkSteps } from "@taskplayer/core";
import { type RunOptions, runSkill } from "../run.ts";
import type { Failure, Resume, RunDeps, RunLogEvent, RunOutcome } from "../types.ts";
import type { RepairEnv } from "./env.ts";
import type { Repairer, RepairOutcome } from "./repair.ts";

export interface Recovery {
  // One per run: it keeps the run's repair limits.
  repairer: Repairer;
  // Saves a repaired version; the run goes on with what is returned.
  saveVersion(skill: Skill): Skill | Promise<Skill>;
  // The run needs the user: something to do first (log in), or a fix repair couldn't find. "retry" runs the stuck
  // step again, "skip" goes on after it (the user did it by hand), "stop" ends the run.
  waitForUser(message: string, failure: Failure): Promise<"retry" | "skip" | "stop">;
  // The browser tab, for web failures.
  page?: RepairEnv["page"];
  // Site notes, by skill.
  recall?(query: string, skillId: string): Promise<string[]>;
  note?(fact: string, skillId: string): Promise<void>;
  available?(): Availability;
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
  // Retargeted outward steps the repair's try didn't run: approval the first time they run.
  let approveOnce: string[] = [];
  let transient = 0;
  let episodes = 0;

  for (;;) {
    const outcome = await runSkill(withApproval(current, approveOnce), logged, { ...options, runId, resume });
    if (outcome.status !== "paused" || outcome.pausedBy !== "failure" || !outcome.failure || !outcome.resume) {
      return outcome;
    }
    const failure = outcome.failure;
    const skillId = current.id;
    const env: RepairEnv = {
      runId,
      deps: { ...deps, onFailure: undefined },
      page: failure.step.type === "action" && failure.step.channel === "web" ? recovery.page : undefined,
      runLog,
      recall: recovery.recall && ((query) => recovery.recall?.(query, skillId) ?? Promise.resolve([])),
      note: recovery.note && ((fact) => recovery.note?.(fact, skillId) ?? Promise.resolve()),
      available: recovery.available?.(),
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
      current = await recovery.saveVersion(repaired.skill);
      event(repaired.summary, { by: repaired.by, version: current.version });
      approveOnce = repaired.approveOnce;
      // The try ran to the end of the workflow: the run is done.
      if (!repaired.resume) return { status: "succeeded", vars: failure.vars };
      resume = repaired.resume;
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
        resume = outcome.resume;
        continue;
      }
    }

    // Needs the user: something to do first, or a fix repair couldn't find.
    const message =
      repaired.kind === "escalate"
        ? `couldn't repair ${failure.path}: ${repaired.reason}.${repaired.whatToShow ? ` Do it by hand: ${repaired.whatToShow}.` : ""}`
        : repaired.need
          ? `${failure.path} needs you: ${repaired.need}.`
          : `${failure.path} failed: ${failure.result.error}.`;
    const choice = await recovery.waitForUser(message, failure);
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
