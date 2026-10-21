import { UsageMeter } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { DESIGN_V2_BUDGET, remaining } from "./budget.ts";

describe("one budget for a whole design", () => {
  it("counts the pictures' captions too: each stage gets what is left", () => {
    const meter = new UsageMeter();
    expect(remaining(meter)).toEqual(DESIGN_V2_BUDGET);
    meter.add(1_000, 100, 0.02); // the captions
    meter.add(20_000, 800, 0.05); // the understand call
    expect(remaining(meter)).toEqual({ costUsd: 0.18, calls: 38 });
    meter.add(90_000, 2_000, 0.3);
    expect(remaining(meter)).toEqual({ costUsd: 0, calls: 37 });
  });
});
