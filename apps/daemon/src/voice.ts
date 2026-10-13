// Narration (docs/design.md, "2. Record"): after Stop, the voice Shadow.app recorded in the recording's folder
// (voice.m4a, started at voice.json's startedAt) becomes text on the Mac (`Shadow --transcribe`, macOS's
// SpeechAnalyzer), masked like a screenshot's words (emails, numbers, keys, Never terms), in transcript.jsonl with
// each piece's time on the recording's clock. The design agent reads it next to the steps it was said over. The audio
// never leaves the Mac and goes with the folder a day later.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { maskText } from "@shadow/recorder";
import { recordingDir } from "./recording-store.ts";

const run = promisify(execFile);
type Log = (...args: unknown[]) => void;

export interface Segment {
  start: number; // seconds from the start of the audio
  end: number;
  text: string;
}
export type Transcribe = (audio: string) => Promise<Segment[]>;

// Shadow.app's binary, if it is built and new enough to turn speech into text.
export function transcriberFrom(binary: string): Transcribe | undefined {
  try {
    if (!existsSync(binary) || !readFileSync(binary).includes("--transcribe")) return undefined;
  } catch {
    return undefined;
  }
  return async (audio) => {
    const { stdout } = await run(binary, ["--transcribe", audio], { timeout: 300_000, maxBuffer: 10_000_000 });
    return (JSON.parse(stdout) as { segments: Segment[] }).segments;
  };
}

// Writes transcript.jsonl for a recording with narration; returns how many pieces of text it has.
export async function transcribeRecording(options: {
  dataDir: string;
  sessionId: string;
  transcribe?: Transcribe;
  never: string[];
  log: Log;
}): Promise<number> {
  const dir = recordingDir(options.dataDir, options.sessionId);
  const audio = join(dir, "voice.m4a");
  if (!existsSync(audio) || existsSync(join(dir, "transcript.jsonl"))) return 0;
  if (!options.transcribe) {
    options.log("narration needs Shadow.app to turn it into text (pnpm setup:mac): not used");
    return 0;
  }
  let startedAt: number;
  try {
    startedAt = Number((JSON.parse(readFileSync(join(dir, "voice.json"), "utf8")) as { startedAt: unknown }).startedAt);
    if (!Number.isFinite(startedAt)) throw new Error("no start time");
  } catch {
    options.log("narration has no start time, so it can't be lined up with the steps: not used");
    return 0;
  }
  try {
    const segments = await options.transcribe(audio);
    const lines = segments
      .filter((s) => s.text.trim())
      .map((s) => ({
        at: Math.round(startedAt + s.start * 1000),
        until: Math.round(startedAt + s.end * 1000),
        text: maskText(s.text, options.never).text,
      }));
    writeFileSync(join(dir, "transcript.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""), {
      mode: 0o600,
    });
    options.log(`narration: ${lines.length} piece(s) of text`);
    return lines.length;
  } catch (error) {
    options.log("narration couldn't be turned into text:", (error as Error).message);
    return 0;
  }
}
