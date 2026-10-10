// The workflow interpreter. Runs in the daemon. Walks the step tree in order: action steps go to their channel (web
// steps to the browser through deps.web, fs and script steps locally), llm steps to the model client, loops run their
// steps once per item, branches pick an arm. See "The workflow format" and "Replay" in docs/design.md.
//
// Variables live in scopes. The top level holds the trigger's inputs and every output as steps produce it. A loop
// gives each item its own scope (the item, plus whatever its steps produce), dropped when the item is done. A branch
// runs its arm in a scope too; afterwards only the variables both arms produce are kept, as the save-time check
// (packages/core/src/check.ts) guarantees.
//
// Pause and resume (docs/design.md, "Plugging into a run"): a step that fails every attempt asks deps.onFailure,
// and "pause" ends the run as `paused` with where it stopped and its variables. Recovery happens outside; then
// runSkill(version, deps, { resume }) goes on from that position, on the same or a repaired version (step ids are
// kept). A position is a path, e.g. "l1[2] > s3": loops say which item; the tree says which branch arm.
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
  walkSteps,
} from "@taskplayer/core";
import { evaluate } from "./conditions.ts";
import { resolveTemplates } from "./template.ts";
import type { Failure, Resume, RunContext, RunDeps, RunLogEvent, RunOutcome, RunStatus, StepResult } from "./types.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RunOptions {
  runId?: string;
  inputs: Record<string, unknown>; // already resolved (see resolveInputs in @taskplayer/player/node)
  now?: () => Date;
  // Go on from a paused run's position instead of the start. `inputs` are then only for the log; `vars` carry on.
  resume?: Resume;
  // Pause before the action or llm step after this many have run (used to try a few steps of a draft).
  maxSteps?: number;
}

// Why the run stopped early, and where.
interface Halt {
  status: Exclude<RunStatus, "succeeded">;
  failedStep: string;
  error?: string;
  resume?: Resume;
  pausedBy?: RunOutcome["pausedBy"];
  failure?: Failure;
}

// Where a resumed run is heading: the step to start at, and the item of each loop on the way there. Shared by all
// the env copies of one run, and switched off once the step is reached.
interface ResumeState {
  target: string;
  items: Map<string, number>;
  active: boolean;
  skip?: boolean;
}

interface Env {
  skill: Skill;
  deps: RunDeps;
  ctx: Omit<RunContext, "vars">;
  now: () => Date;
  log: (event: RunLogEvent) => void;
  // Where the steps being run sit: "" at the top, "l1[2] > " inside the third item of loop l1.
  at: string;
  resume?: ResumeState;
  // Action and llm steps still allowed (maxSteps), shared by the whole run.
  stepsLeft?: { n: number };
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
  const env: Env = {
    skill,
    deps,
    ctx,
    now: options.now ?? (() => new Date()),
    log,
    at: "",
    stepsLeft: options.maxSteps === undefined ? undefined : { n: options.maxSteps },
  };
  // One namespace at the top: the trigger's inputs, then every output as steps produce it. A resumed run starts
  // with the variables it had when it paused.
  const vars: Vars = { ...(options.resume?.vars ?? options.inputs) };
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

  log({
    type: "run.start",
    runId: ctx.runId,
    skillId: skill.id,
    version: skill.version,
    inputs: ctx.inputs,
    resumedAt: options.resume?.at,
  });

  if (options.resume) {
    const parsed = parsePosition(skill, options.resume.at);
    if (typeof parsed === "string")
      return end({ status: "failed", vars, failedStep: options.resume.at, error: parsed });
    env.resume = { ...parsed, skip: options.resume.skip };
  }

  const halt = await runSteps(skill.steps, vars, env);
  if (halt) return end({ ...halt, vars: halt.resume?.vars ?? vars });

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
    // Resuming: steps before the one that holds the position already ran.
    if (env.resume?.active && !contains(step, env.resume.target)) continue;
    const halt = await runStep(step, vars, env);
    if (halt) return halt;
  }
  return undefined;
}

async function runStep(step: Exclude<Step, { type: "trigger" }>, vars: Vars, env: Env): Promise<Halt | undefined> {
  const path = `${env.at}${step.id}`;
  const fail = (error: string, status: Halt["status"] = "failed"): Halt => ({ status, failedStep: path, error });

  // Resuming into a loop or branch that holds the position: no question or approval again, straight in.
  const resume = env.resume;
  if (resume?.active && step.id !== resume.target && step.type === "control") {
    if (step.kind === "loop") return runLoop(step, vars, env, path, resume.items.get(step.id));
    return runBranch(step, vars, env, path, contains({ ...step, else: [] }, resume.target) ? "steps" : "else");
  }
  if (resume?.active) {
    // The position itself: a loop item ("l1[2]") starts that item; any other step runs from its question on.
    resume.active = false;
    if (resume.skip) {
      const produces = step.type !== "control" && (step.output ?? step.ask?.output);
      if (produces) return fail(`${step.id} produces ${produces.name}, so it can't be done by hand and skipped`);
      env.log({ type: "step.skipped", stepId: step.id, path, reason: "done by hand" });
      return undefined;
    }
    if (step.type === "control" && step.kind === "loop" && resume.items.has(step.id)) {
      return runLoop(step, vars, env, path, resume.items.get(step.id));
    }
  }

  // The step limit (maxSteps): pause before an action or llm step once it is reached.
  if (step.type !== "control" && env.stepsLeft) {
    if (env.stepsLeft.n <= 0) {
      return { status: "paused", failedStep: path, pausedBy: "step_limit", resume: { at: path, vars: { ...vars } } };
    }
    env.stepsLeft.n--;
  }

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
  if (!result.ok) {
    const failure: Failure = { stepId: step.id, path, step: resolved, result, attempts, vars: { ...vars } };
    if ((await env.deps.onFailure?.(failure)) === "pause") {
      return {
        status: "paused",
        failedStep: path,
        error: result.error ?? "check failed",
        pausedBy: "failure",
        failure,
        resume: { at: path, vars: { ...vars } },
      };
    }
    return fail(result.error ?? "check failed");
  }

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

async function runLoop(
  step: LoopStep,
  vars: Vars,
  env: Env,
  path: string,
  // Resuming: the item to start at. Its approval was given before the pause.
  startAt?: number,
): Promise<Halt | undefined> {
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
  if (startAt !== undefined && startAt >= list.length) {
    return fail(`can't resume at item ${startAt}: ${step.over} has ${list.length} items now`);
  }
  if (step.requires_approval && startAt === undefined) {
    const approved = await env.deps.approve(step, env.skill);
    env.log({ type: "step.approval", stepId: step.id, path, approved });
    if (!approved) return fail("you denied it", "denied");
  }
  if (startAt === undefined) env.log({ type: "loop.start", stepId: step.id, path, items: list.length });

  for (const [index, raw] of list.entries()) {
    if (startAt !== undefined && index < startAt) continue;
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
    // "skip" goes on with the next item after a failure; a denial or a pause always stops the run.
    if (halt.status === "failed" && step.on_item_fail === "skip") {
      env.log({ type: "loop.item_failed", stepId: step.id, path, index, error: `${halt.failedStep}: ${halt.error}` });
      continue;
    }
    return halt;
  }
  return undefined;
}

async function runBranch(
  step: BranchStep,
  vars: Vars,
  env: Env,
  path: string,
  // Resuming: the arm that holds the position. The condition was decided before the pause.
  resumeArm?: "steps" | "else",
): Promise<Halt | undefined> {
  let holdsTrue: boolean;
  if (resumeArm) holdsTrue = resumeArm === "steps";
  else {
    try {
      holdsTrue = evaluate(step.if, vars, env.now());
    } catch (error) {
      return { status: "failed", failedStep: path, error: (error as Error).message };
    }
  }
  const took = holdsTrue ? "steps" : "else";
  if (!resumeArm) env.log({ type: "branch", stepId: step.id, path, took });
  if (step.requires_approval && !resumeArm) {
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

// Whether a step is, or holds, the step with this id.
function contains(step: Step, id: string): boolean {
  for (const { step: inner } of walkSteps([step])) if (inner.id === id) return true;
  return false;
}

// "l1[2] > s3" -> start at s3, in item 2 of loop l1. Checked against the version being resumed.
function parsePosition(skill: Skill, at: string): ResumeState | string {
  const items = new Map<string, number>();
  let target = "";
  for (const part of at.split(" > ")) {
    const m = /^([A-Za-z0-9_-]+)(?:\[(\d+)\])?$/.exec(part.trim());
    if (!m?.[1]) return `not a position: ${at}`;
    target = m[1];
    if (m[2] !== undefined) items.set(m[1], Number(m[2]));
  }
  const found = [...walkSteps(skill.steps)].find(({ step }) => step.id === target);
  if (!found) return `can't resume at ${at}: version ${skill.version} has no step ${target}`;
  for (const loop of found.parents) {
    const parent = [...walkSteps(skill.steps)].find(({ step }) => step.id === loop)?.step;
    if (parent?.type === "control" && parent.kind === "loop" && !items.has(loop)) {
      return `can't resume at ${at}: ${target} is inside loop ${loop}, and the position doesn't say which item`;
    }
  }
  return { target, items, active: true };
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
