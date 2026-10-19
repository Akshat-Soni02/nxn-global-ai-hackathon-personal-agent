import { findStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { Question } from "./compile.ts";
import { applyAnswer, drill } from "./drill.ts";

const skill = Skill.parse({
  id: "jobs",
  name: "jobs",
  version: 1,
  description: { goal: "add jobs" },
  steps: [
    {
      id: "start",
      type: "trigger",
      intent: "by hand",
      inputs: { jobs: { type: { type: "list", items: { type: "text" } }, default: [] } },
    },
    {
      id: "l1",
      type: "control",
      kind: "loop",
      intent: "each job",
      over: "{{jobs}}",
      item: { name: "job", type: { type: "text" } },
      steps: [
        {
          id: "s3",
          type: "action",
          intent: "type the company",
          channel: "web",
          action: "type",
          target: { role: "textbox", name: "Company", fallbacks: [] },
          args: { text: "Numeral" },
        },
      ],
    },
  ],
});
const question = (appliesTo: string): Question => ({ id: "q", text: "What goes there?", appliesTo }) as Question;

describe("answers", () => {
  it("reach a step inside a loop, by its id", () => {
    const result = applyAnswer(skill, question("steps.s3.args.text"), "{{job}}");
    expect(result.ok).toBe(true);
    const step = result.ok ? findStep(result.skill, "s3") : undefined;
    expect(step && "args" in step ? step.args.text : undefined).toBe("{{job}}");
  });

  it("are asked with the step they change and the draft, so the window can show it", async () => {
    const seen: { step?: string; hasDraft: boolean }[] = [];
    await drill(skill, [question("steps.s3.args.text")], {
      prompter: {
        ask: async (_q, about) => {
          seen.push({ step: about?.step, hasDraft: Boolean(about?.draft) });
          return "{{job}}";
        },
      },
    });
    expect(seen).toEqual([{ step: "s3", hasDraft: true }]);
  });
});
