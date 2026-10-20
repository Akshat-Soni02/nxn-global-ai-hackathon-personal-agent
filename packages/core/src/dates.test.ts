import { describe, expect, it } from "vitest";
import { parseDateRef } from "./dates.ts";
import { Skill } from "./skill.ts";

const typing = (text: string, inputs: Record<string, unknown> = {}) =>
  Skill.safeParse({
    id: "d",
    version: 1,
    name: "d",
    description: { goal: "g" },
    steps: [
      { id: "start", type: "trigger", intent: "by hand", inputs },
      { id: "s1", type: "action", intent: "type", channel: "web", action: "type", args: { text } },
    ],
  });

describe("dates in a workflow", () => {
  it("reads today or the week's Monday, a few days before or after, and a format", () => {
    expect(parseDateRef("today|D MMM")).toEqual({ base: "today", offset: 0, format: "D MMM" });
    expect(parseDateRef(" today - 1 ")).toEqual({ base: "today", offset: -1 });
    expect(parseDateRef("week_start|[w/c] D MMM")).toEqual({ base: "week_start", offset: 0, format: "[w/c] D MMM" });
    expect(parseDateRef("todays")).toBeUndefined();
  });

  it("lets a step use them, and keeps week_start a reserved name", () => {
    expect(typing("{{today|D MMM}}").success).toBe(true);
    expect(typing("w/c {{week_start|D.M.YYYY}}").success).toBe(true);
    expect(typing("{{today-1}}").success).toBe(true);
    expect(typing("{{tomorrow}}").success).toBe(false);
    expect(typing("x", { week_start: { type: { type: "date" } } }).success).toBe(false);
  });
});
