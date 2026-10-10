import type { ActionStep, Ask, Check, LlmStep, Skill, Step } from "@taskplayer/core";

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
  // Mac apps through the Accessibility API (Task Player.app). Optional: web-and-file skills never need it.
  ax?: ChannelExecutor;
  // Polls a file_exists check (a path or glob) until it holds or the timeout passes.
  fileExists(pattern: string, timeoutMs: number): Promise<boolean>;
  // Web checks used by the skill's `success` list (text_visible, url_matches, element_visible).
  webCheck(check: Check, timeoutMs: number): Promise<boolean>;
  approve(step: Step, skill: Skill): Promise<boolean>;
  // A step's question for the user, asked before it runs. "value": the typed answer (text, converted to the
  // output's type). "confirm": true runs the step, false skips it. Without it, a step that asks fails the run:
  // nothing is guessed.
  ask?(ask: Ask, step: Step): Promise<string | boolean>;
  // A step failed every attempt. "pause" stops the run where it is (the tab or window, the variables and the
  // position are kept) so it can be recovered and resumed; "fail" handles it as a failure (a loop with
  // on_item_fail: skip goes on). Without it, every failure is a failure.
  onFailure?(failure: Failure): "pause" | "fail" | Promise<"pause" | "fail">;
  log?(event: RunLogEvent): void;
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

// Where a paused run goes on: the step at `at` runs next (its question and approval included), with `vars`.
// skip: the user did that step by hand, so the run goes on after it.
export interface Resume {
  at: string;
  vars: Record<string, unknown>;
  skip?: boolean;
}

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
// nothing_to_do: recovery found there was nothing to do this time (the inbox is empty): not a failure.
export type RunStatus = "succeeded" | "failed" | "denied" | "paused" | "nothing_to_do";

export interface RunOutcome {
  status: RunStatus;
  vars: Record<string, unknown>;
  failedStep?: string;
  error?: string;
  // Paused runs only.
  resume?: Resume;
  pausedBy?: "failure" | "step_limit";
  failure?: Failure;
}
