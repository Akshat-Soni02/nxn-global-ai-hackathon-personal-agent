// Replay inside the user's Chrome: one dedicated automation window, driven through chrome.debugger.
// The window is fixed at 1280x800 so pages lay out the same way on every run, and comes to the front when a run
// starts, so you can watch it. Your own windows and tabs are never used.
// Chrome shows a "started debugging this browser" bar while attached; we attach only during a run.
import type { Check, ActionStep as Step } from "@taskplayer/core";
import { type Cdp, executeWebStep, waitForCheck } from "@taskplayer/player/web";

const PROTOCOL_VERSION = "1.3";
const STORE_KEY = "automationTab";

let attachedTab: number | undefined;
let knownAutomationTab: number | undefined;

// Recording ignores the automation tab, so a replay that runs while you record never records itself.
export function isAutomationTab(tabId: number | undefined): boolean {
  return tabId !== undefined && tabId === knownAutomationTab;
}

async function automationTab(): Promise<number> {
  const stored = (await chrome.storage.session.get(STORE_KEY))[STORE_KEY] as number | undefined;
  if (stored !== undefined) {
    const tab = await chrome.tabs.get(stored).catch(() => undefined);
    if (tab?.id !== undefined) {
      knownAutomationTab = tab.id;
      return tab.id;
    }
  }
  const win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1280, height: 800 });
  const tabId = win?.tabs?.[0]?.id;
  if (tabId === undefined) throw new Error("could not open the automation window");
  knownAutomationTab = tabId;
  await chrome.storage.session.set({ [STORE_KEY]: tabId });
  return tabId;
}

async function cdpFor(tabId: number): Promise<Cdp> {
  const target = { tabId };
  if (attachedTab !== tabId) {
    // A run attaches once, at its first step (endRun detaches): bring its window forward to be watched.
    const { windowId } = await chrome.tabs.get(tabId);
    await chrome.windows.update(windowId, { focused: true, state: "normal" }).catch(() => {});
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
    attachedTab = tabId;
    for (const domain of ["Page", "DOM", "Runtime", "Accessibility"]) {
      await chrome.debugger.sendCommand(target, `${domain}.enable`);
    }
  }
  return {
    send: <T>(method: string, params?: Record<string, unknown>) =>
      chrome.debugger.sendCommand(target, method, params) as Promise<T>,
  };
}

// The user may cancel the debugging bar, or close the window; forget the session so the next step re-attaches.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === attachedTab) attachedTab = undefined;
});

// Reading a Google Sheet's export from here, not the page: the worker has the user's cookies for every host it has
// permission for, and is not held back by CORS when the export redirects to googleusercontent.com.
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

export async function runWebStep(step: Step) {
  return executeWebStep(await cdpFor(await automationTab()), step, { fetchText });
}

export async function runPageCheck(check: Check, timeoutMs: number): Promise<boolean> {
  return waitForCheck(await cdpFor(await automationTab()), check, timeoutMs);
}

export async function endRun(): Promise<void> {
  if (attachedTab === undefined) return;
  const tabId = attachedTab;
  attachedTab = undefined;
  await chrome.debugger.detach({ tabId }).catch(() => {});
}
