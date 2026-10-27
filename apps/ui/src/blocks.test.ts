import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { canPutInBlock } from "./blocks.ts";

const act = (id: string) => ({
  id,
  type: "action",
  intent: `do ${id}`,
  channel: "web",
  action: "navigate",
  args: { url: "https://example.com" },
});
const skill = Skill.parse({
  id: "w",
  name: "w",
  version: 1,
  description: { goal: "g" },
  steps: [
    {
      id: "start",
      type: "trigger",
      intent: "t",
      inputs: { list: { type: { type: "list", items: { type: "text" } }, default: ["a"] } },
    },
    act("s1"),
    { id: "b1", type: "control", kind: "group", intent: "Open the page", steps: [act("s2"), act("s3")] },
    {
      id: "l1",
      type: "control",
      kind: "loop",
      intent: "for each",
      over: "{{list}}",
      item: { name: "x", type: { type: "text" } },
      steps: [{ id: "b2", type: "control", kind: "group", intent: "Inside the loop", steps: [act("s4")] }, act("s5")],
    },
  ],
});

describe('when "Put in a block" is offered (B3)', () => {
  it("is offered for a step that isn't in a block, even inside a loop", () => {
    expect(canPutInBlock(skill.steps, "s1")).toBe(true);
    expect(canPutInBlock(skill.steps, "s5")).toBe(true);
    expect(canPutInBlock(skill.steps, "l1")).toBe(true);
  });

  it("is hidden for a step already inside a block, and for a block: one level only, core refuses both", () => {
    expect(canPutInBlock(skill.steps, "s2")).toBe(false);
    expect(canPutInBlock(skill.steps, "s4")).toBe(false);
    expect(canPutInBlock(skill.steps, "b1")).toBe(false);
    expect(canPutInBlock(skill.steps, "b2")).toBe(false);
  });
});
