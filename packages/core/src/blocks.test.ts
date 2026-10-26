// Blocks (reports/plan-oct26-workflow-revamp.md, R1): a named node holding the steps that do one thing.
import { describe, expect, it } from "vitest";
import { applyEdits } from "./edit.ts";
import { findStep, isGroup, Skill, walkSteps } from "./skill.ts";

const click = (id: string, name: string) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "link", name, fallbacks: [] },
});
const open = (id: string) => ({
  id,
  type: "action",
  intent: "open the jobs",
  channel: "web",
  action: "navigate",
  args: { url: "https://example.com/jobs" },
});
const read = (id: string, name: string) => ({
  id,
  type: "action",
  intent: "read the first job",
  channel: "web",
  action: "extract",
  target: { role: "link", name: "job", fallbacks: [] },
  output: { name, type: { type: "text" } },
});
const workflow = (steps: unknown[]) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [{ id: "start", type: "trigger", intent: "t" }, ...steps],
  });

describe("blocks", () => {
  it("hold steps, are walked into, and keep what their steps save visible after them", () => {
    const w = workflow([
      { id: "b1", type: "control", kind: "group", intent: "Read the top job", steps: [open("s1"), read("s2", "job")] },
      { ...click("s3", "{{job}}") },
    ]);
    expect([...walkSteps(w.steps)].map(({ step }) => step.id)).toEqual(["start", "b1", "s1", "s2", "s3"]);
    expect(findStep(w, "s2")).toMatchObject({ output: { name: "job" } });
  });

  it("hold no block, and are never empty", () => {
    const inner = { id: "b2", type: "control", kind: "group", intent: "x", steps: [open("s1")] };
    expect(() => workflow([{ id: "b1", type: "control", kind: "group", intent: "y", steps: [inner] }])).toThrow(
      /a block can't hold a block/,
    );
    expect(() => workflow([{ id: "b1", type: "control", kind: "group", intent: "y", steps: [] }])).toThrow();
  });

  it("are made, renamed, filled and undone by edits", () => {
    const w = workflow([open("s1"), click("s2", "Recent"), click("s3", "Ycomb jobs"), read("s4", "job")]);
    const wrapped = applyEdits(w, [{ op: "wrap", steps: ["s2", "s1", "s3"], intent: "Open the jobs sheet" }]);
    if (!wrapped.ok) throw new Error(wrapped.problems.join("; "));
    const block = wrapped.skill.steps[1];
    expect(block && isGroup(block) ? block.steps.map((s) => s.id) : []).toEqual(["s1", "s2", "s3"]);
    expect(block).toMatchObject({ id: "b1", intent: "Open the jobs sheet" });

    const renamed = applyEdits(wrapped.skill, [
      { op: "set", step: "b1", field: "intent", value: "Open my sheet" },
      { op: "move", step: "s4", to: { into: "b1" } },
    ]);
    if (!renamed.ok) throw new Error(renamed.problems.join("; "));
    expect(findStep(renamed.skill, "b1")).toMatchObject({ intent: "Open my sheet" });
    expect((findStep(renamed.skill, "b1") as { steps: unknown[] }).steps).toHaveLength(4);

    const undone = applyEdits(renamed.skill, [{ op: "unwrap", step: "b1" }]);
    if (!undone.ok) throw new Error(undone.problems.join("; "));
    expect(undone.skill.steps.map((s) => s.id)).toEqual(["start", "s1", "s2", "s3", "s4"]);
  });

  it("wrap steps in a loop or an if too (the step panel's Repeat for each / Only if, R4.5)", () => {
    const w = workflow([
      {
        id: "ai1",
        type: "llm",
        intent: "pick",
        instruction: "the first 5",
        inputs: [],
        output: { name: "jobs", type: { type: "list", items: { type: "text" } } },
      },
      click("s2", "Next"),
      open("s3"),
    ]);
    const looped = applyEdits(w, [
      {
        op: "wrap",
        steps: ["s2"],
        intent: "For each job",
        as: "loop",
        over: "{{jobs}}",
        item: { name: "job", type: { type: "text" } },
      },
    ]);
    if (!looped.ok) throw new Error(looped.problems.join("; "));
    expect(findStep(looped.skill, "l1")).toMatchObject({ kind: "loop", over: "{{jobs}}" });
    const iffed = applyEdits(w, [
      {
        op: "wrap",
        steps: ["s3"],
        intent: "Only if there are jobs",
        as: "branch",
        if: { left: "{{jobs}}", op: "exists" },
      },
    ]);
    if (!iffed.ok) throw new Error(iffed.problems.join("; "));
    expect(findStep(iffed.skill, "b1")).toMatchObject({ kind: "branch", else: [] });
    // Without what a loop needs, said.
    const bare = applyEdits(w, [{ op: "wrap", steps: ["s3"], intent: "x", as: "loop" }]);
    expect(bare.ok ? "" : bare.problems.join(" ")).toMatch(/needs over/);
  });

  it("are refused for steps that aren't next to each other, the trigger, or a block", () => {
    const w = workflow([open("s1"), click("s2", "a"), click("s3", "b")]);
    const gap = applyEdits(w, [{ op: "wrap", steps: ["s1", "s3"], intent: "x" }]);
    expect(gap.ok ? [] : gap.problems.join(" ")).toMatch(/next to each other/);
    expect(applyEdits(w, [{ op: "wrap", steps: ["start", "s1"], intent: "x" }]).ok).toBe(false);
    const once = applyEdits(w, [{ op: "wrap", steps: ["s1"], intent: "x" }]);
    if (!once.ok) throw new Error(once.problems.join("; "));
    const twice = applyEdits(once.skill, [{ op: "wrap", steps: ["b1"], intent: "y" }]);
    expect(twice.ok ? [] : twice.problems.join(" ")).toMatch(/can't hold a block/);
    expect(applyEdits(w, [{ op: "unwrap", step: "s1" }]).ok).toBe(false);
  });
});
