import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Skill } from "@taskplayer/core";
import { describe, expect, it } from "vitest";
import { loadSkill, rollbackSkill, saveSkill, versions } from "./skill-store.ts";

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

describe("rollback", () => {
  it("saves the version before the latest as the next one, saying what was undone", () => {
    const home = mkdtempSync(join(tmpdir(), "tp-store-"));
    saveSkill(home, v1);
    saveSkill(home, {
      ...v1,
      version: 2,
      steps: [
        v1.steps[0] as Skill["steps"][number],
        { ...(v1.steps[1] as object), target: { name: "Send now", fallbacks: [] } } as Skill["steps"][number],
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
