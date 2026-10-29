// Whether the editor offers "Put in a block" for a step. A block holds steps, never a block (one level, core's `wrap`
// refuses it), so it is hidden for a block and for a step already inside one. It used to be hidden only for a block, so
// the choice was offered for a step inside a block and then refused (R4.5, B3).
import type { Step } from "@shadow/core";

export function canPutInBlock(steps: Step[], id: string): boolean {
  const walk = (list: Step[], inBlock: boolean): boolean | undefined => {
    for (const step of list) {
      if (step.id === id) return !(inBlock || (step.type === "control" && step.kind === "group"));
      if (step.type !== "control") continue;
      const inside = walk(step.steps, inBlock || step.kind === "group");
      const other = step.kind === "branch" ? walk(step.else, inBlock) : undefined;
      if (inside !== undefined || other !== undefined) return inside ?? other;
    }
    return undefined;
  };
  return walk(steps, false) ?? true;
}
