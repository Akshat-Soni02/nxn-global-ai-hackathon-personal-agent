// Content script: Chrome injects it into every page and frame (manifest.json content_scripts, at document_start), and
// background.ts injects it into tabs that were already open when the extension loaded. It records only while the
// daemon has a recording session open. The top frame also shows the floating Record / Stop button (button.ts) while the
// daemon is running.
// Built as a classic script (IIFE in build.mjs): Chrome never loads content scripts as ES modules, so nothing may be
// exported from this file.
import { type Button, type ButtonState, mountButton, type Position } from "./button.ts";
import { startCapture } from "./capture.ts";

const scope = globalThis as typeof globalThis & { __taskPlayerStop?: () => void };

// Exactly one copy records per page. A copy left behind by an extension reload is orphaned (its chrome.runtime is
// gone) and Chrome may or may not give the new copy the same isolated world, so: a new copy stops any previous one,
// and an orphaned copy stops itself the first time it has something to send.
scope.__taskPlayerStop?.();

let sessionId: string | undefined;

// Top frame only: one button per tab, not one per iframe. background.ts sends no button state to replay's own window.
// The button is optional: if it can't be drawn on a page (an SVG or XML file opened directly, or anything unforeseen),
// that page gets no button and is still recorded.
const POSITION_KEY = "buttonPosition";
const button = window.top === window ? tryButton() : undefined;
const show = (state: ButtonState | undefined) => {
  try {
    button?.update(state);
  } catch (error) {
    console.warn("[task player] button failed", error);
  }
};

type FromBackground = { type?: string; sessionId?: string; ui?: ButtonState };
const onMessage = (message: FromBackground, _sender: unknown, reply: (ok: boolean) => void) => {
  if (message?.type !== "recording") return;
  sessionId = message.sessionId;
  reply(true); // tells background.ts this tab already has a live content script
  show(message.ui);
};
chrome.runtime.onMessage.addListener(onMessage);

// A page opened mid-recording asks whether to capture, and what the button shows.
chrome.runtime.sendMessage({ type: "recording?" }).then(
  (reply: FromBackground | undefined) => {
    sessionId = reply?.sessionId;
    show(reply?.ui);
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

function tryButton(): Button | undefined {
  if (!(document.documentElement instanceof HTMLElement)) return undefined; // an SVG or XML document
  try {
    return mountButton(document, {
      alive: () => Boolean(chrome.runtime?.id),
      // An orphaned copy (the extension was reloaded) throws instead of rejecting: async turns both into a reply.
      press: async (command) => {
        try {
          const reply: { error?: string } | undefined = await chrome.runtime.sendMessage({
            type: "record.press",
            command,
          });
          return reply?.error;
        } catch {
          return "Task Player was reloaded: reload this page";
        }
      },
      loadPosition: async () => {
        try {
          return (await chrome.storage.local.get(POSITION_KEY))[POSITION_KEY] as Position | undefined;
        } catch {
          return undefined;
        }
      },
      savePosition: async (position) => {
        try {
          await chrome.storage.local.set({ [POSITION_KEY]: position });
        } catch {
          // orphaned: the next page load uses the default corner
        }
      },
    });
  } catch (error) {
    console.warn("[task player] no button on this page", error);
    return undefined;
  }
}

function stop() {
  stopCapture();
  button?.remove();
  try {
    chrome.runtime.onMessage.removeListener(onMessage);
  } catch {
    // orphaned runtime: nothing to remove
  }
  if (scope.__taskPlayerStop === stop) scope.__taskPlayerStop = undefined;
}
scope.__taskPlayerStop = stop;
