import { UsageMeter } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { DESIGN_V2_BUDGET, remaining } from "./budget.ts";

describe("one budget for a whole design", () => {
  it("counts the pictures' captions too: each stage gets what is left, and calls have no cap", () => {
    const meter = new UsageMeter();
    expect(remaining(meter)).toEqual(DESIGN_V2_BUDGET);
    meter.add(1_000, 100, 0.02); // the captions
    meter.add(20_000, 800, 0.05); // the understand call
    expect(remaining(meter)).toEqual({ costUsd: 0.18, calls: Number.POSITIVE_INFINITY });
    meter.add(90_000, 2_000, 0.5);
    expect(remaining(meter).costUsd).toBe(0);
  });

  it("still keeps a cap a caller sets (the bench)", () => {
    const meter = new UsageMeter();
    meter.add(1_000, 100, 0.01);
    expect(remaining(meter, { costUsd: 0.25, calls: 40 })).toEqual({ costUsd: 0.24, calls: 39 });
  });
});
