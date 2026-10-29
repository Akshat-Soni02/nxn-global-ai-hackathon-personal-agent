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

// The warning above the goal box when Chrome's extension isn't connected: a recording started then captured nothing and
// said only "no steps were recorded". `connected` is undefined from a daemon older than the window: no warning.
export function chromeWarning(connected: boolean | undefined): string | undefined {
  if (connected !== false) return undefined;
  // Words for the downloaded app and the repository alike: Connect Chrome registers the same bridge pnpm
  // setup:native-host does, and a person who downloaded the app has no terminal command to run.
  return "Chrome isn't connected, so nothing you do in Chrome will be recorded. In Settings → Chrome press Connect Chrome, then in chrome://extensions turn on the Shadow extension and press its reload button.";
}

// Recording waits for a sign-in when this build has Shadow's service and there is no model yet: a recording made
// first could not be turned into a workflow, and the sidebar's "no API key" told a downloaded app's user to find one.
export function signInFirst(
  settings: { account: { signedIn: boolean; apiUrl?: string }; key: { present: boolean } } | undefined,
): boolean {
  if (!settings) return false;
  return Boolean(settings.account.apiUrl) && !settings.account.signedIn && !settings.key.present;
}

// The sidebar's Model row: what is missing, in the build's own terms.
export function modelStatus(health: { model?: string; service?: boolean }): string {
  if (health.model === "configured") return "Nemotron";
  return health.service ? "not signed in" : "no API key";
}

// The feed's lines while a recording becomes a workflow. A daemon older than the window sends none (the window's pages
// are rebuilt before the daemon restarts): then there are none to show, and the screen still works.
export function progressOf(view: RecordingView): RecordingView["progress"] {
  return view.progress ?? [];
}

// What an approval will do, as the run filled it in (Y9): the app tool and its arguments, or the action and its values.
// A daemon older than the window sends none: the card shows only its title, as before.
export function approvalWhat(item: InboxItem): string | undefined {
  if (item.kind !== "approval") return undefined;
  const what = (item.detail.waiting as { what?: unknown } | undefined)?.what;
  return typeof what === "string" && what.trim() ? what : undefined;
}

// A fix repair found that waits for the user's OK (A3): what it changes and what its new step will do.
export function proposalOf(item: InboxItem): { summary: string; what: string } | undefined {
  if (item.kind !== "recovery") return undefined;
  const p = (item.detail.waiting as { proposal?: { summary?: unknown; what?: unknown } } | undefined)?.proposal;
  return typeof p?.summary === "string"
    ? { summary: p.summary, what: typeof p.what === "string" ? p.what : "" }
    : undefined;
}
