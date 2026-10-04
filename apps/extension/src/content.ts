// Content script: Chrome injects it into every page and frame (manifest.json content_scripts, at document_start), and
// background.ts injects it into tabs that were already open when the extension loaded. It records only while the
// daemon has a recording session open.
// Built as a classic script (IIFE in build.mjs): Chrome never loads content scripts as ES modules, so nothing may be
// exported from this file.
import { startCapture } from "./capture.ts";

const scope = globalThis as typeof globalThis & { __taskPlayerStop?: () => void };

// Exactly one copy records per page. A copy left behind by an extension reload is orphaned (its chrome.runtime is
// gone) and Chrome may or may not give the new copy the same isolated world, so: a new copy stops any previous one,
// and an orphaned copy stops itself the first time it has something to send.
scope.__taskPlayerStop?.();

let sessionId: string | undefined;

const onMessage = (message: { type?: string; sessionId?: string }, _sender: unknown, reply: (ok: boolean) => void) => {
  if (message?.type !== "recording") return;
  sessionId = message.sessionId;
  reply(true); // tells background.ts this tab already has a live content script
};
chrome.runtime.onMessage.addListener(onMessage);

// A page opened mid-recording asks whether to capture.
chrome.runtime.sendMessage({ type: "recording?" }).then(
  (reply) => {
    sessionId = reply?.sessionId;
  },
  () => {},
);

// The background adds the id, session, tab and frame; this side only knows what happened on the page.
const stopCapture = startCapture(
  document,
  (event) => {
    if (!chrome.runtime?.id) return stop(); // orphaned: the extension was reloaded or removed
    chrome.runtime.sendMessage({ type: "record.event", at: Date.now(), ...event }).catch(() => {});
  },
  () => sessionId !== undefined,
  {
    fetchSheet: (url) =>
      chrome.runtime.sendMessage({ type: "sheet.csv", url }).then((reply: { text?: string; error?: string }) => {
        if (typeof reply?.text !== "string") throw new Error(reply?.error ?? "no reply");
        return reply.text;
      }),
  },
);

function stop() {
  stopCapture();
  try {
    chrome.runtime.onMessage.removeListener(onMessage);
  } catch {
    // orphaned runtime: nothing to remove
  }
  if (scope.__taskPlayerStop === stop) scope.__taskPlayerStop = undefined;
}
scope.__taskPlayerStop = stop;
