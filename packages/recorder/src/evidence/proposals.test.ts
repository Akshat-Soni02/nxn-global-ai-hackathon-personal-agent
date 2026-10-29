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
    // The whole date, year too: a year kept as text types the wrong year from January.
    expect(dateIn("20 Oct 2026", TUESDAY)?.text).toBe("{{today|D MMM YYYY}}");
    expect(dateIn("Oct 20, 2026", TUESDAY)?.text).toBe("{{today|MMM D, YYYY}}");
    expect(dateIn("Due 20 October 2026", TUESDAY)?.text).toBe("Due {{today|D MMMM YYYY}}");
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
      itemText: "Ana · Daily KPIs - w/c 19 Oct · Hi All, numbers attached",
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
    // Checkpoint 4: for "the newest video" it would fix today's one in place; the agent is told when it fits.
    expect(open?.summary).toMatch(/only if it is always this same page/i);
  });

  it("offers the item's place in its list when the link's own selector names the item (N4)", async () => {
    const JOBS = "https://jobs.example.com/";
    const { proposals } = await propose([
      step("navigate", { url: JOBS, events: [] }),
      step("click", {
        url: JOBS,
        target: el("link", "Eventual job", JOBS),
        navigatesTo: `${JOBS}j/7421`,
        list: {
          container: { tag: "ul", url: JOBS, fallbacks: [], selectors: { css: "ul.jobs" } },
          index: 0,
          count: 30,
          itemText: "Eventual · Senior engineer · Remote",
          place: "ul.jobs > li:nth-of-type(1) > a",
        },
      }),
    ]);
    const same = proposals.find((p) => p.kind === "same_place");
    expect(same?.edits[0]).toMatchObject({ with: { target: { fallbacks: ["ul.jobs > li:nth-of-type(1) > a"] } } });
  });

  it("opens a document directly when the recording reached it through Drive's list into a new tab (Oct 25)", async () => {
    const DRIVE = "https://drive.google.com/drive/my-drive";
    const RECENT = "https://drive.google.com/drive/recent";
    const DOC = "https://docs.google.com/spreadsheets/d/1XyZexampleDocIdk/edit";
    const { skill, proposals } = await propose([
      step("navigate", { url: DRIVE, events: [] }),
      step("click", { url: DRIVE, target: el("link", "Recent items", DRIVE), navigatesTo: RECENT }),
      step("click", {
        url: RECENT,
        target: el("gridcell", "Ycomb jobs Google Sheets", RECENT),
        navigatesTo: DOC,
        opensTab: 2,
        list: {
          container: { tag: "div", url: RECENT, role: "grid", fallbacks: [], selectors: {} },
          index: 0,
          count: 12,
          itemText: "Ycomb jobs",
          // Its place in the list (N4): still the file opened, never "the top recent file".
          place: "div[role=grid] > div:nth-of-type(1)",
        },
      }),
      step("type", { url: DOC, tabId: 2, value: "25 Oct", target: el("textbox", "A4", DOC), cell: { ref: "A4" } }),
    ]);
    const open = proposals.find((p) => p.kind === "open_directly");
    expect(open?.steps).toEqual(["s1", "s2", "s3"]);
    expect(open?.summary).toMatch(/same file every time/);
    // Not offered as "the first file in the list" too, by either proposal.
    expect(proposals.filter((p) => p.kind === "list_item" || p.kind === "same_place")).toEqual([]);
    const applied = applyEdits(skill, open?.edits ?? []);
    expect(applied.ok && findStep(applied.skill, "s1")).toMatchObject({ action: "navigate", args: { url: DOC } });
  });

  it("notes a value you said is always the same", async () => {
    const { proposals } = await propose(
      [step("navigate", { events: [] }), step("type", { value: "NX-202", target: el("textbox", "Project") })],
      ["The project is always NX-202."],
    );
    expect(proposals.find((p) => p.kind === "constant")?.summary).toContain("NX-202");
  });

  it("doesn't open a page directly when the click's destination isn't known, or when it picked an item of a list", async () => {
    const inbox = await propose([
      step("navigate", { events: [] }),
      step("click", { target: el("link", "Daily KPIs") }), // an older recording: no destination kept
      step("copy", { value: "4,928", target: el("cell", "Tickets") }),
    ]);
    expect(inbox.proposals.filter((p) => p.kind === "open_directly")).toEqual([]);
    const picked = await propose([
      step("navigate", { url: "https://github.com/o/r/issues", events: [] }),
      step("click", {
        url: "https://github.com/o/r/issues",
        target: el("link", "Evolving the interface"),
        navigatesTo: "https://github.com/o/r/issues/334285",
        list: {
          container: { tag: "ul", url: MAIL, role: "list", fallbacks: [], selectors: {} },
          index: 0,
          count: 25,
          itemText: "Evolving the interface #334285 opened on Sep 3",
        },
      }),
      step("copy", {
        url: "https://github.com/o/r/issues/334285",
        value: "Evolving",
        target: el("heading", "Evolving"),
      }),
    ]);
    expect(picked.proposals.filter((p) => p.kind === "open_directly")).toEqual([]);
  });

  it("finds a repeat of one step only when it is done for items of a list or rows, not two keys or two typings", async () => {
    const { proposals } = await propose([
      step("navigate", { events: [] }),
      step("press", { value: "g", target: el("main", "Repo") }),
      step("press", { value: "i", target: el("main", "Repo") }),
    ]);
    expect(proposals.filter((p) => p.kind === "repeat")).toEqual([]);
  });

  it("proposes a list item only for content lists, not page chrome or a few header blocks", async () => {
    const list = (role: string | undefined, count: number, itemText: string) => ({
      container: { tag: "div", url: MAIL, ...(role ? { role } : {}), fallbacks: [], selectors: {} },
      index: 1,
      count,
      itemText,
    });
    const { proposals } = await propose([
      step("navigate", { events: [] }),
      step("click", {
        target: el("link", "Issues"),
        list: list("list", 8, "Issues 5k+ ( 5k+ )"),
        navigatesTo: `${MAIL}/i`,
      }),
      step("copy", {
        value: "Subject",
        target: el("heading", "Subject"),
        list: list(undefined, 4, "Print all In new window One day left to enter"),
      }),
    ]);
    expect(proposals.filter((p) => p.kind === "list_item")).toEqual([]);
  });
});
