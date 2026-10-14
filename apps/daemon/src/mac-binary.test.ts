import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { macCapabilities } from "./mac-binary.ts";
import { screenToolsFrom } from "./screen.ts";
import { transcriberFrom } from "./voice.ts";

const temp = () => mkdtempSync(join(tmpdir(), "mac-binary-"));
// A stand-in binary: machine code around the bytes given.
function binary(...parts: string[]) {
  const file = join(temp(), "Shadow");
  writeFileSync(
    file,
    Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 7]), ...parts.map((p) => Buffer.from(p))]),
  );
  return file;
}
const LINE = "shadow-capabilities: ocr redact transcribe\0";
const built = join(import.meta.dirname, "../../mac/build/Shadow.app/Contents/MacOS/Shadow");

describe("what Shadow.app's binary can do", () => {
  it("reads the capabilities line, up to its end", () => {
    const file = binary("\0\0", LINE, "transcribe-not-this\0");
    expect([...macCapabilities(file)].sort()).toEqual(["ocr", "redact", "transcribe"]);
    expect(screenToolsFrom(file)).toBeDefined();
    expect(transcriberFrom(file)).toBeDefined();
  });

  it("gives each tool only what the build lists", () => {
    const file = binary("shadow-capabilities: ocr redact\0");
    expect(screenToolsFrom(file)).toBeDefined();
    expect(transcriberFrom(file)).toBeUndefined();
  });

  it("never takes the flags' own names as the answer (an older build would start the app)", () => {
    const file = binary("--ocr\0--redact\0--transcribe\0");
    expect(macCapabilities(file).size).toBe(0);
    expect(screenToolsFrom(file)).toBeUndefined();
  });

  it("has nothing when the app isn't built", () => {
    expect(macCapabilities(join(temp(), "missing")).size).toBe(0);
  });

  // The real build, when there is one (pnpm setup:mac): the line must survive the optimiser.
  it.skipIf(!existsSync(built))("finds every mode in the built Shadow.app", () => {
    expect([...macCapabilities(built)].sort()).toEqual(["ocr", "redact", "transcribe"]);
  });
});
