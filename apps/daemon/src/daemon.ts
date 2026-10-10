// Daemon core: tracks connected extensions and Task Player.app, owns recording sessions, and sends replay work out:
// web steps to the extension, ax steps (Mac apps) to Task Player.app. Each connection says which it is in its hello.
import { randomUUID } from "node:crypto";
import type { Server } from "node:net";
import { Message } from "@taskplayer/core";
import { openRecording, type Recording } from "./record.ts";
import { type Connection, listen } from "./server.ts";

const VERSION = "0.0.0";

export interface Daemon {
  server: Server;
  extensions: ReadonlySet<Connection>;
  // Starts a recording session. Web capture joins if Chrome is connected; Mac-only tasks work without it.
  startRecording(): string;
  // Resolves with the stopped session once late events have arrived, ready to compile.
  stopRecording(): Promise<string | undefined>;
  // Sends a request to the extension and resolves with its reply (same id). Waits for an extension to connect.
  request(message: Message, timeoutMs: number): Promise<Message>;
  // Fire-and-forget message to the extension, if one is connected.
  notify(message: Message): void;
  // To every connected extension (one per Chrome profile): recording state and the button's status line.
  broadcast(message: Message): void;
  waitForExtension(timeoutMs: number): Promise<boolean>;
  // Task Player.app (apps/mac): the desktop button, Mac-app recording and the ax channel.
  mac(): { connected: boolean; trusted: boolean };
  // Sends an ax step to Task Player.app and resolves with its reply.
  requestMac(message: Message, timeoutMs: number): Promise<Message>;
  close(): Promise<void>;
}

interface Pending {
  connection: Connection;
  resolve(reply: Message): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export async function startDaemon(options: {
  socketPath: string;
  log?: (...args: unknown[]) => void;
  // Where traces are written. Without it, events are only logged (tests of the socket alone).
  dataDir?: string;
  // Folders whose file changes are recorded too (FSEvents).
  watchDirs?: string[];
  // How long to keep accepting a stopped session's events that were already in flight.
  drainMs?: number;
  // The Record / Stop button in Chrome. main.ts routes it to the same code as a typed `record` / `stop`, so a click
  // is refused while a recording is still being compiled. Without it, the button only starts and stops the session.
  onRecordCommand?(command: "start" | "stop"): void;
}): Promise<Daemon> {
  const log = options.log ?? (() => {});
  const extensions = new Set<Connection>();
  const macs = new Map<Connection, { trusted: boolean }>(); // Task Player.app; one at a time in practice
  let sessionId: string | undefined;
  let startedAt = 0;
  let recording: Recording | undefined; // the open trace; kept briefly after stop for late events
  const pending = new Map<string, Pending>();
  const extensionWaiters = new Set<() => void>();

  const send = (connection: Connection, message: Message) => connection.send(message);
  const broadcast = (message: Message) => {
    for (const connection of [...extensions, ...macs.keys()]) send(connection, message);
  };
  // Chrome hides its in-page button while the desktop one is on screen: one Record button, not two.
  const desktopButton = (connection?: Connection) => {
    const message: Message = { id: randomUUID(), type: "desktop.button", present: macs.size > 0 };
    for (const c of connection ? [connection] : extensions) send(c, message);
  };

  const server = await listen(options.socketPath, {
    onMessage(connection, raw) {
      const parsed = Message.safeParse(raw);
      if (!parsed.success) {
        log("invalid message", parsed.error.issues);
        return;
      }
      const message = parsed.data;
      switch (message.type) {
        case "hello":
          if (message.from === "mac") {
            macs.set(connection, { trusted: message.trusted === true });
            log(
              "Task Player.app connected,",
              message.trusted ? "Accessibility allowed" : "Accessibility not allowed yet: Mac apps are not recorded",
            );
            desktopButton();
          } else {
            extensions.add(connection);
            log("extension connected, version", message.version);
            for (const wake of extensionWaiters) wake();
          }
          send(connection, { id: message.id, type: "hello", from: "daemon", version: VERSION });
          // After the hello: the extension starts its button state afresh when it gets one.
          if (message.from !== "mac" && macs.size > 0) desktopButton(connection);
          // Whoever connects mid-session joins the recording.
          if (sessionId) send(connection, { id: randomUUID(), type: "record.start", sessionId, startedAt });
          break;
        case "watch.folder":
          if (sessionId && recording?.sessionId === sessionId) recording.watchFolder(message.path);
          break;
        case "mac.trusted": {
          const mac = macs.get(connection);
          if (mac) mac.trusted = message.trusted;
          log(message.trusted ? "Accessibility allowed: Mac apps are recorded" : "Accessibility was turned off");
          break;
        }
        case "ping":
          send(connection, { id: message.id, type: "pong" });
          break;
        case "record.command":
          log(`${message.command} pressed in ${macs.has(connection) ? "the desktop button" : "Chrome"}`);
          if (options.onRecordCommand) options.onRecordCommand(message.command);
          else if (message.command === "start") daemon.startRecording();
          else void daemon.stopRecording();
          break;
        case "record.event":
          // Into the session's trace, alongside the file events (record.ts). Events for any other session are dropped.
          if (recording && message.sessionId === recording.sessionId) recording.append(message);
          else log("record.event", message.event, "(no open trace)");
          break;
        case "run.step_result":
        case "run.check_result":
        case "page.op_result": {
          const waiter = pending.get(message.id);
          if (!waiter) break;
          pending.delete(message.id);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
          break;
        }
        default:
          log("unhandled", message.type);
      }
    },
    onClose(connection) {
      if (extensions.delete(connection)) log("extension disconnected");
      if (macs.delete(connection)) {
        log("Task Player.app disconnected");
        desktopButton();
      }
      for (const [id, waiter] of pending) {
        if (waiter.connection !== connection) continue;
        pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject(new Error("disconnected during the request"));
      }
    },
  });

  function waitForExtension(timeoutMs: number): Promise<boolean> {
    if (extensions.size > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        extensionWaiters.delete(wake);
        resolve(true);
      };
      const timer = setTimeout(() => {
        extensionWaiters.delete(wake);
        resolve(false);
      }, timeoutMs);
      extensionWaiters.add(wake);
    });
  }

  // One request and its reply (same id), on one connection.
  function ask(connection: Connection, message: Message, timeoutMs: number): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.id);
        const who = macs.has(connection) ? "Task Player.app" : "extension";
        reject(new Error(`${who} did not answer ${message.type} within ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(message.id, { connection, resolve, reject, timer });
      send(connection, message);
    });
  }

  const daemon: Daemon = {
    server,
    extensions,
    startRecording() {
      if (!sessionId) {
        sessionId = randomUUID();
        startedAt = Date.now();
        if (options.dataDir) {
          recording?.stopWatching();
          recording = openRecording(sessionId, { dataDir: options.dataDir, watchDirs: options.watchDirs ?? [], log });
        }
      }
      broadcast({ id: randomUUID(), type: "record.start", sessionId, startedAt });
      log("recording", sessionId, `(${extensions.size} extension(s) capturing)`);
      return sessionId;
    },
    async stopRecording() {
      if (!sessionId) return undefined;
      const stopped = sessionId;
      broadcast({ id: randomUUID(), type: "record.stop", sessionId });
      log("stopped", sessionId);
      sessionId = undefined;
      const open = recording;
      open?.stopWatching();
      // Events already on their way through Chrome and the native host still belong to this recording.
      await new Promise((resolve) => setTimeout(resolve, options.drainMs ?? 500));
      if (recording === open) recording = undefined;
      return stopped;
    },
    waitForExtension,
    async request(message, timeoutMs) {
      if (!(await waitForExtension(timeoutMs))) throw new Error("no extension connected (is Chrome running?)");
      return ask([...extensions][0] as Connection, message, timeoutMs);
    },
    mac() {
      const [state] = macs.values();
      return { connected: state !== undefined, trusted: state?.trusted ?? false };
    },
    async requestMac(message, timeoutMs) {
      const [connection] = macs.keys();
      if (!connection) throw new Error("Task Player.app is not running (it starts with the daemon: pnpm setup:mac)");
      return ask(connection, message, timeoutMs);
    },
    notify(message) {
      const connection = [...extensions][0];
      if (connection) send(connection, message);
    },
    broadcast,
    // server.close() alone waits for every open connection to end, and Chrome's native host and Task Player.app
    // keep theirs open: so end them (Task Player.app quits when its connection ends), with a short backstop.
    close: () =>
      new Promise((resolve) => {
        for (const connection of [...extensions, ...macs.keys()]) connection.close();
        server.close(() => resolve());
        setTimeout(resolve, 1_000).unref();
      }),
  };
  return daemon;
}
