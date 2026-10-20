// Where values go (spec 2.5): a copy pasted later, a copied text typed again, a step's output used by a later step.
// By draft step ids, so the timeline, the proposals and the agent all name steps the same way (spec 2.9).
import { findRefs, isAction, isLlm, type Skill, walkSteps } from "@shadow/core";
import type { NormalisedStep } from "../normalise.ts";

export interface Flow {
  from: string;
  to: string;
  how: "pasted" | "typed" | "used";
  value?: string;
}

export function flowOf(steps: NormalisedStep[], skill: Skill, idsByStep: string[][]): Flow[] {
  const flows: Flow[] = [];
  const has = (from: string, to: string) => flows.some((f) => f.from === from && f.to === to);
  // A copy from a sheet is two draft steps (read the sheet, pick the value): the value comes from the last.
  const outOf = (i: number) => idsByStep[i]?.at(-1);
  const copies = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "copy");
  steps.forEach((s, i) => {
    if (s.kind !== "type" && s.kind !== "app_type") return;
    const to = idsByStep[i]?.[0];
    if (!to) return;
    if (s.fromCopy) {
      const copy = copies.find(({ s: c }) => c.events.includes(s.fromCopy as string));
      const from = copy && outOf(copy.i);
      if (from) flows.push({ from, to, how: "pasted", ...(copy.s.value ? { value: copy.s.value.slice(0, 80) } : {}) });
      return;
    }
    for (const { s: c, i: ci } of copies) {
      if (ci >= i || !c.value || c.value.length < 3 || !s.value?.includes(c.value)) continue;
      const from = outOf(ci);
      if (from && !has(from, to)) flows.push({ from, to, how: "typed", value: c.value.slice(0, 80) });
    }
  });
  const producer = new Map<string, string>();
  for (const { step } of walkSteps(skill.steps)) {
    const names = isAction(step)
      ? findRefs({ target: step.target, args: step.args }).map((r) => r.expr)
      : isLlm(step)
        ? step.inputs
        : [];
    for (const expr of names) {
      const from = producer.get(expr.replace(/[{}\s]/g, "").split(/[.|+-]/)[0] ?? "");
      if (from && from !== step.id && !has(from, step.id)) flows.push({ from, to: step.id, how: "used" });
    }
    if ((isAction(step) || isLlm(step)) && step.output) producer.set(step.output.name, step.id);
  }
  return flows;
}
