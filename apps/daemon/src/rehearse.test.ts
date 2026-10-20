import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { notRunWhy } from "./rehearse.ts";

const skill = (channel: "web" | "ax") =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [
      { id: "start", type: "trigger", intent: "by hand" },
      channel === "web"
        ? {
            id: "s1",
            type: "action",
            intent: "open",
            channel: "web",
            action: "navigate",
            args: { url: "https://x.example/" },
          }
        : { id: "s1", type: "action", intent: "open", channel: "ax", action: "open", args: { app: "com.apple.Notes" } },
    ],
  });

describe("whether the test run can start", () => {
  it("says it can't before trying, when what the workflow needs isn't connected (no 30 s wait, no failed step)", () => {
    expect(notRunWhy(skill("web"), { extension: false, mac: true })).toBe("Chrome is not connected to Shadow");
    expect(notRunWhy(skill("web"), { extension: true, mac: false })).toBeUndefined();
    expect(notRunWhy(skill("ax"), { extension: true, mac: false })).toBe("Shadow.app is not running");
  });
});
