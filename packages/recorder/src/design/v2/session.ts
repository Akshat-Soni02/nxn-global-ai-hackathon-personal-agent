// One design session of design agent v2: the recorded workflow (code's plain list), the draft being changed, what the
// recording allows, code's proposals and what the agent decided about each, the steps code left out as noise (the
// agent may put one back), the reason for every change (the review shows them), the steps whose new target no test has
// found yet, and the questions it queued (asked in one batch after the build). The tools change it; the orchestrator
// (Task 9) reads it between stages.
import type { Skill, StepInput } from "@shadow/core";
import type { DoneReport, EvidenceView, Proposal, TestReport } from "./contracts.ts";
import type { RecordingFacts } from "./rules.ts";

// At most this many test runs per design (build, fix, and after your answers), and this many refusals of done before
// the workflow is saved with what is left listed for you.
export const MAX_TESTS = 3;
export const MAX_DONE_REFUSALS = 2;

export interface QueuedQuestion {
  id: string;
  text: string;
  why: string;
  step: string;
  options: string[];
  default?: string;
}

export interface SessionV2 {
  original: Skill;
  draft: Skill;
  facts: RecordingFacts;
  proposals: Map<string, Proposal>;
  decisions: Map<string, { decision: "accept" | "reject"; why: string }>;
  dropped: Map<string, { step: StepInput; why: string; after: string }>;
  whys: Map<string, string>;
  // The tabs code gave steps (gate.ts tabsFixed), by step: code's to work out again after every change.
  autoTabs?: Map<string, string>;
  // The reasons given since the last test run: only these explain a step's test failure (gate.ts).
  sinceTest: Map<string, string>;
  unverified: Set<string>;
  questions: QueuedQuestion[];
  evidence?: EvidenceView;
  // The recording's Never and private words: every tool result is masked with them, like the evidence.
  maskTerms?: string[];
  // Real addresses by step id and tab name (evidence/pages.ts): the agent opens a page by name, code writes the address.
  pages: Map<string, string>;
  // The safe test run (the orchestrator binds the daemon's), how many ran, the last report, and the draft it tested.
  runTest?: () => Promise<TestReport>;
  tests: number;
  lastTest?: TestReport;
  testedDraft?: string;
  // The finish gate with all but the agent's report bound in (gate.ts; the orchestrator sets it).
  finish?: (report: DoneReport) => string[];
  // How often done was refused, and what was left when it finished anyway (the review lists it).
  refusedDone: number;
  gaps: string[];
}

export function newSession(original: Skill, facts: RecordingFacts, extra: Partial<SessionV2> = {}): SessionV2 {
  return {
    original,
    draft: original,
    facts,
    proposals: new Map(),
    decisions: new Map(),
    dropped: new Map(),
    whys: new Map(),
    sinceTest: new Map(),
    unverified: new Set(),
    questions: [],
    pages: new Map(),
    tests: 0,
    refusedDone: 0,
    gaps: [],
    ...extra,
  };
}
