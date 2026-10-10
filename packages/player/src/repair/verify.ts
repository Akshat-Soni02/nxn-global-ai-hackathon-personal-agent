// Trying a draft on the live page, and what counts as evidence that it works (docs/design.md, section 9 "Verify").
// A repair counts only with evidence: the repaired step's check passes, or (without one) the next step's target is
// on the page or its wait holds, or for the last step the workflow's success checks pass. A click that simply didn't
// throw is not evidence. Steps whose effect the player verifies itself (typing, choosing, uploading, extracting)
// are their own evidence.
import { isAction, isOutward, type Skill, type Step, walkSteps } from "@taskplayer/core";
import { runSkill } from "../run.ts";
import { resolveTemplates } from "../template.ts";
import type { Resume, RunLogEvent } from "../types.ts";
import type { RepairEnv } from "./env.ts";

export interface TryResult {
  ok: boolean;
  // Each step that ran, by path.
  ran: { path: string; ok: boolean; error?: string }[];
  error?: string;
  // Where the run goes on after the tried steps; absent when they ran to the end of the workflow (or the first one
  // failed, so the page hasn't moved).
  resume?: Resume;
  vars: Record<string, unknown>;
  // Why the result counts, or undefined when it doesn't (yet).
  evidence?: string;
  // Outward steps that ran (and were approved by the user) during the try.
  approved: string[];
}

const SELF_VERIFYING = new Set(["type", "select", "upload", "extract", "navigate", "set_value"]);

export async function tryDraft(draft: Skill, env: RepairEnv, from: Resume, count: number): Promise<TryResult> {
  // Approval is forced on for outward steps while trying: the user sees anything that leaves a mark.
  const trial = structuredClone(draft);
  for (const { step } of walkSteps(trial.steps)) {
    if (isOutward(step) && "requires_approval" in step) step.requires_approval = true;
  }
  const events: RunLogEvent[] = [];
  const approved: string[] = [];
  const outcome = await runSkill(
    trial,
    {
      ...env.deps,
      onFailure: undefined,
      approve: async (step, skill) => {
        const ok = await env.deps.approve(step, skill);
        if (ok && isOutward(step)) approved.push(step.id);
        return ok;
      },
      log: (event) => events.push(event),
    },
    { runId: env.runId, inputs: {}, resume: from, maxSteps: count },
  );
  const ran = events.flatMap((e) =>
    e.type === "step.result" ? [{ path: e.path, ok: e.result.ok, error: e.result.error }] : [],
  );
  const base = { ran, vars: outcome.vars, approved };
  if (outcome.status === "failed" || outcome.status === "denied") {
    // The page stands at the step that failed: a next try starts there.
    const at = outcome.failedStep && outcome.failedStep !== "success" ? outcome.failedStep : undefined;
    return {
      ...base,
      ok: false,
      error: `${outcome.failedStep}: ${outcome.error}`,
      resume: at && ran.length > 1 ? { at, vars: outcome.vars } : undefined,
    };
  }
  if (outcome.status === "succeeded") {
    const evidence = draft.success.length > 0 ? "the workflow ran to the end and its success checks pass" : undefined;
    return { ...base, ok: true, evidence: evidence ?? (await lastStepEvidence(draft, ran, env)) };
  }
  // Paused after `count` steps: the next step's target, or the last step's own check or effect.
  const resume = outcome.resume as Resume;
  return { ...base, ok: true, resume, evidence: await evidenceAt(draft, ran, resume, env) };
}

async function evidenceAt(
  draft: Skill,
  ran: TryResult["ran"],
  next: Resume,
  env: RepairEnv,
): Promise<string | undefined> {
  const own = await lastStepEvidence(draft, ran, env);
  if (own) return own;
  const nextStep = stepAt(draft, next.at);
  if (nextStep && isAction(nextStep) && nextStep.channel === "web") {
    if (nextStep.wait) {
      const wait = resolveTemplates(nextStep.wait, { vars: next.vars });
      if (await env.deps.webCheck(wait, 5000)) return `the next step's wait holds (${next.at})`;
    }
    if (nextStep.target) {
      const target = resolveTemplates(nextStep.target, { vars: next.vars });
      if (await env.deps.webCheck({ element_visible: target }, 5000)) {
        return `the next step's target is on the page (${next.at})`;
      }
    }
  }
  return undefined;
}

async function lastStepEvidence(draft: Skill, ran: TryResult["ran"], _env: RepairEnv): Promise<string | undefined> {
  const last = ran.at(-1);
  if (!last?.ok) return undefined;
  const step = stepAt(draft, last.path);
  if (!step || !isAction(step)) return undefined;
  if (step.check) return `${last.path}'s check passed`;
  if (SELF_VERIFYING.has(step.action)) return `${last.path} (${step.action}) is verified by the player`;
  return undefined;
}

// The step a path ends in: "l1[2] > s3" -> s3.
export function stepAt(skill: Skill, path: string): Step | undefined {
  const id = /([A-Za-z0-9_-]+)(?:\[\d+\])?$/.exec(path.split(" > ").at(-1) ?? "")?.[1];
  for (const { step } of walkSteps(skill.steps)) if (step.id === id) return step;
  return undefined;
}
