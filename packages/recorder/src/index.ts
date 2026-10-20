// Record: turns a demonstration into a skill. Owned by the record team. See "Record" in the design doc.
//
//   capture      content-script listeners and describeElement live in apps/extension (they need the DOM)
//   normalise    trace -> the steps a person would describe (no AI)
//   skeleton     steps -> a valid skill built by code: actions, targets, recorded values
//   compile      skeleton + Nemotron -> intents, inputs, checks, approvals, questions
//   drill        the questions, asked once before saving; lasting answers go to memory
//   design       the design agent: the compiled draft -> the workflow meant (loops, branches, llm steps), asking
//                what is unclear; the compiled draft is kept if it can't finish
//   mask         the words read from a screenshot, with emails, numbers, keys and Never terms hidden (███)
//   approvals    approval on every step that sends, pays or deletes, or matches the user's Never list (code, last)
export { requireApprovals } from "./approvals.ts";
export {
  type Chat,
  type Compiled,
  compile,
  extractJson,
  type Form,
  Question,
  stepsForModel,
  systemPrompt,
  templateProblems,
} from "./compile.ts";
export { changesSummary, describeChanges } from "./design/changes.ts";
export {
  DESIGN_BUDGET,
  type DesignOptions,
  type DesignOutcome,
  designWorkflow,
  MAX_QUESTIONS,
} from "./design/design.ts";
export { type DesignFinish, designViolations, outlineOf } from "./design/tools.ts";
export {
  DoneReport,
  type EvidenceView,
  PROPOSAL_KINDS,
  type Proposal,
  TaskModel,
  type TestReport,
  type TestStep,
} from "./design/v2/contracts.ts";
export { applyAnswer, type DrillResult, drill, type Prompter } from "./drill.ts";
export { checkExpectations, Expectation, Expectations, type Verdict } from "./eval/expect.ts";
export { answerFromEvidence } from "./evidence/answers.ts";
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
