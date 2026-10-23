// A step with nothing to work with fails, saying why, instead of passing nothing on (checkpoint 6: D's read named a tab
// no step had opened, read "" and passed; its AI step then made up ".../wiki/2026_in_railway_transportation").
import { type ActionStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { runSkill } from "./run.ts";
import type { RunDeps, StepResult } from "./types.ts";

const skill = (steps: unknown[]): Skill =>
  Skill.parse({
    id: "t",
    name: "t",
    version: 1,
    description: { goal: "t" },
    steps: [{ id: "start", type: "trigger", intent: "by hand" }, ...steps],
  });
const page = {
  id: "s4",
  type: "action",
  intent: "Read the Main Page",
  channel: "web",
  action: "extract",
  target: { fallbacks: ["main", "body"] },
  output: { name: "page", type: { type: "text" } },
};
const pick = {
  id: "ai1",
  type: "llm",
  intent: "Pick today's featured article",
  instruction: "The title of today's featured article",
  inputs: ["{{page}}"],
  output: { name: "title", type: { type: "text" } },
};
const deps = (read: StepResult, asked: string[] = []): RunDeps => ({
  web: async (_step: ActionStep) => read,
  fs: async () => ({ ok: true }),
  script: async () => ({ ok: true }),
  llm: async (step) => {
    asked.push(step.id);
    return { ok: true, value: "2026 in railway transportation" };
  },
  fileExists: async () => true,
  webCheck: async () => true,
  approve: async () => true,
  log: () => {},
});

describe("a step with nothing to work with", () => {
  it("a read of the whole page that comes back empty fails: the page was blank or not loaded", async () => {
    const out = await runSkill(skill([page]), deps({ ok: true, value: "  " }), { inputs: {} });
    expect(out).toMatchObject({ status: "failed", failedStep: "s4" });
    expect(out.error).toMatch(/read nothing: the page was blank or hadn't loaded/);
  });

  it("a read of one control may be empty (an empty cell is a value)", async () => {
    const cell = { ...page, target: { role: "cell", name: "Total", fallbacks: [] } };
    expect((await runSkill(skill([cell]), deps({ ok: true, value: "" }), { inputs: {} })).status).not.toBe("failed");
  });

  it("an AI step whose inputs are all empty doesn't run: it would answer from nothing", async () => {
    const asked: string[] = [];
    const empty = { ...page, target: { role: "region", name: "Featured", fallbacks: [] } };
    const out = await runSkill(skill([empty, pick]), deps({ ok: true, value: "" }, asked), { inputs: {} });
    expect(out).toMatchObject({ status: "failed", failedStep: "ai1" });
    expect(out.error).toMatch(/nothing to work from: its inputs are empty \(\{\{page\}\}\)/);
    expect(asked).toEqual([]);
  });

  it("an AI step with something to read runs", async () => {
    const asked: string[] = [];
    const out = await runSkill(
      skill([page, pick]),
      deps({ ok: true, value: "Today's featured article: Thuggee" }, asked),
      {
        inputs: {},
      },
    );
    expect(out.status).toBe("succeeded");
    expect(asked).toEqual(["ai1"]);
  });

  it("a page that won't open says the address it tried, when that address was built from a value", async () => {
    const open = {
      id: "s2",
      type: "action",
      intent: "Open today's featured article",
      channel: "web",
      action: "navigate",
      args: { url: "https://en.wikipedia.org{{featured_url}}" },
    };
    const s = Skill.parse({
      id: "t",
      name: "t",
      version: 1,
      description: { goal: "t" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand", inputs: { featured_url: { type: { type: "text" } } } },
        open,
      ],
    });
    const out = await runSkill(s, deps({ ok: false, error: "navigation failed: net::ERR_NAME_NOT_RESOLVED" }), {
      inputs: { featured_url: "https://en.wikipedia.org/wiki/Thuggee" },
    });
    expect(out.error).toBe(
      "navigation failed: net::ERR_NAME_NOT_RESOLVED (it tried to open https://en.wikipedia.orghttps://en.wikipedia.org/wiki/Thuggee)",
    );
  });
});
