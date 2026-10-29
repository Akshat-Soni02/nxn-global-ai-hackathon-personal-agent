// The review on the workflow page (spec 4.3): a badge per change with its why, "not tested" where no test run found
// the step; and, after Stop, the workflow a recording just saved (H24).
import { findStep, type Skill, walkSteps } from "@shadow/core";
import type { RecordingView, Review } from "@shadow/daemon/src/types.ts";

const LABEL = { added: "Added", changed: "Changed", removed: "Removed", moved: "Moved" } as const;

export function badgesOf(review: Review): { step: string; label: string; why?: string; untested: boolean }[] {
  const untested = new Set(review.notTested.map((t) => t.split(":")[0]));
  return review.notes.map((n) => ({
    step: n.step,
    label: LABEL[n.change],
    ...(n.why ? { why: n.why } : {}),
    untested: Boolean(n.unverified) || untested.has(n.step),
  }));
}

// What the review says about each node, in plain words (reports/plan-oct26-workflow-revamp.md, R3.5–R3.6): the
// design's checks are sentences for the agent that start with a step id ("s5: the test run didn't find it: fix it, or
// explain why it will work in a real run"); each goes on the node the reader sees (the block holding the step), said for
// the user. What is about no step (a rule, the test as a whole) stays in `other`.
export function nodeProblems(review: Review, skill: Skill): { byNode: Map<string, string[]>; other: string[] } {
  const nodeOf = new Map<string, string>();
  for (const { step, parents } of walkSteps(skill.steps)) {
    const block = [...parents].reverse().find((p) => {
      const parent = findStep(skill, p);
      return parent?.type === "control" && parent.kind === "group";
    });
    nodeOf.set(step.id, block ?? step.id);
  }
  const byNode = new Map<string, string[]>();
  const other: string[] = [];
  for (const line of [...review.notTested, ...review.gaps]) {
    const id = /^(\w+)(?::|\s)/.exec(line)?.[1];
    const node = id ? nodeOf.get(id) : undefined;
    if (!node || !id) {
      other.push(plainProblem(line));
      continue;
    }
    const said = plainProblem(line.slice(id.length).replace(/^:\s*/, ""));
    const list = byNode.get(node) ?? [];
    if (!list.includes(said)) list.push(said);
    byNode.set(node, list);
  }
  return { byNode, other: [...new Set(other)] };
}

// The design agent's phrasing, for a person.
export function plainProblem(text: string): string {
  const t = text.trim();
  if (/^target not found|didn't find it/i.test(t))
    return "When testing, it couldn't find what it clicks or reads on the page";
  if (/^not reached/i.test(t)) return "The test stopped before it got here";
  const failed = /failed in the test run \(([^)]*)\)/i.exec(t)?.[1];
  if (failed) return `It failed when testing: ${failed}`;
  if (/got nothing in the test run/i.test(t)) return "When testing, it read nothing";
  if (/read exactly what (\w+) read/i.test(t))
    return "It reads the same page as the step before it: one of them is on the wrong page";
  if (/was work the user showed, and it is gone/i.test(t))
    return "Something you did in the recording isn't done any more";
  // The gate's other wording (design/v2/gate.ts), each as a sentence for a person (R3.6).
  if (/replay can't find its control/i.test(t)) return "A step has no way to find its control on the page yet";
  if (/never appeared on screen/i.test(t)) return "A check looks for text that never showed up on screen";
  if (/a text check can't be empty/i.test(t)) return "A check has no text to look for, so it would always pass";
  if (/holds a hidden value/i.test(t)) return "A check looks for text that includes a hidden value";
  if (/a text check can't see a sheet/i.test(t))
    return "A text check can't read a sheet's cells or a document's drawing";
  if (/but it only runs when started by hand/i.test(t))
    return "You said how often it should run, but it only runs when you start it: set its Frequency";
  const notStarted = /the test run couldn't start \(([^)]*)\)/i.exec(t)?.[1];
  if (notStarted) return `The test run couldn't start (${notStarted})`;
  if (/runs start on a blank window/i.test(t)) return "It has to open a page before it clicks or reads";
  if (/was accepted, but .* still as recorded/i.test(t)) return "A change the design accepted isn't made yet";
  // A rule they said that no step builds: 'rule 0 "I pick top 5 jobs.": no step open_yc_jobs in the workflow'.
  const rule = /^rule \d+ "([^"]*)"/i.exec(t)?.[1];
  if (rule) return `What you said, “${rule}”, isn't built by any step yet`;
  return t
    .replace(/:\s*fix it, or explain why it will work in a real run$/i, "")
    .replace(/^\w/, (c) => c.toUpperCase());
}

// Why the version shown can't do the task yet: the design's reasons, while no one has saved a version on top of it
// (an edit may have added the step that makes the file; the daemon's Go live judges the same way).
export function cantRunNow(review: Review | null | undefined, latest: number): string[] {
  return review?.cantRun?.length && review.version === latest ? review.cantRun : [];
}

// The review's first line: the design's summary, unless it said "can't run yet" and a version was saved on top since.
export function summaryOf(review: Review, cantRun: string[]): string {
  return review.cantRun?.length && cantRun.length === 0
    ? `You changed it after the design said it can't run yet (${review.cantRun[0]}): check it now does, then Looks right`
    : review.summary;
}

// The workflow to open: one a recording saved since the Record screen opened (`seen` is the last recording then).
export function savedSince(seen: string | undefined, last: RecordingView["last"]): string | undefined {
  return last && last.outcome === "saved" && last.skillId && last.sessionId !== seen ? last.skillId : undefined;
}
