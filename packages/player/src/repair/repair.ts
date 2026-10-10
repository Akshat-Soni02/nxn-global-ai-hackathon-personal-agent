// Recover from a failure (docs/design.md, section 9): classify first, then the cheap ladder, then the repair agent.
// Only drift may change the workflow, and only with evidence; a verified repair is the next version at once
// (by: debug), and the run resumes from where it stopped.
//
//   const repairer = createRepairer({ llm, meter });           one per run: it keeps the per-run limits
//   const outcome = await repairer.repair(skill, failure, env); resolve | commit | escalate
import { type Budget, type Episode, runAgent } from "@taskplayer/agent";
import { briefing, type EditInput, isOutward, Skill, type Step, walkSteps } from "@taskplayer/core";
import type { Llm, UsageMeter } from "@taskplayer/llm";
import { UsageMeter as Meter } from "@taskplayer/llm";
import type { Failure, Resume } from "../types.ts";
import type { PageSignals } from "../web/inspect.ts";
import { type Classification, classify, type FailureClass } from "./classify.ts";
import type { RepairEnv } from "./env.ts";
import { ladder } from "./ladder.ts";
import { failureReport } from "./report.ts";
import { type RepairFinish, type RepairSession, repairGuard, repairTools } from "./tools.ts";

export interface RepairLimits {
  // Repair episodes (agent runs) per run, and dollars of repair per run.
  episodesPerRun: number;
  costPerRunUsd: number;
  // Per episode: turns, dollars, live actions.
  episode: Partial<Budget>;
}
export const DEFAULT_REPAIR_LIMITS: RepairLimits = {
  episodesPerRun: 2,
  costPerRunUsd: 0.25,
  episode: { turns: 12, costUsd: 0.1, liveActions: 20 },
};

export interface RepairerOptions {
  // Without a model, only classification and the cheap ladder run.
  llm?: Llm;
  // The run's meter: repair's cost is counted there too.
  meter?: UsageMeter;
  limits?: Partial<RepairLimits>;
  protocol?: "tools" | "json";
  signal?: AbortSignal;
  onEvent?: Parameters<typeof runAgent>[0]["onEvent"];
  now?: () => Date;
}

export type RepairOutcome = { classification: Classification; episode?: Episode<RepairFinish> } & (
  | { kind: "resolve"; class: Exclude<FailureClass, "drift">; reason: string; need?: string }
  | {
      kind: "commit";
      // The next version, with its history note.
      skill: Skill;
      summary: string;
      edits: EditInput[];
      by: "ladder" | "agent";
      // Where the run goes on; absent when the tried steps finished the workflow.
      resume?: Resume;
      // Retargeted outward steps the try didn't run: they need approval the first time they run.
      approveOnce: string[];
    }
  | { kind: "escalate"; reason: string; whatToShow?: string }
);

export interface Repairer {
  repair(skill: Skill, failure: Failure, env: RepairEnv): Promise<RepairOutcome>;
  // Episodes run and dollars spent so far in this run.
  readonly spent: { episodes: number; costUsd: number };
}

export function createRepairer(options: RepairerOptions = {}): Repairer {
  const limits = { ...DEFAULT_REPAIR_LIMITS, ...options.limits };
  const meter = (options.meter ?? new Meter()).child();
  let episodes = 0;

  async function repair(skill: Skill, failure: Failure, env: RepairEnv): Promise<RepairOutcome> {
    const isWeb = failure.step.type === "action" && failure.step.channel === "web";
    const signals = env.page && isWeb ? await env.page({ op: "signals" }) : undefined;
    const classification = classify(failure, signals?.ok ? (signals.value as PageSignals) : undefined);
    const c = classification.class;
    if (c !== "drift" && c !== "unknown") {
      return { kind: "resolve", class: c, reason: classification.reason, need: classification.need, classification };
    }

    // 1. The cheap ladder, no model.
    if (c === "drift") {
      const fix = await ladder(skill, failure, env);
      if (fix) {
        return {
          kind: "commit",
          by: "ladder",
          skill: nextVersion(skill, fix.skill, `${fix.rung}: ${fix.summary}`, options.now),
          summary: fix.summary,
          edits: fix.edits,
          resume: fix.tried.resume,
          approveOnce: approveOnce(skill, fix.skill, fix.tried.approved),
          classification,
        };
      }
    }

    // 2. The repair agent, within the run's limits.
    const escalate = (reason: string, episode?: Episode<RepairFinish>): RepairOutcome => ({
      kind: "escalate",
      reason,
      classification,
      episode,
    });
    if (!options.llm) return escalate(`no model configured to repair it (${classification.reason})`);
    if (episodes >= limits.episodesPerRun)
      return escalate(`this run already used its ${limits.episodesPerRun} repairs`);
    const left = limits.costPerRunUsd - meter.usage.costUsd;
    if (left <= 0.005) return escalate(`this run already spent its repair budget ($${limits.costPerRunUsd})`);
    episodes++;

    const session: RepairSession = {
      original: skill,
      draft: skill,
      failure,
      env,
      report: await failureReport(skill, failure, classification, env),
      edits: [],
    };
    const episode = await runAgent<RepairFinish>({
      llm: options.llm,
      profile: "smart",
      system: `${ROLE}\n\n${briefing({ edits: true, available: env.available })}`,
      task: session.report,
      tools: repairTools(session),
      guard: repairGuard(session),
      budget: { ...limits.episode, costUsd: Math.min(limits.episode.costUsd ?? 0.1, left) },
      protocol: options.protocol,
      meter,
      signal: options.signal,
      onEvent: options.onEvent,
    });

    const outcome = episode.outcome;
    if (outcome.kind !== "finished") {
      const why =
        outcome.kind === "out_of_budget"
          ? `the repair ran out of ${outcome.budget}`
          : outcome.kind === "error"
            ? `the repair failed: ${outcome.error}`
            : "the repair was stopped";
      return escalate(why, episode);
    }
    const finish = outcome.value;
    if (finish.kind === "resolve") return { ...finish, classification, episode };
    if (finish.kind === "escalate") return { ...finish, classification, episode };
    const tried = session.tried?.result;
    return {
      kind: "commit",
      by: "agent",
      skill: nextVersion(skill, session.draft, finish.summary, options.now),
      summary: finish.summary,
      edits: session.edits,
      resume: tried?.resume,
      approveOnce: approveOnce(skill, session.draft, tried?.approved ?? []),
      classification,
      episode,
    };
  }

  return {
    repair,
    get spent() {
      return { episodes, costUsd: meter.usage.costUsd };
    },
  };
}

const ROLE = `You are Task Player's repair agent. A saved workflow failed at one step while running on its own, and you get
it going again, safely. First decide what kind of failure it is: only drift (the site or app changed: a renamed
button, a new banner or dialog, an action moved into a menu, a new confirmation page) may change the workflow. A site
that is down, a login page, an empty inbox or bad data is resolved without changing anything.
To repair drift: look at the page, probe it if you must (open a menu, dismiss a banner), edit the draft, then
try_steps to run it on the live page. Commit only when a try shows evidence. Keep the change as small as the page
requires, keep step ids, and never change what the user decided. If you can't find a safe fix, escalate and say what
the user should show you.`;

// The repaired workflow as the next version, with a note saying how it came about.
function nextVersion(original: Skill, draft: Skill, summary: string, now = () => new Date()): Skill {
  return Skill.parse({
    ...draft,
    version: original.version + 1,
    history: [...draft.history, { version: original.version + 1, by: "debug", summary, at: now().toISOString() }],
  });
}

// Outward steps whose target the repair changed, and which the try didn't run (with the user's approval).
function approveOnce(original: Skill, draft: Skill, approvedInTry: string[]): string[] {
  const before = new Map<string, Step>([...walkSteps(original.steps)].map(({ step }) => [step.id, step]));
  return [...walkSteps(draft.steps)]
    .filter(({ step }) => {
      const old = before.get(step.id);
      const retargeted =
        !old || ("target" in old && "target" in step && JSON.stringify(old.target) !== JSON.stringify(step.target));
      return isOutward(step) && retargeted && !approvedInTry.includes(step.id);
    })
    .map(({ step }) => step.id);
}
