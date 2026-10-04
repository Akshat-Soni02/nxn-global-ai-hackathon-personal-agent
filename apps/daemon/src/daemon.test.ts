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
  return { send: (m: unknown) => socket.write(encode(m)), next, end: () => socket.end(), socket };
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

  it("starts and stops from the button in Chrome, and tells every extension", async () => {
    const socketPath = path();
    daemon = await startDaemon({ socketPath, drainMs: 0 });
    const ext = client(socketPath);
    ext.send({ id: "1", type: "hello", from: "extension", version: "test" });
    await ext.next("hello");

    ext.send({ id: "2", type: "record.command", command: "start" });
    const started = await ext.next("record.start");
    expect(started).toMatchObject({ sessionId: expect.any(String), startedAt: expect.any(Number) });

    ext.send({ id: "3", type: "record.command", command: "stop" });
    expect(await ext.next("record.stop")).toMatchObject({ sessionId: started.sessionId });
    ext.end();
  });

  it("hands the button's command to main.ts when it asks to handle it", async () => {
    const socketPath = path();
    const commands: string[] = [];
    daemon = await startDaemon({ socketPath, onRecordCommand: (c) => commands.push(c) });
    const ext = client(socketPath);
    ext.send({ id: "1", type: "hello", from: "extension", version: "test" });
    await ext.next("hello");
    ext.send({ id: "2", type: "record.command", command: "start" });
    for (let i = 0; i < 100 && commands.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(commands).toEqual(["start"]);
    ext.end();
  });

  it("keeps Task Player.app apart from Chrome: ax steps go to it, web steps never do", async () => {
    const socketPath = path();
    daemon = await startDaemon({ socketPath });
    const mac = client(socketPath);
    mac.send({ id: "1", type: "hello", from: "mac", version: "test", trusted: true });
    await mac.next("hello");
    expect(daemon.extensions.size).toBe(0);
    expect(daemon.mac()).toEqual({ connected: true, trusted: true });

    // Chrome connects later: it hears that the desktop button is on screen, after its hello.
    const ext = client(socketPath);
    ext.send({ id: "2", type: "hello", from: "extension", version: "test" });
    await ext.next("hello");
    expect(await ext.next("desktop.button")).toMatchObject({ present: true });

    const step = { id: "s1", intent: "Click Save", channel: "ax", action: "press", args: {} };
    const reply = daemon.requestMac({ id: "r1", type: "run.step", runId: "run", step } as never, 2_000);
    expect(await mac.next("run.step")).toMatchObject({ id: "r1", step: { channel: "ax" } });
    mac.send({ id: "r1", type: "run.step_result", runId: "run", stepId: "s1", ok: true, matchScore: 1 });
    expect(await reply).toMatchObject({ ok: true, matchScore: 1 });
    mac.end();
    ext.end();
  });

  it("shuts down while Chrome and Task Player.app are still connected, and ends their connections", async () => {
    const socketPath = path();
    const d = await startDaemon({ socketPath });
    const mac = client(socketPath);
    mac.send({ id: "1", type: "hello", from: "mac", version: "test" });
    await mac.next("hello");
    const ended = new Promise((resolve) => mac.socket.once("end", resolve));
    await d.close(); // used to wait forever for the open connection
    await ended; // Task Player.app quits when this happens
  });

  it("refuses to start twice on the same socket", async () => {
    const socketPath = path();
    daemon = await startDaemon({ socketPath });
    await expect(startDaemon({ socketPath })).rejects.toThrow(/already listening/);
  });
});
