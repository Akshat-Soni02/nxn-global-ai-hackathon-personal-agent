import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { RunContext } from "../types.ts";
import { fsChannel } from "./fs-channel.ts";
import { resolveInputs } from "./inputs.ts";

const step = (action: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  Skill.parse({
    id: "t",
    name: "t",
    version: 1,
    description: { goal: "t" },
    steps: [
      { id: "start", type: "trigger", intent: "t" },
      { id: "s", type: "action", intent: "t", channel: "fs", action, args, ...extra },
    ],
  }).steps[1] as ActionStep;
const pathOf = (v: unknown) => (v as { path: string }).path;
const ctx = (startedAt = 0): RunContext => ({ runId: "r", startedAt, inputs: {}, vars: {} });

function dir() {
  const d = mkdtempSync(join(tmpdir(), "tp-fs-"));
  const old = join(d, "old.pdf");
  writeFileSync(old, "1");
  utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
  writeFileSync(join(d, "new.pdf"), "2");
  writeFileSync(join(d, "pic.png"), "3");
  return d;
}

describe("fs channel", () => {
  it("finds the newest match, or all of them, with brace globs", async () => {
    const d = dir();
    expect((await fsChannel(step("find", { dir: d, glob: "*.pdf" }), ctx())).value).toMatchObject({
      path: join(d, "new.pdf"),
      name: "new.pdf",
      size: 1,
    });
    const all = (await fsChannel(step("find", { dir: d, glob: "*.{pdf,png}", pick: "all" }), ctx())).value;
    expect(all).toHaveLength(3);
  });

  it("ignores files older than the run with since_run_start", async () => {
    const d = dir();
    const r = await fsChannel(step("find", { dir: d, glob: "old.pdf", since_run_start: true }), ctx(Date.now() - 1000));
    expect(r.ok).toBe(false);
    // Checkpoint 6: "no file matches *.pdf", with yesterday's PDF right there. It says why it didn't count.
    expect(r.error).toBe(`no new file matches old.pdf in ${d} since the run started (older ones there: old.pdf)`);
  });

  it("moves a list into a folder and never overwrites", async () => {
    const d = dir();
    writeFileSync(join(d, "out-new.pdf"), "x");
    const moved = await fsChannel(step("move", { from: [join(d, "new.pdf")], to: `${d}/sorted/` }), ctx());
    expect((moved.value as unknown[]).map(pathOf)).toEqual([join(d, "sorted", "new.pdf")]);
    writeFileSync(join(d, "again.pdf"), "y");
    // A file value works wherever a path is expected.
    const again = { path: join(d, "again.pdf"), name: "again.pdf", size: 1, modified: "" };
    const clash = await fsChannel(step("move", { from: again, to: join(d, "pic.png") }), ctx());
    expect(pathOf(clash.value)).toBe(join(d, "pic (1).png"));
    expect(readFileSync(join(d, "pic.png"), "utf8")).toBe("3");
  });

  it("treats an empty list as a no-op", async () => {
    const d = dir();
    expect(await fsChannel(step("move", { from: [], to: `${d}/x/` }), ctx())).toEqual({ ok: true, value: [] });
  });

  it("writes, creating folders", async () => {
    const d = dir();
    const r = await fsChannel(step("write", { path: join(d, "a/b/c.md"), content: "hi" }), ctx());
    expect(readFileSync(pathOf(r.value), "utf8")).toBe("hi");
  });

  it("never overwrites a file it writes: a clash gets a suffix, as the header says (C28)", async () => {
    const d = dir();
    writeFileSync(join(d, "notes.md"), "mine");
    const r = await fsChannel(step("write", { path: join(d, "notes.md"), content: "new" }), ctx());
    expect(pathOf(r.value)).toBe(join(d, "notes (1).md"));
    expect(readFileSync(join(d, "notes.md"), "utf8")).toBe("mine");
    expect(readFileSync(join(d, "notes (1).md"), "utf8")).toBe("new");
  });

  it("appends to the file it is told to, and only then touches an existing one (C28)", async () => {
    const d = dir();
    writeFileSync(join(d, "log.txt"), "a\n");
    await fsChannel(step("write", { path: join(d, "log.txt"), content: "b\n", append: true }), ctx());
    expect(readFileSync(join(d, "log.txt"), "utf8")).toBe("a\nb\n");
  });

  it("writes a number or a yes/no as its text, and fails on a list or an object instead of writing an empty file (C28)", async () => {
    const d = dir();
    const n = await fsChannel(step("write", { path: join(d, "n.txt"), content: 42 }), ctx());
    expect(readFileSync(pathOf(n.value), "utf8")).toBe("42");
    const bad = await fsChannel(step("write", { path: join(d, "l.txt"), content: ["a", "b"] }), ctx());
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/text/);
  });
});

describe("file inputs resolved without asking", () => {
  const skillWith = (resolve: Record<string, unknown>) =>
    Skill.parse({
      id: "t",
      version: 1,
      name: "t",
      description: { goal: "t" },
      steps: [
        { id: "start", type: "trigger", intent: "t", inputs: { doc: { type: { type: "file" }, resolve } } },
        { id: "s", type: "action", intent: "t", channel: "fs", action: "read", args: { path: "{{doc.path}}" } },
      ],
    });

  it("takes the newest file the step can use: of the kind it takes, and not empty", async () => {
    const d = dir();
    writeFileSync(join(d, "empty.png"), ""); // newest of all, but empty
    expect(
      (await resolveInputs(skillWith({ dir: d, glob: "*", pick: "newest", accept: "image/*" }))).doc,
    ).toMatchObject({ path: join(d, "pic.png"), name: "pic.png" });
    expect((await resolveInputs(skillWith({ dir: d, glob: "*", pick: "all", accept: ".pdf" }))).doc).toHaveLength(2);
    await expect(
      resolveInputs(skillWith({ dir: d, glob: "*.pdf", pick: "newest", accept: "video/*" })),
    ).rejects.toThrow(/no file matches \*\.pdf .* \(taking video\/\*\)/);
  });
});

describe("a secret input, from the Keychain (N2)", () => {
  // A recorded password field became a secret input with no value, and the run stopped: "input password has no value".
  const withSecret = Skill.parse({
    id: "t",
    version: 1,
    name: "t",
    description: { goal: "t" },
    steps: [
      { id: "start", type: "trigger", intent: "t", inputs: { password: { type: { type: "secret" } } } },
      {
        id: "s",
        type: "action",
        intent: "t",
        channel: "fs",
        action: "write",
        args: { path: "~/x.txt", content: "{{password}}" },
      },
    ],
  });

  it("takes its value from where secrets are kept, and says where to set it when none is", async () => {
    const asked: string[] = [];
    const secret = async (name: string) => {
      asked.push(name);
      return name === "password" ? "hunter2" : undefined;
    };
    expect(await resolveInputs(withSecret, {}, { secret })).toEqual({ password: "hunter2" });
    expect(asked).toEqual(["password"]);
    await expect(resolveInputs(withSecret, {}, { secret: async () => undefined })).rejects.toThrow(
      /password is a secret nobody has set yet: set it on the workflow's page/,
    );
    // A value given for this run wins.
    expect(await resolveInputs(withSecret, { password: "given" }, { secret })).toEqual({ password: "given" });
  });
});

describe("a file's path, checked when it runs (F10)", () => {
  it("says which file isn't there, and when a value was never filled", async () => {
    const d = mkdtempSync(join(tmpdir(), "tp-fs-"));
    await expect(fsChannel(step("move", { from: join(d, "gone.pdf"), to: `${d}/out/` }), ctx())).rejects.toThrow(
      `no file at ${join(d, "gone.pdf")}`,
    );
    // As the runner would hand it over if a value was never filled (the schema refuses it in a saved workflow).
    const unfilled = { ...step("read", { path: "x" }), args: { path: join(d, "{{pdf.path}}") } };
    await expect(fsChannel(unfilled, ctx())).rejects.toThrow(/unfilled value/);
  });
});
