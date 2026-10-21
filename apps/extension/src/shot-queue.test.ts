import { describe, expect, it } from "vitest";
import { GAP_MS, type ShotJob, ShotQueue } from "./shot-queue.ts";

const job = (eventId: string, kind: string, at: number): ShotJob => ({ tabId: 1, eventId, kind, at, due: at + 400 });

describe("the picture queue", () => {
  it("keeps three, drops the least telling first, and takes them in order with a gap", () => {
    const q = new ShotQueue(3);
    expect(q.add(job("nav", "navigate", 0))).toBeUndefined();
    expect(q.add(job("c1", "click", 10))).toBeUndefined();
    expect(q.add(job("k1", "copy", 20))).toBeUndefined();
    expect(q.add(job("t1", "type", 30))?.eventId).toBe("nav"); // a navigation is the least telling of the four
    expect(q.next(500, Number.NEGATIVE_INFINITY)?.eventId).toBe("c1");
    expect(q.next(600, 500)).toBeUndefined(); // too soon after the last picture
    expect(q.next(500 + GAP_MS, 500)?.eventId).toBe("k1");
    expect(q.clear().map((j) => j.eventId)).toEqual(["t1"]);
  });
});
