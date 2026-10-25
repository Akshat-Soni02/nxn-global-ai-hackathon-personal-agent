import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { runSkill } from "./run.ts";
import { type RunDeps, type RunLogEvent, WAIT } from "./types.ts";

// A file the run downloads (s1 finds it), then moves (s2): the test run skips s1, so s2's {{pdf.path}} has no value.
const skill = Skill.parse({
  id: "w",
  name: "w",
  version: 1,
  description: { goal: "move the downloaded PDF" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand", inputs: {} },
    {
      id: "s1",
      type: "action",
      intent: "find the PDF this run downloaded",
      channel: "fs",
      action: "find",
      args: { dir: "~/Downloads", glob: "*.pdf", pick: "newest", since_run_start: true },
      output: { name: "pdf", type: { type: "file" } },
    },
    {
      id: "s2",
      type: "action",
      intent: "move it",
      channel: "fs",
      action: "move",
      args: { from: "{{pdf.path}}", to: "~/Documents/" },
    },
    {
      id: "s3",
      type: "action",
      intent: "open the page",
      channel: "web",
      action: "navigate",
      args: { url: "https://example.com" },
    },
  ],
});

const base = (log: RunLogEvent[]): RunDeps => ({
  web: async () => ({ ok: true }),
  fs: async () => ({ ok: true }),
  script: async () => ({ ok: true }),
  fileExists: async () => true,
  webCheck: async () => true,
  approve: async () => true,
  log: (e) => log.push(e),
});

describe("a walk with values no step made yet", () => {
  it("skips the step that needs them instead of failing on them", async () => {
    const log: RunLogEvent[] = [];
    const outcome = await runSkill(
      skill,
      { ...base(log), walk: async (step) => (step.type === "action" && step.channel === "fs" ? "skip" : "do") },
      { runId: "r", inputs: {} },
    );
    expect(outcome.status).toBe("succeeded");
    expect(log.filter((e) => e.type === "step.skipped").map((e) => (e as { stepId: string }).stepId)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("still fails when the step is done", async () => {
    const outcome = await runSkill(
      skill,
      { ...base([]), walk: async (step) => (step.id === "s1" ? "skip" : "do") },
      { runId: "r", inputs: {} },
    );
    expect(outcome).toMatchObject({ status: "failed", failedStep: "s2", error: expect.stringMatching(/pdf/) });
  });
});

describe("a walk answered later", () => {
  it("logs whether the target was outlined before it waited", async () => {
    const log: RunLogEvent[] = [];
    const first = await runSkill(
      skill,
      { ...base(log), walk: async () => WAIT, highlight: async () => {} },
      { runId: "r", inputs: {} },
    );
    expect(first.status).toBe("waiting");
    const resumed: RunLogEvent[] = [];
    await runSkill(
      skill,
      { ...base(resumed), walk: async () => "skip" },
      {
        runId: "r",
        inputs: {},
        resume: {
          ...(first.resume as NonNullable<typeof first.resume>),
          answers: [{ kind: "walk", choice: "skip", highlighted: true }],
        },
      },
    );
    expect(resumed.find((e) => e.type === "step.walk")).toMatchObject({ stepId: "s1", highlighted: true });
  });
});
