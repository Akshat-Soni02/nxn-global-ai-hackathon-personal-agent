import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateLegacyDataDir } from "./paths.ts";

describe("migrateLegacyDataDir", () => {
  const dirs = () => {
    const root = mkdtempSync(join(tmpdir(), "shadow-paths-"));
    return { from: join(root, "TaskPlayer"), to: join(root, "Shadow") };
  };

  it("moves the old folder to the new name", () => {
    const { from, to } = dirs();
    mkdirSync(join(from, "runs"), { recursive: true });
    writeFileSync(join(from, "runs", "r1.jsonl"), "{}\n");
    expect(migrateLegacyDataDir(from, to)).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(join(to, "runs", "r1.jsonl"), "utf8")).toBe("{}\n");
  });

  it("never overwrites a new folder that already exists", () => {
    const { from, to } = dirs();
    mkdirSync(from);
    mkdirSync(to);
    writeFileSync(join(to, "keep"), "new");
    expect(migrateLegacyDataDir(from, to)).toBe(false);
    expect(existsSync(from)).toBe(true);
    expect(readFileSync(join(to, "keep"), "utf8")).toBe("new");
  });

  it("does nothing without an old folder", () => {
    const { from, to } = dirs();
    expect(migrateLegacyDataDir(from, to)).toBe(false);
    expect(existsSync(to)).toBe(false);
  });
});
