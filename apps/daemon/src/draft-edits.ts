// A workflow changed whole (the chat box, R6.1) as the edit operations the editor's draft is made of, so the change shows
// in "what changed", Undo takes it back and Save makes the next version, as for a change made by hand. Same steps in the
// same order: each changed one is replaced. Steps added, removed or moved: the body is rebuilt, step by step.
import type { EditInput, Skill, Step } from "@shadow/core";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function editsBetween(before: Skill, after: Skill): EditInput[] {
  const edits: EditInput[] = [];
  const [was, ...old] = before.steps;
  const [now, ...body] = after.steps;
  if (was?.type === "trigger" && now?.type === "trigger") {
    for (const field of ["intent", "when", "inputs"] as const)
      if (!same(was[field], now[field])) edits.push({ op: "set", step: now.id, field, value: now[field] });
  }
  const ids = (steps: Step[]) => steps.map((s) => s.id);
  if (same(ids(old), ids(body))) {
    body.forEach((step, i) => {
      if (!same(step, old[i])) edits.push({ op: "replace", step: step.id, with: step as never });
    });
    return edits;
  }
  for (const step of old) edits.push({ op: "remove", step: step.id });
  let previous = now?.id ?? "start";
  for (const step of body) {
    edits.push({ op: "insert", at: { after: previous }, step: step as never });
    previous = step.id;
  }
  return edits;
}
