// Replay: executes a skill step by step. Owned by the replay team. See "Replay" in the design doc.
// Entry points: this file (run loop, templates), ./web (browser executor), ./node (fs, script, inputs).
// Still to come: agent fallback (agent.ts) and learn-back (learnback.ts).

export {
  ACTION_VERBS,
  madeHere,
  type RecordedEffect,
  type Rehearsal,
  rehearsal,
  rehearsalChoice,
  rehearsalPlan,
} from "./rehearse.ts";
export { DEFAULT_TIMEOUT_MS, type RunOptions, runSkill } from "./run.ts";
export { resolveTemplates, today } from "./template.ts";
export type * from "./types.ts";
export { WAIT, walkActs } from "./types.ts";
