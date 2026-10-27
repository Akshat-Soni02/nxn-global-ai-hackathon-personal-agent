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
import { answerDialog, DialogLog, dialogProblem, type PageDialog } from "./dialogs.ts";
import { PAGE_GUARD, waitingForSaveAs } from "./page-guard.ts";
import { TabMap } from "./tab-map.ts";

const PROTOCOL_VERSION = "1.3";
const TABS_KEY = "automationTabs";
// Chrome calls that set a tab up (attach, the domain enables) fail after this long, as the later calls do (cdp.ts), so a
// frozen tab doesn't hold a step until the daemon gives up.
const SETUP_TIMEOUT_MS = 15_000;
const within = <T>(work: Promise<T>, what: string): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Chrome did not answer ${what} in ${SETUP_TIMEOUT_MS / 1000} s`)),
        SETUP_TIMEOUT_MS,
      ),
    ),
  ]);

let tabs: TabMap | undefined;
const attached = new Set<number>();
// The tab the last step ran in: checks and repair's page ops look there.
let current: number | undefined;
// Dialogs a page opens (alert, confirm…) are answered the moment they open (dialogs.ts). Whether the step running in a
// tab was approved by the user decides if a confirm there is accepted.
const dialogs = new DialogLog();
const approvedIn = new Map<number, boolean>();
// The run whose step ran last: a tab a page opens belongs to it.
let currentRun: string | undefined;
// Downloads Chrome started while a step ran (A5): one held by Chrome's Save-as dialog fails the step, saying so.
let stepDownloads: number[] | undefined;

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
async function tabFor(name: string | undefined, runId?: string): Promise<number> {
  const main = await automationTab();
  const map = await loadTabs();
  // A tab the page opened by itself (a link with target=_blank) is the next new name's tab (A5).
  let id = map.lookup(name, runId) ?? (name && name !== "main" ? map.adoptOpened(name, runId) : undefined);
  if (id !== undefined) await saveTabs();
  if (id === undefined && name) {
    const { windowId } = await chrome.tabs.get(main);
    const created = await chrome.tabs.create({ windowId, url: "about:blank", active: true });
    if (created.id === undefined) throw new Error(`could not open the tab "${name}"`);
    id = created.id;
    map.remember(name, id, runId);
    await saveTabs();
  }
  const tabId = id ?? main;
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  return tabId;
}

async function cdpFor(tabId: number): Promise<Cdp> {
  const target = { tabId };
  const raw: Cdp = {
    send: <T>(method: string, params?: Record<string, unknown>) =>
      chrome.debugger.sendCommand(target, method, params) as Promise<T>,
  };
  const cdp = withTimeouts(raw, {
    // A page in a window behind another may stop answering accessibility queries: bring the window forward.
    onSlow: async () => {
      const { windowId } = await chrome.tabs.get(tabId);
      await chrome.windows.update(windowId, { focused: true, state: "normal" }).catch(() => {});
    },
  });
  if (!attached.has(tabId)) {
    // A run attaches to each tab once, at its first step there (endRun detaches): bring its window forward.
    const { windowId } = await chrome.tabs.get(tabId);
    await chrome.windows.update(windowId, { focused: true, state: "normal" }).catch(() => {});
    await within(chrome.debugger.attach(target, PROTOCOL_VERSION), "debugger.attach");
    try {
      for (const domain of ["Page", "DOM", "Runtime", "Accessibility"]) await cdp.send(`${domain}.enable`);
      // Print previews and permission bubbles would stop the run behind Chrome's own UI: answered in the page (A5).
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_GUARD });
      await cdp.send("Runtime.evaluate", { expression: PAGE_GUARD }).catch(() => {});
    } catch (error) {
      // Half set up counts as not attached: the next step starts again from a clean tab.
      await chrome.debugger.detach(target).catch(() => {});
      throw error;
    }
    attached.add(tabId);
  }
  current = tabId;
  return cdp;
}

// The user may cancel the debugging bar, or close the window; forget the session so the next step re-attaches.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) attached.delete(source.tabId);
});

// A page's own dialog (alert, confirm, prompt, "Leave this page?") freezes the page until someone answers it: answer
// it now, by dialogs.ts's rule, and keep what it was so the step can say if a question went unanswered.
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Page.javascriptDialogOpening" || source.tabId === undefined) return;
  const tabId = source.tabId;
  const opened = params as unknown as PageDialog;
  const answer = answerDialog(opened, { approved: approvedIn.get(tabId) ?? false });
  dialogs.add(tabId, opened, answer);
  void chrome.debugger
    .sendCommand({ tabId }, "Page.handleJavaScriptDialog", {
      accept: answer.accept,
      ...(answer.promptText !== undefined ? { promptText: answer.promptText } : {}),
    })
    .catch(() => {});
});

// Reading a Google Sheet's export from here, not the page: the worker has the user's cookies for every host it has
// permission for, and is not held back by CORS when the export redirects to googleusercontent.com.
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

export async function runWebStep(step: Step, runId?: string) {
  currentRun = runId;
  const tabId = await tabFor(step.tab, runId);
  const cdp = await cdpFor(tabId);
  approvedIn.set(tabId, step.requires_approval === true);
  dialogs.take(tabId); // what opened between steps is not this step's
  stepDownloads = [];
  try {
    const result = await executeWebStep(cdp, step, { fetchText });
    // A question the page asked and nobody could answer: the step didn't do what it was for, whatever the click said.
    const problem = dialogProblem(dialogs.take(tabId)) ?? (await saveAsProblem(stepDownloads));
    return problem ? { ok: false, error: problem } : result;
  } finally {
    approvedIn.delete(tabId);
    stepDownloads = undefined;
  }
}

// A download the step started: kept, so the step can say if Chrome holds it behind its Save-as dialog.
export function noteDownload(item: chrome.downloads.DownloadItem): void {
  stepDownloads?.push(item.id);
}

// Chrome's "Ask where to save each file" puts a dialog no extension may skip over a run's download (A5, checked live:
// Page.setDownloadBehavior is refused to extensions, and a suggested name or saveAs: false still asks). The step
// says so instead of the run hanging behind it, and recovery's "I did it by hand: go on" fits.
async function saveAsProblem(ids: number[]): Promise<string | undefined> {
  if (ids.length === 0) return undefined;
  await new Promise((r) => setTimeout(r, 1_500));
  const items = (await Promise.all(ids.map((id) => chrome.downloads.search({ id })))).flat();
  return waitingForSaveAs(items);
}

export async function runPageCheck(check: Check, timeoutMs: number): Promise<boolean> {
  return waitForCheck(await cdpFor(current ?? (await automationTab())), check, timeoutMs);
}

// Repair looking at, or safely probing, the automation tab (the daemon's guard has allowed the op).
export async function runPageOp(op: PageOp, runId?: string): Promise<PageOpResult> {
  // A walk-through outlines the target of a step before it runs: in that step's own tab, not the last one used.
  const tabId = op.op === "highlight" ? await tabFor(op.tab, runId) : (current ?? (await automationTab()));
  return pageOp(await cdpFor(tabId), op);
}

// The run is over: detach from its tabs, and close the tabs it opened, so the next run starts with the window's one tab.
// With a run id, only that run's: another run waiting for you keeps its own (a waiting run's tabs are kept on purpose).
// Without one (the daemon went away), everything.
export async function endRun(runId?: string): Promise<void> {
  const map = await loadTabs();
  const owned = map.extras(runId);
  const ids = runId ? [...attached].filter((id) => id === map.main || owned.includes(id)) : [...attached];
  for (const tabId of ids) {
    attached.delete(tabId);
    approvedIn.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
  if (current !== undefined && ids.includes(current)) current = undefined;
  for (const id of owned) {
    await chrome.tabs.remove(id).catch(() => {});
    map.forget(id);
  }
  if (runId) map.forgetOwner(runId);
  await saveTabs();
}

// A tab a page in the automation window opened by itself: kept for the run whose step was running (A5).
export function noteOpenedTab(tab: chrome.tabs.Tab): void {
  if (tab.id === undefined || !isAutomationTab(tab.openerTabId) || !tabs) return;
  tabs.noteOpened(tab.id, currentRun);
  void saveTabs();
}

// A tab you closed is never used again: the next step that names it opens a new one.
export function forgetAutomationTab(tabId: number): void {
  if (!tabs?.has(tabId)) return;
  tabs.forget(tabId);
  attached.delete(tabId);
  if (current === tabId) current = undefined;
  void saveTabs();
}
