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
});
