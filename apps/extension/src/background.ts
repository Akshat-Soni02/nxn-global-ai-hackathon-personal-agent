// Service worker: keeps a native port open to the daemon (via apps/native-host) and runs replay steps.
// Only the extension can open this connection. It connects on startup; after a disconnect it retries soon,
// and a chrome.alarms heartbeat keeps retrying even if Chrome suspends this worker (timers die with it).
// An open native port also keeps this MV3 service worker alive.
// It also drives the Record / Stop controls: the floating button in each page (button.ts) and the toolbar icon. Both
// only ask the daemon, which owns the session; what they show is what the daemon said back.
import { type Message, NATIVE_HOST_NAME } from "@shadow/core";
import type { PageOp } from "@shadow/player/web";
import type { ButtonState } from "./button.ts";
import {
  endRun,
  forgetAutomationTab,
  isAutomationTab,
  noteDownload,
  noteOpenedTab,
  runPageCheck,
  runPageOp,
  runWebStep,
} from "./replay.ts";
import type { ShotHint } from "./shot.ts";
import { type ShotJob, ShotQueue } from "./shot-queue.ts";
import { TabRegistry } from "./tab-registry.ts";

// The build's id (build.mjs) after the manifest version: the daemon compares it with the build on disk (C25).
declare const __SHADOW_BUILD__: string | undefined;
const VERSION = `${chrome.runtime.getManifest().version}+${typeof __SHADOW_BUILD__ === "string" ? __SHADOW_BUILD__ : "dev"}`;
const QUICK_RETRY_MS = 3_000;
const RECONNECT_ALARM = "reconnect-daemon";

let port: chrome.runtime.Port | undefined;
let recordingSession: string | undefined;
// Whether this recording's form allowed a screenshot per step (record.start).
let screenConsent = false;
let ui: ButtonState = { daemon: false };
// The tabs this recording used, announced at their first use (tab-registry.ts).
const tabs = new TabRegistry();

function send(message: Message) {
  port?.postMessage(message);
}

function connectDaemon() {
  if (port) return;
  port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  port.onMessage.addListener((message: Message) => void onDaemonMessage(message));
  port.onDisconnect.addListener(() => {
    console.warn("[extension] disconnected from daemon", chrome.runtime.lastError?.message ?? "");
    port = undefined;
    setRecording(undefined, { daemon: false });
    void endRun();
    setTimeout(connectDaemon, QUICK_RETRY_MS);
    // Minimum alarm period is 30 s; it survives the worker being suspended.
    chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  });
  send({ id: crypto.randomUUID(), type: "hello", from: "extension", version: VERSION });
}

async function onDaemonMessage(message: Message) {
  switch (message.type) {
    case "hello":
      chrome.alarms.clear(RECONNECT_ALARM);
      console.log("[extension] connected to daemon", message.version);
      setRecording(recordingSession, { daemon: true });
      break;
    case "daemon.offline":
      console.warn("[extension] daemon offline:", message.reason);
      break;
    case "record.start":
      screenConsent = message.consent?.screen === true;
      // Before any event is recorded: which tabs were already open when Record was pressed.
      tabs.start(await chrome.tabs.query({}).catch(() => []));
      setRecording(message.sessionId, { recording: { since: message.startedAt ?? Date.now() }, status: undefined });
      break;
    case "record.stop":
      // Pictures still waiting are not taken now: said so in the ledger while the session is still known.
      for (const job of shots.clear()) skipShot(job.eventId, job.at, "stopped");
      screenConsent = false;
      setRecording(undefined, { recording: undefined });
      break;
    case "desktop.button":
      setRecording(recordingSession, { desktop: message.present });
      break;
    case "record.status": {
      // "Still compiling" while a question is already showing would only hide that question.
      const open = ui.status?.phase === "compiling" || ui.status?.phase === "question";
      if (message.phase === "busy" && open) break;
      setRecording(recordingSession, { status: { phase: message.phase, text: message.text, at: Date.now() } });
      break;
    }
    case "run.step": {
      const { id, runId, step } = message;
      const result = await runWebStep(step, runId).catch((error: Error) => ({
        ok: false,
        error: error.message,
      }));
      send({ ...result, id, type: "run.step_result", runId, stepId: step.id });
      break;
    }
    case "run.check": {
      const ok = await runPageCheck(message.check, message.timeoutMs).catch(() => false);
      send({ id: message.id, type: "run.check_result", runId: message.runId, ok });
      break;
    }
    case "page.op": {
      const result = await runPageOp(message.op as PageOp, message.runId).catch((error: Error) => ({
        ok: false,
        error: error.message,
      }));
      send({ ...result, id: message.id, type: "page.op_result" });
      break;
    }
    case "run.end":
      await endRun(message.runId); // only this run's tabs: another run may be waiting for you with its own
      break;
    default:
      console.log("[extension] unhandled", message.type);
  }
}

// Tell every content script whether to capture, and what the button shows. Content scripts send captured events
// back via chrome.runtime.
function setRecording(sessionId: string | undefined, change: Partial<ButtonState> = {}) {
  recordingSession = sessionId;
  ui = { ...ui, ...change };
  if (!ui.daemon) ui = { daemon: false };
  paintToolbar();
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined) tellTab(tab.id);
    }
  });
}

// The button's state for one tab: none in replay's automation window (the matcher must not find a "Stop" button there).
const uiFor = (tabId: number | undefined) => (isAutomationTab(tabId) ? undefined : ui);

// Tabs that were open before the extension was installed or reloaded have no content script: inject it there once the
// daemon is up (for the button) or a session starts. On start it asks "recording?" itself, so it needs nothing more.
async function tellTab(tabId: number) {
  const message = { type: "recording", sessionId: recordingSession, ui: uiFor(tabId) };
  const reached = await chrome.tabs.sendMessage(tabId, message).then(
    () => true,
    () => false,
  );
  if (reached || !ui.daemon || isAutomationTab(tabId)) return;
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).catch(() => {}); // chrome:// pages and the Web Store can't be scripted
}

// Record / Stop, from the floating button or the toolbar icon: a request to the daemon, which answers with
// record.start / record.stop (or a status saying why not).
function press(command: "start" | "stop"): string | undefined {
  if (!ui.daemon || !port) return "The daemon isn't running: start it with pnpm daemon";
  send({ id: crypto.randomUUID(), type: "record.command", command });
  return undefined;
}

chrome.action.onClicked.addListener(() => {
  const busy = ui.status?.phase === "compiling" || ui.status?.phase === "question";
  if (ui.daemon && !busy) press(ui.recording ? "stop" : "start");
});

// The toolbar icon, drawn here (a red dot to record, a square to stop), so the extension ships no image files.
function paintToolbar() {
  const busy = ui.status?.phase === "compiling" || ui.status?.phase === "question";
  const kind = !ui.daemon ? "off" : ui.recording ? "stop" : "record";
  void chrome.action.setIcon({ imageData: drawIcon(kind) }).catch(() => {});
  void chrome.action.setBadgeText({ text: ui.recording ? "REC" : busy ? "…" : "" });
  void chrome.action.setBadgeBackgroundColor({ color: ui.recording ? "#dc2626" : "#52525b" });
  const title = !ui.daemon
    ? "Shadow: the daemon isn't running (pnpm daemon)"
    : ui.recording
      ? "Shadow: stop recording"
      : busy
        ? `Shadow: ${ui.status?.text}`
        : "Shadow: record a task";
  void chrome.action.setTitle({ title });
}

function drawIcon(kind: "off" | "record" | "stop"): Record<number, ImageData> {
  const images: Record<number, ImageData> = {};
  for (const size of [16, 32]) {
    const canvas = new OffscreenCanvas(size, size);
    const g = canvas.getContext("2d");
    if (!g) continue;
    const u = size / 16;
    g.fillStyle = "#18181b";
    g.beginPath();
    g.arc(8 * u, 8 * u, 7.5 * u, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = kind === "off" ? "#a1a1aa" : kind === "stop" ? "#ffffff" : "#ef4444";
    g.beginPath();
    if (kind === "stop") g.roundRect(4.5 * u, 4.5 * u, 7 * u, 7 * u, 1.5 * u);
    else g.arc(8 * u, 8 * u, 3.6 * u, 0, Math.PI * 2);
    g.fill();
    images[size] = g.getImageData(0, 0, size, size);
  }
  return images;
}

// One trace event from a page or the browser, stamped with the session. Dropped when not recording, and for the
// automation tab (replay's own clicks are not something you did).
function record(event: { event: string; tabId?: number; [field: string]: unknown }) {
  if (!recordingSession || isAutomationTab(event.tabId)) return;
  const { shot, ...fields } = event as typeof event & { shot?: ShotHint };
  const id = crypto.randomUUID();
  const at = typeof fields.at === "number" ? fields.at : Date.now();
  // A tab that was open before Record, used for the first time: where it was, just before its first event.
  if (event.tabId !== undefined && event.event !== "tab_open") {
    const first = tabs.firstUse(event.tabId);
    if (first?.preexisting) {
      const { tabId, windowId, url, title } = first;
      send({
        id: crypto.randomUUID(),
        type: "record.event",
        sessionId: recordingSession,
        event: "tab_open",
        at: at - 1,
        tabId,
        windowId,
        url,
        title,
        preexisting: true,
      } as Message);
    }
  }
  send({ at, ...fields, id, type: "record.event", sessionId: recordingSession } as Message);
  if (screenConsent && SHOT_EVENTS.has(event.event) && event.tabId !== undefined) {
    if (shot?.skip) skipShot(id, at, "private");
    else
      queueShot({
        tabId: event.tabId,
        eventId: id,
        at,
        kind: event.event,
        due: Date.now() + (event.event === "navigate" || event.event === "tab_switch" ? 1_200 : 400),
        masks: shot?.masks,
      });
  }
}

// Pictures of the visible tab after events, when the form allowed them (shot-queue.ts). Only the words read from them,
// masked, ever leave the Mac (the daemon's screen.ts). Every event that should have a picture and has none gets a ledger
// line saying why.
const SHOT_EVENTS = new Set([
  "click",
  "type",
  "select",
  "check",
  "file",
  "drop",
  "submit",
  "key",
  "copy",
  "navigate",
  "select_text",
  // A click that opened a new tab: its picture is taken when that tab shows.
  "tab_switch",
]);
const shots = new ShotQueue();
let shotTimer: ReturnType<typeof setTimeout> | undefined;
let lastShot = Number.NEGATIVE_INFINITY;
type SkipReason = "private" | "tab-hidden" | "rate-limit" | "error" | "stopped";

function skipShot(eventId: string, at: number, reason: SkipReason) {
  if (!recordingSession) return;
  send({
    id: crypto.randomUUID(),
    type: "record.shot_skip",
    sessionId: recordingSession,
    eventId,
    at,
    reason,
  } as Message);
}
function queueShot(job: ShotJob) {
  const dropped = shots.add(job);
  if (dropped) skipShot(dropped.eventId, dropped.at, "rate-limit");
  pumpShots();
}
function pumpShots() {
  clearTimeout(shotTimer);
  const wait = shots.wake(Date.now(), lastShot);
  if (wait === undefined) return;
  shotTimer = setTimeout(async () => {
    const job = shots.next(Date.now(), lastShot);
    if (job) await takeShot(job);
    pumpShots();
  }, wait);
}
async function takeShot(job: ShotJob) {
  const session = recordingSession;
  if (!session || !screenConsent) return;
  lastShot = Date.now();
  try {
    const tab = await chrome.tabs.get(job.tabId);
    if (isAutomationTab(job.tabId)) return;
    if (!tab.active) return skipShot(job.eventId, job.at, "tab-hidden"); // the picture is of what is on screen
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
    send({
      id: crypto.randomUUID(),
      type: "record.shot",
      sessionId: session,
      eventId: job.eventId,
      at: job.at,
      takenAt: Date.now(),
      tabId: job.tabId,
      image,
      masks: job.masks,
    } as Message);
  } catch (error) {
    console.warn("[extension] no screenshot:", (error as Error).message);
    skipShot(job.eventId, job.at, "error");
  }
}

// Content scripts in newly opened pages ask whether a session is active. Captured events are forwarded to the daemon
// with the tab and frame they came from: only the background knows those (sender).
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === "sheet.csv" && recordingSession) {
    // A Google Sheet's export, read here (cookies, no CORS) for the copy the page just recorded.
    fetch(String(message.url), { credentials: "include" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => reply({ text: text.slice(0, 500_000) }))
      .catch((error: Error) => reply({ error: error.message }));
    return true; // the reply comes later
  }
  if (message?.type === "record.press") reply({ error: press(message.command === "stop" ? "stop" : "start") });
  else if (message?.type === "recording?") reply({ sessionId: recordingSession, ui: uiFor(sender.tab?.id) });
  else if (message?.type === "record.event")
    record({
      ...message,
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      // The page's own address at the moment (content.ts), else the tab's.
      url: typeof message.url === "string" ? message.url : sender.url,
    });
});

// Browser events a content script can't see: page loads, single-page route changes, tabs, finished downloads.
chrome.webNavigation.onCommitted.addListener((nav) => {
  if (nav.frameId === 0)
    record({
      event: "navigate",
      at: nav.timeStamp,
      tabId: nav.tabId,
      url: nav.url,
      transition: nav.transitionType,
      // The browser's Back or Forward: a step "go back", not a typed address.
      ...(nav.transitionQualifiers.includes("forward_back") ? { back: true } : {}),
    });
});
chrome.webNavigation.onHistoryStateUpdated.addListener((nav) => {
  if (nav.frameId === 0)
    record({ event: "navigate", at: nav.timeStamp, tabId: nav.tabId, url: nav.url, transition: nav.transitionType });
});
chrome.tabs.onCreated.addListener((tab) => {
  tabs.opened(tab);
  noteOpenedTab(tab);
  record({
    event: "tab_open",
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.pendingUrl ?? tab.url,
    openerTabId: tab.openerTabId,
  });
});
// Recorded first (an automation tab is ignored while it is still known), then forgotten by replay.
chrome.tabs.onRemoved.addListener((tabId) => {
  record({ event: "tab_close", tabId });
  forgetAutomationTab(tabId);
});
// Switching tabs: replay runs in one tab, so the order of pages you worked on is rebuilt from these.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (!recordingSession) return;
  chrome.tabs.get(tabId).then(
    (tab) => record({ event: "tab_switch", tabId, windowId, url: tab.url ?? tab.pendingUrl }),
    () => record({ event: "tab_switch", tabId, windowId }),
  );
});
// Switching Chrome windows is not a tab activation: recorded as its own event, with the window's active tab.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!recordingSession || windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then(
    ([tab]) => record({ event: "window_focus", windowId, tabId: tab?.id, url: tab?.url }),
    () => {},
  );
});
// A download a run's step started: replay checks it isn't held by the Save-as dialog (A5).
chrome.downloads.onCreated.addListener((item) => noteDownload(item));
// A finished download links the web and the Mac: its path is where a later file step will find it.
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current !== "complete") return;
  chrome.downloads.search({ id: delta.id }).then(([item]) => {
    if (!item) return;
    const name = item.filename.split("/").pop() ?? item.filename;
    record({
      event: "download",
      path: item.filename,
      url: item.finalUrl || item.url,
      file: { name, size: item.fileSize, type: item.mime },
    });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connectDaemon();
});
paintToolbar();
chrome.runtime.onStartup.addListener(connectDaemon);
chrome.runtime.onInstalled.addListener(connectDaemon);
connectDaemon();
