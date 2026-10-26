import { Skill } from "@shadow/core";
import type { Review } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import { badgesOf, cantRunNow, nodeProblems, plainProblem, savedSince, summaryOf } from "./review.ts";

const review: Review = {
  skillId: "w",
  version: 1,
  summary: "x",
  notes: [
    { step: "s4", change: "removed", what: "click the header", why: "it changed nothing" },
    { step: "s13", change: "added", what: "read the inbox", unverified: true },
    { step: "s7", change: "changed", what: "paste" },
  ],
  said: [],
  notTested: ["s7: target not found"],
  gaps: [],
  reviewed: false,
};

describe("problems on the nodes they're about (the YC review, Oct 26: nine 's5: target not found')", () => {
  const nav = (id: string) => ({
    id,
    type: "action",
    intent: "open",
    channel: "web",
    action: "navigate",
    args: { url: "https://example.com" },
  });
  const skill = Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [
      { id: "start", type: "trigger", intent: "t" },
      { id: "b1", type: "control", kind: "group", intent: "Fill in the sheet", steps: [nav("s5"), nav("s6")] },
      nav("s7"),
    ],
  });

  it("puts each on the block that holds its step, in plain words, once", () => {
    const { byNode, other } = nodeProblems(
      {
        ...review,
        notTested: ["s5: target not found", "s6: target not found"],
        gaps: [
          "s5: the test run didn't find it: fix it, or explain why it will work in a real run",
          "s7: it failed in the test run (no such cell)",
          'rule 0 "I pick top 5 jobs.": no step open_yc_jobs in the workflow',
        ],
      },
      skill,
    );
    expect(byNode.get("b1")).toEqual(["When testing, it couldn't find what it clicks or reads on the page"]);
    expect(byNode.get("s7")).toEqual(["It failed when testing: no such cell"]);
    expect(other).toEqual(["What you said, “I pick top 5 jobs.”, isn't built by any step yet"]);
  });

  it("says the agent's other phrasings for a person", () => {
    expect(plainProblem("not reached")).toBe("The test stopped before it got here");
    expect(plainProblem("s29 read exactly what s28 read in the test run")).toMatch(/same page/);
  });
});

describe("the review on the workflow page", () => {
  it("can't run yet only on the version the design saved: a version saved on top may have fixed it", () => {
    const cant = { ...review, cantRun: ["no step makes a file in ~/Desktop/Reading"] };
    expect(cantRunNow(cant, 1)).toEqual(["no step makes a file in ~/Desktop/Reading"]);
    expect(cantRunNow(cant, 2)).toEqual([]);
    expect(cantRunNow(review, 1)).toEqual([]);
    // Its first line follows: the design's words until a version is saved on top, then what to check.
    expect(summaryOf({ ...cant, summary: "Can't run yet: x" }, cantRunNow(cant, 1))).toBe("Can't run yet: x");
    expect(summaryOf(cant, cantRunNow(cant, 2))).toMatch(/^You changed it after the design said it can't run yet/);
    expect(summaryOf(review, [])).toBe("x");
  });

  it("badges every change, with its why, and marks what no test run found", () => {
    expect(badgesOf(review)).toEqual([
      { step: "s4", label: "Removed", why: "it changed nothing", untested: false },
      { step: "s13", label: "Added", untested: true },
      { step: "s7", label: "Changed", untested: true },
    ]);
  });

  it("opens the workflow a recording just saved, never one saved before the screen opened", () => {
    const last = { sessionId: "rec-2", outcome: "saved" as const, skillId: "kpi-a1b2c3", text: "Saved KPIs" };
    expect(savedSince("rec-1", last)).toBe("kpi-a1b2c3");
    expect(savedSince("rec-2", last)).toBeUndefined();
    expect(savedSince("rec-1", { ...last, outcome: "failed" })).toBeUndefined();
  });
});
