// What the review shows after a design (spec 4.3), kept beside the workflow (skills/<id>/review.json), not in it: what
// the design did, every change with its why, what you said and what was built for each, what the test run didn't do,
// and what the finish gate still wanted. Go live waits until you say it looks right.
import { type Skill, walkSteps } from "@shadow/core";
import type { DesignV2Outcome } from "./orchestrator.ts";
import type { ChangeNote } from "./rules.ts";

export interface Review {
  skillId: string;
  version: number;
  summary: string;
  notes: ChangeNote[];
  said: { quote: string; steps: string[]; notBuilt?: string }[];
  notTested: string[];
  gaps: string[];
  // How often it runs, in the words it came from (a changed Frequency isn't a step note).
  cadence?: string;
  // The feed's lines while it was made (spec 4.1): "How this was made" on the workflow page.
  made?: string[];
  // Questions not asked (another one changed the same step, or past MAX_QUESTIONS): each took its default.
  notAsked?: string[];
  // Why it can't do the task yet: the page shows this instead of "Looks right", and it can't go live (checkpoint 6).
  cantRun?: string[];
  // What the final check did for real: the files it made and put in the Trash, or how it failed.
  checked?: string;
  // What the recording itself missed (no words from the microphone, Accessibility off, a file nothing made).
  notices?: string[];
  reviewed: boolean;
}

// The final check in a line: what it made (then put in the Trash), or where it failed.
function checkedText(check: NonNullable<DesignV2Outcome["checked"]>): string {
  if (check.outcome.startsWith("failed")) return `The final check ran it for real and it failed: ${check.outcome}`;
  const made = check.made ?? [];
  return made.length > 0
    ? `The final check ran it for real: it made ${made.join(", ")}, then put ${made.length === 1 ? "it" : "them"} in the Trash`
    : `The final check ran it for real: ${check.outcome}`;
}

export function reviewOf(design: DesignV2Outcome, skill: Skill, made: string[] = [], notices: string[] = []): Review {
  // Only steps that are really in the workflow: the agent's claims are checked, not repeated (Oct 25).
  const ids = new Set([...walkSteps(skill.steps)].map(({ step }) => step.id));
  const said = (design.task?.rules ?? []).map((rule, i) => {
    const built = design.done?.rules.find((r) => r.rule === i);
    const steps = (built?.steps ?? []).map((s) => (s === "trigger" ? "start" : s)).filter((s) => ids.has(s));
    const invented = (built?.steps.length ?? 0) > 0 && steps.length === 0 && !built?.not_built;
    const notBuilt = !built
      ? "the design agent didn't say"
      : invented
        ? "not built: the design agent named steps that aren't in the workflow"
        : built.not_built;
    return { quote: rule.quote, steps, ...(notBuilt ? { notBuilt } : {}) };
  });
  const test = design.test;
  const untested = (s: NonNullable<DesignV2Outcome["test"]>["steps"][number]) =>
    `${s.id}: ${s.status === "not_reached" ? "not reached" : (s.error ?? s.status.replace("_", " "))}`;
  const notTested = !test
    ? [
        design.kind === "kept"
          ? "the test run didn't run: the design stopped before it got there"
          : "the test run didn't run (no automation window)",
      ]
    : test.outcome.startsWith("not run")
      ? [`the test run didn't run: ${test.outcome.replace(/^not run:\s*/, "")}`]
      : test.steps.filter((s) => s.status !== "done" && s.status !== "found").map(untested);
  const cadence =
    design.task && design.task.cadence.kind !== "manual"
      ? (design.task.cadence.quote ?? design.task.cadence.kind)
      : undefined;
  return {
    skillId: skill.id,
    version: skill.version,
    summary: design.cantRun?.length
      ? `Can't run yet: ${design.cantRun[0]}`
      : design.kind === "designed"
        ? // The agent's own words, said as such: Checkpoint 4's described a branch that wasn't there. The notes are code's.
          design.summary
          ? `In the agent's words: "${design.summary}". The changes below are what it really did.`
          : "Designed"
        : `${design.notes.length > 0 ? "Kept what the design reached" : "Kept the recorded steps"}: ${design.reason}`,
    notes: design.notes,
    said,
    notTested,
    // The critic's notes it never got to fix: a second look, said as such (critic.ts).
    gaps: [...design.gaps, ...(design.critique ?? []).map((c) => `a second look: ${c}`)],
    ...(cadence ? { cadence } : {}),
    ...(made.length > 0 ? { made } : {}),
    ...(design.skipped.length > 0 ? { notAsked: design.skipped } : {}),
    ...(design.cantRun?.length ? { cantRun: design.cantRun } : {}),
    ...(design.checked ? { checked: checkedText(design.checked) } : {}),
    ...(notices.length > 0 ? { notices } : {}),
    reviewed: false,
  };
}
