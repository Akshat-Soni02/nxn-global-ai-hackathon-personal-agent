import { describe, expect, it } from "vitest";
import { narrationOf } from "../narration.ts";
import type { NormalisedStep } from "../normalise.ts";
import { timelineOf, timelineSlice } from "./timeline.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/ID/edit";
const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const steps: NormalisedStep[] = [
  { index: 0, kind: "navigate", at: 3_000, tabId: 1, url: SHEET, events: [] },
  {
    index: 1,
    kind: "click",
    at: 12_000,
    tabId: 2,
    url: MAIL,
    events: ["e2"],
    target: { tag: "div", url: MAIL, role: "link", name: "Daily KPIs", fallbacks: [], selectors: {} },
    list: { container: { tag: "table", url: MAIL, fallbacks: [], selectors: {} }, index: 0, count: 50 },
    effect: { changed: "large" },
  },
];

describe("one timeline", () => {
  it("puts tabs, steps by draft id, speech and what was left out in time order", () => {
    const lines = timelineOf({
      start: 0,
      steps,
      ids: [["s1"], ["s2"]],
      classes: ["go", "reveal"],
      tabs: [
        { id: 1, name: "KPI Sheet", firstUrl: SHEET, preexisting: true },
        { id: 2, name: "Gmail", firstUrl: MAIL, openedBy: 1 },
      ],
      screens: [
        { near: [], appeared: [] },
        { near: [], appeared: ["Hi All,"] },
      ],
      said: [{ at: 9_000, text: "every day I get KPI emails" }],
      noise: [
        {
          events: ["e3"],
          at: 14_000,
          what: 'clicked "Print all"',
          why: "changed nothing on the page, and nothing was copied from it",
        },
      ],
    });
    expect(lines.map((l) => l.text)).toEqual([
      '00:00  tab "KPI Sheet": docs.google.com/spreadsheets/d/ID/edit (open before Record)',
      "00:03  s1 [KPI Sheet] go: open docs.google.com/spreadsheets/d/ID/edit",
      '00:09  said: "every day I get KPI emails"',
      '00:12  tab "Gmail": mail.google.com/mail/u/0/#inbox (opened from "KPI Sheet")',
      '00:12  s2 [Gmail] reveal: click link "Daily KPIs": item 1 of 50; changed the page (large)',
      '00:14  (left out) clicked "Print all": changed nothing on the page, and nothing was copied from it',
    ]);
    expect(timelineSlice(lines, "s2", "s2").map((l) => l.step)).toEqual(["s2"]);
  });

  it("names the draft's steps in the narration, not the recorded order", () => {
    const said = [{ at: 12_500, until: 12_900, kind: "said" as const, text: "always the newest one" }];
    expect(narrationOf(steps, said, [["s1"], ["s2", "s3"]])).toEqual([{ during: "s2", said: "always the newest one" }]);
  });
});
