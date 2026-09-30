// The daemon's Unix socket. Each connection is one extension (one Chrome profile) bridged by apps/native-host.
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { createDecoder, encode } from "@taskplayer/ipc";

export interface Connection {
  send(message: unknown): void;
  close(): void;
}

export interface ServerHandlers {
  onMessage(connection: Connection, message: unknown): void;
  onClose?(connection: Connection): void;
}

export async function listen(path: string, handlers: ServerHandlers): Promise<Server> {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (await isAlive(path)) throw new Error(`another daemon is already listening on ${path}`);
    unlinkSync(path); // stale socket left by a crashed daemon
  }

  const server = createServer((socket: Socket) => {
    const connection: Connection = {
      send: (message) => socket.write(encode(message)),
      close: () => socket.end(),
    };
    socket.on(
      "data",
      createDecoder((message) => handlers.onMessage(connection, message)),
    );
    socket.on("close", () => handlers.onClose?.(connection));
    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return server;
}

function isAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path);
    probe.once("connect", () => {
      probe.end();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}
