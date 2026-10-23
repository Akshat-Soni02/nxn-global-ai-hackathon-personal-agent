import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { DesignV2Outcome } from "./orchestrator.ts";
import { reviewOf } from "./review.ts";

const skill = Skill.parse({
  id: "kpi-a1b2c3",
  name: "KPIs",
  version: 1,
  description: { goal: "KPIs into the sheet" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand" },
    {
      id: "s1",
      type: "action",
      intent: "open the sheet",
      channel: "web",
      action: "navigate",
      args: { url: "https://docs.google.com/" },
    },
  ],
});
const design = (extra: Partial<DesignV2Outcome>): DesignV2Outcome => ({
  kind: "designed",
  skill,
  decisions: [],
  notes: [{ step: "s4", change: "removed", what: "click the header", why: "it changed nothing" }],
  gaps: [],
  asked: [],
  answered: [],
  pending: [],
  skipped: [],
  system: "",
  transcript: [],
  usage: { calls: 3, input: 0, output: 0, costUsd: 0.04 },
  ...extra,
});

describe("what the review shows", () => {
  it("says what you said and what was built for it, or why not", () => {
    const review = reviewOf(
      design({
        summary: "every new KPI email, each morning",
        task: {
          outcome: "x",
          cadence: { kind: "schedule", quote: "every day" },
          values: [],
          rules: [
            { quote: "always the newest one", where: "said", steps: [] },
            { quote: "never one already done", where: "said", steps: [] },
          ],
          proposals: [],
          unknowns: [],
        },
        done: {
          summary: "x",
          rules: [
            { rule: 0, steps: ["s2", "l1"] },
            { rule: 1, steps: [], not_built: "replay can't tell yet" },
          ],
        },
      }),
      skill,
    );
    expect(review.said).toEqual([
      { quote: "always the newest one", steps: ["s2", "l1"] },
      { quote: "never one already done", steps: [], notBuilt: "replay can't tell yet" },
    ]);
    expect(review.cadence).toBe("every day");
    expect(review.reviewed).toBe(false);
    // Checkpoint 4 (D): the agent's summary described a branch that didn't exist; shown as its words, not as fact.
    expect(review.summary).toBe(
      'In the agent\'s words: "every new KPI email, each morning". The changes below are what it really did.',
    );
  });

  it("lists what the test run didn't do, or that it didn't run, and why the recorded steps were kept", () => {
    expect(reviewOf(design({}), skill).notTested).toEqual(["the test run didn't run (no automation window)"]);
    const notRun = design({ test: { outcome: "not run: Chrome is not connected", steps: [] } });
    expect(reviewOf(notRun, skill).notTested).toEqual(["the test run didn't run: Chrome is not connected"]);
    const partly = design({
      test: {
        outcome: "succeeded",
        steps: [
          { id: "s1", path: "s1", status: "done" },
          { id: "s3", path: "s3", status: "not_found", error: "target not found" },
          { id: "s6", path: "s6", status: "not_reached" },
        ],
      },
    });
    expect(reviewOf(partly, skill).notTested).toEqual(["s3: target not found", "s6: not reached"]);
    const kept = reviewOf(design({ kind: "kept", reason: "it ran out of turns", notes: [] }), skill);
    expect(kept.summary).toBe("Kept the recorded steps: it ran out of turns");
    // Changes it made before it stopped stay, and the summary says so.
    const reached = reviewOf(design({ kind: "kept", reason: "it ran out of turns" }), skill);
    expect(reached.summary).toBe("Kept what the design reached: it ran out of turns");
    expect(reviewOf(design({ skipped: ["Which row?"] }), skill).notAsked).toEqual(["Which row?"]);
  });

  it("keeps the feed's lines, as how this was made", () => {
    expect(reviewOf(design({}), skill, ["Read 12 actions as 9 steps", "Done"]).made).toEqual([
      "Read 12 actions as 9 steps",
      "Done",
    ]);
    expect(reviewOf(design({}), skill).made).toBeUndefined();
  });
});
