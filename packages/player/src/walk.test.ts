// A walk-through (docs/design.md, "7. Test"): the interpreter stops before every action or llm step, after
// highlighting its target, and goes on with the user's choice. With nobody to answer, the run waits in the inbox and
// resumes later with the answer, like an approval.
import { type ActionStep, type Skill, Skill as SkillSchema } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { runSkill } from "./run.ts";
import { type RunDeps, type RunLogEvent, type StepResult, WAIT, type WalkChoice, walkActs } from "./types.ts";

const click = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "button", name, fallbacks: [`#${id}`] },
  ...extra,
});
const navigate = (id: string) => ({
  id,
  type: "action",
  intent: "open the page",
  channel: "web",
  action: "navigate",
  args: { url: "http://localhost:5173/page.html" },
});
const skill = (steps: unknown[]): Skill =>
  SkillSchema.parse({
    id: "t",
    name: "test",
    version: 1,
    description: { goal: "test" },
    steps: [{ id: "start", type: "trigger", intent: "by hand", inputs: {} }, ...steps],
  });

function fake(walk?: RunDeps["walk"]) {
  const ran: string[] = [];
  const highlighted: string[] = [];
  const approved: string[] = [];
  const events: RunLogEvent[] = [];
  const channel = async (step: ActionStep): Promise<StepResult> => {
    ran.push(step.id);
    return { ok: true };
  };
  const deps: RunDeps = {
    web: channel,
    fs: channel,
    script: channel,
    fileExists: async () => true,
    webCheck: async () => true,
    approve: async (step) => {
      approved.push(step.id);
      return true;
    },
    walk,
    highlight: async (step) => {
      highlighted.push(step.id);
    },
    log: (e) => events.push(e),
  };
  return { deps, ran, highlighted, approved, events };
}

describe("a walk-through", () => {
  it("highlights each step's target, runs it on do, passes over it on skip, and never asks for approval twice", async () => {
    const s = skill([navigate("s1"), click("s2", "Submit", { requires_approval: true }), click("s3", "Next")]);
    const choices: Record<string, WalkChoice> = { s1: "do", s2: "do", s3: "skip" };
    const { deps, ran, highlighted, approved, events } = fake(async (step) => choices[step.id] ?? "stop");
    const outcome = await runSkill(s, deps, { inputs: {} });
    expect(outcome.status).toBe("succeeded");
    expect(ran).toEqual(["s1", "s2"]);
    // s1 has no target: nothing to outline. s2 and s3 were outlined before the question.
    expect(highlighted).toEqual(["s2", "s3"]);
    // "do it" is the approval: the approve hook is not asked again for s2.
    expect(approved).toEqual([]);
    expect(events.filter((e) => e.type === "step.walk").map((e) => (e as { choice: string }).choice)).toEqual([
      "do",
      "do",
      "skip",
    ]);
    expect(events.find((e) => e.type === "step.skipped")).toMatchObject({ stepId: "s3", reason: "walked past" });
  });

  it("ends as denied when the user stops", async () => {
    const s = skill([navigate("s1"), click("s2", "Submit")]);
    const { deps, ran } = fake(async (step) => (step.id === "s1" ? "do" : "stop"));
    const outcome = await runSkill(s, deps, { inputs: {} });
    expect(outcome).toMatchObject({ status: "denied", failedStep: "s2", error: "you stopped the walk-through" });
    expect(ran).toEqual(["s1"]);
  });

  it("waits when nobody can answer, and goes on later with the answer", async () => {
    const s = skill([navigate("s1"), click("s2", "Submit"), click("s3", "Next")]);
    const first = fake(async () => WAIT);
    const waiting = await runSkill(s, first.deps, { inputs: {} });
    expect(waiting).toMatchObject({
      status: "waiting",
      waiting: { kind: "walk", path: "s1", stepId: "s1", acting: false, highlighted: false },
      resume: { at: "s1" },
    });
    expect(first.ran).toEqual([]);

    // Later: "next" for s1 (a read), then the walk waits again at s2, an acting step with its target outlined.
    const second = fake(async () => WAIT);
    const resume = { ...JSON.parse(JSON.stringify(waiting.resume)), answers: [{ kind: "walk", choice: "do" }] };
    const again = await runSkill(s, second.deps, { inputs: {}, resume });
    expect(second.ran).toEqual(["s1"]);
    expect(again).toMatchObject({
      status: "waiting",
      waiting: { kind: "walk", path: "s2", acting: true, highlighted: true },
    });
    expect(second.highlighted).toEqual(["s2"]);
  });

  it("knows which steps act and which only read", () => {
    const acts = (step: unknown) => walkActs(step as ActionStep);
    expect(acts(click("a", "Send"))).toBe(true);
    expect(acts(navigate("b"))).toBe(false);
    expect(acts({ ...navigate("c"), action: "extract" })).toBe(false);
    expect(acts({ ...navigate("d"), channel: "fs", action: "move", args: {} })).toBe(true);
    expect(
      acts({
        id: "e",
        type: "llm",
        intent: "read",
        instruction: "x",
        inputs: [],
        output: { name: "o", type: { type: "text" } },
      }),
    ).toBe(false);
  });
});
