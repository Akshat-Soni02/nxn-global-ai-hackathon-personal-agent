// One recording's folder, recordings/<sessionId>/ (docs/design.md, "Retention"): the description form filled in
// before Record (description.json), and what was captured. Written when recording starts, so `compile <session>` and
// a restarted daemon still have the form. The consents are also kept as the form's next defaults (config.json).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Description, Trigger } from "@shadow/core";
import { z } from "zod";

export const Consent = z.object({
  // A screenshot of the active window at each event; only the words read from it (masked) leave the Mac.
  screen: z.boolean().default(false),
  // Narration, turned into text on the Mac; only the text leaves it.
  microphone: z.boolean().default(false),
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
  consent: Consent.default({ screen: false, microphone: false }),
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
  return parsed.success ? parsed.data : { screen: false, microphone: false };
}

// Only the "consent" key is written; anything else in config.json is kept as it is.
export function saveConsent(dataDir: string, consent: Consent): void {
  mkdirSync(dataDir, { recursive: true });
  const config = { ...readConfig(dataDir), consent };
  writeFileSync(configPath(dataDir), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
