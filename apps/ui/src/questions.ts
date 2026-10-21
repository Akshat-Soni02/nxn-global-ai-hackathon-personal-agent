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

// The feed's lines while a recording becomes a workflow. A daemon older than the window sends none (the window's pages
// are rebuilt before the daemon restarts): then there are none to show, and the screen still works.
export function progressOf(view: RecordingView): RecordingView["progress"] {
  return view.progress ?? [];
}
