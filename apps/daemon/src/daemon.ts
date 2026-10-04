// Daemon core: tracks connected extensions, owns recording sessions, and sends replay work to the extension.
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
  waitForExtension(timeoutMs: number): Promise<boolean>;
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
}): Promise<Daemon> {
  const log = options.log ?? (() => {});
  const extensions = new Set<Connection>();
  let sessionId: string | undefined;
  let recording: Recording | undefined; // the open trace; kept briefly after stop for late events
  const pending = new Map<string, Pending>();
  const extensionWaiters = new Set<() => void>();

  const send = (connection: Connection, message: Message) => connection.send(message);
  const broadcast = (message: Message) => {
    for (const connection of extensions) send(connection, message);
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
          extensions.add(connection);
          log("extension connected, version", message.version);
          for (const wake of extensionWaiters) wake();
          send(connection, { id: message.id, type: "hello", from: "daemon", version: VERSION });
          // An extension that connects mid-session joins the recording.
          if (sessionId) send(connection, { id: randomUUID(), type: "record.start", sessionId });
          break;
        case "ping":
          send(connection, { id: message.id, type: "pong" });
          break;
        case "record.event":
          // Into the session's trace, alongside the file events (record.ts). Events for any other session are dropped.
          if (recording && message.sessionId === recording.sessionId) recording.append(message);
          else log("record.event", message.event, "(no open trace)");
          break;
        case "run.step_result":
        case "run.check_result": {
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
      for (const [id, waiter] of pending) {
        if (waiter.connection !== connection) continue;
        pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.reject(new Error("extension disconnected during the request"));
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

  return {
    server,
    extensions,
    startRecording() {
      if (!sessionId) {
        sessionId = randomUUID();
        if (options.dataDir) {
          recording?.stopWatching();
          recording = openRecording(sessionId, { dataDir: options.dataDir, watchDirs: options.watchDirs ?? [], log });
        }
      }
      broadcast({ id: randomUUID(), type: "record.start", sessionId });
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
      const connection = [...extensions][0] as Connection;
      return new Promise<Message>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new Error(`extension did not answer ${message.type} within ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(message.id, { connection, resolve, reject, timer });
        send(connection, message);
      });
    },
    notify(message) {
      const connection = [...extensions][0];
      if (connection) send(connection, message);
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
