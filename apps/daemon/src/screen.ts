// Screenshots of a recording (docs/design.md, "Redaction"). Each picture is saved in the recording's folder
// (shots/<event>.jpg), its words are read on the Mac (`Shadow --ocr`, Apple's Vision framework), masked
// (packages/recorder/src/mask.ts), and the masked lines and the known password and card fields are blacked out in the
// picture (`Shadow --redact`). Only the masked words are kept as text (screen.jsonl), and only they can reach the
// model; the picture never leaves the Mac and goes with the folder a day later. One picture at a time, so recording
// is never held up. A picture that can't be read or blacked out is deleted rather than kept unmasked.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { type Box, type Line, maskLines } from "@shadow/recorder";
import { macCapabilities } from "./mac-binary.ts";
import { recordingDir } from "./recording-store.ts";

const run = promisify(execFile);
type Log = (...args: unknown[]) => void;

export interface Shot {
  sessionId: string;
  eventId: string;
  at: number;
  // From Chrome: the picture (a JPEG data URL), and boxes to black out (password and card fields).
  image?: string;
  masks?: Box[];
  // From Shadow.app: the file it saved in the recording's folder.
  path?: string;
  // The tab it is of, and when it was taken (a queued picture may be taken a moment after its event).
  tabId?: number;
  takenAt?: number;
}

// Reading words in a picture and blacking out boxes: Shadow.app's command-line modes, or a stand-in in tests.
export interface ScreenTools {
  read(path: string): Promise<Line[]>;
  blackOut(path: string, boxes: Box[]): Promise<void>;
}

export function appScreenTools(binary: string): ScreenTools {
  return {
    async read(path) {
      const { stdout } = await run(binary, ["--ocr", path], { timeout: 120_000, maxBuffer: 10_000_000 });
      return (JSON.parse(stdout) as { lines: Line[] }).lines;
    },
    async blackOut(path, boxes) {
      if (boxes.length === 0) return;
      const list = `${path}.boxes.json`;
      writeFileSync(list, JSON.stringify(boxes), { mode: 0o600 });
      try {
        await run(binary, ["--redact", path, list], { timeout: 60_000 });
      } finally {
        rmSync(list, { force: true });
      }
    },
  };
}

// Shadow.app's binary, if it is built and new enough to read pictures (mac-binary.ts).
export function screenToolsFrom(binary: string): ScreenTools | undefined {
  const can = macCapabilities(binary);
  return can.has("ocr") && can.has("redact") ? appScreenTools(binary) : undefined;
}

export interface ScreenReader {
  add(shot: Shot): void;
  // A picture that was not taken, and why: written to the ledger at once.
  skip(entry: { sessionId: string; eventId: string; at: number; reason: string }): void;
  // Resolves once every picture added so far is done (before a recording is turned into a workflow).
  idle(): Promise<void>;
}

// One line per event that should have a picture: taken, or why not. A missing picture is never silent (spec 1.15).
function ledger(dir: string, line: Record<string, unknown>): void {
  appendFileSync(join(dir, "shots.jsonl"), `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

export function createScreenReader(options: {
  dataDir: string;
  tools?: ScreenTools;
  // The recording's Never terms, masked too.
  never(sessionId: string): string[];
  log: Log;
}): ScreenReader {
  const { dataDir, tools, log } = options;
  let queue = Promise.resolve();
  let warned = false;

  async function handle(shot: Shot) {
    if (!/^[\w-]+$/.test(shot.eventId)) return;
    const dir = recordingDir(dataDir, shot.sessionId);
    if (!existsSync(dir)) return;
    const shots = join(dir, "shots");
    mkdirSync(shots, { recursive: true, mode: 0o700 });
    let file: string;
    if (shot.image) {
      const data = /^data:image\/(?:jpeg|png);base64,(.+)$/.exec(shot.image)?.[1];
      if (!data) return;
      file = join(shots, `${shot.eventId}.jpg`);
      writeFileSync(file, Buffer.from(data, "base64"), { mode: 0o600 });
    } else if (shot.path) {
      file = resolve(shot.path);
      // Shadow.app saves into the recording's own folder; anything else is not ours to read.
      if (!file.startsWith(`${shots}${sep}`) || !existsSync(file)) return;
    } else return;

    if (!tools) {
      rmSync(file, { force: true });
      ledger(dir, { eventId: shot.eventId, at: shot.at, outcome: "no-tools" });
      if (!warned) log("screenshots need Shadow.app to read and mask them (pnpm setup:mac): not kept");
      warned = true;
      return;
    }
    try {
      const masked = maskLines(await tools.read(file), options.never(shot.sessionId));
      await tools.blackOut(file, [...masked.boxes, ...(shot.masks ?? [])]);
      const text = masked.lines
        .map((l) => l.text.trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, 2_000);
      if (text) {
        appendFileSync(join(dir, "screen.jsonl"), `${JSON.stringify({ at: shot.at, eventId: shot.eventId, text })}\n`, {
          mode: 0o600,
        });
      }
      ledger(dir, { eventId: shot.eventId, at: shot.at, outcome: "taken" });
    } catch (error) {
      rmSync(file, { force: true });
      ledger(dir, {
        eventId: shot.eventId,
        at: shot.at,
        outcome: "deleted",
        reason: (error as Error).message.slice(0, 200),
      });
      log("a screenshot couldn't be read or masked, so it was deleted:", (error as Error).message);
    }
  }

  return {
    skip({ sessionId, eventId, at, reason }) {
      if (!/^[\w-]+$/.test(eventId)) return;
      const dir = recordingDir(dataDir, sessionId);
      if (existsSync(dir)) ledger(dir, { eventId, at, outcome: "skipped", reason });
    },
    add(shot) {
      queue = queue.then(() => handle(shot)).catch((error: Error) => log("screenshot:", error.message));
    },
    idle: () => queue,
  };
}
