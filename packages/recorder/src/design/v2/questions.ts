// The questions left after a design (spec, "Questions: who writes, who answers"); grown in Task 9.
import { type Skill, triggerOf, walkSteps } from "@shadow/core";

export const MAX_QUESTIONS = 5;

// What sits where a question's answer goes ("steps.start.inputs.invoice.resolve.dir"), as JSON, so the agent's
// change to it can be noticed; null when the step or input the question is about is gone (nothing left to ask).
export function slotOf(skill: Skill, appliesTo: string | undefined): string | null {
  let keys = (appliesTo ?? "").split(".").filter(Boolean);
  let node: unknown = skill;
  if (keys[0] === "steps" && keys.length >= 2) {
    const step =
      keys[1] === "0" ? skill.steps[0] : [...walkSteps(skill.steps)].find(({ step }) => step.id === keys[1])?.step;
    if (!step) return null;
    if (step.type === "trigger" && keys[2] === "inputs" && keys[3] && !(keys[3] in triggerOf(skill).inputs))
      return null;
    node = step;
    keys = keys.slice(2);
  }
  for (const key of keys) {
    if (node === null || typeof node !== "object") return "-";
    node = (node as Record<string, unknown>)[key];
  }
  return JSON.stringify(node) ?? "-";
}
