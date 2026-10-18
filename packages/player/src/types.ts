import type { ActionStep, Ask, Check, LlmStep, Skill, Step } from "@shadow/core";

// What a channel reports back for one attempt at one step.
export interface StepResult {
  ok: boolean;
  // The step's result, saved as its declared output (found files, extracted text, file contents).
  value?: unknown;
  // Web only: how confidently the target was matched (0..1) and which signals matched.
  matchScore?: number;
  matchedBy?: string[];
  failedCheck?: Check;
  error?: string;
}

// What an approval or ask hook returns when nobody can answer now: the run stops as `waiting`, with where it stopped
// (its `resume`) and what it waits for, and goes on later with the answer (Resume.answers). Lets a run wait for hours,
// or across a daemon restart, holding nothing in memory.
export const WAIT: unique symbol = Symbol("wait");
export type Wait = typeof WAIT;

// Channels only ever run action steps; llm and control steps are handled by the run loop.
export type ChannelExecutor = (step: ActionStep, ctx: RunContext) => Promise<StepResult>;

export interface RunContext {
  runId: string;
  startedAt: number; // epoch ms; fs.find with since_run_start ignores older files
  inputs: Record<string, unknown>;
  vars: Record<string, unknown>;
}

export interface RunDeps {
  web: ChannelExecutor;
  fs: ChannelExecutor;
  script: ChannelExecutor;
  // Rules over saved values (data.pick). Optional: skills without data steps never need it.
  data?: ChannelExecutor;
  // llm steps: one model call that transforms data. Optional: skills without llm steps never need it.
  llm?: (step: LlmStep, ctx: RunContext) => Promise<StepResult>;
  // Mac apps through the Accessibility API (Shadow.app). Optional: web-and-file skills never need it.
  ax?: ChannelExecutor;
  // Polls a file_exists check (a path or glob) until it holds or the timeout passes.
  fileExists(pattern: string, timeoutMs: number): Promise<boolean>;
  // Web checks used by the skill's `success` list (text_visible, url_matches, element_visible).
  webCheck(check: Check, timeoutMs: number): Promise<boolean>;
  approve(step: Step, skill: Skill): Promise<boolean | Wait>;
  // A step's question for the user, asked before it runs. "value": the typed answer (text, converted to the
  // output's type). "confirm": true runs the step, false skips it. Without it, a step that asks fails the run:
  // nothing is guessed.
  ask?(ask: Ask, step: Step): Promise<string | boolean | Wait>;
  // A step failed every attempt. "pause" stops the run where it is (the tab or window, the variables and the
  // position are kept) so it can be recovered and resumed; "fail" handles it as a failure (a loop with
  // on_item_fail: skip goes on). Without it, every failure is a failure.
  onFailure?(failure: Failure): "pause" | "fail" | Promise<"pause" | "fail">;
  // Walking through a workflow (docs/design.md, "7. Test"): asked before every action or llm step, once its target
  // has been highlighted. "do" runs the step (and counts as its approval), "skip" passes over it without acting,
  // "stop" ends the walk. WAIT: nobody can answer now, so the run waits in the inbox (kind "walk").
  walk?(step: ActionStep | LlmStep, path: string): Promise<WalkChoice | Wait>;
  // Shows where a step would act: outlines its target on the page or in the Mac app, without acting.
  highlight?(step: ActionStep): Promise<void>;
  log?(event: RunLogEvent): void;
}

export type WalkChoice = "do" | "skip" | "stop";

// Steps that only read or move: in a walk-through they run on "next"; everything else is acting and needs "do".
const WALK_READS = new Set([
  "web.navigate",
  "web.wait_for",
  "web.extract",
  "fs.find",
  "fs.read",
  "data.pick",
  "ax.open",
]);
export function walkActs(step: ActionStep | LlmStep): boolean {
  if (step.type === "llm") return false;
  return !WALK_READS.has(`${step.channel}.${step.action}`);
}

// A step that failed every attempt: what recovery starts from.
export interface Failure {
  stepId: string;
  // Where it ran, e.g. "l1[2] > s3".
  path: string;
  // The step with its references resolved, as it was run.
  step: ActionStep | LlmStep;
  result: StepResult;
  attempts: number;
  // Every variable visible at the step.
  vars: Record<string, unknown>;
}

// Where a paused or waiting run goes on: the step at `at` runs next (its question and approval included), with
// `vars`. skip: the user did that step by hand, so the run goes on after it. answers: what the user already answered
// for the step at `at` (its question, its approval), used instead of asking again. approveOnce: retargeted outward
// steps that still need approval the first time they run (recovery keeps them across a wait).
export interface Resume {
  at: string;
  vars: Record<string, unknown>;
  skip?: boolean;
  answers?: Answer[];
  approveOnce?: string[];
}

export type Answer =
  | { kind: "approval"; approved: boolean }
  | { kind: "ask"; value: string | boolean }
  | { kind: "walk"; choice: WalkChoice };

// What a waiting run waits for, at `path`. recovery: a failure repair couldn't fix, or something only the user can do
// (log in); answered with retry, skip or stop. walk: a walk-through stopped before a step, its target highlighted;
// `acting` says whether the step would change something (needs "do") or only reads ("next").
export type Waiting =
  | { kind: "approval"; path: string; stepId: string; intent: string }
  | { kind: "ask"; path: string; stepId: string; question: string; ask: Ask }
  | { kind: "recovery"; path: string; stepId: string; message: string; error?: string }
  | { kind: "walk"; path: string; stepId: string; intent: string; acting: boolean; highlighted: boolean };

// `path` says where a step ran: its id, inside loops with the item number, e.g. "l1[2] > s3".
export type RunLogEvent =
  | {
      type: "run.start";
      runId: string;
      skillId: string;
      version: number;
      inputs: Record<string, unknown>;
      resumedAt?: string;
    }
  | { type: "step.start"; stepId: string; path: string; channel: string; action: string; attempt: number }
  | { type: "step.result"; stepId: string; path: string; attempt: number; result: StepResult; ms: number }
  | { type: "step.approval"; stepId: string; path: string; approved: boolean }
  | { type: "step.ask"; stepId: string; path: string; question: string; answer: string | boolean }
  | { type: "step.skipped"; stepId: string; path: string; reason: string }
  // A walk-through's choice for a step: do it, skip it, or stop.
  | { type: "step.walk"; stepId: string; path: string; choice: WalkChoice; highlighted: boolean }
  | { type: "loop.start"; stepId: string; path: string; items: number }
  | { type: "loop.item"; stepId: string; path: string; index: number }
  | { type: "loop.item_failed"; stepId: string; path: string; index: number; error: string }
  | { type: "branch"; stepId: string; path: string; took: "steps" | "else" }
  | {
      // A paused run's recovery (packages/player/src/repair): what kind of failure, and what was done about it.
      type: "repair";
      path: string;
      outcome: "resolve" | "commit" | "escalate";
      class: string;
      by?: "ladder" | "agent";
      summary: string;
      version?: number;
      costUsd: number;
    }
  | { type: "run.end"; runId: string; status: RunStatus; failedStep?: string; error?: string; ms: number };

// paused: stopped on purpose, with `resume` saying where to go on (after a failure, or after maxSteps).
// waiting: stopped until the user answers (`waiting` says what), with `resume` to go on from.
// nothing_to_do: recovery found there was nothing to do this time (the inbox is empty): not a failure.
// cancelled: stopped by the user while it ran (between steps; a step in progress is abandoned).
export type RunStatus = "succeeded" | "failed" | "denied" | "paused" | "waiting" | "nothing_to_do" | "cancelled";

export interface RunOutcome {
  status: RunStatus;
  vars: Record<string, unknown>;
  failedStep?: string;
  error?: string;
  // Paused and waiting runs only.
  resume?: Resume;
  pausedBy?: "failure" | "step_limit";
  failure?: Failure;
  // Waiting runs only.
  waiting?: Waiting;
}
