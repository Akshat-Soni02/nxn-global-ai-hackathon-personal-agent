// The daemon's API types, without Node: shared by the daemon (store.ts, service.ts) and the app's window (apps/ui),
// which imports them to type what the API returns.
import type { Skill, Trigger } from "@shadow/core";
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
  // A walk-through of a draft: the exact tree being walked (a draft is not a version in the store).
  skill?: Skill;
}

// A workflow's draft as the editor shows it (docs/design.md, "6. Edit"): the tree with the edits applied, what
// changed in words, and what still stops it from going live.
export interface DraftView {
  id: string;
  // The version the edits were made on, and the latest version in the store.
  base: number;
  latest: number;
  skill: Skill;
  changes: string[];
  canUndo: boolean;
  canRedo: boolean;
  problems: string[];
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

// approval, ask, recovery: a waiting run's step ("waiting for you"). walk: a walk-through stopped before a step
// (answered with do it / next, skip or stop). question: a question outside a run (the drill after a recording, which
// file to use). repaired: nothing to answer; a repair saved a new version, to review. paused: a workflow paused
// itself after failing runs; answered by resuming it (or leaving it paused).
export type InboxKind = "approval" | "ask" | "recovery" | "walk" | "question" | "repaired" | "paused";

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
  // Its Frequency: the trigger step's `when`.
  when: Trigger[];
  // Live and scheduled: when it next starts on its own (epoch ms).
  nextRunAt?: number;
}

// A question outside a run: the drill after a recording, which file to use. A drill question can be about one step
// of the draft workflow: the window shows the draft with that step marked.
export interface Question {
  title: string;
  options?: string[];
  // The person may write their own answer besides the options (an "Other" box). False when an option stands for
  // something typed text can't be (a whole step, a schedule).
  freeText?: boolean;
  default?: string;
  step?: string;
  draft?: unknown;
  // The recording the question is about: the Record screen shows only its questions.
  sessionId?: string;
}

// Recording (record-control.ts), as the window's Record screen gets it from `recording`.
export type RecordPhase = "idle" | "describing" | "recording" | "compiling";
export interface Consent {
  // A screenshot of the active window at each event; only the words read from it (masked) leave the Mac.
  screen: boolean;
  // Narration, turned into text on the Mac; only the text leaves it.
  microphone: boolean;
  // The masked picture may be sent to the vision model to be described (design and repair). Off: words only.
  pictures: boolean;
}
// The description form, as recording-store.ts checks and saves it.
export interface RecordFormView {
  goal: string;
  changes: string[];
  constants: string[];
  never: string[];
  when: Trigger[];
  consent: Consent;
}
export interface RecordingView {
  phase: RecordPhase;
  sessionId?: string;
  startedAt?: number;
  // The form of the recording going on, or being turned into a workflow.
  form?: RecordFormView;
  // The consents the form starts with: the ones given last time.
  consent: Consent;
  // How the last recording ended.
  last?: { sessionId: string; outcome: "saved" | "empty" | "failed"; skillId?: string; text: string };
  // Whether Shadow.app is running (it shows the form in its window).
  macApp: boolean;
  // Whether pictures can be read and masked (Shadow.app's tools): when not, the Record screen says so before recording.
  screenReady: boolean;
  // What is happening while a recording becomes a workflow, in plain words, oldest first.
  progress: { at: number; line: string }[];
}
// A design's review (skills/<id>/review.json; built by packages/recorder/src/design/v2/review.ts), as the window reads
// it. Declared here, not imported: the recorder package needs Node, and the window's code must not load it. record.ts
// hands the recorder's Review to writeReview, which takes this one, so the two can't drift apart unnoticed.
export interface Review {
  skillId: string;
  version: number;
  summary: string;
  notes: {
    step: string;
    change: "added" | "removed" | "changed" | "moved";
    what: string;
    why?: string;
    unverified?: boolean;
  }[];
  said: { quote: string; steps: string[]; notBuilt?: string }[];
  notTested: string[];
  gaps: string[];
  cadence?: string;
  made?: string[];
  notAsked?: string[];
  // Why it can't do the task yet: shown instead of "Looks right", and it can't go live.
  cantRun?: string[];
  reviewed: boolean;
}
