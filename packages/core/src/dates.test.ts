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

  it("takes only date tokens, short words in brackets and separators as a format, so a date is never a path", () => {
    expect(parseDateRef("today|[Week of] D MMM, YYYY")?.format).toBe("[Week of] D MMM, YYYY");
    expect(parseDateRef("today|DD/MM/YYYY")?.format).toBe("DD/MM/YYYY");
    expect(parseDateRef("today|D.M.YYYY")?.format).toBe("D.M.YYYY");
    expect(parseDateRef("today|~/.ssh/id_rsa")).toBeUndefined();
    expect(parseDateRef("today|[~/.ssh]")).toBeUndefined();
    expect(parseDateRef("today|..")).toBeUndefined();
    expect(parseDateRef("today|D[..]")).toBeUndefined();
    expect(parseDateRef("today|[w/c]")).toBeUndefined(); // no date in it
    expect(parseDateRef("today|Week of D")).toBeUndefined(); // words go in brackets
    expect(typing("{{today|[~/.ssh]}}").success).toBe(false);
  });

  it("lets a step use them", () => {
    expect(typing("{{today|D MMM}}").success).toBe(true);
    expect(typing("w/c {{week_start|D.M.YYYY}}").success).toBe(true);
    expect(typing("{{today-1}}").success).toBe(true);
    expect(typing("{{tomorrow}}").success).toBe(false);
    expect(typing("x", { today: { type: { type: "date" } } }).success).toBe(false);
  });

  it("still loads a workflow saved with its own week_start (the design doc's KPI example names one), which wins", () => {
    const own = typing("{{week_start.label}}", {
      week_start: { type: { type: "object", fields: { label: { type: "text" } } } },
    });
    expect(own.success).toBe(true);
  });
});
