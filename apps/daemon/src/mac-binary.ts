// What Shadow.app's binary can do from the command line (--ocr, --redact, --transcribe), found without running it: a
// build too old to know a mode would start the whole app instead. Shadow.app keeps one line in the binary,
// "shadow-capabilities: ocr redact transcribe" (apps/mac/Sources/main.swift), and `Shadow --capabilities` prints it.
// Searching for the flags themselves doesn't work: Swift keeps strings of 15 bytes or fewer inside the machine code.
import { existsSync, readFileSync } from "node:fs";

const MARKER = "shadow-capabilities:";

export type MacCapability = "ocr" | "redact" | "transcribe";

export function macCapabilities(binary: string): Set<MacCapability> {
  const found = new Set<MacCapability>();
  try {
    if (!existsSync(binary)) return found;
    const bytes = readFileSync(binary);
    const at = bytes.indexOf(MARKER);
    if (at < 0) return found;
    const end = bytes.indexOf(0, at);
    const line = bytes.subarray(at + MARKER.length, end < 0 ? at + 200 : Math.min(end, at + 200)).toString("utf8");
    for (const word of line.split(/\s+/)) {
      if (word === "ocr" || word === "redact" || word === "transcribe") found.add(word);
    }
  } catch {
    // unreadable: nothing it can do
  }
  return found;
}
