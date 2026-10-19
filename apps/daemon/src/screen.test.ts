import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDecoder, encode } from "@shadow/ipc";
import { fakeLlm } from "@shadow/llm";
import type { Box } from "@shadow/recorder";
import { afterEach, describe, expect, it } from "vitest";
import { type Daemon, startDaemon } from "./daemon.ts";
import { finishRecording } from "./record.ts";
import { readNotes, writeForm } from "./recording-store.ts";
import { createScreenReader, type ScreenTools } from "./screen.ts";
import { appendTrace } from "./trace-store.ts";

const temp = () => mkdtempSync(join(tmpdir(), "screen-"));
const PAGE = "http://localhost:5173/upload.html";
const JPEG = `data:image/jpeg;base64,${Buffer.from("not really a jpeg").toString("base64")}`;
const box = (y: number) => ({ x: 10, y, w: 300, h: 20 });

// Stands in for Shadow.app's Vision text reading: what the picture "shows", and what was blacked out.
function fakeTools(lines: string[]) {
  const blackedOut: Box[][] = [];
  const tools: ScreenTools = {
    read: async () => lines.map((text, i) => ({ text, box: box(i * 30) })),
    blackOut: async (_path, boxes) => {
      blackedOut.push(boxes);
    },
  };
  return { tools, blackedOut };
}

function recording(home: string, sessionId = "s1", never: string[] = []) {
  writeForm(home, sessionId, {
    goal: "Weekly KPIs are in the sheet",
    changes: [],
    constants: [],
    never,
    when: [{ type: "manual" }],
    consent: { screen: true, microphone: false, pictures: false },
  });
  return sessionId;
}

describe("screenshots", () => {
  it("keep only masked words, black out what was masked and the known fields, and never send the rest", async () => {
    const home = temp();
    const sessionId = recording(home, "s1", ["Project Falcon"]);
    const { tools, blackedOut } = fakeTools([
      "Weekly metrics",
      "From: jane.doe@acme.com",
      "Card 4242 4242 4242 4242",
      "Re: Project Falcon budget",
    ]);
    const reader = createScreenReader({ dataDir: home, tools, never: () => ["Project Falcon"], log: () => {} });
    reader.add({ sessionId, eventId: "e1", at: 1500, image: JPEG, masks: [{ x: 0, y: 500, w: 200, h: 30 }] });
    await reader.idle();

    const saved = readFileSync(join(home, "recordings", sessionId, "screen.jsonl"), "utf8");
    expect(saved).not.toMatch(/jane|acme|4242|Falcon/);
    expect(JSON.parse(saved)).toEqual({
      at: 1500,
      eventId: "e1",
      text: "Weekly metrics\nFrom: ███\nCard ███\nRe: ███ budget",
    });
    // The lines that had something masked, and the password field the page reported.
    expect(blackedOut).toEqual([[box(30), box(60), box(90), { x: 0, y: 500, w: 200, h: 30 }]]);
    expect(existsSync(join(home, "recordings", sessionId, "shots", "e1.jpg"))).toBe(true);

    // The design agent reads the masked words next to the step; nothing unmasked is in any request to the model.
    appendTrace(home, {
      id: "e1",
      sessionId,
      at: 1000,
      event: "click",
      url: PAGE,
      target: { tag: "a", url: PAGE, role: "link", name: "Weekly metrics", fallbacks: [], selectors: { css: "#m" } },
    });
    expect(readNotes(home, sessionId)).toEqual([{ at: 1500, kind: "screen", text: expect.stringContaining("███") }]);
    const llm = fakeLlm([
      "{}",
      { toolCalls: [{ name: "read_recording", arguments: {} }] },
      { toolCalls: [{ name: "finish", arguments: { summary: "ok" } }] },
    ]);
    await finishRecording(sessionId, {
      dataDir: home,
      llm,
      log: () => {},
      design: { protocol: "tools" },
      prompter: { ask: async () => "" },
    });
    const sent = JSON.stringify(llm.requests);
    expect(sent).toContain("on screen: Weekly metrics");
    expect(sent).not.toContain("jane");
    expect(sent).not.toContain("acme.com");
    expect(sent).not.toContain("4242 4242");
    // The Never term itself is the user's own words on the form, which the model reads; from the screen it is masked.
    expect(sent).not.toContain("Project Falcon budget");
  });

  it("delete a picture that can't be read or masked, and keep nothing unmasked", async () => {
    const home = temp();
    const sessionId = recording(home);
    const failing: ScreenTools = {
      read: async () => {
        throw new Error("Vision failed");
      },
      blackOut: async () => {},
    };
    const said: string[] = [];
    const reader = createScreenReader({
      dataDir: home,
      tools: failing,
      never: () => [],
      log: (...a) => said.push(a.join(" ")),
    });
    reader.add({ sessionId, eventId: "e1", at: 1, image: JPEG });
    // Without Shadow.app's binary nothing can be read either.
    const none = createScreenReader({ dataDir: home, never: () => [], log: (...a) => said.push(a.join(" ")) });
    none.add({ sessionId, eventId: "e2", at: 2, image: JPEG });
    await Promise.all([reader.idle(), none.idle()]);
    expect(readdirSync(join(home, "recordings", sessionId, "shots"))).toEqual([]);
    expect(existsSync(join(home, "recordings", sessionId, "screen.jsonl"))).toBe(false);
    expect(said.join("\n")).toMatch(/couldn't be read or masked, so it was deleted/);
    expect(said.join("\n")).toMatch(/need Shadow.app to read and mask them/);
  });

  it("read only pictures in the recording's own folder", async () => {
    const home = temp();
    const sessionId = recording(home);
    const elsewhere = join(temp(), "secret.jpg");
    writeFileSync(elsewhere, "x");
    const { tools } = fakeTools(["anything"]);
    let read = 0;
    const counting: ScreenTools = { ...tools, read: async (p) => (read++, tools.read(p)) };
    const reader = createScreenReader({ dataDir: home, tools: counting, never: () => [], log: () => {} });
    reader.add({ sessionId, eventId: "e1", at: 1, path: elsewhere });
    reader.add({ sessionId, eventId: "../e2", at: 2, image: JPEG });
    await reader.idle();
    expect(read).toBe(0);
  });
});

describe("screenshots over the socket", () => {
  let daemon: Daemon | undefined;
  afterEach(() => daemon?.close());

  it("are asked for in record.start only when the form allowed them, and dropped otherwise", async () => {
    const home = temp();
    const shots: string[] = [];
    daemon = await startDaemon({
      socketPath: join(temp(), "d.sock"),
      dataDir: home,
      watchDirs: [],
      drainMs: 20,
      onShot: (shot) => shots.push(shot.eventId),
    });
    const socket = daemon.server.address() as string;
    const received: { type: string; consent?: unknown; dir?: string }[] = [];
    const ext = connect(socket);
    ext.on(
      "data",
      createDecoder((m) => received.push(m as (typeof received)[number])),
    );
    ext.write(encode({ id: "1", type: "hello", from: "extension", version: "test" }));
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
    };
    const shot = (sessionId: string, eventId: string) =>
      ext.write(encode({ id: eventId, type: "record.shot", sessionId, eventId, at: 1, image: JPEG }));

    const yes = daemon.startRecording({ consent: { screen: true, microphone: false, pictures: false } });
    await until(() => received.some((m) => m.type === "record.start"));
    expect(received.find((m) => m.type === "record.start")).toMatchObject({
      consent: { screen: true, microphone: false, pictures: false },
      dir: join(home, "recordings", yes),
    });
    shot(yes, "a");
    shot("another-session", "b");
    // A real tab picture is a few MB as a data URL: messages from the extension have no 1 MB cap on this side.
    const big = `data:image/jpeg;base64,${Buffer.alloc(1_600_000, 7).toString("base64")}`;
    // Framed the way Chrome frames it (our own encode caps what the daemon sends Chrome at 1 MB).
    const json = Buffer.from(
      JSON.stringify({ id: "big", type: "record.shot", sessionId: yes, eventId: "big", at: 2, image: big }),
    );
    const header = Buffer.alloc(4);
    header.writeUInt32LE(json.length, 0);
    ext.write(Buffer.concat([header, json]));
    await until(() => shots.length > 1);
    await daemon.stopRecording();

    const no = daemon.startRecording({ consent: { screen: false, microphone: false, pictures: false } });
    shot(no, "c");
    await new Promise((r) => setTimeout(r, 50));
    await daemon.stopRecording();
    ext.end();
    expect(shots).toEqual(["a", "big"]);
  });
  it("keep a ledger line for every picture: taken, or why not", async () => {
    const home = temp();
    const sessionId = recording(home);
    const { tools } = fakeTools(["Inbox"]);
    const reader = createScreenReader({ dataDir: home, tools, never: () => [], log: () => {} });
    reader.add({ sessionId, eventId: "e1", at: 1, image: JPEG });
    reader.skip({ sessionId, eventId: "e2", at: 2, reason: "rate-limit" });
    await reader.idle();
    const ledger = readFileSync(join(home, "recordings", sessionId, "shots.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(ledger).toEqual([
      { eventId: "e2", at: 2, outcome: "skipped", reason: "rate-limit" },
      { eventId: "e1", at: 1, outcome: "taken" },
    ]);
  });

  it("say no-tools for every picture when Shadow.app can't read pictures, instead of losing them silently", async () => {
    const home = temp();
    const sessionId = recording(home);
    const reader = createScreenReader({ dataDir: home, tools: undefined, never: () => [], log: () => {} });
    reader.add({ sessionId, eventId: "e1", at: 1, image: JPEG });
    reader.add({ sessionId, eventId: "e2", at: 2, image: JPEG });
    await reader.idle();
    const ledger = readFileSync(join(home, "recordings", sessionId, "shots.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(ledger.map((l) => JSON.parse(l).outcome)).toEqual(["no-tools", "no-tools"]);
  });
});
