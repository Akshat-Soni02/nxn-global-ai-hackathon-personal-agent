import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.ts";

describe("the daemon's log", () => {
  it("prints each line and writes it as JSON with its level", () => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-log-"));
    const printed: string[] = [];
    const log = createLogger({ dir, print: (l) => printed.push(l), now: () => new Date("2026-10-11T10:00:00Z") });
    log("listening on", "/tmp/d.sock");
    log.warn("macOS blocked", { folder: "~/Desktop" });
    log.error(new Error("compile failed"));
    expect(printed).toEqual([
      "[daemon] listening on /tmp/d.sock",
      '[daemon] macOS blocked {"folder":"~/Desktop"}',
      "[daemon] compile failed",
    ]);
    const lines = readFileSync(log.file, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { at: "2026-10-11T10:00:00.000Z", level: "info", component: "daemon", message: "listening on /tmp/d.sock" },
      {
        at: "2026-10-11T10:00:00.000Z",
        level: "warn",
        component: "daemon",
        message: 'macOS blocked {"folder":"~/Desktop"}',
      },
      { at: "2026-10-11T10:00:00.000Z", level: "error", component: "daemon", message: "compile failed" },
    ]);
  });

  it("rotates the file by size and keeps only a few", () => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-log-"));
    const log = createLogger({ dir, maxBytes: 200, keep: 2, print: () => {} });
    for (let i = 0; i < 20; i++) log(`line ${i} ${"x".repeat(40)}`);
    expect(existsSync(join(dir, "daemon.1.log"))).toBe(true);
    expect(existsSync(join(dir, "daemon.2.log"))).toBe(true);
    expect(existsSync(join(dir, "daemon.3.log"))).toBe(false);
    expect(readFileSync(log.file, "utf8")).toContain("line 19");
  });
});
