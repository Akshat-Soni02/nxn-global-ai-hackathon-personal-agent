import type { InboxItem, RecordingView } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import {
  approvalWhat,
  chromeWarning,
  modelStatus,
  progressOf,
  proposalOf,
  questionsFor,
  signInFirst,
  waitingNote,
} from "./questions.ts";

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
    // The same words for the downloaded app and the repository: no terminal command (Oct 29, a first-time user was
    // told to run pnpm setup:native-host).
    expect(chromeWarning(false)).toMatch(/Settings → Chrome.*Connect Chrome/);
    expect(chromeWarning(false)).not.toMatch(/pnpm/);
    expect(chromeWarning(true)).toBeUndefined();
    // A daemon older than the window sends no such field: no warning, and the screen still works.
    expect(chromeWarning(undefined)).toBeUndefined();
  });
});

describe("signing in before recording", () => {
  const account = (signedIn: boolean, apiUrl?: string) => ({ signedIn, ...(apiUrl ? { apiUrl } : {}) });
  it("is asked for when this build has Shadow's service, nobody is signed in and there is no key of their own", () => {
    expect(signInFirst({ account: account(false, "https://api.example"), key: { present: false } })).toBe(true);
    expect(signInFirst({ account: account(true, "https://api.example"), key: { present: true } })).toBe(false);
    // A key from .env is enough, and a build without the service has nothing to sign in to.
    expect(signInFirst({ account: account(false, "https://api.example"), key: { present: true } })).toBe(false);
    expect(signInFirst({ account: account(false), key: { present: false } })).toBe(false);
    expect(signInFirst(undefined)).toBe(false);
  });

  it("names what is missing in the sidebar: a sign-in with the service, a key without it", () => {
    expect(modelStatus({ model: "configured", service: true })).toBe("Nemotron");
    expect(modelStatus({ model: "none", service: true })).toBe("not signed in");
    expect(modelStatus({ model: "none", service: false })).toBe("no API key");
    expect(modelStatus({ model: "none" })).toBe("no API key");
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
