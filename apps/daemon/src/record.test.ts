import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { isAction, Skill } from "@taskplayer/core";
import { createDecoder, encode } from "@taskplayer/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { chooseFiles, cleanPath, givenInputs, splitArgs } from "./choose-file.ts";
import { type Daemon, startDaemon } from "./daemon.ts";
import { classify, type FsChange, ignored, watchDirsFromEnv, watchFiles } from "./fs-watch.ts";
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
      name: "first",
      description: { goal: "first" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand" },
        { id: "s1", type: "action", intent: "x", channel: "web", action: "navigate" },
      ],
    });
    const v1 = saveSkill(dir, skill);
    const v2 = saveSkill(dir, { ...skill, name: "second" });
    expect([v1.skill.version, v2.skill.version, versions(dir, "demo")]).toEqual([1, 2, [1, 2]]);
    expect(JSON.parse(readFileSync(v1.path, "utf8")).name).toBe("first");
    expect(loadSkill(dir, "demo")?.name).toBe("second"); // the highest version is the active one
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

describe("which folders are watched", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("is your whole home folder unless you say otherwise, skipping where apps keep their own files", () => {
    expect(watchDirsFromEnv({})).toEqual([homedir()]);
    expect(watchDirsFromEnv({ TASKPLAYER_WATCH_DIRS: "" })).toEqual([]);
    for (const path of [
      "/u/code/app/node_modules/x/index.js",
      "/u/Pictures/Photos Library.photoslibrary/database/a.db",
      "/u/Applications/Tool.app/Contents/Info.plist",
      "/u/.cache/a",
    ]) {
      expect(ignored(path), path).toBe(true);
    }
    expect(ignored("/u/Work/Clients/invoice.pdf")).toBe(false);
  });

  it.runIf(process.platform === "darwin")(
    "in a home folder: moves in your folders and your cloud drive are recorded, files apps write in Library are not",
    async () => {
      const home = temp();
      mkdirSync(join(home, "Library/Caches"), { recursive: true });
      mkdirSync(join(home, "Work/Clients"), { recursive: true });
      mkdirSync(join(home, "Work/Done"), { recursive: true });
      const drive = join(home, "Library/CloudStorage/GoogleDrive-me/My Drive");
      mkdirSync(join(drive, "Inbox"), { recursive: true });
      mkdirSync(join(drive, "Filed"), { recursive: true });
      writeFileSync(join(home, "Work/Clients/invoice.pdf"), "x");
      writeFileSync(join(drive, "Inbox/receipt.pdf"), "x");
      await sleep(300); // FSEvents reports a file made just before the watch starts: let that pass first
      const changes: FsChange[] = [];
      const watcher = watchFiles([home], (c) => changes.push(c), { log: () => {}, settleMs: 150, home });
      await sleep(200);
      writeFileSync(join(home, "Library/Caches/app.db"), "noise");
      renameSync(join(home, "Work/Clients/invoice.pdf"), join(home, "Work/Done/invoice.pdf"));
      renameSync(join(drive, "Inbox/receipt.pdf"), join(drive, "Filed/receipt.pdf")); // Google Drive, in Library
      for (let i = 0; i < 40 && changes.filter((c) => c.event === "fs_move").length < 2; i++) await sleep(50);
      await sleep(300);
      watcher.close();
      expect(changes.map((c) => [c.event, c.toPath ?? c.path])).toEqual([
        ["fs_move", join(home, "Work/Done/invoice.pdf")],
        ["fs_move", join(drive, "Filed/receipt.pdf")],
      ]);
    },
  );

  it.runIf(process.platform === "darwin")(
    "a folder Finder shows outside the watched ones (an external drive) is watched from then on",
    async () => {
      const data = temp();
      const drive = temp();
      mkdirSync(join(drive, "Done"));
      writeFileSync(join(drive, "scan.pdf"), "x");
      await sleep(300);
      daemon = await startDaemon({ socketPath: join(temp(), "d.sock"), dataDir: data, watchDirs: [temp()] });
      const sessionId = daemon.startRecording();
      const app = connect(daemon.server.address() as string);
      app.write(encode({ id: "1", type: "hello", from: "mac", version: "test" }));
      // The Finder window shows the drive's folder; the file then goes into its Done folder.
      app.write(encode({ id: "2", type: "watch.folder", path: drive }));
      await sleep(400);
      renameSync(join(drive, "scan.pdf"), join(drive, "Done/scan.pdf"));
      await sleep(1_200);
      await daemon.stopRecording();
      app.end();
      expect(readTrace(data, sessionId).map((e) => e.event)).toContain("fs_move");
    },
  );
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
    expect(asked).toEqual(["file-invoice", "dir-invoice", "intent"]); // which file next time, then where they arrive
    expect(saved?.skill).toMatchObject({ id: "upload-invoice", version: 1 });
    expect(saved?.skill.steps.map((s) => (isAction(s) ? s.action : s.type))).toEqual([
      "trigger",
      "navigate",
      "upload",
      "click",
    ]);
    expect(Skill.safeParse(JSON.parse(readFileSync(saved?.path ?? "", "utf8"))).success).toBe(true);
  });
});

describe("choosing the file when a skill runs", () => {
  const skillFor = (resolve: Record<string, unknown>) =>
    Skill.parse({
      id: "file-photo",
      version: 1,
      name: "File a photo",
      description: { goal: "File a photo" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand", inputs: { photo: { type: { type: "file" }, resolve } } },
        {
          id: "s1",
          type: "action",
          intent: "Move the photo to ~/Desktop/rushil",
          channel: "fs",
          action: "move",
          args: { from: "{{photo}}", to: "~/Desktop/rushil/" },
        },
      ],
    });

  it("reads a path dragged into the terminal from Finder, or typed with quotes or ~", () => {
    expect(cleanPath("/Users/me/Downloads/Rushil\\ Jariwala\\ Photo.jpeg ")).toBe(
      "/Users/me/Downloads/Rushil Jariwala Photo.jpeg",
    );
    expect(cleanPath("'/Users/me/My Photo.jpeg'")).toBe("/Users/me/My Photo.jpeg");
    expect(cleanPath("~/x.jpeg")).toBe(join(homedir(), "x.jpeg"));
    expect(cleanPath("   ")).toBe("");
  });

  it("asks which file: Enter takes the newest like the recorded one, or any other file you give", async () => {
    const dir = temp();
    const other = temp();
    writeFileSync(join(dir, "old.jpeg"), "x");
    utimesSync(join(dir, "old.jpeg"), 1_700_000_000, 1_700_000_000);
    writeFileSync(join(dir, "new.jpeg"), "x");
    writeFileSync(join(other, "Another Photo.jpeg"), "x");
    const skill = skillFor({ dir, glob: "*.jpeg", pick: "newest", ask: true });
    const asked: string[] = [];

    const enter: Record<string, unknown> = {};
    await chooseFiles(
      skill,
      enter,
      async (q) => {
        asked.push(`${q.text} | ${q.default}`);
        return ""; // Enter
      },
      () => {},
    );
    expect(enter.photo).toBe(join(dir, "new.jpeg"));
    expect(asked[0]).toMatch(/^Move the photo to ~\/Desktop\/rushil: which file\?.* \| .*new\.jpeg$/);

    const dragged: Record<string, unknown> = {};
    const dropped = `${join(other, "Another Photo.jpeg").replaceAll(" ", "\\ ")} `;
    await chooseFiles(
      skill,
      dragged,
      async () => dropped,
      () => {},
    );
    expect(dragged.photo).toBe(join(other, "Another Photo.jpeg"));
  });

  it("does not ask when you chose a fixed rule, or gave the file on the command line", async () => {
    const ask = async () => {
      throw new Error("should not ask");
    };
    const dir = temp();
    writeFileSync(join(dir, "My Photo.jpeg"), "x");
    await chooseFiles(skillFor({ dir, glob: "*.jpeg", pick: "newest", ask: false }), {}, ask, () => {});
    const given: Record<string, unknown> = { photo: join(dir, "My Photo.jpeg") };
    await chooseFiles(skillFor({ dir, glob: "*.jpeg", pick: "newest", accept: "image/*" }), given, ask, () => {});
    expect(given.photo).toBe(join(dir, "My Photo.jpeg"));
  });

  it("stops before the first step when the file given with the command is missing, empty or the wrong kind", async () => {
    const ask = async () => {
      throw new Error("should not ask");
    };
    const dir = temp();
    writeFileSync(join(dir, "report.pdf"), "x");
    writeFileSync(join(dir, "blank.jpeg"), "");
    const skill = skillFor({ dir, glob: "*.jpeg", pick: "newest", accept: "image/*" });
    await expect(chooseFiles(skill, { photo: join(dir, "gone.jpeg") }, ask, () => {})).rejects.toThrow(/no file at/);
    await expect(chooseFiles(skill, { photo: join(dir, "blank.jpeg") }, ask, () => {})).rejects.toThrow(/empty/);
    await expect(chooseFiles(skill, { photo: dir }, ask, () => {})).rejects.toThrow(/is a folder/);
    await expect(chooseFiles(skill, { photo: join(dir, "report.pdf") }, ask, () => {})).rejects.toThrow(
      "photo: report.pdf is the wrong kind of file: this step takes images",
    );
  });

  it("says why a file you give is wrong and asks again; the suggestion is only ever a file the step takes", async () => {
    const dir = temp();
    writeFileSync(join(dir, "photo.png"), "x");
    utimesSync(join(dir, "photo.png"), 1_700_000_000, 1_700_000_000);
    writeFileSync(join(dir, "newer.jpeg"), ""); // newest, but empty
    writeFileSync(join(dir, "report.pdf"), "x");
    const skill = skillFor({ dir, glob: "*", pick: "newest", ask: true, accept: "image/*" });
    const answers = [join(dir, "report.pdf"), ""];
    const said: string[] = [];
    const asked: (string | undefined)[] = [];
    const provided: Record<string, unknown> = {};
    await chooseFiles(
      skill,
      provided,
      async (q) => {
        asked.push(q.default);
        return answers.shift() ?? "";
      },
      (line) => said.push(String(line)),
    );
    expect(asked[0]).toBe(join(dir, "photo.png"));
    expect(said).toEqual(["report.pdf is the wrong kind of file: this step takes images"]);
    expect(provided.photo).toBe(join(dir, "photo.png"));
  });

  it("tells you which files a run on all of them leaves out, and why", async () => {
    const dir = temp();
    writeFileSync(join(dir, "a.jpeg"), "x");
    writeFileSync(join(dir, "notes.txt"), "x");
    const said: string[] = [];
    const skill = skillFor({ dir, glob: "*", pick: "all", accept: "image/*" });
    await chooseFiles(
      skill,
      {},
      async () => "",
      (line) => said.push(String(line)),
    );
    expect(said).toEqual(["skipping: notes.txt is the wrong kind of file: this step takes images"]);
  });

  it("splits a command line as a shell would, and puts a bare path in the skill's only file input", () => {
    expect(splitArgs("run file-photo /Users/me/My\\ Photo.jpeg")).toEqual([
      "run",
      "file-photo",
      "/Users/me/My Photo.jpeg",
    ]);
    expect(splitArgs(`run x photo='~/a b.jpeg'  note="say \\"hi\\""`)).toEqual([
      "run",
      "x",
      "photo=~/a b.jpeg",
      'note=say "hi"',
    ]);
    const skill = skillFor({ dir: temp(), glob: "*.jpeg", pick: "newest" });
    expect(givenInputs(skill, ["/Users/me/My Photo.jpeg"])).toEqual({ photo: "/Users/me/My Photo.jpeg" });
    expect(givenInputs(skill, ["photo=~/x.jpeg"])).toEqual({ photo: "~/x.jpeg" });
    expect(() => givenInputs(skill, ["picture=~/x.jpeg"])).toThrow(/has no input picture \(it has: photo\)/);
  });

  it("gives up after three answers that are not files", async () => {
    const skill = skillFor({ dir: temp(), glob: "*.jpeg", pick: "newest", ask: true });
    await expect(
      chooseFiles(
        skill,
        {},
        async () => "/no/such/file.jpeg",
        () => {},
      ),
    ).rejects.toThrow(/no file chosen/);
  });
});
