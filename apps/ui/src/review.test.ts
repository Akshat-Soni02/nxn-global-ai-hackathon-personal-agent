import type { Review } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import { badgesOf, cantRunNow, savedSince, summaryOf } from "./review.ts";

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
