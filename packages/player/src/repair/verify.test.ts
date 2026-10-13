// Trying a draft while nobody can approve (docs/guide/14, §7 item 1): an approval that answers WAIT is not an
// approval. The try must come back as not ok, the step must not count as approved, and a commit on that try must be
// refused, so a retargeted outward step can never run without the user's OK.
import { type ActionStep, type Skill, Skill as SkillSchema } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { type RunDeps, type StepResult, WAIT } from "../types.ts";
import type { RepairEnv } from "./env.ts";
import { createRepairer } from "./repair.ts";
import { tryDraft } from "./verify.ts";

const click = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "button", name, fallbacks: [`#${id}`] },
  ...extra,
});
const write = (id: string) => ({
  id,
  type: "action",
  intent: `write ${id}`,
  channel: "fs",
  action: "write",
  args: { path: "~/out.txt", content: id },
});
const skill = (steps: unknown[]): Skill =>
  SkillSchema.parse({
    id: "t",
    name: "test",
    version: 1,
    description: { goal: "test" },
    steps: [{ id: "start", type: "trigger", intent: "by hand", inputs: {} }, ...steps],
  });

// Channels that record what ran; the web channel fails `failing` steps with "target not found".
function fake(failing: string[] = [], approve: RunDeps["approve"] = async () => true) {
  const ran: string[] = [];
  const channel = async (step: ActionStep): Promise<StepResult> => {
    if (failing.includes(step.id)) return { ok: false, error: "target not found", matchScore: 0 };
    ran.push(step.id);
    return { ok: true };
  };
  const deps: RunDeps = {
    web: channel,
    fs: channel,
    script: channel,
    fileExists: async () => true,
    webCheck: async () => true,
    approve,
  };
  const env: RepairEnv = { runId: "r1", deps };
  return { deps, env, ran };
}

const failureAt = (original: Skill, index: number) => ({
  stepId: (original.steps[index] as ActionStep).id,
  path: (original.steps[index] as ActionStep).id,
  step: original.steps[index] as ActionStep,
  result: { ok: false, error: "target not found", matchScore: 0 },
  attempts: 1,
  vars: {},
});
const outputs = (outcome: { episode?: { transcript: { type: string; output?: string }[] } }) =>
  (outcome.episode?.transcript ?? [])
    .filter((e) => e.type === "result")
    .map((e) => e.output ?? "")
    .join("\n");

describe("trying a draft when nobody can approve", () => {
  it("is not ok, counts nothing as approved, and runs nothing", async () => {
    // s2 is outward (Submit). The next step's target "is on the page" (webCheck says yes), which used to pass as
    // evidence although the try stopped at s2's approval.
    const draft = skill([write("s1"), click("s2", "Submit"), click("s3", "Next")]);
    const { env, ran } = fake([], async () => WAIT);
    const result = await tryDraft(draft, env, { at: "s2", vars: {} }, 2);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/approval/i);
    expect(result.approved).toEqual([]);
    expect(result.evidence).toBeUndefined();
    expect(ran).toEqual([]);
  });

  it("refuses to commit on a try that waited for approval, so the step keeps its approval", async () => {
    const original = skill([write("s1"), click("s2", "Submit"), click("s3", "Next")]);
    const { env, ran } = fake(["s2"], async () => WAIT);
    const llm = fakeLlm([
      {
        toolCalls: [
          { name: "edit", arguments: { edits: [{ op: "set", step: "s2", field: "timeout_ms", value: 20_000 }] } },
        ],
      },
      { toolCalls: [{ name: "try_steps", arguments: { count: 2 } }] },
      { toolCalls: [{ name: "commit", arguments: { summary: "longer wait" } }] },
      { toolCalls: [{ name: "escalate", arguments: { reason: "the user must approve Submit first" } }] },
    ]);
    const outcome = await createRepairer({ llm, protocol: "tools" }).repair(original, failureAt(original, 2), env);
    expect(outcome.kind).toBe("escalate");
    expect(outputs(outcome)).toMatch(/Not committed/);
    expect(ran).toEqual([]);
  });
});
