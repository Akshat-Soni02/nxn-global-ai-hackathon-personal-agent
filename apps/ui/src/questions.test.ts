import type { InboxItem, RecordingView } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import { approvalWhat, chromeWarning, progressOf, proposalOf, questionsFor, waitingNote } from "./questions.ts";

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

describe("the Record screen's Chrome warning", () => {
  it("says what to do when no extension is connected, and nothing when one is or the daemon doesn't say", () => {
    expect(chromeWarning(false)).toMatch(
      /Chrome isn't connected.*nothing you do in Chrome will be recorded.*chrome:\/\/extensions/,
    );
    expect(chromeWarning(true)).toBeUndefined();
    // A daemon older than the window sends no such field: no warning, and the screen still works.
    expect(chromeWarning(undefined)).toBeUndefined();
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

describe("an approval card's values (Y9)", () => {
  it("shows what the run filled in, and nothing from an older daemon or another kind", () => {
    const approval = (waiting: unknown) =>
      ({
        id: "a",
        kind: "approval",
        title: "Approve: add a row",
        detail: { waiting },
        createdAt: 0,
      }) as unknown as InboxItem;
    expect(
      approvalWhat(approval({ kind: "approval", what: 'GOOGLESHEETS_APPEND {"values":[["28 Oct","Acme"]]}' })),
    ).toBe('GOOGLESHEETS_APPEND {"values":[["28 Oct","Acme"]]}');
    expect(approvalWhat(approval({ kind: "approval" }))).toBeUndefined();
    expect(approvalWhat(item("q", "question"))).toBeUndefined();
  });
});

describe("a proposed fix on a recovery card (A3)", () => {
  it("shows what it changes and does, and nothing for a plain recovery", () => {
    const recovery = (waiting: unknown) =>
      ({ id: "r", kind: "recovery", title: "s2 failed", detail: { waiting }, createdAt: 0 }) as unknown as InboxItem;
    expect(
      proposalOf(recovery({ kind: "recovery", proposal: { summary: "done in Google Sheets", what: "s2: APPEND {}" } })),
    ).toEqual({ summary: "done in Google Sheets", what: "s2: APPEND {}" });
    expect(proposalOf(recovery({ kind: "recovery" }))).toBeUndefined();
  });
});
