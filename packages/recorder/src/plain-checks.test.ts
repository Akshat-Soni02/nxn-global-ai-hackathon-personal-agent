import { findStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { plainChecks, plainUrlPart } from "./plain-checks.ts";

describe("url_matches is a part of the address, never a pattern", () => {
  it("turns a regex the model wrote back into the address part it meant (the YC replay failed on the right page)", () => {
    expect(plainUrlPart("https://www\\.ycombinator\\.com/jobs")).toBe("https://www.ycombinator.com/jobs");
    expect(plainUrlPart("^https://github\\.com/microsoft/vscode/issues/\\d+$")).toBe(
      "https://github.com/microsoft/vscode/issues/",
    );
    expect(plainUrlPart("docs\\.google\\.com/spreadsheets/d/.*/edit")).toBe("docs.google.com/spreadsheets/d/");
    expect(plainUrlPart("/jobs?page=2")).toBe("/jobs?page=2"); // already a plain part: kept as it is
  });

  it("fixes every url check in a workflow: nested steps and the whole task's checks too", () => {
    const skill = Skill.parse({
      id: "yc",
      version: 1,
      name: "YC",
      description: { goal: "note the top job" },
      steps: [
        {
          id: "start",
          type: "trigger",
          intent: "by hand",
          inputs: { jobs: { type: { type: "list", items: { type: "text" } }, default: [] } },
        },
        {
          id: "s1",
          type: "action",
          intent: "open the jobs",
          channel: "web",
          action: "navigate",
          args: { url: "https://www.ycombinator.com/jobs" },
          check: { url_matches: "https://www\\.ycombinator\\.com/jobs" },
        },
        {
          id: "s2",
          type: "control",
          kind: "loop",
          intent: "each job",
          over: "{{jobs}}",
          item: { name: "job", type: { type: "text" } },
          steps: [
            {
              id: "s3",
              type: "action",
              intent: "open it",
              channel: "web",
              action: "navigate",
              args: { url: "{{job}}" },
              check: { url_matches: "/jobs/\\w+$" },
            },
          ],
        },
      ],
      success: [{ url_matches: "^https://www\\.ycombinator\\.com/" }],
    });
    const plain = plainChecks(skill);
    expect(findStep(plain, "s1")).toMatchObject({ check: { url_matches: "https://www.ycombinator.com/jobs" } });
    expect(findStep(plain, "s3")).toMatchObject({ check: { url_matches: "/jobs/" } });
    expect(plain.success).toEqual([{ url_matches: "https://www.ycombinator.com/" }]);
    expect(findStep(skill, "s1")).toMatchObject({ check: { url_matches: "https://www\\.ycombinator\\.com/jobs" } });
  });
});
