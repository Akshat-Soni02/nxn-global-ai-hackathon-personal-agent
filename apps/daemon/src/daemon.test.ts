import { mkdtempSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDecoder, encode } from "@taskplayer/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { type Daemon, startDaemon } from "./daemon.ts";

let daemon: Daemon | undefined;
afterEach(() => daemon?.close());

function client(path: string) {
  const received: { type: string; [key: string]: unknown }[] = [];
  const socket: Socket = connect(path);
  socket.on(
    "data",
    createDecoder((m) => received.push(m as (typeof received)[number])),
  );
  const next = async (type: string) => {
    for (let i = 0; i < 100; i++) {
      const found = received.find((m) => m.type === type);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${type} message`);
  };
  return { send: (m: unknown) => socket.write(encode(m)), next, end: () => socket.end() };
}

describe("daemon socket", () => {
  const path = () => join(mkdtempSync(join(tmpdir(), "tp-")), "d.sock");

  it("answers hello and ping", async () => {
    const socketPath = path();
    daemon = await startDaemon({ socketPath });
    const ext = client(socketPath);
    ext.send({ id: "1", type: "hello", from: "extension", version: "test" });
    expect(await ext.next("hello")).toMatchObject({ from: "daemon" });
    ext.send({ id: "2", type: "ping" });
    expect(await ext.next("pong")).toMatchObject({ id: "2" });
    ext.end();
  });

  it("records with no extension connected, and tells extensions that join mid-session", async () => {
    const socketPath = path();
    daemon = await startDaemon({ socketPath });
    const sessionId = daemon.startRecording();

    const ext = client(socketPath);
    ext.send({ id: "1", type: "hello", from: "extension", version: "test" });
    expect(await ext.next("record.start")).toMatchObject({ sessionId });

    daemon.stopRecording();
    expect(await ext.next("record.stop")).toMatchObject({ sessionId });
    ext.end();
  });

  it("refuses to start twice on the same socket", async () => {
    const socketPath = path();
    daemon = await startDaemon({ socketPath });
    await expect(startDaemon({ socketPath })).rejects.toThrow(/already listening/);
  });
});
