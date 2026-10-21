// One budget for a whole design (spec, "Budget: ≤ $0.25 and ≤ 40 calls per design"), the pictures' captions included:
// they are counted on the same meter before the agent starts, and every stage gets what is left.
import type { UsageMeter } from "@shadow/llm";

export const DESIGN_V2_BUDGET = { costUsd: 0.25, calls: 40 };

export function remaining(meter: UsageMeter, budget = DESIGN_V2_BUDGET): { costUsd: number; calls: number } {
  const used = meter.usage;
  return {
    costUsd: Math.max(0, Math.round((budget.costUsd - used.costUsd) * 1e6) / 1e6),
    calls: Math.max(0, budget.calls - used.calls),
  };
}
