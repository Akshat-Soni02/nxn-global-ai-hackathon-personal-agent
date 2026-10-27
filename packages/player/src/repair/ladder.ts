// The cheap ladder (docs/design.md, section 9 "Repair", step 1): fixes that need no model, tried in order on the live
// page, each kept only with evidence. Most drift should stop here.
//   0. skip a detour    the step only got somewhere, and a later step opens a page by its address anyway: drop the way
//   1. wait longer      the page was slow: the same step with twice the time
//   2. fuzzy match      the control was renamed or restyled: one clear winner among controls of the same kind
// A fix is a set of edits on the workflow, so it is saved as a new version like any other repair.
import {
  applyEdits,
  type EditInput,
  findStep,
  isAction,
  isOutward,
  repairViolations,
  type Skill,
  type Step,
} from "@shadow/core";
import { DEFAULT_TIMEOUT_MS } from "../run.ts";
import type { Failure } from "../types.ts";
import type { FoundElement } from "../web/inspect.ts";
import type { RepairEnv } from "./env.ts";
import { type TryResult, tryDraft } from "./verify.ts";

export interface LadderFix {
  rung: "skip a detour" | "wait longer" | "fuzzy match";
  summary: string;
  edits: EditInput[];
  skill: Skill;
  tried: TryResult;
}

// How sure a fuzzy match must be: good enough on its own, and clearly ahead of the next candidate.
const FUZZY_MIN = 0.6;
const FUZZY_MARGIN = 0.2;

// A step that only moves around: opens a page, clicks to go somewhere, or waits; it saves nothing, asks nothing, needs
// no approval, and isn't outward.
const onlyMoves = (s: Step | undefined): boolean =>
  Boolean(
    s &&
      isAction(s) &&
      s.channel === "web" &&
      ["navigate", "click", "wait_for"].includes(s.action) &&
      !s.output &&
      !s.ask &&
      !s.requires_approval &&
      !isOutward(s),
  );

// From the failing step: the run of steps that only move around, up to the first later step in the same list and tab
// that opens a page by a fixed address. Undefined when there is none, or the failing step itself is that open.
export function detourFrom(skill: Skill, stepId: string): { skipped: string[]; opens: string } | undefined {
  const siblings = parentList(skill.steps, stepId);
  if (!siblings) return undefined;
  const at = siblings.findIndex((s) => s.id === stepId);
  const failing = siblings[at];
  if (!failing || !isAction(failing) || !onlyMoves(failing) || failing.action === "navigate") return undefined;
  const tab = failing.tab;
  const skipped: string[] = [];
  for (const s of siblings.slice(at)) {
    if (!onlyMoves(s) || !isAction(s) || s.tab !== tab) return undefined;
    if (s.action === "navigate" && skipped.length > 0) {
      const url = String(s.args.url ?? "");
      return /^https?:\/\//.test(url) && !url.includes("{{") ? { skipped, opens: s.id } : undefined;
    }
    skipped.push(s.id);
  }
  return undefined;
}

function parentList(steps: Step[], id: string): Step[] | undefined {
  if (steps.some((s) => s.id === id)) return steps;
  for (const s of steps) {
    if (s.type !== "control") continue;
    const inner = parentList(s.steps, id) ?? (s.kind === "branch" ? parentList(s.else, id) : undefined);
    if (inner) return inner;
  }
  return undefined;
}

export async function ladder(skill: Skill, failure: Failure, env: RepairEnv): Promise<LadderFix | undefined> {
  const original = findStep(skill, failure.stepId);
  if (!original || !isAction(original) || !original.target) return undefined;
  // Web steps get both rungs; Mac-app (ax) steps only the first: there is no page to search for a lookalike.
  if (original.channel !== "web" && original.channel !== "ax") return undefined;
  const from = { at: failure.path, vars: failure.vars };

  const attempt = async (rung: LadderFix["rung"], summary: string, edits: EditInput[], start = from) => {
    const draft = applyEdits(skill, edits);
    if (!draft.ok || repairViolations(skill, draft.skill).length > 0) return undefined;
    const tried = await tryDraft(draft.skill, env, start, 1, skill);
    return tried.ok && tried.evidence ? { rung, summary, edits, skill: draft.skill, tried } : undefined;
  };

  // 0. Skip a detour (Oct 25: the run died clicking a file in Drive's Recent list, three steps before a step that opens
  // that sheet by its address). The steps from the failing one up to a later open in the same tab only moved around:
  // they read nothing, ask nothing, send nothing. That open puts the tab on its own page whatever they reached.
  const detour = detourFrom(skill, original.id);
  if (detour) {
    const fix = await attempt(
      "skip a detour",
      `${detour.skipped.join(", ")}: only led to a page; ${detour.opens} opens its page directly`,
      detour.skipped.map((id): EditInput => ({ op: "remove", step: id })),
      { at: failure.path.replace(/[^>\s]+$/, detour.opens), vars: failure.vars },
    );
    if (fix) return fix;
  }

  // 1. Wait longer: only when the target didn't show up at all, not when something else was in the way. A Mac app
  // says "no AXButton like the recorded one" (AX.swift) when the window hasn't drawn it yet.
  const error = failure.result.error ?? "";
  const nothingThere =
    original.channel === "web"
      ? /target not found/i.test(error) && (failure.result.matchScore ?? 0) === 0
      : /like the recorded one|not found/i.test(error);
  if (nothingThere) {
    const longer = Math.max(2 * (original.timeout_ms ?? DEFAULT_TIMEOUT_MS), 20_000);
    const where = original.channel === "web" ? "the page" : "the app";
    const fix = await attempt("wait longer", `${original.id}: waits up to ${longer / 1000}s for ${where}`, [
      { op: "set", step: original.id, field: "timeout_ms", value: longer },
    ]);
    if (fix) return fix;
  }
  if (original.channel !== "web") return undefined;

  // 2. Fuzzy match: same kind of control, a similar name, one clear winner. A target built from a variable
  // ("{{client.name}}") is never replaced by a literal one: that is the agent's call.
  const wanted = original.target.name ?? original.target.label ?? original.target.text;
  // Without a recorded role any kind of control would do, so a name that merely begins the same could win.
  if (!env.page || !wanted || !original.target.role || /\{\{/.test(JSON.stringify(original.target))) return undefined;
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
