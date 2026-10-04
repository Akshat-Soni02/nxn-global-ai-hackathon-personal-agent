// The per-skill loop. Runs in the daemon. Web steps are sent to the browser (deps.web);
// fs and script steps run locally. See "Replay" in the design doc.
import type { Check, Skill, Step } from "@taskplayer/core";
import { resolveTemplates } from "./template.ts";
import type { RunContext, RunDeps, RunOutcome, StepResult } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RunOptions {
  runId?: string;
  inputs: Record<string, unknown>; // already resolved (see resolveInputs in @taskplayer/player/node)
  now?: () => Date;
}

export async function runSkill(skill: Skill, deps: RunDeps, options: RunOptions): Promise<RunOutcome> {
  const now = options.now ?? (() => new Date());
  const started = Date.now();
  const ctx: RunContext = {
    runId: options.runId ?? `${skill.id}-${started}`,
    startedAt: started,
    inputs: options.inputs,
    vars: {},
  };
  const log = deps.log ?? (() => {});
  const end = (outcome: RunOutcome): RunOutcome => {
    log({
      type: "run.end",
      runId: ctx.runId,
      status: outcome.status,
      failedStep: outcome.failedStep,
      error: outcome.error,
      ms: Date.now() - started,
    });
    return outcome;
  };

  log({ type: "run.start", runId: ctx.runId, skillId: skill.id, version: skill.version, inputs: ctx.inputs });

  for (const step of skill.steps) {
    let resolved: Step;
    try {
      resolved = resolveTemplates(step, ctx, now());
    } catch (error) {
      return end({ status: "failed", vars: ctx.vars, failedStep: step.id, error: (error as Error).message });
    }

    if (resolved.requires_approval) {
      const approved = await deps.approve(resolved, skill);
      log({ type: "step.approval", stepId: step.id, approved });
      if (!approved) return end({ status: "denied", vars: ctx.vars, failedStep: step.id });
    }

    const attempts = 1 + (resolved.on_fail?.retries ?? 0);
    let result: StepResult = { ok: false, error: "not run" };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      log({ type: "step.start", stepId: step.id, channel: step.channel, action: step.action, attempt });
      const t0 = Date.now();
      result = await executeOnce(resolved, ctx, deps);
      log({ type: "step.result", stepId: step.id, attempt, result, ms: Date.now() - t0 });
      if (result.ok) break;
    }

    if (!result.ok) {
      // TODO(player): agent fallback (on_fail.fallback === "agent") goes here; until then every failure escalates.
      return end({ status: "failed", vars: ctx.vars, failedStep: step.id, error: result.error ?? "check failed" });
    }
    if (resolved.save_as) ctx.vars[resolved.save_as] = result.value;
  }

  for (const check of resolveTemplates(skill.success, ctx, now())) {
    if (!(await holds(check, DEFAULT_TIMEOUT_MS, deps))) {
      return end({
        status: "failed",
        vars: ctx.vars,
        failedStep: "success",
        error: `success check failed: ${JSON.stringify(check)}`,
      });
    }
  }
  return end({ status: "succeeded", vars: ctx.vars });
}

async function executeOnce(step: Step, ctx: RunContext, deps: RunDeps): Promise<StepResult> {
  const channel =
    step.channel === "web"
      ? deps.web
      : step.channel === "fs"
        ? deps.fs
        : step.channel === "script"
          ? deps.script
          : step.channel === "data"
            ? deps.data
            : step.channel === "ax"
              ? deps.ax
              : undefined;
  if (!channel) return { ok: false, error: `channel ${step.channel} is not supported yet` };

  let result: StepResult;
  try {
    result = await channel(step, ctx);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  // The web executor verifies its own page checks; file checks are verified here for every channel.
  const fileCheck = step.check?.file_exists;
  if (result.ok && fileCheck && !(await deps.fileExists(fileCheck, step.timeout_ms ?? DEFAULT_TIMEOUT_MS))) {
    return { ...result, ok: false, failedCheck: { file_exists: fileCheck }, error: `file not found: ${fileCheck}` };
  }
  return result;
}

async function holds(check: Check, timeoutMs: number, deps: RunDeps): Promise<boolean> {
  const { file_exists, ...web } = check;
  if (file_exists && !(await deps.fileExists(file_exists, timeoutMs))) return false;
  if (Object.keys(web).length > 0 && !(await deps.webCheck(web, timeoutMs))) return false;
  return true;
}
