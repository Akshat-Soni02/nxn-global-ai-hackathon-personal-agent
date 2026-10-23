// What the review shows after a design (spec 4.3), kept beside the workflow (skills/<id>/review.json), not in it: what
// the design did, every change with its why, what you said and what was built for each, what the test run didn't do,
// and what the finish gate still wanted. Go live waits until you say it looks right.
import type { Skill } from "@shadow/core";
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
  // Questions not asked (another one changed the same step, or past five): each took its default.
  notAsked?: string[];
  // Why it can't do the task yet: the page shows this instead of "Looks right", and it can't go live (checkpoint 6).
  cantRun?: string[];
  reviewed: boolean;
}

export function reviewOf(design: DesignV2Outcome, skill: Skill, made: string[] = []): Review {
  const said = (design.task?.rules ?? []).map((rule, i) => {
    const built = design.done?.rules.find((r) => r.rule === i);
    const notBuilt = built ? built.not_built : "the design agent didn't say";
    return { quote: rule.quote, steps: built?.steps ?? [], ...(notBuilt ? { notBuilt } : {}) };
  });
  const test = design.test;
  const untested = (s: NonNullable<DesignV2Outcome["test"]>["steps"][number]) =>
    `${s.id}: ${s.status === "not_reached" ? "not reached" : (s.error ?? s.status.replace("_", " "))}`;
  const notTested = !test
    ? ["the test run didn't run (no automation window)"]
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
    gaps: design.gaps,
    ...(cadence ? { cadence } : {}),
    ...(made.length > 0 ? { made } : {}),
    ...(design.skipped.length > 0 ? { notAsked: design.skipped } : {}),
    ...(design.cantRun?.length ? { cantRun: design.cantRun } : {}),
    reviewed: false,
  };
}
