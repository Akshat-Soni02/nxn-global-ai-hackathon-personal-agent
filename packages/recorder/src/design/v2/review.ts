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
    summary: design.kind === "designed" ? (design.summary ?? "Designed") : `Kept the recorded steps: ${design.reason}`,
    notes: design.notes,
    said,
    notTested,
    gaps: design.gaps,
    ...(cadence ? { cadence } : {}),
    ...(made.length > 0 ? { made } : {}),
    reviewed: false,
  };
}
