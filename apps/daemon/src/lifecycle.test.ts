import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { goLiveProblems } from "./lifecycle.ts";

const skill = (when: unknown[], inputs: Record<string, unknown> = {}) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "test" },
    steps: [
      { id: "start", type: "trigger", intent: "start", when, inputs },
      {
        id: "s1",
        type: "action",
        intent: "write",
        channel: "fs",
        action: "write",
        args: { path: "~/x", content: "x" },
      },
    ],
  });
const text = { type: { type: "text" } };
const file = { type: { type: "file" } };

describe("going live", () => {
  it("is always allowed for a workflow you start by hand: you are there to give it what it needs", () => {
    expect(goLiveProblems(skill([{ type: "manual" }], { who: text, invoice: file }))).toEqual([]);
  });

  it("needs inputs that fill without anyone when it runs on its own", () => {
    expect(goLiveProblems(skill([{ type: "schedule", cron: "0 9 * * *" }], { who: text }))).toEqual([
      'input "who" has no default and no way to be found: an unattended run has nobody to ask',
    ]);
    expect(
      goLiveProblems(skill([{ type: "schedule", cron: "0 9 * * *" }], { who: { ...text, default: "Acme" } })),
    ).toEqual([]);
    // By hand AND on a schedule: the scheduled runs still need it.
    expect(
      goLiveProblems(skill([{ type: "manual" }, { type: "schedule", cron: "0 9 * * *" }], { who: text })),
    ).toHaveLength(1);
  });

  it("refuses a schedule that isn't valid cron", () => {
    expect(goLiveProblems(skill([{ type: "schedule", cron: "every monday" }]))[0]).toContain("isn't valid");
  });

  it("lets a folder trigger fill its file input, and needs one to fill", () => {
    expect(goLiveProblems(skill([{ type: "folder_watch", dir: "~/In" }], { invoice: file }))).toEqual([]);
    expect(goLiveProblems(skill([{ type: "folder_watch", dir: "~/In" }]))[0]).toContain("needs exactly one file input");
  });
});
