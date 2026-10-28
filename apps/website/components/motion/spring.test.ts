import { describe, expect, it } from "vitest";
import { spring } from "./spring";

describe("spring", () => {
  it("a critically damped spring starts at 0, ends at 1 and never overshoots", () => {
    const { ease, duration } = spring(0.6);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBeCloseTo(1, 6);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const now = ease(i / 100);
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now).toBeLessThanOrEqual(1 + 1e-9);
      last = now;
    }
    // Settle time follows the response: about 1.6 times it for a critically damped spring.
    expect(duration).toBeGreaterThan(0.6);
    expect(duration).toBeLessThan(1.2);
  });

  it("a lower damping overshoots, and a slower response takes longer", () => {
    const bouncy = spring(0.4, 0.8).ease;
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => bouncy((i + 1) / 100)));
    expect(peak).toBeGreaterThan(1.01);
    expect(spring(0.8).duration).toBeGreaterThan(spring(0.4).duration);
  });
});
