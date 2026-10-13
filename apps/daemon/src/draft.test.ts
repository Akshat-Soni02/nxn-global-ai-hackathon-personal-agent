// The editor's draft (docs/design.md, "6. Edit"): edits on a base version, autosaved as operations; undo and redo;
// a refused edit says why; publishing makes the next version by the user; a walk-through walks the draft.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findStep, Skill } from "@shadow/core";
import { type RunDeps, runSkill } from "@shadow/player";
import { describe, expect, it } from "vitest";
import { createService, type Execute } from "./service.ts";
import { saveSkill } from "./skill-store.ts";
import { openStore } from "./store.ts";

const click = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "button", name, fallbacks: [`#${id}`] },
  ...extra,
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "shadow-draft-"));
  saveSkill(
    dataDir,
    Skill.parse({
      id: "report",
      name: "Weekly report",
      version: 1,
      description: { goal: "send the report" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand", inputs: {} },
        click("s1", "Open"),
        click("s2", "Send", { requires_approval: true }),
      ],
    }),
  );
  const walked: string[] = [];
  const execute: Execute = (skill, leg) => {
    const channel = async () => ({ ok: true });
    const deps: RunDeps = {
      web: channel,
      fs: channel,
      script: channel,
      fileExists: async () => true,
      webCheck: async () => true,
      approve: leg.hooks.approve,
      walk: leg.walk
        ? async (step) => {
            walked.push(step.intent);
            return "skip";
          }
        : undefined,
      log: leg.log,
    };
    return runSkill(skill, deps, { runId: leg.runId, inputs: leg.provided, resume: leg.resume });
  };
  const service = createService({ dataDir, store: openStore(join(dataDir, "shadow.db")), execute });
  return { dataDir, service, walked };
}

describe("the editor's draft", () => {
  it("changes a step, undoes, redoes, and refuses what the workflow can't take", () => {
    const { dataDir, service } = setup();
    expect(service.draft("report")).toMatchObject({ base: 1, latest: 1, changes: [], canUndo: false });

    const edited = service.editDraft("report", [
      { op: "set", step: "s1", field: "intent", value: "Open the portal" },
      { op: "set", step: "s1", field: "requires_approval", value: true },
    ]);
    expect(findStep(edited.skill, "s1")).toMatchObject({ intent: "Open the portal", requires_approval: true });
    expect(edited.changes).toEqual(["s1: set intent", "s1: set requires_approval"]);
    expect(edited.canUndo).toBe(true);
    expect(existsSync(join(dataDir, "skills", "report", "draft.json"))).toBe(true);
    // The live version is untouched.
    expect(findStep(service.workflow("report")?.latest as Skill, "s1")?.intent).toBe("click Open");

    const undone = service.undoDraft("report");
    expect(findStep(undone.skill, "s1")).toMatchObject({ requires_approval: false });
    expect(undone.canRedo).toBe(true);
    const redone = service.redoDraft("report");
    expect(findStep(redone.skill, "s1")).toMatchObject({ requires_approval: true });

    expect(() => service.editDraft("report", [{ op: "remove", step: "start" }])).toThrow(/trigger can't be removed/);
    expect(() =>
      service.editDraft("report", [{ op: "set", step: "s2", field: "args", value: { text: "{{nothing}}" } }]),
    ).toThrow(/nothing/);
  });

  it("publishes the draft as the next version by the user, and drops it", () => {
    const { dataDir, service } = setup();
    service.editDraft("report", [{ op: "set", step: "s1", field: "intent", value: "Open the portal" }]);
    expect(service.publishDraft("report")).toEqual({ version: 2 });
    const latest = service.workflow("report")?.latest;
    expect(latest).toMatchObject({ version: 2, history: [{ version: 2, by: "user", summary: "s1: set intent" }] });
    expect(findStep(latest as Skill, "s1")?.intent).toBe("Open the portal");
    expect(existsSync(join(dataDir, "skills", "report", "draft.json"))).toBe(false);
    expect(() => service.publishDraft("report")).toThrow(/no changes/);
  });

  it("walks the draft, not the live version", async () => {
    const { service, walked } = setup();
    service.editDraft("report", [{ op: "set", step: "s1", field: "intent", value: "Open the portal" }]);
    service.walk("report");
    await service.idle();
    expect(walked).toEqual(["Open the portal", "click Send"]);
  });

  it("discards the draft", () => {
    const { service } = setup();
    service.editDraft("report", [{ op: "set", step: "s1", field: "intent", value: "x" }]);
    expect(service.discardDraft("report")).toMatchObject({ changes: [], canUndo: false });
  });
});
