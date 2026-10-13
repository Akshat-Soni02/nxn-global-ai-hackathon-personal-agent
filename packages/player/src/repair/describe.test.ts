// The repair agent's describe_screen: there only when the daemon can give a masked picture (the user's consent), and
// what it says comes back as data, never as instructions.
import { type ActionStep, type Skill, Skill as SkillSchema } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import type { RunDeps, StepResult } from "../types.ts";
import type { RepairEnv } from "./env.ts";
import { createRepairer } from "./repair.ts";

const click = (id: string, name: string) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "button", name, fallbacks: [`#${id}`] },
});
const skill: Skill = SkillSchema.parse({
  id: "t",
  name: "test",
  version: 1,
  description: { goal: "test" },
  steps: [{ id: "start", type: "trigger", intent: "by hand", inputs: {} }, click("s1", "Go"), click("s2", "Next")],
});
const failure = {
  stepId: "s1",
  path: "s1",
  step: skill.steps[1] as ActionStep,
  // A partial match (not 0): the cheap ladder's "wait longer" rung doesn't apply, so the agent is asked.
  result: { ok: false, error: "target not found", matchScore: 0.3 },
  attempts: 1,
  vars: {},
};
const channel = async (): Promise<StepResult> => ({ ok: true });
const deps: RunDeps = {
  web: channel,
  fs: channel,
  script: channel,
  fileExists: async () => true,
  webCheck: async () => true,
  approve: async () => true,
};
const script = [
  { toolCalls: [{ name: "describe_screen", arguments: { question: "what is on the page?" } }] },
  { toolCalls: [{ name: "escalate", arguments: { reason: "done looking" } }] },
];
const outputs = (outcome: { episode?: { transcript: { type: string; output?: string }[] } }) =>
  (outcome.episode?.transcript ?? []).filter((e) => e.type === "result").map((e) => e.output ?? "");

describe("describe_screen in repair", () => {
  it("describes the page as untrusted data when the daemon can give a masked picture", async () => {
    const asked: string[] = [];
    const env: RepairEnv = {
      runId: "r1",
      deps,
      describeScreen: async (question) => {
        asked.push(question);
        return "A cookie banner covers the page; Accept is at the bottom.";
      },
      available: { screenConsent: true },
    };
    const outcome = await createRepairer({ llm: fakeLlm(script), protocol: "tools" }).repair(skill, failure, env);
    expect(asked).toEqual(["what is on the page?"]);
    expect(outputs(outcome)[0]).toBe(
      "<untrusted_data>\nA cookie banner covers the page; Accept is at the bottom.\n</untrusted_data>",
    );
  });

  it("has no such tool without the consent", async () => {
    const env: RepairEnv = { runId: "r1", deps };
    const outcome = await createRepairer({ llm: fakeLlm(script), protocol: "tools" }).repair(skill, failure, env);
    expect(outcome.kind).toBe("escalate");
    expect(outcome.episode?.transcript.find((e) => e.type === "invalid")).toMatchObject({
      error: expect.stringMatching(/no tool describe_screen/),
    });
  });
});
