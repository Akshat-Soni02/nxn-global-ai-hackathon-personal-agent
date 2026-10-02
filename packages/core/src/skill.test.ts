import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Skill } from "./skill.ts";

const skillsDir = join(import.meta.dirname, "../../../skills/real");

describe("skill schema", () => {
  for (const file of readdirSync(skillsDir).filter((f) => f.endsWith(".json"))) {
    it(`accepts ${file}`, () => {
      const data = JSON.parse(readFileSync(join(skillsDir, file), "utf8"));
      expect(() => Skill.parse(data)).not.toThrow();
    });
  }

  const minimal = {
    id: "demo",
    version: 1,
    intent: "demo",
    steps: [{ id: "s1", intent: "open", channel: "web", action: "navigate" }],
  };

  it("fills defaults", () => {
    const skill = Skill.parse(minimal);
    expect(skill.triggers).toEqual([{ type: "manual" }]);
    expect(skill.steps[0]?.requires_approval).toBe(false);
  });

  it("rejects an action the channel does not support", () => {
    const bad = { ...minimal, steps: [{ id: "s1", intent: "x", channel: "fs", action: "click" }] };
    expect(() => Skill.parse(bad)).toThrow(/not supported/);
  });

  it("rejects vision steps in a stored skill", () => {
    const bad = { ...minimal, steps: [{ id: "s1", intent: "x", channel: "vision", action: "click" }] };
    expect(() => Skill.parse(bad)).toThrow(/vision/);
  });
});
