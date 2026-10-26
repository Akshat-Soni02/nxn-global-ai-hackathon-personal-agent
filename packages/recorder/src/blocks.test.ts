import { isGroup, Skill, type Step } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { blocksOf, clean, nodeCount, pageName } from "./blocks.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/1XyZexampleDocId/edit";
const nav = (id: string, url: string) => ({
  id,
  type: "action",
  intent: `open ${url}`,
  channel: "web",
  action: "navigate",
  args: { url },
});
const click = (id: string, name: string) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "link", name, fallbacks: [] },
});
const copy = (id: string, name: string) => ({
  id,
  type: "action",
  intent: "copy",
  channel: "web",
  action: "extract",
  target: { role: "heading", fallbacks: [] },
  output: { name, type: { type: "text" } },
});
const type = (id: string, text: string) => ({
  id,
  type: "action",
  intent: "type",
  channel: "web",
  action: "type",
  target: { role: "combobox", name: "A4", fallbacks: [] },
  args: { text },
});
const workflow = (steps: unknown[]) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [{ id: "start", type: "trigger", intent: "t" }, ...steps],
  });
const names = (steps: Step[]) => steps.filter((s) => s.type !== "trigger").map((s) => (isGroup(s) ? s.intent : s.id));

describe("blocks by code (the YC recording, Oct 26: 33 steps → 10 nodes)", () => {
  it("groups what was done on a page, named for what it does and where, never by address", () => {
    const w = blocksOf(
      workflow([
        nav("s2", "https://drive.google.com/drive/my-drive"),
        click("s4", "Recent"),
        click("s5", "Ycomb jobs Google Sheets More info (Option + →)"),
        nav("s6", "https://jobs.example.com/jobs"),
        nav("s7", "https://jobs.example.com/companies/acme"),
        copy("s8", "company"),
        nav("s9", SHEET),
        type("s10", "{{company}}"),
      ]),
      { titles: new Map([[SHEET, "Ycomb jobs - Google Sheets"]]) },
    );
    expect(names(w.steps)).toEqual(["Open Ycomb jobs", "Copy from jobs.example.com", "Fill in Ycomb jobs"]);
    expect(nodeCount(w.steps)).toBe(3);
  });

  it("leaves AI steps, loops and single steps as they are, and blocks inside a loop", () => {
    const w = blocksOf(
      workflow([
        nav("s1", "https://jobs.example.com/jobs"),
        {
          id: "ai1",
          type: "llm",
          intent: "pick",
          instruction: "the first 5",
          inputs: [],
          output: { name: "top", type: { type: "list", items: { type: "text" } } },
        },
        {
          id: "l1",
          type: "control",
          kind: "loop",
          intent: "each",
          over: "{{top}}",
          item: { name: "job", type: { type: "text" } },
          steps: [nav("s2", SHEET), type("s3", "{{job}}")],
        },
      ]),
    );
    expect(names(w.steps)).toEqual(["s1", "ai1", "l1"]);
    const loop = w.steps[3] as { steps: Step[] };
    expect(names(loop.steps)).toEqual(["Fill in Google Sheets"]);
  });

  it("keeps a design's own blocks, and never makes a workflow that doesn't parse", () => {
    const own = workflow([
      { id: "b1", type: "control", kind: "group", intent: "Mine", steps: [nav("s1", SHEET), type("s2", "x")] },
    ]);
    expect(names(blocksOf(own).steps)).toEqual(["Mine"]);
  });

  it("names pages by tab or app, and cleans what only a screen reader needed", () => {
    expect(pageName(SHEET)).toBe("Google Sheets");
    expect(pageName(SHEET, { titles: new Map([[SHEET, "docs.google.com"]]) })).toBe("Google Sheets");
    expect(pageName("https://www.example.org/a")).toBe("example.org");
    expect(clean("Ycomb jobs Google Sheets More info (Option + →)")).toBe("Ycomb jobs");
  });
});
