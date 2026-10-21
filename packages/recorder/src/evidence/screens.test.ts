import type { TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { type Picture, screensOf } from "./screens.ts";

const line = (text: string, x: number, y: number) => ({ text, box: { x, y, w: 60, h: 30 } });
const picture = (eventId: string, at: number, texts: [string, number, number][], tabId = 1): Picture => ({
  eventId,
  at,
  tabId,
  lines: texts.map(([t, x, y]) => line(t, x, y)),
});

describe("what a step saw", () => {
  const save: NormalisedStep = {
    index: 1,
    kind: "click",
    at: 1_000,
    tabId: 1,
    events: ["c1"],
    point: { x: 238, y: 90, dpr: 2, box: { x: 215, y: 80, w: 46, h: 22 } },
    target: { tag: "button", url: "", role: "button", name: "Save", fallbacks: [], selectors: {} },
  };
  const before = picture("p0", 900, [
    ["Amount", 30, 170],
    ["Save", 450, 168],
    ["New expense", 20, 60],
  ]);
  const after = picture("c1", 1_000, [
    ["Amount", 30, 170],
    ["Save", 450, 168],
    ["Saved amount 1,234", 20, 240],
  ]);
  const elsewhere = picture("p9", 950, [["Inbox", 10, 10]], 2);

  it("finds the words near the click in the picture before it, and what appeared after it", () => {
    const [screen] = screensOf([save], [after, before, elsewhere], [] as TraceEvent[]);
    expect(screen).toMatchObject({ before: "p0", after: "c1", appeared: ["Saved amount 1,234"] });
    expect(screen?.near[0]).toBe("Save");
  });

  it("finds nothing when there were no pictures", () => {
    expect(screensOf([save], [], [])).toEqual([{ near: [], appeared: [] }]);
  });

  it("orders pictures by when they were taken, and leaves out Shadow's own Stop pill", () => {
    const typed: NormalisedStep = { index: 1, kind: "type", at: 1_000, tabId: 1, events: ["t1"] };
    const saved: NormalisedStep = { ...save, index: 2, at: 1_002, events: ["c2"] };
    const empty = {
      ...picture("p0", 900, [
        ["Amount", 30, 170],
        ["• Stop • 0:59", 900, 900],
      ]),
      takenAt: 950,
    };
    // The typing's picture was taken after Save was clicked (typing is kept when the field loses focus).
    const typedShot = {
      ...picture("t1", 1_000, [
        ["Amount 1,234", 30, 170],
        ["Saved amount 1,234", 20, 240],
        ["• Stop • 1:00", 900, 900],
      ]),
      takenAt: 1_400,
    };
    const savedShot = {
      ...picture("c2", 1_002, [
        ["Amount 1,234", 30, 170],
        ["Saved amount 1,234", 20, 240],
      ]),
      takenAt: 1_500,
    };
    const [forTyping, forSave] = screensOf([typed, saved], [empty, typedShot, savedShot], []);
    expect(forTyping?.appeared).toEqual([]);
    expect(forSave?.appeared).toEqual(["Amount 1,234", "Saved amount 1,234"]);
  });

  it("compares a step's last picture with its own first when nothing was pictured before it", () => {
    const copy: NormalisedStep = { index: 0, kind: "copy", at: 2_000, tabId: 1, events: ["k1", "k2"] };
    const first = { ...picture("k1", 1_000, [["Table", 0, 0]]), takenAt: 1_100 };
    const last = {
      ...picture("k2", 2_000, [
        ["Table", 0, 0],
        ["Copied", 0, 40],
      ]),
      takenAt: 2_100,
    };
    expect(screensOf([copy], [first, last], [])[0]?.appeared).toEqual(["Copied"]);
  });
});
