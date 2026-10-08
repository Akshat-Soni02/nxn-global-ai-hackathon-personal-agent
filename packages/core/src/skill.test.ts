import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findStep, isBranch, isLoop, Skill, walkSteps } from "./skill.ts";

const skillsDir = join(import.meta.dirname, "../../../skills/real");

const base = { id: "demo", name: "Demo", version: 1, description: { goal: "Open the page" } };
const nav = (id: string) => ({ id, type: "action", intent: "open", channel: "web", action: "navigate" });
const issues = (data: unknown) => {
  const r = Skill.safeParse(data);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("skill schema", () => {
  for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".json"))) {
    it(`accepts ${file}`, () => {
      expect(issues(JSON.parse(readFileSync(join(skillsDir, file), "utf8")))).toEqual([]);
    });
  }

  it("fills defaults", () => {
    const skill = Skill.parse({ ...base, steps: [nav("s1")] });
    expect(skill.triggers).toEqual([{ type: "manual" }]);
    expect(skill.description).toEqual({ goal: "Open the page", changes: [], constants: [], never: [] });
    expect(skill.history).toEqual([]);
    expect(skill.steps[0]?.requires_approval).toBe(false);
  });

  it("requires a name and a goal instead of the old one-line intent", () => {
    expect(issues({ id: "x", version: 1, intent: "old", steps: [nav("s1")] })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^name:/), expect.stringMatching(/^description:/)]),
    );
  });

  it("reports a bad action step by its own path, even nested", () => {
    expect(issues({ ...base, steps: [{ ...nav("s1"), channel: "fs", action: "click" }] })).toEqual([
      "steps.0.action: action is not supported by this channel",
    ]);
    const loop = { id: "l1", type: "control", kind: "loop", intent: "each", over: "{{vars.x}}", as: "item" };
    expect(
      issues({ ...base, steps: [{ ...loop, steps: [{ ...nav("s2"), channel: "vision", action: "click" }] }] }),
    ).toEqual(["steps.0.steps.0.channel: vision steps are chosen by replay at run time, never written into a skill"]);
  });

  it("no longer has data.ai: judgement is an llm step", () => {
    const old = { id: "s1", type: "action", intent: "x", channel: "data", action: "ai" };
    expect(issues({ ...base, steps: [old] })).toEqual(["steps.0.action: action is not supported by this channel"]);
  });

  it("accepts a tree of loop, branch, llm and action steps", () => {
    const skill = Skill.parse({
      ...base,
      steps: [
        { ...nav("s1"), save_as: "emails" },
        {
          id: "l1",
          type: "control",
          kind: "loop",
          intent: "For each email",
          over: "{{vars.emails}}",
          as: "email",
          steps: [
            {
              id: "s2",
              type: "llm",
              intent: "Read the invoice",
              instruction: "Extract vendor and amount.",
              inputs: ["{{email.body}}"],
              output: { type: "object", fields: { vendor: "text", amount: "number" } },
              save_as: "invoice",
            },
            {
              id: "b1",
              type: "control",
              kind: "branch",
              intent: "Large invoices",
              if: { all: [{ left: "{{vars.invoice.amount}}", op: "greater_than", right: 5000 }] },
              steps: [{ ...nav("s3"), requires_approval: true }],
            },
          ],
        },
      ],
    });
    expect([...walkSteps(skill.steps)].map(({ step, parents }) => [step.id, parents.join("/")])).toEqual([
      ["s1", ""],
      ["l1", ""],
      ["s2", "l1"],
      ["b1", "l1"],
      ["s3", "l1/b1"],
    ]);
    const loop = findStep(skill, "l1");
    expect(loop && isLoop(loop) && [loop.max_items, loop.on_item_fail]).toEqual([100, "stop"]);
    const branch = findStep(skill, "b1");
    expect(branch && isBranch(branch) && branch.else).toEqual([]);
  });

  it("needs ids unique across the whole tree", () => {
    const loop = {
      id: "l1",
      type: "control",
      kind: "loop",
      intent: "e",
      over: "{{vars.x}}",
      as: "x",
      steps: [nav("s1")],
    };
    expect(issues({ ...base, steps: [nav("s1"), loop] })).toEqual(["steps: duplicate step id s1"]);
  });

  it("checks llm steps, asks and variable names", () => {
    const llm = { id: "s1", type: "llm", intent: "x", instruction: "Summarise", output: { type: "text" } };
    expect(issues({ ...base, steps: [llm] })).toEqual([
      "steps.0.save_as: Invalid input: expected string, received undefined",
    ]);
    expect(issues({ ...base, steps: [{ ...nav("s1"), ask: { question: "Which plan today?" } }] })).toEqual([
      "steps.0.ask.save_as: a value question needs save_as",
    ]);
    expect(issues({ ...base, steps: [{ ...nav("s1"), ask: { question: "Go?", kind: "confirm" } }] })).toEqual([]);
    expect(issues({ ...base, steps: [{ ...nav("s1"), save_as: "today" }] })).toEqual([
      "steps.0.save_as: reserved name",
    ]);
  });
});
