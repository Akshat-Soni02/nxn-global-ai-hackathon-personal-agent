import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { plainChanges } from "./changes.ts";

const nav = (id: string, url: string) => ({
  id,
  type: "action",
  intent: `open ${url}`,
  channel: "web",
  action: "navigate",
  args: { url },
});
const type = (id: string, text: string) => ({
  id,
  type: "action",
  intent: "Type into 'A4'",
  channel: "web",
  action: "type",
  target: { role: "combobox", name: "A4", fallbacks: [] },
  args: { text },
});
const workflow = (steps: unknown[], when: unknown[] = [{ type: "manual" }]) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [{ id: "start", type: "trigger", intent: "t", when }, ...steps],
  });

describe("a version's changes in plain words (the YC v1 note, Oct 26)", () => {
  it("says the schedule, what it leaves out and the values it now makes, by step title", () => {
    const before = workflow([
      nav("s1", "https://jobs.example.com/jobs"),
      nav("s3", "https://drive.google.com/drive/my-drive"),
      type("s11", "25 Oct"),
    ]);
    const after = workflow(
      [nav("s1", "https://jobs.example.com/jobs"), type("s11", "{{today|D MMM}}")],
      [{ type: "schedule", cron: "0 9 * * *", missed: "run_once" }],
    );
    expect(plainChanges(before, after)).toEqual([
      "Every day at 09:00 (was: only when you start it)",
      "leaves out “Open Google Drive”",
      "‘Type into “A4”’ uses today's date",
    ]);
  });

  it("says what was added, put in a loop or made to ask first, and never counts blocks", () => {
    const before = workflow([nav("s1", "https://jobs.example.com/jobs"), type("s2", "x")]);
    const after = workflow([
      {
        id: "b1",
        type: "control",
        kind: "group",
        intent: "Open the jobs",
        steps: [nav("s1", "https://jobs.example.com/jobs")],
      },
      {
        id: "ai1",
        type: "llm",
        intent: "Pick the top 5 jobs",
        instruction: "the first 5",
        inputs: [],
        output: { name: "top_jobs", type: { type: "list", items: { type: "text" } } },
      },
      {
        id: "l1",
        type: "control",
        kind: "loop",
        intent: "For each job",
        over: "{{top_jobs}}",
        item: { name: "job", type: { type: "text" } },
        steps: [{ ...type("s2", "{{job}}"), requires_approval: true }],
      },
    ]);
    expect(plainChanges(before, after)).toEqual([
      "adds “Pick the top 5 jobs” and “For each job”",
      "‘Type into “A4”’ uses the job",
      "asks you first before ‘Type into “A4”’",
      "does a step for each job",
    ]);
  });
});
