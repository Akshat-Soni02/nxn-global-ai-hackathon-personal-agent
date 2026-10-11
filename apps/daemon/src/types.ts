// The daemon's API types, without Node: shared by the daemon (store.ts, service.ts) and the app's window (apps/ui),
// which imports them to type what the API returns.
import type { Resume, RunLogEvent, Waiting } from "@shadow/player";

// running → one of the others. waiting: stopped until an inbox item is answered. interrupted: the daemon stopped
// while the run was going (a restart, a crash); it does not go on by itself.
export type RunState =
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "denied"
  | "nothing_to_do"
  | "cancelled"
  | "interrupted";

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
export type InboxKind = "approval" | "ask" | "recovery" | "question" | "repaired";

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
  | { type: "inbox"; item: InboxItem };

export interface WorkflowSummary {
  id: string;
  name: string;
  versions: number[];
  lastRun?: RunRow;
}

// A question outside a run: the drill after a recording, which file to use.
export interface Question {
  title: string;
  options?: string[];
  default?: string;
}
