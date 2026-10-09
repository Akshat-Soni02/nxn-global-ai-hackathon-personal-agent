import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionStep, Skill } from "@taskplayer/core";
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
    steps: [{ id: "s", type: "action", intent: "t", channel: "fs", action, args, ...extra }],
  }).steps[0] as ActionStep;
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
    expect((await fsChannel(step("find", { dir: d, glob: "*.pdf" }), ctx())).value).toBe(join(d, "new.pdf"));
    const all = (await fsChannel(step("find", { dir: d, glob: "*.{pdf,png}", pick: "all" }), ctx())).value;
    expect(all).toHaveLength(3);
  });

  it("ignores files older than the run with since_run_start", async () => {
    const d = dir();
    const r = await fsChannel(step("find", { dir: d, glob: "old.pdf", since_run_start: true }), ctx(Date.now() - 1000));
    expect(r.ok).toBe(false);
  });

  it("moves a list into a folder and never overwrites", async () => {
    const d = dir();
    writeFileSync(join(d, "out-new.pdf"), "x");
    const moved = await fsChannel(step("move", { from: [join(d, "new.pdf")], to: `${d}/sorted/` }), ctx());
    expect(moved.value).toEqual([join(d, "sorted", "new.pdf")]);
    writeFileSync(join(d, "again.pdf"), "y");
    const clash = await fsChannel(step("move", { from: join(d, "again.pdf"), to: join(d, "pic.png") }), ctx());
    expect(clash.value).toBe(join(d, "pic (1).png"));
    expect(readFileSync(join(d, "pic.png"), "utf8")).toBe("3");
  });

  it("treats an empty list as a no-op", async () => {
    const d = dir();
    expect(await fsChannel(step("move", { from: [], to: `${d}/x/` }), ctx())).toEqual({ ok: true, value: [] });
  });

  it("writes, creating folders", async () => {
    const d = dir();
    const r = await fsChannel(step("write", { path: join(d, "a/b/c.md"), content: "hi" }), ctx());
    expect(readFileSync(r.value as string, "utf8")).toBe("hi");
  });
});

describe("file inputs resolved without asking", () => {
  const skillWith = (resolve: Record<string, unknown>) =>
    Skill.parse({
      id: "t",
      version: 1,
      name: "t",
      description: { goal: "t" },
      inputs: { doc: { type: "file", resolve } },
      steps: [
        { id: "s", type: "action", intent: "t", channel: "fs", action: "read", args: { path: "{{inputs.doc}}" } },
      ],
    });

  it("takes the newest file the step can use: of the kind it takes, and not empty", async () => {
    const d = dir();
    writeFileSync(join(d, "empty.png"), ""); // newest of all, but empty
    expect((await resolveInputs(skillWith({ dir: d, glob: "*", pick: "newest", accept: "image/*" }))).doc).toBe(
      join(d, "pic.png"),
    );
    expect((await resolveInputs(skillWith({ dir: d, glob: "*", pick: "all", accept: ".pdf" }))).doc).toHaveLength(2);
    await expect(
      resolveInputs(skillWith({ dir: d, glob: "*.pdf", pick: "newest", accept: "video/*" })),
    ).rejects.toThrow(/no file matches \*\.pdf .* \(taking video\/\*\)/);
  });
});
