import { expect, describe as group, it } from "vitest";
import { type Choice, describe, toChoice, toTrigger } from "./frequency.ts";

group("the Frequency picker", () => {
  const choices: Choice[] = [
    { kind: "manual" },
    { kind: "hourly", minute: 15 },
    { kind: "daily", time: "09:00" },
    { kind: "weekdays", time: "08:30" },
    { kind: "weekly", weekday: 1, time: "10:05" },
    { kind: "monthly", day: 1, time: "07:00" },
    { kind: "folder", dir: "~/Downloads", glob: "*.pdf" },
  ];

  it("turns every choice into a trigger and back into the same choice", () => {
    for (const choice of choices) expect(toChoice(toTrigger(choice, "run_once"))).toEqual(choice);
  });

  it("writes cron the scheduler reads, with the missed setting", () => {
    expect(toTrigger({ kind: "weekdays", time: "08:30" }, "skip")).toEqual({
      type: "schedule",
      cron: "30 8 * * 1-5",
      missed: "skip",
    });
    expect(toTrigger({ kind: "monthly", day: 15, time: "18:45" }, "run_once")).toMatchObject({ cron: "45 18 15 * *" });
  });

  it("keeps a schedule it can't express as custom, and says triggers in words", () => {
    expect(toChoice({ type: "schedule", cron: "*/10 9-17 * * 1-5", missed: "run_once" })).toEqual({
      kind: "custom",
      cron: "*/10 9-17 * * 1-5",
    });
    expect(describe({ type: "schedule", cron: "0 9 * * 1-5", missed: "run_once" })).toBe("Weekdays at 09:00");
    expect(describe({ type: "schedule", cron: "0 * * * *", missed: "run_once" })).toBe("Every hour");
    expect(describe({ type: "folder_watch", dir: "~/Invoices", glob: "*.pdf", missed: "run_once" })).toBe(
      "When a file (*.pdf) appears in ~/Invoices",
    );
  });
});
