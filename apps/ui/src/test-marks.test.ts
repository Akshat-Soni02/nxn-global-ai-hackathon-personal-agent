// A test from the workflow's page (R4.6), on its nodes: ✓ where a step worked, the reason where it didn't, a block by
// its steps.
import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { testMarks } from "./test-marks.ts";

const skill = Skill.parse({
  id: "w",
  name: "w",
  version: 1,
  description: { goal: "g" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand" },
    {
      id: "b1",
      type: "control",
      kind: "group",
      intent: "Read the jobs",
      steps: [
        {
          id: "s1",
          type: "action",
          intent: "open",
          channel: "web",
          action: "navigate",
          args: { url: "https://x.example/" },
        },
        {
          id: "s2",
          type: "action",
          intent: "read",
          channel: "web",
          action: "extract",
          target: { fallbacks: ["h1"] },
          args: {},
          output: { name: "t", type: { type: "text" } },
        },
      ],
    },
    {
      id: "s3",
      type: "action",
      intent: "click send",
      channel: "web",
      action: "click",
      target: { name: "Send", fallbacks: [] },
      args: {},
    },
    {
      id: "s4",
      type: "action",
      intent: "open",
      channel: "web",
      action: "navigate",
      args: { url: "https://y.example/" },
    },
  ],
});

describe("a test's results on the nodes (R4.6)", () => {
  it("marks what worked, what didn't with why, what was only outlined, and a block by its steps", () => {
    const marks = testMarks(
      {
        outcome: "failed: s4 did not load",
        steps: [
          { id: "s1", path: "s1", status: "done" },
          { id: "s2", path: "s2", status: "done" },
          { id: "s3", path: "s3", status: "found" },
          { id: "s4", path: "s4", status: "failed", error: "did not load" },
        ],
      },
      skill,
    );
    expect([...marks.passed].sort()).toEqual(["b1", "s1", "s2", "s3"]);
    expect(marks.failed.get("s4")).toEqual(["the test: did not load"]);
    expect(marks.line).toBe("2 steps worked, 1 found on the page without being done (it writes), 1 didn't");
  });

  it("marks a block as not working when one of its steps didn't, and says when it couldn't run at all", () => {
    const marks = testMarks(
      {
        outcome: "failed",
        steps: [
          { id: "s1", path: "s1", status: "done" },
          { id: "s2", path: "s2", status: "not_found", error: "no h1" },
        ],
      },
      skill,
    );
    expect(marks.passed.has("b1")).toBe(false);
    expect(marks.failed.get("b1")).toEqual(["the test: read: no h1"]);
    expect(testMarks({ outcome: "not run: Chrome is not connected to Shadow", steps: [] }, skill).line).toBe(
      "The test didn't run: Chrome is not connected to Shadow",
    );
  });
});
