// Service worker: keeps a native port open to the daemon (via apps/native-host) and owns chrome.debugger for replay.
// Only the extension can open this connection, so it connects on startup and reconnects with backoff.
// An open native port also keeps this MV3 service worker alive.
import { type Message, NATIVE_HOST_NAME } from "@taskplayer/core";

const VERSION = chrome.runtime.getManifest().version;
const MAX_BACKOFF_MS = 60_000;

let port: chrome.runtime.Port | undefined;
let backoffMs = 1_000;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let recordingSession: string | undefined;

function send(message: Message) {
  port?.postMessage(message);
}

function connectDaemon() {
  clearTimeout(reconnectTimer);
  if (port) return;
  port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  port.onMessage.addListener(onDaemonMessage);
  port.onDisconnect.addListener(() => {
    console.warn("[extension] disconnected from daemon", chrome.runtime.lastError?.message ?? "");
    port = undefined;
    setRecording(undefined);
    reconnectTimer = setTimeout(connectDaemon, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  });
  send({ id: crypto.randomUUID(), type: "hello", from: "extension", version: VERSION });
}

function onDaemonMessage(message: Message) {
  switch (message.type) {
    case "hello":
      backoffMs = 1_000;
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
    case "run.step":
      // TODO(player): run the step in the automation window through chrome.debugger, reply with run.step_result.
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

chrome.runtime.onStartup.addListener(connectDaemon);
chrome.runtime.onInstalled.addListener(connectDaemon);
connectDaemon();
