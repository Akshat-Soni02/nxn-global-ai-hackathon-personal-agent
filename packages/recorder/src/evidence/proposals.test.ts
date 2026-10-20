import { applyEdits, findStep } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { compile } from "../compile.ts";
import type { NormalisedStep } from "../normalise.ts";
import { dateIn, proposalsOf } from "./proposals.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/DOC1/edit#gid=0";
const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const TUESDAY = new Date(2026, 9, 20, 10);
const el = (role: string, name: string, url = MAIL) => ({
  tag: "div",
  url,
  role,
  name,
  fallbacks: [],
  selectors: { css: `[aria-label='${name}']` },
});
let k = 0;
const step = (kind: NormalisedStep["kind"], extra: Partial<NormalisedStep>): NormalisedStep => ({
  index: 0,
  kind,
  at: ++k * 1_000,
  tabId: 1,
  url: MAIL,
  events: [`e${k}`],
  ...extra,
});
const indexed = (steps: NormalisedStep[]) => steps.map((s, index) => ({ ...s, index }));
async function propose(raw: NormalisedStep[], said: string[] = [], goal = "g") {
  const steps = indexed(raw);
  const { skill, base } = await compile(steps);
  const proposals = proposalsOf({
    steps,
    skill,
    idsByStep: base.idsByStep,
    goal,
    said: said.map((text, at) => ({ at, text })),
    recordedOn: TUESDAY,
  });
  return { skill, proposals };
}

describe("dates", () => {
  it("finds the recording day in what was typed, in the format typed", () => {
    expect(dateIn("20 Oct", TUESDAY)?.text).toBe("{{today|D MMM}}");
    expect(dateIn("Daily KPIs - w/c 19 Oct", TUESDAY)?.text).toBe("Daily KPIs - w/c {{week_start|D MMM}}");
    expect(dateIn("19 Oct", TUESDAY)?.text).toBe("{{today-1|D MMM}}");
    expect(dateIn("20/10/2026", TUESDAY)?.text).toBe("{{today|DD/MM/YYYY}}");
    expect(dateIn("12 Oct", TUESDAY)).toBeUndefined();
    expect(dateIn("120 Oct", TUESDAY)).toBeUndefined();
  });

  it("prepares the change to type today's date next time", async () => {
    const { skill, proposals } = await propose([
      step("navigate", { url: SHEET, events: [] }),
      step("type", { url: SHEET, value: "20 Oct", target: el("textbox", "A4", SHEET), cell: { ref: "A4" } }),
    ]);
    const date = proposals.find((p) => p.kind === "date");
    expect(date?.summary).toContain("{{today|D MMM}}");
    const applied = applyEdits(skill, date?.edits ?? []);
    expect(applied.ok && findStep(applied.skill, date?.steps[0] ?? "")).toMatchObject({
      args: { text: "{{today|D MMM}}" },
    });
  });
});

describe("other generalisations", () => {
  it("notes a click on an item of a list, but not on a navigation bar", async () => {
    const list = (role: string) => ({
      container: { tag: "table", url: MAIL, role, fallbacks: [], selectors: { css: "table.F" } },
      index: 0,
      count: 50,
      itemText: "Daily KPIs",
    });
    const { proposals } = await propose([
      step("navigate", { events: [] }),
      step("click", { target: el("link", "Daily KPIs"), list: list("grid"), effect: { changed: "large" } }),
      step("click", { target: el("link", "Sent"), list: list("navigation"), navigatesTo: `${MAIL}/sent` }),
    ]);
    expect(proposals.filter((p) => p.kind === "list_item").map((p) => p.summary)).toEqual([
      expect.stringContaining("item 1 of 50"),
    ]);
  });

  it("notes typing into the first empty row of a sheet, which can't run yet", async () => {
    const { proposals } = await propose([
      step("navigate", { url: SHEET, events: [] }),
      step("copy", {
        url: SHEET,
        value: "1,234",
        context: { sheet: "https://docs.google.com/spreadsheets/d/DOC1/export?format=csv&gid=0", rows: 2 },
      }),
      step("type", { url: SHEET, value: "Lunch", target: el("textbox", "B4", SHEET), cell: { ref: "B4" } }),
    ]);
    expect(proposals.find((p) => p.kind === "next_empty_row")).toMatchObject({ runnable: false, edits: [] });
  });

  it("notes the same steps done for two items of a list", async () => {
    const item = (index: number) => ({
      container: { tag: "table", url: MAIL, role: "grid", fallbacks: [], selectors: { css: "table.F" } },
      index,
      count: 50,
    });
    const { proposals } = await propose([
      step("navigate", { events: [] }),
      step("click", { target: el("link", "KPIs Mon"), list: item(0), effect: { changed: "large" } }),
      step("copy", { value: "4928", target: el("cell", "Tickets") }),
      step("click", { target: el("link", "KPIs Tue"), list: item(1), effect: { changed: "large" } }),
      step("copy", { value: "5011", target: el("cell", "Tickets") }),
    ]);
    expect(proposals.find((p) => p.kind === "repeat")?.summary).toContain("2 times");
  });

  it("prepares opening a page directly instead of the clicks that reached it", async () => {
    const { skill, proposals } = await propose([
      step("navigate", { url: "https://drive.google.com/drive/home", events: [] }),
      step("click", {
        url: "https://drive.google.com/drive/home",
        target: el("link", "Reports"),
        navigatesTo: "https://drive.google.com/drive/folders/reports",
      }),
      step("click", {
        url: "https://drive.google.com/drive/folders/reports",
        target: el("button", "New"),
        effect: { changed: "small", opened: "menu" },
      }),
    ]);
    const open = proposals.find((p) => p.kind === "open_directly");
    expect(open?.steps).toEqual(["s1", "s2"]);
    expect(applyEdits(skill, open?.edits ?? []).ok).toBe(true);
  });

  it("notes a value you said is always the same", async () => {
    const { proposals } = await propose(
      [step("navigate", { events: [] }), step("type", { value: "NX-202", target: el("textbox", "Project") })],
      ["The project is always NX-202."],
    );
    expect(proposals.find((p) => p.kind === "constant")?.summary).toContain("NX-202");
  });
});
