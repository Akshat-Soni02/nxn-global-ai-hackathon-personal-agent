// The chat box's change into the editor's draft (R6.1): ordinary edit operations, so the changes list, Undo and Save
// work as they do for a change made by hand.
import { applyEdits, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { editsBetween } from "./draft-edits.ts";

const nav = (id: string, url: string) => ({
  id,
  type: "action",
  intent: `open ${id}`,
  channel: "web",
  action: "navigate",
  args: { url },
});
const skill = (steps: unknown[], when: unknown[] = [{ type: "manual" }]) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 2,
    description: { goal: "g" },
    steps: [{ id: "start", type: "trigger", intent: "by hand", when }, ...steps],
  });

describe("a changed workflow as edits on the draft (R6.1)", () => {
  const before = skill([nav("s1", "https://a.example/"), nav("s2", "https://b.example/")]);
  const replay = (edits: ReturnType<typeof editsBetween>) => {
    const done = applyEdits(before, edits);
    if (!done.ok) throw new Error(done.problems.join("; "));
    return done.skill;
  };

  it("replaces only the steps that changed when the order is the same", () => {
    const after = skill([nav("s1", "https://a.example/"), nav("s2", "https://c.example/")]);
    const edits = editsBetween(before, after);
    expect(edits.map((e) => e.op)).toEqual(["replace"]);
    expect(replay(edits).steps).toEqual(after.steps);
  });

  it("sets the trigger's fields, and rebuilds the body when steps were added, removed or moved", () => {
    const after = skill(
      [nav("s3", "https://d.example/"), nav("s1", "https://a.example/")],
      [{ type: "schedule", cron: "0 9 * * *" }],
    );
    const edits = editsBetween(before, after);
    expect(edits[0]).toMatchObject({ op: "set", step: "start", field: "when" });
    expect(replay(edits).steps).toEqual(after.steps);
  });

  it("makes no edit when nothing changed", () => {
    expect(editsBetween(before, before)).toEqual([]);
  });
});
