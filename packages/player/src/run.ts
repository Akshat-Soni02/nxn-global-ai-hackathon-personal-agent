// The workflow interpreter. Runs in the daemon. Walks the step tree in order: action steps go to their channel (web
// steps to the browser through deps.web, fs and script steps locally), llm steps to the model client, loops run their
// steps once per item, branches pick an arm. See "The workflow format" and "Replay" in docs/design.md.
//
// Variables live in scopes. The top level holds the trigger's inputs and every output as steps produce it. A loop
// gives each item its own scope (the item, plus whatever its steps produce), dropped when the item is done. A branch
// runs its arm in a scope too; afterwards only the variables both arms produce are kept, as the save-time check
// (packages/core/src/check.ts) guarantees.
import {
  type ActionStep,
  type BranchStep,
  type Check,
  fitValue,
  isAction,
  isLlm,
  type LlmStep,
  type LoopStep,
  type Skill,
  type Step,
  typeText,
  type VarType,
} from "@taskplayer/core";
import { evaluate } from "./conditions.ts";
import { resolveTemplates } from "./template.ts";
import type { RunContext, RunDeps, RunLogEvent, RunOutcome, RunStatus, StepResult } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RunOptions {
  runId?: string;
  inputs: Record<string, unknown>; // already resolved (see resolveInputs in @taskplayer/player/node)
  now?: () => Date;
}

// Why the run stopped early, and where.
interface Halt {
  status: Exclude<RunStatus, "succeeded">;
  failedStep: string;
  error?: string;
}

interface Env {
  skill: Skill;
  deps: RunDeps;
  ctx: Omit<RunContext, "vars">;
  now: () => Date;
  log: (event: RunLogEvent) => void;
  // Where the steps being run sit: "" at the top, "l1[2] > " inside the third item of loop l1.
  at: string;
}

type Vars = Record<string, unknown>;

export async function runSkill(skill: Skill, deps: RunDeps, options: RunOptions): Promise<RunOutcome> {
  const started = Date.now();
  const ctx = {
    runId: options.runId ?? `${skill.id}-${started}`,
    startedAt: started,
    inputs: options.inputs,
  };
  const log = deps.log ?? (() => {});
  const env: Env = { skill, deps, ctx, now: options.now ?? (() => new Date()), log, at: "" };
  // One namespace at the top: the trigger's inputs, then every output as steps produce it.
  const vars: Vars = { ...options.inputs };
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

  const halt = await runSteps(skill.steps, vars, env);
  if (halt) return end({ ...halt, vars });

  let checks: Check[];
  try {
    checks = resolveTemplates(skill.success, { vars }, env.now());
  } catch (error) {
    return end({ status: "failed", vars, failedStep: "success", error: (error as Error).message });
  }
  for (const check of checks) {
    if (!(await holds(check, DEFAULT_TIMEOUT_MS, deps))) {
      return end({
        status: "failed",
        vars,
        failedStep: "success",
        error: `success check failed: ${JSON.stringify(check)}`,
      });
    }
  }
  return end({ status: "succeeded", vars });
}

async function runSteps(steps: Step[], vars: Vars, env: Env): Promise<Halt | undefined> {
  for (const step of steps) {
    // The trigger's inputs are already in vars (resolved before the run).
    if (step.type === "trigger") continue;
    const halt = await runStep(step, vars, env);
    if (halt) return halt;
  }
  return undefined;
}

async function runStep(step: Exclude<Step, { type: "trigger" }>, vars: Vars, env: Env): Promise<Halt | undefined> {
  const path = `${env.at}${step.id}`;
  const fail = (error: string, status: Halt["status"] = "failed"): Halt => ({ status, failedStep: path, error });

  // 1. The step's question, before anything else: its answer may be used by the step itself.
  if (step.ask) {
    let question: string;
    try {
      question = resolveTemplates(step.ask.question, { vars }, env.now());
    } catch (error) {
      return fail((error as Error).message);
    }
    if (!env.deps.ask) return fail(`needs an answer from you: "${question}"`);
    const answer = await env.deps.ask({ ...step.ask, question }, step);
    env.log({ type: "step.ask", stepId: step.id, path, question, answer });
    if (step.ask.kind === "confirm") {
      if (!answer) {
        env.log({ type: "step.skipped", stepId: step.id, path, reason: "you said no" });
        return undefined;
      }
    } else if (step.ask.output) {
      const value = fitValue(step.ask.output.type, answer);
      if (value === undefined)
        return fail(`the answer ${JSON.stringify(answer)} is not ${typeText(step.ask.output.type)}`);
      vars[step.ask.output.name] = value;
    }
  }

  if (step.type === "control")
    return step.kind === "loop" ? runLoop(step, vars, env, path) : runBranch(step, vars, env, path);
  return runLeaf(step, vars, env, path);
}

// An action or llm step: approval, attempts with retries, then its output checked against the declared type.
async function runLeaf(step: ActionStep | LlmStep, vars: Vars, env: Env, path: string): Promise<Halt | undefined> {
  const fail = (error: string, status: Halt["status"] = "failed"): Halt => ({ status, failedStep: path, error });
  let resolved: ActionStep | LlmStep;
  try {
    resolved = resolveTemplates(step, { vars }, env.now());
  } catch (error) {
    return fail((error as Error).message);
  }

  if (resolved.requires_approval) {
    const approved = await env.deps.approve(resolved, env.skill);
    env.log({ type: "step.approval", stepId: step.id, path, approved });
    if (!approved) return fail("you denied it", "denied");
  }

  const ctx: RunContext = { ...env.ctx, vars };
  const attempts = 1 + (isAction(resolved) ? (resolved.on_fail?.retries ?? 0) : 0);
  let result: StepResult = { ok: false, error: "not run" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const [channel, action] = isAction(resolved) ? [resolved.channel, resolved.action] : ["llm", "transform"];
    env.log({ type: "step.start", stepId: step.id, path, channel, action, attempt });
    const t0 = Date.now();
    result = isAction(resolved)
      ? await executeOnce(resolved, ctx, env.deps)
      : isLlm(resolved) && env.deps.llm
        ? await env.deps.llm(resolved, ctx).catch((error: Error) => ({ ok: false, error: error.message }))
        : { ok: false, error: "llm steps need a model client" };
    env.log({ type: "step.result", stepId: step.id, path, attempt, result, ms: Date.now() - t0 });
    if (result.ok) break;
  }
  // TODO(player): debug and self-correct (on_fail.fallback === "agent") goes here; until then every failure escalates.
  if (!result.ok) return fail(result.error ?? "check failed");

  const output = resolved.output;
  if (output) {
    // The value must fit the declared type; text that means a number or date is converted ("1,234" → 1234).
    const value = fitValue(output.type, result.value);
    if (value === undefined) {
      return fail(
        `${output.name} should be ${typeText(output.type)}, got ${JSON.stringify(result.value)?.slice(0, 120)}`,
      );
    }
    vars[output.name] = value;
  }
  return undefined;
}

async function runLoop(step: LoopStep, vars: Vars, env: Env, path: string): Promise<Halt | undefined> {
  const fail = (error: string, status: Halt["status"] = "failed"): Halt => ({ status, failedStep: path, error });
  let list: unknown;
  try {
    list = resolveTemplates(step.over, { vars }, env.now());
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!Array.isArray(list)) return fail(`${step.over} is not a list`);
  // A cap, so a list that is far longer than expected (a page of search results) cannot run on and on.
  if (list.length > step.max_items) {
    return fail(`${step.over} has ${list.length} items, more than this loop's max_items (${step.max_items})`);
  }
  if (step.requires_approval) {
    const approved = await env.deps.approve(step, env.skill);
    env.log({ type: "step.approval", stepId: step.id, path, approved });
    if (!approved) return fail("you denied it", "denied");
  }
  env.log({ type: "loop.start", stepId: step.id, path, items: list.length });

  for (const [index, raw] of list.entries()) {
    const at = `${path}[${index}]`;
    const item = fitValue(step.item.type, raw);
    let halt: Halt | undefined;
    if (item === undefined) {
      halt = { status: "failed", failedStep: at, error: `item ${index} is not ${typeText(step.item.type)}` };
    } else {
      env.log({ type: "loop.item", stepId: step.id, path, index });
      // Each item gets its own scope: the item, plus what its steps produce. Nothing leaks to the next item.
      halt = await runSteps(step.steps, { ...vars, [step.item.name]: item }, { ...env, at: `${at} > ` });
    }
    if (!halt) continue;
    // "skip" goes on with the next item after a failure; a denial always stops the run.
    if (halt.status === "failed" && step.on_item_fail === "skip") {
      env.log({ type: "loop.item_failed", stepId: step.id, path, index, error: `${halt.failedStep}: ${halt.error}` });
      continue;
    }
    return halt;
  }
  return undefined;
}

async function runBranch(step: BranchStep, vars: Vars, env: Env, path: string): Promise<Halt | undefined> {
  let holdsTrue: boolean;
  try {
    holdsTrue = evaluate(step.if, vars, env.now());
  } catch (error) {
    return { status: "failed", failedStep: path, error: (error as Error).message };
  }
  const took = holdsTrue ? "steps" : "else";
  env.log({ type: "branch", stepId: step.id, path, took });
  if (step.requires_approval) {
    const approved = await env.deps.approve(step, env.skill);
    env.log({ type: "step.approval", stepId: step.id, path, approved });
    if (!approved) return { status: "denied", failedStep: path, error: "you denied it" };
  }
  const arm = holdsTrue ? step.steps : step.else;
  const scope: Vars = { ...vars };
  const halt = await runSteps(arm, scope, env);
  if (halt) return halt;
  // Keep what both arms produce: those are the variables later steps may use (check.ts).
  for (const name of producedByBoth(step)) vars[name] = scope[name];
  return undefined;
}

// Names a list of steps leaves behind at its own level: action, llm and ask outputs, and what nested branches
// produce in both arms. Loop outputs stay inside the loop.
function levelOutputs(steps: Step[]): Map<string, VarType> {
  const out = new Map<string, VarType>();
  for (const step of steps) {
    if (step.type === "trigger") continue;
    if (step.ask?.output) out.set(step.ask.output.name, step.ask.output.type);
    if ((isAction(step) || isLlm(step)) && step.output) out.set(step.output.name, step.output.type);
    if (step.type === "control" && step.kind === "branch")
      for (const name of producedByBoth(step)) out.set(name, { type: "text" });
  }
  return out;
}

function producedByBoth(step: BranchStep): string[] {
  const no = levelOutputs(step.else);
  return [...levelOutputs(step.steps).keys()].filter((name) => no.has(name));
}

async function executeOnce(step: ActionStep, ctx: RunContext, deps: RunDeps): Promise<StepResult> {
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
