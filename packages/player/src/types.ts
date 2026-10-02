import type { Check, Skill, Step } from "@taskplayer/core";

// What a channel reports back for one attempt at one step.
export interface StepResult {
  ok: boolean;
  // Result to store under `save_as` (found paths, extracted text, file contents).
  value?: unknown;
  // Web only: how confidently the target was matched (0..1) and which signals matched.
  matchScore?: number;
  matchedBy?: string[];
  failedCheck?: Check;
  error?: string;
}

export type ChannelExecutor = (step: Step, ctx: RunContext) => Promise<StepResult>;

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
  // Polls a file_exists check (a path or glob) until it holds or the timeout passes.
  fileExists(pattern: string, timeoutMs: number): Promise<boolean>;
  // Web checks used by the skill's `success` list (text_visible, url_matches, element_visible).
  webCheck(check: Check, timeoutMs: number): Promise<boolean>;
  approve(step: Step, skill: Skill): Promise<boolean>;
  log?(event: RunLogEvent): void;
}

export type RunLogEvent =
  | { type: "run.start"; runId: string; skillId: string; version: number; inputs: Record<string, unknown> }
  | { type: "step.start"; stepId: string; channel: string; action: string; attempt: number }
  | { type: "step.result"; stepId: string; attempt: number; result: StepResult; ms: number }
  | { type: "step.approval"; stepId: string; approved: boolean }
  | { type: "run.end"; runId: string; status: RunStatus; failedStep?: string; error?: string; ms: number };

export type RunStatus = "succeeded" | "failed" | "denied";

export interface RunOutcome {
  status: RunStatus;
  vars: Record<string, unknown>;
  failedStep?: string;
  error?: string;
}
