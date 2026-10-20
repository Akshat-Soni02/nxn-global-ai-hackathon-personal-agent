import type { ElementDescriptor, TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { normalise, normaliseAll } from "./normalise.ts";
import { skeletonOf } from "./skeleton.ts";

const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const SHEET = "https://docs.google.com/spreadsheets/d/ID/edit#gid=0";
let n = 0;
const ev = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${++n}`,
  sessionId: "s",
  at,
  event,
  tabId: 1,
  frameId: 0,
  url: MAIL,
  ...extra,
});
const el = (role: string, name: string, extra: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  tag: role === "link" ? "a" : "div",
  url: MAIL,
  role,
  name,
  fallbacks: [],
  selectors: { css: `[aria-label='${name}']` },
  ...extra,
});
const start = () => ev("navigate", 0, { transition: "typed" });

describe("steps keep what capture saw", () => {
  it("keeps what a click did, where it sat in a list and where it landed", () => {
    const list = {
      container: { tag: "table", url: MAIL, fallbacks: [], selectors: {} },
      index: 0,
      count: 50,
      itemText: "Daily KPIs - w/c 19 Oct",
    };
    const point = { x: 10, y: 20, dpr: 2, box: { x: 0, y: 10, w: 100, h: 20 } };
    const steps = normalise([
      start(),
      ev("click", 1_000, { target: el("link", "Daily KPIs - w/c 19 Oct"), cid: "c1", list, point }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "large", navigated: true } }),
    ]);
    expect(steps.at(-1)).toMatchObject({
      kind: "click",
      effect: { changed: "large", navigated: true },
      list: { index: 0, count: 50 },
      point: { x: 10, dpr: 2 },
    });
  });

  it("says which tab a click opened", () => {
    const steps = normalise([
      start(),
      ev("click", 1_000, { target: el("link", "Product Engineer"), cid: "c2" }),
      ev("tab_open", 1_020, { tabId: 2, openerTabId: 1, url: "" }),
      ev("navigate", 1_500, { tabId: 2, url: "https://www.ycombinator.com/companies/x/jobs/1", transition: "link" }),
    ]);
    expect(steps.find((s) => s.kind === "click")).toMatchObject({ opensTab: 2 });
  });

  it("turns single keys and shortcuts into presses with their modifiers", () => {
    const steps = normalise([
      start(),
      ev("key", 2_000, { value: "e", target: el("main", "Inbox") }),
      ev("key", 4_000, { value: "Enter", modifiers: ["cmd"], target: el("textbox", "Message body") }),
    ]);
    expect(steps.filter((s) => s.kind === "press").map((s) => [s.value, s.modifiers])).toEqual([
      ["e", undefined],
      ["Enter", ["cmd"]],
    ]);
    const presses = skeletonOf(steps).draft.steps.filter((s) => s.action === "press");
    expect(presses.map((s) => s.args)).toEqual([{ key: "e" }, { key: "Enter", modifiers: ["cmd"] }]);
  });

  it("makes an Enter that emptied a chat box a send that needs your OK, but not Enter in a sheet's cell", () => {
    const sent = normalise([
      start(),
      ev("key", 1_000, { value: "Enter", target: el("textbox", "Message"), cid: "k1" }),
      ev("effect", 1_700, { of: "k1", effect: { changed: "small", emptied: true } }),
    ]);
    expect(sent.at(-1)).toMatchObject({ kind: "press", sends: true });
    expect(skeletonOf(sent).draft.steps.at(-1)).toMatchObject({ action: "press", requires_approval: true });
    const cell = normalise([
      ev("navigate", 0, { url: SHEET, transition: "typed" }),
      ev("key", 1_000, { url: SHEET, value: "Enter", target: el("textbox", "A4", { url: SHEET }), cid: "k2" }),
      ev("effect", 1_700, { url: SHEET, of: "k2", effect: { changed: "small", emptied: true } }),
    ]);
    expect(cell.at(-1)?.sends).toBeUndefined();
    expect(skeletonOf(cell).draft.steps.at(-1)).toMatchObject({ action: "press", requires_approval: false });
  });

  it("keeps a Back", () => {
    const steps = normalise([
      start(),
      ev("navigate", 9_000, { url: "https://example.com/list", transition: "link", back: true }),
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: "navigate", back: true });
  });
});

describe("noise, removed and listed with its reason (spec 2.2)", () => {
  const p = { tag: "p", url: MAIL, text: "GDP fluctuates", fallbacks: [], selectors: { css: "#intro" } };
  const header = { tag: "div", url: MAIL, text: "Print all In new window", fallbacks: [], selectors: { css: "#h" } };
  const body = { tag: "body", url: MAIL, fallbacks: [], selectors: {} };

  it("makes a double click and the copy after it one read step", () => {
    const { steps, noise } = normaliseAll([
      start(),
      ev("click", 1_000, { target: p, cid: "c1" }),
      ev("select_text", 1_010, { target: p, value: "fluctuations" }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "none" } }),
      ev("copy", 3_000, { target: p, value: "fluctuations", via: "keyboard" }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "copy"]);
    expect(steps[1]?.events).toHaveLength(3);
    expect(noise).toEqual([]);
  });

  it("lists a selection never copied, with the double click that made it", () => {
    const { steps, noise } = normaliseAll([
      start(),
      ev("click", 1_000, { target: p, cid: "c1" }),
      ev("select_text", 1_010, { target: p, value: "fluctuations" }),
      ev("click", 5_000, { target: el("button", "Save"), cid: "c2" }),
      ev("effect", 5_700, { of: "c2", effect: { changed: "small" } }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "click"]);
    expect(noise).toMatchObject([
      { events: [expect.any(String), expect.any(String)], why: "selected text but didn't copy it" },
    ]);
  });

  it("lists a click that changed nothing (Gmail's header), unless the next action came too soon to tell", () => {
    const quiet = normaliseAll([
      start(),
      ev("click", 1_000, { target: header, cid: "c1" }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "none" } }),
      ev("click", 6_000, { target: el("button", "Archive"), cid: "c2" }),
      ev("effect", 6_700, { of: "c2", effect: { changed: "large" } }),
    ]);
    expect(quiet.steps.map((s) => s.target?.name ?? s.kind)).toEqual(["navigate", "Archive"]);
    expect(quiet.noise).toMatchObject([{ why: "changed nothing on the page, and nothing was copied from it" }]);
    const soon = normaliseAll([
      start(),
      ev("click", 1_000, { target: header, cid: "c1" }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "none" } }),
      ev("click", 1_300, { target: el("button", "Archive"), cid: "c2" }),
    ]);
    expect(soon.steps).toHaveLength(3);
  });

  it("keeps a click with no recorded effect (an older recording)", () => {
    const { steps, noise } = normaliseAll([start(), ev("click", 1_000, { target: header })]);
    expect(steps).toHaveLength(2);
    expect(noise).toEqual([]);
  });

  it("lists switching to a tab and away without doing anything there", () => {
    const { noise } = normaliseAll([
      start(),
      ev("tab_switch", 1_000, { tabId: 2 }),
      ev("tab_switch", 2_000, { tabId: 1 }),
      ev("click", 3_000, { target: el("button", "Save") }),
    ]);
    expect(noise).toMatchObject([{ why: "switched to a tab and away again without doing anything there" }]);
  });

  it("lists the click a page made after your keys (GitHub's g i); the keys are the steps", () => {
    const { steps, noise } = normaliseAll([
      start(),
      ev("key", 1_000, { value: "g", target: body }),
      ev("key", 1_300, { value: "i", target: body }),
      ev("click", 1_320, { target: el("link", "Issues"), synthetic: true }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "press", "press"]);
    expect(noise).toMatchObject([{ why: "the page clicked it after the keys you pressed" }]);
  });

  it("lists what was dropped quietly before: a drawn click and a click that only focused a field", () => {
    const grid = { tag: "div", url: SHEET, fallbacks: [], selectors: {} };
    const { noise } = normaliseAll([
      ev("navigate", 0, { url: SHEET, transition: "typed" }),
      ev("click", 1_000, { url: SHEET, target: grid, drawn: true, cell: { ref: "C3" } }),
      ev("click", 4_000, { target: el("textbox", "Search mail") }),
    ]);
    expect(noise.map((x) => x.why)).toEqual([
      "a click on a drawn grid: its cell goes with the copy or typing after it",
      "only put the cursor in a field: the typing after it is the step",
    ]);
  });
});
