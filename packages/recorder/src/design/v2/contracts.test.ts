import { describe, expect, it } from "vitest";
import { DoneReport, TaskModel } from "./contracts.ts";

describe("the task model", () => {
  it("holds what the model understood, with defaults for what it left out", () => {
    const model = TaskModel.parse({
      outcome: "Each new KPI email's numbers are in the next row of the KPI sheet",
      cadence: { kind: "schedule", cron: "0 9 * * *", quote: "every day" },
      rules: [{ quote: "always take the newest one", where: "said" }],
    });
    expect(model).toMatchObject({ values: [], proposals: [], unknowns: [] });
    expect(model.rules[0]?.steps).toEqual([]);
  });

  it("refuses a model with no outcome, or a cadence it can't run", () => {
    expect(TaskModel.safeParse({ cadence: { kind: "manual" } }).success).toBe(false);
    expect(TaskModel.safeParse({ outcome: "x", cadence: { kind: "sometimes" } }).success).toBe(false);
  });
});

describe("the done report", () => {
  it("says, per stated rule, which steps build it or why it isn't built", () => {
    const done = DoneReport.parse({
      summary: "Takes the newest unread KPI email",
      rules: [
        { rule: 0, steps: ["l1", "s4"], how: "a loop over new emails" },
        { rule: 1, not_built: "no write action for the next empty row yet" },
      ],
    });
    expect(done.rules).toHaveLength(2);
  });
});
