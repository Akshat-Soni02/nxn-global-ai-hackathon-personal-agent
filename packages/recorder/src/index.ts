// Record: turns a demonstration into a skill. Owned by the record team. See "Record" in the design doc.
//
//   capture      content-script listeners and describeElement live in apps/extension (they need the DOM)
//   normalise    trace -> the steps a person would describe (no AI)
//   skeleton     steps -> a valid skill built by code: actions, targets, recorded values
//   compile      skeleton + Nemotron -> intents, inputs, checks, approvals, questions
//   drill        the questions, asked once before saving; lasting answers go to memory
export {
  type Chat,
  type Compiled,
  compile,
  extractJson,
  Question,
  systemPrompt,
  templateProblems,
} from "./compile.ts";
export { applyAnswer, type DrillResult, drill, type Prompter } from "./drill.ts";
export { toLocator } from "./locator.ts";
export { globFor, type NormalisedStep, normalise, type ParamCandidate, sameTarget } from "./normalise.ts";
export { type ActionDraft, buildSkeleton, type Skeleton, type SkillDraft, skeletonOf } from "./skeleton.ts";
