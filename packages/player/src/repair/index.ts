// Recover from a failure: classify, the cheap ladder, the repair agent. See docs/design.md, section 9.
export { type Classification, classify, type FailureClass } from "./classify.ts";
export type { RepairEnv } from "./env.ts";
export { type LadderFix, ladder } from "./ladder.ts";
export { type Recovery, runWithRecovery } from "./recover.ts";
export {
  createRepairer,
  DEFAULT_REPAIR_LIMITS,
  type Repairer,
  type RepairerOptions,
  type RepairLimits,
  type RepairOutcome,
} from "./repair.ts";
export { failureReport, workflowOutline } from "./report.ts";
export { type RepairFinish, type RepairSession, repairGuard, repairTools } from "./tools.ts";
export { stepAt, type TryResult, tryDraft } from "./verify.ts";
