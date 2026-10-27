import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtExtension, staleExtension } from "./extension-build.ts";

// C25: every extension build said 0.0.0, so a Chrome still running yesterday's copy (no pictures, old fixes) looked the
// same as a fresh one. Each build now has its own id, and the daemon says when the one in Chrome isn't the one built.
describe("the extension in Chrome against the one built (C25)", () => {
  it("reads the build's id beside the bundle", () => {
    const dist = mkdtempSync(join(tmpdir(), "ext-dist-"));
    expect(builtExtension(dist)).toBeUndefined();
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "build.json"), JSON.stringify({ build: "mh3k2a" }));
    expect(builtExtension(dist)).toBe("mh3k2a");
  });

  it("says Chrome's copy is old only when both builds are known and differ", () => {
    expect(staleExtension("0.0.0+mh3k2a", "mh3k2a")).toBe(false);
    expect(staleExtension("0.0.0+mh0000", "mh3k2a")).toBe(true);
    // A copy built before ids existed says only its version: old.
    expect(staleExtension("0.0.0", "mh3k2a")).toBe(true);
    // Nothing built here (Shadow.app, a store install): nothing to compare.
    expect(staleExtension("0.0.0+mh0000", undefined)).toBe(false);
  });
});
