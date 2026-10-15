// One recording's folder, recordings/<sessionId>/ (docs/design.md, "Retention"): the description form filled in
// before Record (description.json), what was captured (trace.jsonl, trace-store.ts), and when it stopped and was saved
// (meta.json). Written when recording starts, so `compile <session>` and a restarted daemon still have the form. The
// whole folder is deleted a day later (sweepRecordings). The consents are also kept as the form's next defaults
// (config.json).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Description, Trigger } from "@shadow/core";
import type { Note } from "@shadow/recorder";
import { z } from "zod";

export const Consent = z.object({
  // A screenshot of the active window at each event; only the words read from it (masked) leave the Mac.
  screen: z.boolean().default(false),
  // Narration, turned into text on the Mac; only the text leaves it.
  microphone: z.boolean().default(false),
  // The masked picture itself (private lines and secret fields blacked out) may be sent to the vision model, to be
  // described, by the design agent (describe_step_screenshot) and the repair agent (describe_screen). Off: only words ever leave.
  pictures: z.boolean().default(false),
});
export type Consent = z.infer<typeof Consent>;

// The description form (docs/design.md, "1. Describe"). Goal is required; Frequency defaults to "only when I start
// it"; the rest may be empty. Fields are trimmed and empty entries dropped.
const list = z
  .array(z.string().trim().max(200))
  .max(30)
  .default([])
  .transform((xs) => xs.filter(Boolean));
export const RecordForm = Description.extend({
  goal: z.string().trim().min(1, "the goal is required").max(500),
  changes: list,
  constants: list,
  never: list,
  when: z
    .array(Trigger)
    .min(1)
    .max(5)
    .default([{ type: "manual" }]),
  consent: Consent.default({ screen: false, microphone: false, pictures: false }),
  // Recording a task again (docs/design.md, open question closed 13 Oct): the id of the workflow this recording is a
  // new version of. It keeps that id, its Frequency and its state; the recording becomes its next version.
  again: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
});
export type RecordForm = z.infer<typeof RecordForm>;
export type RecordFormInput = z.input<typeof RecordForm>;

export function recordingDir(dataDir: string, sessionId: string): string {
  // The id becomes a folder name, so it may only be a plain token (the daemon makes them with randomUUID).
  if (!/^[\w-]+$/.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  return join(dataDir, "recordings", sessionId);
}

export function writeForm(dataDir: string, sessionId: string, form: RecordForm): void {
  const dir = recordingDir(dataDir, sessionId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "description.json"), `${JSON.stringify(form, null, 2)}\n`, { mode: 0o600 });
}

// The form a recording was started with; undefined for recordings made without one (before Oct 13).
export function readForm(dataDir: string, sessionId: string): RecordForm | undefined {
  const path = join(recordingDir(dataDir, sessionId), "description.json");
  if (!existsSync(path)) return undefined;
  const parsed = RecordForm.safeParse(JSON.parse(readFileSync(path, "utf8")));
  return parsed.success ? parsed.data : undefined;
}

// ---- The consents, remembered as the form's defaults (config.json, "consent") ----------------------------------

function configPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

function readConfig(dataDir: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(configPath(dataDir), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function readConsent(dataDir: string): Consent {
  const parsed = Consent.safeParse(readConfig(dataDir).consent ?? {});
  return parsed.success ? parsed.data : { screen: false, microphone: false, pictures: false };
}

// Only the "consent" key is written; anything else in config.json is kept as it is.
export function saveConsent(dataDir: string, consent: Consent): void {
  mkdirSync(dataDir, { recursive: true });
  const config = { ...readConfig(dataDir), consent };
  writeFileSync(configPath(dataDir), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

// ---- Keeping a recording for a day (docs/design.md, "Retention") ----------------------------------------------

// A recording's folder is deleted this long after its workflow is saved, or after Stop when it was never saved.
export const KEEP_MS = 24 * 60 * 60 * 1000;

export interface RecordingMeta {
  stoppedAt?: number;
  savedAt?: number;
  skillId?: string;
  outcome?: "saved" | "empty" | "failed";
}

export function readMeta(dataDir: string, sessionId: string): RecordingMeta {
  try {
    return JSON.parse(readFileSync(join(recordingDir(dataDir, sessionId), "meta.json"), "utf8")) as RecordingMeta;
  } catch {
    return {};
  }
}

// Adds to meta.json; only for a recording that has a folder (not one of the older single-file traces).
export function writeMeta(dataDir: string, sessionId: string, patch: RecordingMeta): void {
  const dir = recordingDir(dataDir, sessionId);
  if (!existsSync(dir)) return;
  const meta = { ...readMeta(dataDir, sessionId), ...patch };
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
}

// Whether a recording can still be compiled: its folder, or an older single-file trace.
export function recordingExists(dataDir: string, sessionId: string): boolean {
  return existsSync(recordingDir(dataDir, sessionId)) || existsSync(join(dataDir, "traces", `${sessionId}.jsonl`));
}

// Deletes one recording's folder, with everything it captured. The older traces/ files are never touched.
export function deleteRecording(dataDir: string, sessionId: string): void {
  rmSync(recordingDir(dataDir, sessionId), { recursive: true, force: true });
}

// Deletes every recording whose day is over: 24 hours after its workflow was saved, or after Stop if it never was,
// or after it last changed if the daemon stopped while it was recording; one that recorded nothing at once. The
// recording going on (`active`) is kept. Returns the ids deleted.
export function sweepRecordings(dataDir: string, options: { now?: number; active?: string } = {}): string[] {
  const root = join(dataDir, "recordings");
  if (!existsSync(root)) return [];
  const now = options.now ?? Date.now();
  const deleted: string[] = [];
  for (const sessionId of readdirSync(root)) {
    if (sessionId === options.active || !/^[\w-]+$/.test(sessionId)) continue;
    const dir = join(root, sessionId);
    if (!statSync(dir).isDirectory()) continue;
    const meta = readMeta(dataDir, sessionId);
    const since = meta.savedAt ?? meta.stoppedAt ?? lastChange(dir);
    if (meta.outcome === "empty" || now - since >= KEEP_MS) {
      deleteRecording(dataDir, sessionId);
      deleted.push(sessionId);
    }
  }
  return deleted;
}

function lastChange(dir: string): number {
  let newest = statSync(dir).mtimeMs;
  for (const name of readdirSync(dir)) newest = Math.max(newest, statSync(join(dir, name)).mtimeMs);
  return newest;
}

// What was seen and said while recording, on the recording's clock, for the design agent: the masked words read from
// each screenshot (screen.jsonl, screen.ts) and the narration's text (transcript.jsonl). Both are already masked text.
export function readNotes(dataDir: string, sessionId: string): Note[] {
  const notes: Note[] = [];
  const read = (file: string, kind: Note["kind"]) => {
    const path = join(recordingDir(dataDir, sessionId), file);
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      try {
        const entry = JSON.parse(line) as { at?: unknown; until?: unknown; text?: unknown };
        if (typeof entry.at === "number" && typeof entry.text === "string" && entry.text.trim()) {
          // A piece of narration also says when it ended, so it can span the steps it was said over.
          const until = typeof entry.until === "number" ? { until: entry.until } : {};
          notes.push({ at: entry.at, ...until, kind, text: entry.text });
        }
      } catch {
        // an empty or half-written line
      }
    }
  };
  read("screen.jsonl", "screen");
  read("transcript.jsonl", "said");
  return notes.sort((a, b) => a.at - b.at);
}
