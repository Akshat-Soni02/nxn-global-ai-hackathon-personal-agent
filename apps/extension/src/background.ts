// Service worker: keeps a native port open to the daemon (via apps/native-host) and runs replay steps.
// Only the extension can open this connection. It connects on startup; after a disconnect it retries soon,
// and a chrome.alarms heartbeat keeps retrying even if Chrome suspends this worker (timers die with it).
// An open native port also keeps this MV3 service worker alive.
import { type Message, NATIVE_HOST_NAME } from "@taskplayer/core";
import { endRun, isAutomationTab, runPageCheck, runWebStep } from "./replay.ts";

const VERSION = chrome.runtime.getManifest().version;
const QUICK_RETRY_MS = 3_000;
const RECONNECT_ALARM = "reconnect-daemon";

let port: chrome.runtime.Port | undefined;
let recordingSession: string | undefined;

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
    setRecording(undefined);
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
      break;
    case "daemon.offline":
      console.warn("[extension] daemon offline:", message.reason);
      break;
    case "record.start":
      setRecording(message.sessionId);
      break;
    case "record.stop":
      setRecording(undefined);
      break;
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
    case "run.end":
      await endRun();
      break;
    default:
      console.log("[extension] unhandled", message.type);
  }
}

// Tell every content script whether to capture. Content scripts send captured events back via chrome.runtime.
function setRecording(sessionId: string | undefined) {
  recordingSession = sessionId;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined) tellTab(tab.id, sessionId);
    }
  });
}

// Tabs that were open before the extension was installed or reloaded have no content script: inject it there.
// On start it asks "recording?" itself, so it joins the session without another message.
async function tellTab(tabId: number, sessionId: string | undefined) {
  const reached = await chrome.tabs.sendMessage(tabId, { type: "recording", sessionId }).then(
    () => true,
    () => false,
  );
  if (reached || !sessionId) return;
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).catch(() => {}); // chrome:// pages and the Web Store can't be scripted
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
  if (message?.type === "recording?") reply({ sessionId: recordingSession });
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
chrome.runtime.onStartup.addListener(connectDaemon);
chrome.runtime.onInstalled.addListener(connectDaemon);
connectDaemon();
