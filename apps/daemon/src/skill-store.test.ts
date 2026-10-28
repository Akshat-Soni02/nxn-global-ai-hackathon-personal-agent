import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EditInput, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { loadSkill, rollbackSkill, saveRepair, saveSkill, versions } from "./skill-store.ts";

const v1 = Skill.parse({
  id: "send-report",
  name: "Send the report",
  version: 1,
  description: { goal: "Send it" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand" },
    { id: "s1", type: "action", intent: "Send", channel: "web", action: "click", target: { name: "Send" } },
  ],
  history: [{ version: 1, by: "record", summary: "recorded", at: "2026-10-10T08:00:00Z" }],
});

describe("a repair saved after you edited the workflow while the run waited (C32)", () => {
  const retarget: EditInput[] = [{ op: "retarget", step: "s1", target: { name: "Send now", fallbacks: [] } }];
  // The run started on v1; the repair is v1 + the fix, numbered v2 (what repair makes: the original's version + 1).
  const repairOfV1 = Skill.parse({
    ...v1,
    version: 2,
    steps: [v1.steps[0], { ...v1.steps[1], target: { name: "Send now", fallbacks: [] } }],
    history: [
      ...v1.history,
      { version: 2, by: "debug", summary: 's1: "Send" is now "Send now"', at: "2026-10-10T09:00:00Z" },
    ],
  });

  it("applies the fix again on the latest, so your edit stays and the fix is the next version", () => {
    const home = mkdtempSync(join(tmpdir(), "tp-store-"));
    saveSkill(home, v1);
    saveSkill(home, {
      ...v1,
      version: 2,
      steps: [v1.steps[0], { ...v1.steps[1], intent: "Send the monthly report" }] as Skill["steps"],
      history: [...v1.history, { version: 2, by: "user", summary: "reworded", at: "2026-10-10T08:30:00Z" }],
    });
    const saved = saveRepair(home, repairOfV1, retarget);
    expect(versions(home, "send-report")).toEqual([1, 2, 3]);
    expect(saved.version).toBe(3);
    expect(loadSkill(home, "send-report")?.steps[1]).toMatchObject({
      intent: "Send the monthly report", // your edit
      target: { name: "Send now" }, // the fix
    });
    expect(saved.history.at(-1)).toMatchObject({ version: 3, by: "debug" });
  });

  it("saves it as the next version when it was made on the latest, as before", () => {
    const home = mkdtempSync(join(tmpdir(), "tp-store-"));
    saveSkill(home, v1);
    expect(saveRepair(home, repairOfV1, retarget).version).toBe(2);
    expect(versions(home, "send-report")).toEqual([1, 2]);
  });

  it("doesn't save a fix that no longer fits the latest: the run goes on with it, no version", () => {
    const home = mkdtempSync(join(tmpdir(), "tp-store-"));
    saveSkill(home, v1);
    // You replaced s1 with another step, s9.
    saveSkill(home, { ...v1, version: 2, steps: [v1.steps[0], { ...v1.steps[1], id: "s9" }] as Skill["steps"] });
    const result = saveRepair(home, repairOfV1, retarget);
    expect(versions(home, "send-report")).toEqual([1, 2]);
    expect(result.steps).toHaveLength(2); // the run's own fixed copy
  });
});

describe("rollback", () => {
  it("saves the version before the latest as the next one, saying what was undone", () => {
    const home = mkdtempSync(join(tmpdir(), "tp-store-"));
    saveSkill(home, v1);
    saveSkill(home, {
      ...v1,
      version: 2,
      steps: [
        v1.steps[0] as Skill["steps"][number],
        {
          ...(v1.steps[1] as Skill["steps"][number]),
          target: { name: "Send now", fallbacks: [] },
        } as Skill["steps"][number],
      ],
      history: [
        ...v1.history,
        { version: 2, by: "debug", summary: 's1: "Send" is now "Send now"', at: "2026-10-10T09:00:00Z" },
      ],
    });
    const rolled = rollbackSkill(home, "send-report", new Date("2026-10-10T10:00:00Z"));
    expect(versions(home, "send-report")).toEqual([1, 2, 3]);
    expect(loadSkill(home, "send-report")?.steps[1]).toMatchObject({ target: { name: "Send" } });
    expect(rolled.skill.history.map((h) => [h.version, h.by])).toEqual([
      [1, "record"],
      [2, "debug"],
      [3, "user"],
    ]);
    expect(rolled.skill.history.at(-1)?.summary).toBe('rolled back to v1 (undid: s1: "Send" is now "Send now")');
    expect(() => rollbackSkill(mkdtempSync(join(tmpdir(), "tp-store-")), "send-report")).toThrow(/no earlier version/);
  });
});
