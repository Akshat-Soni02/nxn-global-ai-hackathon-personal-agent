import { describe, expect, it } from "vitest";
import { groupsOf, type Logged, lineOf, sectionsOf } from "./runlog.ts";

// Rushil's walk-through of D on 23 Oct, as the log had it: one long list.
let at = 0;
const ev = (e: Record<string, unknown>) => ({ ...e, at: ++at }) as unknown as Logged;
const walk = [
  ev({ type: "run.start", runId: "r", skillId: "d", version: 1, inputs: {} }),
  ev({ type: "run.end", runId: "r", status: "waiting", failedStep: "s1", ms: 0 }),
  ev({ type: "run.start", runId: "r", skillId: "d", version: 1, inputs: {}, resumedAt: "s1" }),
  ev({ type: "step.walk", stepId: "s1", path: "s1", choice: "do", highlighted: false }),
  ev({ type: "step.start", stepId: "s1", path: "s1", channel: "web", action: "navigate", attempt: 1 }),
  ev({ type: "step.result", stepId: "s1", path: "s1", attempt: 1, ms: 934, result: { ok: true } }),
  ev({ type: "run.end", runId: "r", status: "waiting", failedStep: "s3", ms: 0 }),
  ev({ type: "run.start", runId: "r", skillId: "d", version: 1, inputs: {}, resumedAt: "s3" }),
  ev({ type: "step.walk", stepId: "s3", path: "s3", choice: "do", highlighted: false }),
  ev({ type: "step.start", stepId: "s3", path: "s3", channel: "fs", action: "find", attempt: 1 }),
  ev({
    type: "step.result",
    stepId: "s3",
    path: "s3",
    attempt: 1,
    ms: 60_000,
    result: { ok: false, error: "no file matches *.pdf in ~/Desktop/Reading" },
  }),
  ev({ type: "run.end", runId: "r", status: "failed", failedStep: "s3", error: "no file matches", ms: 106_000 }),
];

describe("the run log (checkpoint 6: one long list, the step in every line)", () => {
  it("groups each step's lines: waiting, going on, your choice, how it went", () => {
    const groups = groupsOf(walk);
    expect(groups.map((g) => [g.step, g.kind, g.events.length])).toEqual([
      [undefined, undefined, 1],
      ["s1", "web.navigate", 4],
      ["s3", "fs.find", 4],
      [undefined, undefined, 1],
    ]);
    expect(groups[1]?.id).toBe("s1");
  });

  it("says why nothing was outlined, for the kind of step it is", () => {
    const [, s1, s3, end] = groupsOf(walk);
    expect(s1?.events.map((e) => lineOf(e, s1.kind))).toEqual([
      "Waiting for you",
      "Went on",
      "You said: do it (it opens a page: nothing to outline)",
      "✓ Done · 934 ms",
    ]);
    expect(lineOf(s3?.events[2] as Logged, s3?.kind)).toBe(
      "You said: do it (a file step: nothing on the page to outline)",
    );
    expect(lineOf(s3?.events[3] as Logged)).toBe("✗ Failed · 1 min 0 s · no file matches *.pdf in ~/Desktop/Reading");
    expect(lineOf(end?.events[0] as Logged)).toBe("Ended: failed at s3 · no file matches");
    const outlined = ev({ type: "step.walk", stepId: "s2", path: "s2", choice: "do", highlighted: true });
    expect(lineOf(outlined, "web.click")).toBe("You said: do it (outlined on the page)");
    // Not flagged on a click: nothing claimed (a walk answered from the inbox is never flagged, found or not).
    const missed = ev({ type: "step.walk", stepId: "s2", path: "s2", choice: "skip", highlighted: false });
    expect(lineOf(missed, "web.click")).toBe("You said: skip it");
    expect(lineOf(missed, "web.save_pdf")).toBe("You said: skip it (it saves the page: nothing to outline)");
  });
});

describe("a run's log by block (R7.1)", () => {
  const result = (id: string, ok: boolean) =>
    ev({ type: "step.result", stepId: id, path: id, result: ok ? { ok: true } : { ok: false, error: "x" }, ms: 1 });
  const blocks = new Map([
    ["s1", { id: "b1", title: "Open the jobs" }],
    ["s2", { id: "b1", title: "Open the jobs" }],
    ["s3", { id: "b2", title: "Fill in the sheet" }],
  ]);

  it("puts a block's steps under its title, with how it went", () => {
    const log = [result("s1", true), result("s2", true), result("s3", false), result("s4", true)];
    const sections = sectionsOf(groupsOf(log), blocks);
    expect(sections.map((s) => [s.block?.title ?? s.groups[0]?.id, s.groups.length, s.state])).toEqual([
      ["Open the jobs", 2, "done"],
      ["Fill in the sheet", 1, "failed"],
      ["s4", 1, "done"],
    ]);
  });
});
