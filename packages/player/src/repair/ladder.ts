// The cheap ladder (docs/design.md, section 9 "Repair", step 1): fixes that need no model, tried in order on the live
// page, each kept only with evidence. Most drift should stop here.
//   1. wait longer      the page was slow: the same step with twice the time
//   2. fuzzy match      the control was renamed or restyled: one clear winner among controls of the same kind
// A fix is a set of edits on the workflow, so it is saved as a new version like any other repair.
import { applyEdits, type EditInput, findStep, isAction, repairViolations, type Skill } from "@taskplayer/core";
import { DEFAULT_TIMEOUT_MS } from "../run.ts";
import type { Failure } from "../types.ts";
import type { FoundElement } from "../web/inspect.ts";
import type { RepairEnv } from "./env.ts";
import { type TryResult, tryDraft } from "./verify.ts";

export interface LadderFix {
  rung: "wait longer" | "fuzzy match";
  summary: string;
  edits: EditInput[];
  skill: Skill;
  tried: TryResult;
}

// How sure a fuzzy match must be: good enough on its own, and clearly ahead of the next candidate.
const FUZZY_MIN = 0.6;
const FUZZY_MARGIN = 0.2;

export async function ladder(skill: Skill, failure: Failure, env: RepairEnv): Promise<LadderFix | undefined> {
  const original = findStep(skill, failure.stepId);
  if (!original || !isAction(original) || original.channel !== "web" || !original.target) return undefined;
  const from = { at: failure.path, vars: failure.vars };

  const attempt = async (rung: LadderFix["rung"], summary: string, edits: EditInput[]) => {
    const draft = applyEdits(skill, edits);
    if (!draft.ok || repairViolations(skill, draft.skill).length > 0) return undefined;
    const tried = await tryDraft(draft.skill, env, from, 1);
    return tried.ok && tried.evidence ? { rung, summary, edits, skill: draft.skill, tried } : undefined;
  };

  // 1. Wait longer: only when the target didn't show up at all, not when something else was in the way.
  if (/target not found/i.test(failure.result.error ?? "") && (failure.result.matchScore ?? 0) === 0) {
    const longer = Math.max(2 * (original.timeout_ms ?? DEFAULT_TIMEOUT_MS), 20_000);
    const fix = await attempt("wait longer", `${original.id}: waits up to ${longer / 1000}s for the page`, [
      { op: "set", step: original.id, field: "timeout_ms", value: longer },
    ]);
    if (fix) return fix;
  }

  // 2. Fuzzy match: same kind of control, a similar name, one clear winner. A target built from a variable
  // ("{{client.name}}") is never replaced by a literal one: that is the agent's call.
  const wanted = original.target.name ?? original.target.label ?? original.target.text;
  if (!env.page || !wanted || /\{\{/.test(JSON.stringify(original.target))) return undefined;
  const found = await env.page({ op: "find", text: wanted, role: original.target.role, limit: 5 });
  if (!found.ok) return undefined;
  const [best, second] = (found.value as FoundElement[]).filter((c) => c.visible || c.role === "file");
  if (!best || best.score < FUZZY_MIN || (second && best.score - second.score < FUZZY_MARGIN)) return undefined;
  const inspected = await env.page({ op: "inspect", ref: best.ref });
  if (!inspected.ok) return undefined;
  const { locator } = inspected.value as { locator: NonNullable<typeof original.target> };
  return attempt("fuzzy match", `${original.id}: "${wanted}" is now "${best.name}"`, [
    { op: "retarget", step: original.id, target: locator },
  ]);
}
