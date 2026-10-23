import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { emptyFiles, madeBy, notRunWhy, toTrash } from "./rehearse.ts";

const skill = (channel: "web" | "ax") =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "g" },
    steps: [
      { id: "start", type: "trigger", intent: "by hand" },
      channel === "web"
        ? {
            id: "s1",
            type: "action",
            intent: "open",
            channel: "web",
            action: "navigate",
            args: { url: "https://x.example/" },
          }
        : { id: "s1", type: "action", intent: "open", channel: "ax", action: "open", args: { app: "com.apple.Notes" } },
    ],
  });

describe("whether the test run can start", () => {
  it("says it can't before trying, when what the workflow needs isn't connected (no 30 s wait, no failed step)", () => {
    expect(notRunWhy(skill("web"), { extension: false, mac: true })).toBe("Chrome is not connected to Shadow");
    expect(notRunWhy(skill("web"), { extension: true, mac: false })).toBeUndefined();
    expect(notRunWhy(skill("ax"), { extension: true, mac: false })).toBe("Shadow.app is not running");
  });
});

describe("what the final check made goes to the Trash (Rushil, 24 Oct)", () => {
  const skill = Skill.parse({
    id: "t",
    name: "t",
    version: 1,
    description: { goal: "t" },
    steps: [
      { id: "start", type: "trigger", intent: "by hand" },
      { id: "s1", type: "action", intent: "read", channel: "web", action: "extract", target: { fallbacks: ["h1"] } },
      {
        id: "s2",
        type: "action",
        intent: "save",
        channel: "web",
        action: "save_pdf",
        args: { dir: "~/Reading", name: "x.pdf" },
        output: { name: "saved_1", type: { type: "file" } },
      },
    ],
  });

  it("knows the files it made: only its file-making steps that ran", () => {
    const report = {
      outcome: "succeeded",
      steps: [
        { id: "s1", status: "done", value: { path: "/not/a/file/step" } },
        { id: "s2", status: "done", value: { path: "/u/Reading/24 Oct - X.pdf", name: "24 Oct - X.pdf" } },
      ],
    };
    expect(madeBy(skill, report)).toEqual(["/u/Reading/24 Oct - X.pdf"]);
  });

  it("tells a file made empty (0 bytes) from one with something in it: an empty one fails the check", () => {
    const home = mkdtempSync(join(tmpdir(), "tp-empty-"));
    writeFileSync(join(home, "empty.pdf"), "");
    writeFileSync(join(home, "full.pdf"), "%PDF");
    expect(emptyFiles([join(home, "empty.pdf"), join(home, "full.pdf"), join(home, "gone.pdf")])).toEqual([
      join(home, "empty.pdf"),
    ]);
  });

  it("moves each to the Trash, never over another file there", () => {
    const home = mkdtempSync(join(tmpdir(), "tp-trash-"));
    const trash = join(home, ".Trash");
    mkdirSync(trash);
    writeFileSync(join(trash, "24 Oct - X.pdf"), "an older one");
    const made = join(home, "24 Oct - X.pdf");
    writeFileSync(made, "%PDF");
    expect(toTrash([made, join(home, "gone.pdf")], trash)).toEqual([made]);
    expect(existsSync(made)).toBe(false);
    expect(readFileSync(join(trash, "24 Oct - X (1).pdf"), "utf8")).toBe("%PDF");
  });
});
