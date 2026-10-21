// Replay inside the user's Chrome: one dedicated automation window, driven through chrome.debugger. A step that names
// its tab (step.tab) runs in that tab of the window, the same one for the whole run (tab-map.ts).
// The window is fixed at 1280x800 so pages lay out the same way on every run, and comes to the front when a run
// starts, so you can watch it. Your own windows and tabs are never used.
// Chrome shows a "started debugging this browser" bar while attached; we attach only during a run.
import type { Check, ActionStep as Step } from "@shadow/core";
import {
  type Cdp,
  executeWebStep,
  type PageOp,
  type PageOpResult,
  pageOp,
  waitForCheck,
  withTimeouts,
} from "@shadow/player/web";
import { TabMap } from "./tab-map.ts";

const PROTOCOL_VERSION = "1.3";
const TABS_KEY = "automationTabs";

let tabs: TabMap | undefined;
const attached = new Set<number>();
// The tab the last step ran in: checks and repair's page ops look there.
let current: number | undefined;

// Recording ignores the automation tabs, so a replay that runs while you record never records itself.
export function isAutomationTab(tabId: number | undefined): boolean {
  return tabId !== undefined && (tabs?.has(tabId) ?? false);
}

// The tabs are kept in chrome.storage.session: the service worker may be stopped between steps. A tab that no longer
// exists is dropped.
async function loadTabs(): Promise<TabMap> {
  if (tabs) return tabs;
  const stored = (await chrome.storage.session.get(TABS_KEY))[TABS_KEY] as ReturnType<TabMap["toJSON"]> | undefined;
  const map = TabMap.from(stored ?? { byName: [] });
  for (const id of [map.main, ...map.extras()]) {
    if (id === undefined) continue;
    const tab = await chrome.tabs.get(id).catch(() => undefined);
    if (tab?.id === undefined) map.forget(id);
  }
  tabs = map;
  return map;
}

async function saveTabs(): Promise<void> {
  if (tabs) await chrome.storage.session.set({ [TABS_KEY]: tabs.toJSON() });
}

// The window's first tab: steps with no tab run there.
async function automationTab(): Promise<number> {
  const map = await loadTabs();
  if (map.main !== undefined) return map.main;
  const win = await chrome.windows.create({ url: "about:blank", focused: false, width: 1280, height: 800 });
  const tabId = win?.tabs?.[0]?.id;
  if (tabId === undefined) throw new Error("could not open the automation window");
  map.setMain(tabId);
  await saveTabs();
  return tabId;
}

// The tab a step names: opened in the automation window the first time, the same tab after that. Made the active
// tab, so pictures and accessibility queries see it.
async function tabFor(name: string | undefined): Promise<number> {
  const main = await automationTab();
  const map = await loadTabs();
  let id = map.lookup(name);
  if (id === undefined && name) {
    const { windowId } = await chrome.tabs.get(main);
    const created = await chrome.tabs.create({ windowId, url: "about:blank", active: true });
    if (created.id === undefined) throw new Error(`could not open the tab "${name}"`);
    id = created.id;
    map.remember(name, id);
    await saveTabs();
  }
  const tabId = id ?? main;
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  return tabId;
}

async function cdpFor(tabId: number): Promise<Cdp> {
  const target = { tabId };
  if (!attached.has(tabId)) {
    // A run attaches to each tab once, at its first step there (endRun detaches): bring its window forward.
    const { windowId } = await chrome.tabs.get(tabId);
    await chrome.windows.update(windowId, { focused: true, state: "normal" }).catch(() => {});
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
    attached.add(tabId);
    for (const domain of ["Page", "DOM", "Runtime", "Accessibility"]) {
      await chrome.debugger.sendCommand(target, `${domain}.enable`);
    }
  }
  current = tabId;
  const raw: Cdp = {
    send: <T>(method: string, params?: Record<string, unknown>) =>
      chrome.debugger.sendCommand(target, method, params) as Promise<T>,
  };
  return withTimeouts(raw, {
    // A page in a window behind another may stop answering accessibility queries: bring the window forward.
    onSlow: async () => {
      const { windowId } = await chrome.tabs.get(tabId);
      await chrome.windows.update(windowId, { focused: true, state: "normal" }).catch(() => {});
    },
  });
}

// The user may cancel the debugging bar, or close the window; forget the session so the next step re-attaches.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) attached.delete(source.tabId);
});

// Reading a Google Sheet's export from here, not the page: the worker has the user's cookies for every host it has
// permission for, and is not held back by CORS when the export redirects to googleusercontent.com.
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

export async function runWebStep(step: Step) {
  return executeWebStep(await cdpFor(await tabFor(step.tab)), step, { fetchText });
}

export async function runPageCheck(check: Check, timeoutMs: number): Promise<boolean> {
  return waitForCheck(await cdpFor(current ?? (await automationTab())), check, timeoutMs);
}

// Repair looking at, or safely probing, the automation tab (the daemon's guard has allowed the op).
export async function runPageOp(op: PageOp): Promise<PageOpResult> {
  return pageOp(await cdpFor(current ?? (await automationTab())), op);
}

// The run is over: detach from every tab, and close the tabs it opened, so the next run starts with the window's one tab.
export async function endRun(): Promise<void> {
  const ids = [...attached];
  attached.clear();
  current = undefined;
  for (const tabId of ids) await chrome.debugger.detach({ tabId }).catch(() => {});
  const map = await loadTabs();
  for (const id of map.extras()) {
    await chrome.tabs.remove(id).catch(() => {});
    map.forget(id);
  }
  await saveTabs();
}

// A tab you closed is never used again: the next step that names it opens a new one.
export function forgetAutomationTab(tabId: number): void {
  if (!tabs?.has(tabId)) return;
  tabs.forget(tabId);
  attached.delete(tabId);
  if (current === tabId) current = undefined;
  void saveTabs();
}
