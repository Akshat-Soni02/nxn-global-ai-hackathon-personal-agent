// Record: turns a demonstration into a skill. Owned by the record team. See "Record" in the design doc.
//
//   capture      content-script listeners and describeElement live in apps/extension (they need the DOM)
//   normalise    trace -> the steps a person would describe (no AI)
//   skeleton     steps -> a valid skill built by code: actions, targets, recorded values
//   compile      skeleton -> the plain step list and the questions code can't decide (no AI)
//   evidence     what code understood: the timeline, classes, flow, proposals (no AI)
//   design       design agent v2: understand (the task model) -> build -> test in the automation window -> ask
//                once -> the finish gate; the last valid draft (else the plain list) is kept if it can't finish
//   drill        the questions, asked once before saving; lasting answers go to memory
//   mask         the words read from a screenshot, with emails, numbers, keys and Never terms hidden (███)
//   approvals    approval on every step that sends, pays or deletes, or matches the user's Never list (code, last)
export { requireApprovals } from "./approvals.ts";
export { type BlockNames, blocksOf, clean, nodeCount, pageName } from "./blocks.ts";
export {
  type Compiled,
  compile,
  extractJson,
  type Form,
  Question,
  stepsForModel,
  templateProblems,
} from "./compile.ts";
export { DESIGN_V2_BUDGET, remaining } from "./design/v2/budget.ts";
export { changesSummary, describeChanges } from "./design/v2/changes.ts";
export {
  APPS,
  type AppTool,
  appOf,
  type ConnectorChance,
  type Connectors,
  connectorChances,
} from "./design/v2/connectors.ts";
export {
  DoneReport,
  type EvidenceView,
  PROPOSAL_KINDS,
  type Proposal,
  TaskModel,
  type TestReport,
  type TestStep,
} from "./design/v2/contracts.ts";
export { scriptedDesigner } from "./design/v2/fake.ts";
export { type DesignV2Options, type DesignV2Outcome, designV2 } from "./design/v2/orchestrator.ts";
export { outlineOf } from "./design/v2/outline.ts";
export { recordedFolders, recordedPages } from "./design/v2/places.ts";
export { progressLine } from "./design/v2/progress.ts";
export { MAX_QUESTIONS } from "./design/v2/questions.ts";
export { type Review, reviewOf } from "./design/v2/review.ts";
export { type ChangeNote, changeNotes, type RecordingFacts } from "./design/v2/rules.ts";
export { applyAnswer, type DrillResult, drill, type Prompter } from "./drill.ts";
export { checkExpectations, Expectation, Expectations, type Verdict } from "./eval/expect.ts";
export { answerFromEvidence } from "./evidence/answers.ts";
export { CAPTION_CHARS, captionQuestion, captionsOf, type DescribePicture } from "./evidence/captions.ts";
export { classOf, type StepClass } from "./evidence/classes.ts";
export {
  buildEvidence,
  EVIDENCE_TOKENS,
  type Evidence,
  type EvidenceInput,
  type EvidenceStep,
  estimateTokens,
  evidenceText,
  evidenceView,
  recordedSteps,
} from "./evidence/evidence.ts";
export { type Flow, flowOf } from "./evidence/flow.ts";
export { effectsOf, pagesOf } from "./evidence/pages.ts";
export { dateIn, type ProposalInput, proposalsOf } from "./evidence/proposals.ts";
export { type Picture, type StepScreen, screensOf } from "./evidence/screens.ts";
export { type TabInfo, tabName, tabsOf } from "./evidence/tabs.ts";
export { describeStep, type TimelineLine, timelineOf, timelineSlice } from "./evidence/timeline.ts";
export { toLocator } from "./locator.ts";
export { type Box, type Line, MASK, maskLines, maskText } from "./mask.ts";
export { type Note, narrationOf, notesByStep } from "./narration.ts";
export {
  globFor,
  NOISE,
  type Noise,
  type NormalisedStep,
  normalise,
  normaliseAll,
  type ParamCandidate,
  sameTarget,
} from "./normalise.ts";
export { type ActionDraft, buildSkeleton, type Skeleton, type SkillDraft, skeletonOf } from "./skeleton.ts";
