// A test from the workflow's page (R4.6), shown on its nodes: a ✓ where a step worked, the reason where it didn't, and a
// block by its steps (all worked: ✓; one didn't: that step's reason). Before Test, a hand edit could only be checked by a
// real run.
import { findStep, type Skill, stepTitle, walkSteps } from "@shadow/core";

export interface TestReport {
  outcome: string;
  steps: { id: string; path: string; status: string; error?: string }[];
}

export function testMarks(
  report: TestReport,
  skill: Skill,
): { passed: Set<string>; failed: Map<string, string[]>; line: string } {
  if (/^not run: /.test(report.outcome))
    return { passed: new Set(), failed: new Map(), line: `The test didn't run: ${report.outcome.slice(9)}` };
  const passed = new Set<string>();
  const failed = new Map<string, string[]>();
  let worked = 0;
  let found = 0;
  let didnt = 0;
  for (const s of report.steps) {
    if (s.status === "done" || s.status === "found") {
      passed.add(s.id);
      if (s.status === "done") worked++;
      else found++;
    } else if (s.status === "failed" || s.status === "not_found") {
      failed.set(s.id, [`the test: ${s.error ?? s.status.replace("_", " ")}`]);
      didnt++;
    }
  }
  // A block by its steps.
  for (const { step } of walkSteps(skill.steps)) {
    if (step.type !== "control" || step.kind !== "group") continue;
    const ids = step.steps.map((s) => s.id);
    const bad = ids.find((id) => failed.has(id));
    // Said by the step's name, not its id: "Press Send: target not found".
    const named = bad ? findStep(skill, bad) : undefined;
    if (bad)
      failed.set(step.id, [
        `the test: ${named && named.type !== "trigger" ? stepTitle(named) : bad}: ${(failed.get(bad)?.[0] ?? "").replace(/^the test: /, "")}`,
      ]);
    else if (ids.length > 0 && ids.every((id) => passed.has(id))) passed.add(step.id);
  }
  const parts = [
    worked ? `${worked} step${worked === 1 ? "" : "s"} worked` : "",
    found ? `${found} found on the page without being done (it writes)` : "",
    didnt ? `${didnt} didn't` : "",
  ].filter(Boolean);
  return { passed, failed, line: parts.join(", ") || `The test ended: ${report.outcome}` };
}
