import type { InboxItem, RecordingView } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import { progressOf, questionsFor, waitingNote } from "./questions.ts";

const item = (id: string, kind: string, sessionId?: string) =>
  ({ id, kind, title: id, detail: sessionId ? { sessionId } : {}, createdAt: 0 }) as unknown as InboxItem;

describe("the Record screen's questions", () => {
  it("are this recording's, plus ones from no recording (the form from the terminal), newest last", () => {
    const items = [
      item("a", "question", "rec-1"),
      item("b", "question", "rec-2"),
      item("c", "question"),
      item("d", "approval", "rec-1"),
    ];
    expect(questionsFor(items, "rec-1").map((i) => i.id)).toEqual(["c", "a"]);
  });
});

describe("the Record screen's pointer to the Inbox (W2)", () => {
  it("says how many questions wait and where, and nothing when none do", () => {
    expect(waitingNote(0)).toBeUndefined();
    expect(waitingNote(1)).toBe("1 question is waiting for you in the Inbox.");
    expect(waitingNote(3)).toBe("3 questions are waiting for you in the Inbox.");
  });
});

describe("the Record screen's feed", () => {
  it("is empty, not a crash, when the daemon is older than the window and sends no lines", () => {
    const old = { phase: "compiling" } as unknown as RecordingView;
    expect(progressOf(old)).toEqual([]);
    const now = {
      phase: "compiling",
      progress: [{ at: 1, line: "Read 4 actions as 3 steps" }],
    } as unknown as RecordingView;
    expect(progressOf(now).map((p) => p.line)).toEqual(["Read 4 actions as 3 steps"]);
  });
});
