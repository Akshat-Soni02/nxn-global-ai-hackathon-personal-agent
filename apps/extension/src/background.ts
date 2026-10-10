// Service worker: keeps a native port open to the daemon (via apps/native-host) and runs replay steps.
// Only the extension can open this connection. It connects on startup; after a disconnect it retries soon,
// and a chrome.alarms heartbeat keeps retrying even if Chrome suspends this worker (timers die with it).
// An open native port also keeps this MV3 service worker alive.
// It also drives the Record / Stop controls: the floating button in each page (button.ts) and the toolbar icon. Both
// only ask the daemon, which owns the session; what they show is what the daemon said back.
import { type Message, NATIVE_HOST_NAME } from "@taskplayer/core";
import type { PageOp } from "@taskplayer/player/web";
import type { ButtonState } from "./button.ts";
import { endRun, isAutomationTab, runPageCheck, runPageOp, runWebStep } from "./replay.ts";

const VERSION = chrome.runtime.getManifest().version;
const QUICK_RETRY_MS = 3_000;
const RECONNECT_ALARM = "reconnect-daemon";

let port: chrome.runtime.Port | undefined;
let recordingSession: string | undefined;
let ui: ButtonState = { daemon: false };

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
      setRecording(message.sessionId, { recording: { since: message.startedAt ?? Date.now() }, status: undefined });
      break;
    case "record.stop":
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
      const result = await runWebStep(step).catch((error: Error) => ({ ok: false, error: error.message }));
      send({ ...result, id, type: "run.step_result", runId, stepId: step.id });
      break;
    }
    case "run.check": {
      const ok = await runPageCheck(message.check, message.timeoutMs).catch(() => false);
      send({ id: message.id, type: "run.check_result", runId: message.runId, ok });
      break;
    }
    case "page.op": {
      const result = await runPageOp(message.op as PageOp).catch((error: Error) => ({
        ok: false,
        error: error.message,
      }));
      send({ ...result, id: message.id, type: "page.op_result" });
      break;
    }
    case "run.end":
      await endRun();
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
    ? "Task Player: the daemon isn't running (pnpm daemon)"
    : ui.recording
      ? "Task Player: stop recording"
      : busy
        ? `Task Player: ${ui.status?.text}`
        : "Task Player: record a task";
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
  send({
    at: Date.now(),
    ...event,
    id: crypto.randomUUID(),
    type: "record.event",
    sessionId: recordingSession,
  } as Message);
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
    record({ ...message, tabId: sender.tab?.id, frameId: sender.frameId, url: sender.url });
});

// Browser events a content script can't see: page loads, single-page route changes, tabs, finished downloads.
chrome.webNavigation.onCommitted.addListener((nav) => {
  if (nav.frameId === 0)
    record({ event: "navigate", at: nav.timeStamp, tabId: nav.tabId, url: nav.url, transition: nav.transitionType });
});
chrome.webNavigation.onHistoryStateUpdated.addListener((nav) => {
  if (nav.frameId === 0)
    record({ event: "navigate", at: nav.timeStamp, tabId: nav.tabId, url: nav.url, transition: nav.transitionType });
});
chrome.tabs.onCreated.addListener((tab) => {
  record({ event: "tab_open", tabId: tab.id, url: tab.pendingUrl ?? tab.url, openerTabId: tab.openerTabId });
});
chrome.tabs.onRemoved.addListener((tabId) => record({ event: "tab_close", tabId }));
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
