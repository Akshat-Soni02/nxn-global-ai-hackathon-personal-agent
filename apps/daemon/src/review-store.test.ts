import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markReviewed, readReview, writeReview } from "./review-store.ts";

describe("a workflow's review", () => {
  it("is kept beside its versions, and remembers that you said it looks right", () => {
    const home = mkdtempSync(join(tmpdir(), "review-"));
    const review = {
      skillId: "kpi-a1b2c3",
      version: 2,
      summary: "x",
      notes: [],
      said: [],
      notTested: [],
      gaps: [],
      reviewed: false,
    };
    writeReview(home, review);
    expect(readReview(home, "kpi-a1b2c3")).toEqual(review);
    expect(markReviewed(home, "kpi-a1b2c3")?.reviewed).toBe(true);
    expect(readReview(home, "kpi-a1b2c3")?.reviewed).toBe(true);
    expect(readReview(home, "nothing-here")).toBeUndefined();
  });
});
