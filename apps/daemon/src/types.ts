// The daemon's API types, without Node: shared by the daemon (store.ts, service.ts) and the app's window (apps/ui),
// which imports them to type what the API returns.
import type { Resume, RunLogEvent, Waiting } from "@shadow/player";

// running → one of the others. waiting: stopped until an inbox item is answered. interrupted: the daemon stopped
// while the run was going (a restart, a crash); it does not go on by itself. skipped: its trigger fired while the
// workflow's previous run was still going or waiting for the user, so it never started.
export type RunState =
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "denied"
  | "nothing_to_do"
  | "cancelled"
  | "interrupted"
  | "skipped";

export interface Checkpoint {
  // The version the run was on when it stopped (a repair may have made a newer one during the run).
  version: number;
  // The inputs the run was started with (its variables are in resume.vars).
  inputs: Record<string, unknown>;
  resume: Resume;
  waiting: Waiting;
  // A run started from a workflow file rather than the store: the file, to load that version again.
  file?: string;
}

export interface RunRow {
  id: string;
  skillId: string;
  version: number;
  trigger: string;
  status: RunState;
  startedAt: number;
  endedAt?: number;
  failedStep?: string;
  error?: string;
  repaired: boolean;
  costUsd: number;
  checkpoint?: Checkpoint;
}

// approval, ask, recovery: a waiting run's step ("waiting for you"). question: a question outside a run (the drill
// after a recording, which file to use). repaired: nothing to answer; a repair saved a new version, to review.
// paused: a workflow paused itself after failing runs; answered by resuming it (or leaving it paused).
export type InboxKind = "approval" | "ask" | "recovery" | "question" | "repaired" | "paused";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  runId?: string;
  skillId?: string;
  path?: string;
  // What the user reads.
  title: string;
  // Kind-specific: the run's Waiting, a question's options and default, a repair's version and summary.
  detail: Record<string, unknown>;
  createdAt: number;
  answeredAt?: number;
  answer?: unknown;
}

export type ServiceEvent =
  | { type: "run"; run: RunRow }
  | { type: "step"; runId: string; event: RunLogEvent }
  | { type: "inbox"; item: InboxItem }
  // A workflow's state or trigger changed: the triggers and the window look again.
  | { type: "workflow"; id: string; state: StateFile };

// A workflow apart from any one run (docs/design.md, "Workflow lifecycle"): a draft never starts on its own, a live
// one starts when its trigger fires, a paused one waits to be resumed.
export type WorkflowState = "draft" | "live" | "paused";

export interface StateFile {
  state: WorkflowState;
  // When it last changed (epoch ms). For a live workflow: from when its trigger counts.
  since: number;
  // Paused: why, and whether Shadow paused it (auto-pause) or the user did.
  reason?: string;
  auto?: boolean;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  versions: number[];
  lastRun?: RunRow;
  state: StateFile;
  // Live and scheduled: when it next starts on its own (epoch ms).
  nextRunAt?: number;
}

// A question outside a run: the drill after a recording, which file to use.
export interface Question {
  title: string;
  options?: string[];
  default?: string;
}
