// The questions the Record screen shows: this recording's, and those that belong to no recording (the form asked
// from the terminal). Before, every open question showed, another recording's too.
import type { InboxItem, RecordingView } from "@shadow/daemon/src/types.ts";

export function questionsFor(items: InboxItem[], sessionId: string | undefined): InboxItem[] {
  return items
    .filter((i) => i.kind === "question")
    .filter((i) => {
      const of = (i.detail as { sessionId?: unknown }).sessionId;
      return of === undefined || of === sessionId;
    })
    .reverse();
}

// What the Record screen says instead of showing the questions (W2): they are answered in the Inbox, and the Record
// screen keeps to the steps of what is happening so you don't feel in the dark.
export function waitingNote(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1
    ? "1 question is waiting for you in the Inbox."
    : `${count} questions are waiting for you in the Inbox.`;
}

// The feed's lines while a recording becomes a workflow. A daemon older than the window sends none (the window's pages
// are rebuilt before the daemon restarts): then there are none to show, and the screen still works.
export function progressOf(view: RecordingView): RecordingView["progress"] {
  return view.progress ?? [];
}
