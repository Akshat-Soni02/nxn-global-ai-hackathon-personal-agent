import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Skill } from "@taskplayer/core";
import { createDecoder, encode } from "@taskplayer/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { type Daemon, startDaemon } from "./daemon.ts";
import { classify, type FsChange, watchFiles } from "./fs-watch.ts";
import { locateFile, locateFiles } from "./locate-file.ts";
import { finishRecording } from "./record.ts";
import { loadSkill, saveSkill, versions } from "./skill-store.ts";
import { appendTrace, readTrace, tracePath } from "./trace-store.ts";

const temp = () => mkdtempSync(join(tmpdir(), "tp-"));
const PAGE = "http://localhost:5173/upload.html";
const upload = {
  tag: "input",
  url: PAGE,
  role: "button",
  name: "Upload invoice",
  near: "Documents",
  fallbacks: [],
  selectors: { css: "input[type=file][name=invoice]" },
};
const submit = {
  tag: "button",
  url: PAGE,
  role: "button",
  name: "Submit",
  fallbacks: [],
  selectors: { css: "#submit" },
};

let daemon: Daemon | undefined;
afterEach(() => daemon?.close());

describe("trace store", () => {
  it("appends events as lines and reads them back in time order, skipping a torn last line", () => {
    const dir = temp();
    appendTrace(dir, { id: "b", sessionId: "s1", at: 2, event: "click" });
    appendTrace(dir, { id: "a", sessionId: "s1", at: 1, event: "navigate", url: PAGE });
    appendFileSync(tracePath(dir, "s1"), '{"id":"c","sessio');
    expect(readTrace(dir, "s1").map((e) => e.id)).toEqual(["a", "b"]);
    expect(() => tracePath(dir, "../escape")).toThrow(/invalid session id/);
  });
});

describe("skill store", () => {
  it("saves each version as a new file and never overwrites one", () => {
    const dir = temp();
    const skill = Skill.parse({
      id: "demo",
      version: 1,
      intent: "first",
      steps: [{ id: "s1", intent: "x", channel: "web", action: "navigate" }],
    });
    const v1 = saveSkill(dir, skill);
    const v2 = saveSkill(dir, { ...skill, intent: "second" });
    expect([v1.skill.version, v2.skill.version, versions(dir, "demo")]).toEqual([1, 2, [1, 2]]);
    expect(JSON.parse(readFileSync(v1.path, "utf8")).intent).toBe("first");
    expect(loadSkill(dir, "demo")?.intent).toBe("second"); // the highest version is the active one
  });
});

describe("file changes", () => {
  it("classifies FSEvents observations into create, move and rename, ignoring temporary files", () => {
    const at = 1;
    expect(
      classify([
        { kind: "vanish", path: "/u/Downloads/a.pdf", at, ino: 7 },
        { kind: "appear", path: "/u/Documents/a.pdf", at, ino: 7 },
        { kind: "vanish", path: "/u/Desktop/x.png", at, ino: 9 },
        { kind: "appear", path: "/u/Desktop/y.png", at, ino: 9 },
        { kind: "vanish", path: "/u/Downloads/Unconfirmed 1.crdownload", at },
        { kind: "appear", path: "/u/Downloads/invoice-1001.pdf", at, ino: 11 },
        { kind: "appear", path: "/u/Desktop/.DS_Store", at, ino: 12 },
      ]),
    ).toEqual([
      { event: "fs_move", path: "/u/Downloads/a.pdf", toPath: "/u/Documents/a.pdf", at },
      { event: "fs_rename", path: "/u/Desktop/x.png", toPath: "/u/Desktop/y.png", at },
      { event: "fs_create", path: "/u/Downloads/invoice-1001.pdf", at },
    ]);
  });

  // FSEvents is macOS-only; CI runs on Linux, where recursive fs.watch is a different backend. classify() above runs
  // everywhere.
  it.runIf(process.platform === "darwin")("watches a real folder through FSEvents", async () => {
    const dir = temp();
    writeFileSync(join(dir, "old.txt"), "x");
    const changes: FsChange[] = [];
    const watcher = watchFiles([dir], (c) => changes.push(c), { log: () => {}, settleMs: 150 });
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(dir, "new.txt"), "y");
    renameSync(join(dir, "old.txt"), join(dir, "renamed.txt"));
    for (let i = 0; i < 40 && changes.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    watcher.close();
    expect(changes.map((c) => [c.event, c.toPath ?? c.path])).toEqual(
      expect.arrayContaining([
        ["fs_create", join(dir, "new.txt")],
        ["fs_rename", join(dir, "renamed.txt")],
      ]),
    );
  });
});

describe("finding a file a page saw", () => {
  it("matches name and size, prefers the closest date, and skips files of another size", async () => {
    const home = temp();
    mkdirSync(join(home, "Movies/2026"), { recursive: true });
    mkdirSync(join(home, "Desktop"), { recursive: true });
    writeFileSync(join(home, "Movies/2026/vlog.mp4"), "12345678");
    writeFileSync(join(home, "Desktop/vlog.mp4"), "12345678");
    writeFileSync(join(home, "Desktop/other.mp4"), "123");
    utimesSync(join(home, "Movies/2026/vlog.mp4"), 1_790_000_000, 1_790_000_000);
    const searchDirs = [join(home, "Desktop"), join(home, "Movies")];
    const found = await locateFile(
      { name: "vlog.mp4", size: 8, type: "video/mp4", lastModified: 1_790_000_000_000 },
      { searchDirs, spotlight: async () => [] },
    );
    expect(found).toBe(join(home, "Movies/2026/vlog.mp4"));
    expect(
      await locateFile({ name: "vlog.mp4", size: 99, type: "" }, { searchDirs, spotlight: async () => [] }),
    ).toBeUndefined();
  });

  it("tries Spotlight first and fills in paths on the trace", async () => {
    const dir = temp();
    writeFileSync(join(dir, "a.pdf"), "abc");
    const asked: string[] = [];
    const trace = await locateFiles(
      [
        {
          id: "e1",
          sessionId: "s",
          at: 1,
          event: "drop",
          files: [{ name: "a.pdf", size: 3, type: "application/pdf" }],
        },
      ],
      {
        searchDirs: [],
        spotlight: async (name) => {
          asked.push(name);
          return [join(dir, name)];
        },
      },
    );
    expect(asked).toEqual(["a.pdf"]);
    expect(trace[0]?.files?.[0]?.path).toBe(join(dir, "a.pdf"));
  });
});

describe("record end to end", () => {
  it("record -> events over the socket -> stop -> a saved, valid skill", async () => {
    const home = temp();
    const socketPath = join(temp(), "d.sock");
    daemon = await startDaemon({ socketPath, dataDir: home, watchDirs: [], drainMs: 50 });

    const received: { type: string; sessionId?: string }[] = [];
    const ext = connect(socketPath);
    ext.on(
      "data",
      createDecoder((m) => received.push(m as (typeof received)[number])),
    );
    ext.write(encode({ id: "1", type: "hello", from: "extension", version: "test" }));
    const sessionId = daemon.startRecording();
    for (let i = 0; i < 50 && !received.some((m) => m.type === "record.start"); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const event = (id: string, at: number, body: object) =>
      ext.write(encode({ id, type: "record.event", sessionId, at, tabId: 1, frameId: 0, url: PAGE, ...body }));
    event("e1", 1000, { event: "click", target: upload });
    event("e2", 6000, {
      event: "file",
      target: upload,
      file: { name: "invoice-0923.pdf", size: 10, type: "application/pdf" },
    });
    event("e3", 9000, { event: "click", target: submit });
    event("e4", 9500, { event: "not-a-kind", target: submit }); // rejected by the message schema

    expect(await daemon.stopRecording()).toBe(sessionId);
    expect(readTrace(home, sessionId).map((e) => e.id)).toEqual(["e1", "e2", "e3"]);

    const asked: string[] = [];
    const saved = await finishRecording(sessionId, {
      dataDir: home,
      log: () => {},
      prompter: {
        ask: async (q) => {
          asked.push(q.id);
          return "";
        },
      },
    });
    ext.end();
    expect(asked).toEqual(["dir-invoice", "intent"]);
    expect(saved?.skill).toMatchObject({ id: "upload-invoice", version: 1 });
    expect(saved?.skill.steps.map((s) => s.action)).toEqual(["navigate", "upload", "click"]);
    expect(Skill.safeParse(JSON.parse(readFileSync(saved?.path ?? "", "utf8"))).success).toBe(true);
  });
});
