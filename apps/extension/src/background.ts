// Service worker: keeps a native port open to the daemon (via apps/native-host) and runs replay steps.
// Only the extension can open this connection. It connects on startup; after a disconnect it retries soon,
// and a chrome.alarms heartbeat keeps retrying even if Chrome suspends this worker (timers die with it).
// An open native port also keeps this MV3 service worker alive.
import { type Message, NATIVE_HOST_NAME } from "@taskplayer/core";
import { endRun, runPageCheck, runWebStep } from "./replay.ts";

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
      if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: "recording", sessionId }).catch(() => {});
    }
  });
}

// Content scripts in newly opened pages ask whether a session is active; captured events are forwarded to the daemon.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === "recording?") reply({ sessionId: recordingSession });
  else if (message?.type === "record.event" && recordingSession) send({ ...message, sessionId: recordingSession });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connectDaemon();
});
chrome.runtime.onStartup.addListener(connectDaemon);
chrome.runtime.onInstalled.addListener(connectDaemon);
connectDaemon();
