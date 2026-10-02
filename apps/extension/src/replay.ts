// Replay inside the user's Chrome: one dedicated automation window, driven through chrome.debugger.
// The window is unfocused and fixed at 1280x800 so pages lay out the same way on every run.
// Chrome shows a "started debugging this browser" bar while attached; we attach only during a run.
import type { Check, Step } from "@taskplayer/core";
import { type Cdp, executeWebStep, waitForCheck } from "@taskplayer/player/web";

const PROTOCOL_VERSION = "1.3";
const STORE_KEY = "automationTab";

let attachedTab: number | undefined;

async function automationTab(): Promise<number> {
  const stored = (await chrome.storage.session.get(STORE_KEY))[STORE_KEY] as number | undefined;
  if (stored !== undefined) {
    const tab = await chrome.tabs.get(stored).catch(() => undefined);
    if (tab?.id !== undefined) return tab.id;
  }
  const win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1280, height: 800 });
  const tabId = win?.tabs?.[0]?.id;
  if (tabId === undefined) throw new Error("could not open the automation window");
  await chrome.storage.session.set({ [STORE_KEY]: tabId });
  return tabId;
}

async function cdpFor(tabId: number): Promise<Cdp> {
  const target = { tabId };
  if (attachedTab !== tabId) {
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

export async function runWebStep(step: Step) {
  return executeWebStep(await cdpFor(await automationTab()), step);
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
