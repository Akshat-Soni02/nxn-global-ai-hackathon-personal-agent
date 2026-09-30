// Daemon core: tracks connected extensions and owns recording sessions.
import { randomUUID } from "node:crypto";
import type { Server } from "node:net";
import { Message } from "@taskplayer/core";
import { type Connection, listen } from "./server.ts";

const VERSION = "0.0.0";

export interface Daemon {
  server: Server;
  extensions: ReadonlySet<Connection>;
  // Starts a recording session. Web capture joins if Chrome is connected; Mac-only tasks work without it.
  startRecording(): string;
  stopRecording(): void;
  close(): Promise<void>;
}

export async function startDaemon(options: {
  socketPath: string;
  log?: (...args: unknown[]) => void;
}): Promise<Daemon> {
  const log = options.log ?? (() => {});
  const extensions = new Set<Connection>();
  let sessionId: string | undefined;

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
          send(connection, { id: message.id, type: "hello", from: "daemon", version: VERSION });
          // An extension that connects mid-session joins the recording.
          if (sessionId) send(connection, { id: randomUUID(), type: "record.start", sessionId });
          break;
        case "ping":
          send(connection, { id: message.id, type: "pong" });
          break;
        case "record.event":
          // TODO(recorder): append to the session trace alongside filesystem events.
          log("record.event", message.event);
          break;
        default:
          // TODO(player): route run.step_result to the running skill.
          log("unhandled", message.type);
      }
    },
    onClose(connection) {
      if (extensions.delete(connection)) log("extension disconnected");
    },
  });

  return {
    server,
    extensions,
    startRecording() {
      sessionId ??= randomUUID();
      // TODO(recorder): start filesystem (FSEvents) capture for this session.
      broadcast({ id: randomUUID(), type: "record.start", sessionId });
      log("recording", sessionId, `(${extensions.size} extension(s) capturing)`);
      return sessionId;
    },
    stopRecording() {
      if (!sessionId) return;
      broadcast({ id: randomUUID(), type: "record.stop", sessionId });
      log("stopped", sessionId);
      sessionId = undefined;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
