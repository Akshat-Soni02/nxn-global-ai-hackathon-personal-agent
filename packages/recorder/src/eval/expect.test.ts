import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { checkExpectations, Expectations } from "./expect.ts";

const skill = Skill.parse({
  id: "kpi",
  name: "kpi",
  version: 1,
  description: { goal: "KPIs into the sheet" },
  steps: [
    {
      id: "start",
      type: "trigger",
      intent: "every day",
      when: [{ type: "schedule", cron: "0 9 * * *" }],
      inputs: { emails: { type: { type: "list", items: { type: "text" } }, default: [] } },
    },
    {
      id: "l1",
      type: "control",
      kind: "loop",
      intent: "each email",
      over: "{{emails}}",
      item: { name: "email", type: { type: "text" } },
      steps: [
        {
          id: "s4",
          type: "action",
          intent: "paste the subject",
          channel: "web",
          action: "type",
          target: { role: "textbox", name: "Cell", fallbacks: [] },
          args: { text: "{{email}} {{today}}" },
        },
        {
          id: "s5",
          type: "action",
          intent: "click the header block",
          channel: "web",
          action: "click",
          target: { text: "Print allIn new window", fallbacks: [] },
          args: {},
        },
      ],
    },
  ],
});

describe("checkExpectations", () => {
  it("checks loops, {{today}}, kept writes, text-only targets, the trigger and the questions", () => {
    const expectations = Expectations.parse([
      { kind: "has_loop", over: "emails", why: "every KPI email" },
      { kind: "uses_today", why: "the date is the day it runs" },
      { kind: "write_kept", action: "web.type", value: "\\{\\{email", why: "the subject is pasted" },
      { kind: "no_text_only_target", why: "replay can't find text-only targets" },
      { kind: "trigger", type: "schedule", why: "every day" },
      { kind: "max_questions", n: 1, why: "nothing else is unclear" },
      { kind: "not_asked", pattern: "which file", why: "they said all of them" },
      { kind: "has_loop", over: "rows", why: "the next empty row", expectedToFail: true },
    ]);
    const verdicts = checkExpectations(skill, ["Which sheet?", "Which file next time?"], expectations);
    expect(verdicts.map((v) => [v.expectation.kind, v.ok])).toEqual([
      ["has_loop", true],
      ["uses_today", true],
      ["write_kept", true],
      ["no_text_only_target", false],
      ["trigger", true],
      ["max_questions", false],
      ["not_asked", false],
      ["has_loop", false],
    ]);
    expect(verdicts[3]?.detail).toContain("s5");
    expect(verdicts[7]?.expectation.expectedToFail).toBe(true);
  });
});
