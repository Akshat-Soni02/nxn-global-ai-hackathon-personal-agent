import { describe, expect, it } from "vitest";
import { briefing } from "./briefing.ts";
import { isOutward, neverMatch, repairViolations } from "./guard.ts";
import { Skill } from "./skill.ts";

const skill = (steps: unknown[], never: string[] = []) =>
  Skill.parse({
    id: "kpi",
    name: "KPI",
    version: 1,
    description: { goal: "this week's numbers in the KPI sheet", changes: [], constants: [], never },
    steps: [
      { id: "t", type: "trigger", intent: "start", when: [{ type: "manual" }], inputs: {} },
      {
        id: "r",
        type: "llm",
        intent: "rows",
        instruction: "make rows",
        inputs: [],
        output: { name: "rows", type: { type: "list", items: { type: "object" } } },
      },
      ...steps,
    ],
    success: [],
    history: [],
  });

const append = {
  id: "s1",
  type: "action",
  intent: "add this week's row to the KPI sheet",
  channel: "mcp",
  action: "call",
  args: { tool: "GOOGLESHEETS_APPEND_VALUES", arguments: { spreadsheet_id: "kpi", values: "{{rows}}" } },
  output: { name: "appended", type: { type: "object" } },
};

describe("mcp steps", () => {
  it("parse with a tool and object arguments, and their references are checked", () => {
    const s = skill([append]);
    expect(s.steps[2]).toMatchObject({ channel: "mcp", action: "call" });
    expect(() => skill([{ ...append, args: { arguments: {} } }])).toThrow(/args.tool/);
    expect(() => skill([{ ...append, args: { tool: "X_Y", arguments: [1] } }])).toThrow(/args.tool/);
    expect(() => skill([{ ...append, args: { tool: "A", arguments: { v: "{{nope}}" } } }])).toThrow(/nope/);
    expect(() => skill([{ ...append, output: { name: "f", type: { type: "file" } } }])).toThrow(/mcp.call produces/);
  });

  it("count as outward, and match Never by the words in the tool's name", () => {
    const s = skill(
      [{ ...append, args: { tool: "GMAIL_SEND_EMAIL", arguments: {} } }],
      ["never send email to clients"],
    );
    const step = s.steps[2];
    expect(step && isOutward(step)).toBe(true);
    expect(step && neverMatch(step, s.description.never)).toBe("never send email to clients");
  });

  it("can't be added by a repair", () => {
    const before = skill([]);
    const after = skill([append]);
    expect(repairViolations(before, after).join("\n")).toMatch(/connected-app calls/);
  });

  it("are briefed with the connected tools, or told there are none", () => {
    expect(briefing({ available: {} })).toMatch(/Connected apps: none/);
    const text = briefing({
      available: { connectedTools: [{ name: "GOOGLESHEETS_GET_VALUES", description: "Reads rows", readOnly: true }] },
    });
    expect(text).toContain("- mcp.call { tool, arguments? }");
    expect(text).toContain("GOOGLESHEETS_GET_VALUES (read-only): Reads rows");
  });
});
