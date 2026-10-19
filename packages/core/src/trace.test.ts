import { describe, expect, it } from "vitest";
import { Message } from "./messages.ts";
import { TraceEvent } from "./trace.ts";

const base = { id: "e1", sessionId: "s", at: 1, tabId: 3, frameId: 0, url: "https://a.test/" };

describe("the trace", () => {
  it("reads an event from the old extension exactly as before", () => {
    const old = { ...base, event: "click", target: { tag: "a", url: "https://a.test/", fallbacks: [], selectors: {} } };
    expect(TraceEvent.parse(old)).toEqual(old);
  });

  it("keeps the new facts: what a click did, its list position, its point, the sheet cell, how a copy was made", () => {
    const click = TraceEvent.parse({
      ...base,
      event: "click",
      cid: "c1",
      newTab: true,
      point: { x: 10, y: 20, dpr: 2, box: { x: 0, y: 0, w: 100, h: 30 } },
      list: {
        container: { tag: "ul", url: "https://a.test/", fallbacks: [], selectors: {} },
        index: 0,
        count: 30,
        itemText: "Eventual",
      },
      cell: { ref: "B3", value: "4,928", sheet: "KPI" },
    });
    expect(click).toMatchObject({ cid: "c1", newTab: true, list: { index: 0, count: 30 }, cell: { ref: "B3" } });
    const effect = TraceEvent.parse({
      ...base,
      event: "effect",
      of: "c1",
      effect: { changed: "large", navigated: true },
    });
    expect(effect.effect).toEqual({ changed: "large", navigated: true });
    expect(TraceEvent.parse({ ...base, event: "copy", value: "x", via: "button" }).via).toBe("button");
    for (const event of ["select_text", "window_focus", "fs_remove"]) {
      expect(TraceEvent.safeParse({ ...base, event }).success).toBe(true);
    }
  });

  it("carries a picture's tab and the ledger line for one not taken", () => {
    expect(
      Message.parse({ id: "m", type: "record.shot", sessionId: "s", eventId: "e1", at: 1, tabId: 3, takenAt: 2 }),
    ).toMatchObject({ tabId: 3, takenAt: 2 });
    expect(
      Message.safeParse({
        id: "m",
        type: "record.shot_skip",
        sessionId: "s",
        eventId: "e1",
        at: 1,
        reason: "rate-limit",
      }).success,
    ).toBe(true);
  });
});
