// One budget for a whole design, the pictures' captions included: they are counted on the same meter before the agent
// starts, and every stage gets what is left. No cap on calls (Rushil, 23 Oct: "it literally makes the tasks fail"); the
// cost stays at $0.25 (Rushil, 24 Oct: "let the budget be same"). A design ends when it is done, at that cost, or when
// it stops getting anywhere (STUCK in orchestrator.ts).
import type { UsageMeter } from "@shadow/llm";

export const DESIGN_V2_BUDGET = { costUsd: 0.25, calls: Number.POSITIVE_INFINITY };

export function remaining(meter: UsageMeter, budget = DESIGN_V2_BUDGET): { costUsd: number; calls: number } {
  const used = meter.usage;
  return {
    costUsd: Math.max(0, Math.round((budget.costUsd - used.costUsd) * 1e6) / 1e6),
    calls: Math.max(0, budget.calls - used.calls),
  };
}
