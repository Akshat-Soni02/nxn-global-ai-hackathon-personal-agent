// Service worker: owns the native messaging port to the daemon and the chrome.debugger sessions for replay.
import { type Message, NATIVE_HOST_NAME } from "@taskplayer/core";

let port: chrome.runtime.Port | undefined;

function connectDaemon() {
  port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  port.onMessage.addListener((message: Message) => {
    // TODO(player): handle run.step by driving the tab through chrome.debugger.
    console.log("[extension] from daemon", message);
  });
  port.onDisconnect.addListener(() => {
    console.warn("[extension] daemon disconnected", chrome.runtime.lastError?.message);
    port = undefined;
  });
  const hello: Message = { id: crypto.randomUUID(), type: "hello", from: "extension", version: "0.0.0" };
  port.postMessage(hello);
}

chrome.runtime.onStartup.addListener(connectDaemon);
chrome.runtime.onInstalled.addListener(connectDaemon);
