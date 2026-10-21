// The evidence package of a recording (spec 2.14), written as evidence.json in its folder when it stops, before the
// design agent. Captions only with the recording's Pictures switch and a vision model. Never fails a recording: an
// error is logged and the recording goes on without it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Skill, TraceEvent } from "@shadow/core";
import type { UsageMeter } from "@shadow/llm";
import {
  buildEvidence,
  captionsOf,
  type Evidence,
  evidenceText,
  type Noise,
  type NormalisedStep,
  type Note,
  type Picture,
  screensOf,
} from "@shadow/recorder";
import { cropAround } from "./crop.ts";
import type { ScreenDescriber } from "./describe.ts";
import { maskTermsOf, type RecordForm, recordingDir } from "./recording-store.ts";

export function readPictures(dir: string): Picture[] {
  const file = join(dir, "screen.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const p = JSON.parse(line) as Partial<Picture>;
        if (!p.eventId || typeof p.at !== "number" || !Array.isArray(p.lines)) return [];
        return [
          {
            eventId: p.eventId,
            at: p.at,
            ...(typeof p.takenAt === "number" ? { takenAt: p.takenAt } : {}),
            ...(p.tabId !== undefined ? { tabId: p.tabId } : {}),
            lines: p.lines,
          },
        ];
      } catch {
        return [];
      }
    });
}

export interface EvidenceOptions {
  dataDir: string;
  sessionId: string;
  trace: TraceEvent[];
  steps: NormalisedStep[];
  noise: Noise[];
  skill: Skill;
  idsByStep: string[][];
  form?: RecordForm;
  notes: Note[];
  describer?: Pick<ScreenDescriber, "allowed" | "describeMasked" | "tempPath">;
  meter?: UsageMeter;
  log: (...args: unknown[]) => void;
}

export async function writeEvidence(o: EvidenceOptions): Promise<Evidence | undefined> {
  try {
    const dir = recordingDir(o.dataDir, o.sessionId);
    if (!existsSync(dir)) return undefined;
    const pictures = readPictures(dir);
    const consent = o.form?.consent ?? { screen: false, microphone: false, pictures: false };
    const terms = maskTermsOf(o.form);
    let captions: (string | undefined)[] | undefined;
    const describer = o.describer;
    if (consent.pictures && describer?.allowed() && pictures.length > 0) {
      const screens = screensOf(o.steps, pictures, o.trace);
      const shot = (id?: string) => {
        const path = id && /^[\w-]+$/.test(id) ? join(dir, "shots", `${id}.jpg`) : undefined;
        return path && existsSync(path) ? path : undefined;
      };
      captions = await captionsOf(
        o.steps,
        (i) => shot(screens[i]?.before) ?? shot(screens[i]?.after),
        async (path, question, point) =>
          describer.describeMasked(
            point ? await cropAround(path, point, `${describer.tempPath()}.jpg`) : path,
            question,
            o.meter,
          ),
        o.log,
        terms,
      );
    }
    const evidence = buildEvidence({
      trace: o.trace,
      steps: o.steps,
      noise: o.noise,
      skill: o.skill,
      idsByStep: o.idsByStep,
      goal: o.form?.goal ?? "",
      switches: { screen: consent.screen, voice: consent.microphone, pictures: consent.pictures },
      said: o.notes
        .filter((n) => n.kind === "said")
        .map(({ at, until, text }) => ({ at, ...(until !== undefined ? { until } : {}), text })),
      pictures,
      ...(captions ? { captions } : {}),
      maskTerms: terms,
    });
    writeFileSync(join(dir, "evidence.json"), JSON.stringify(evidence), { mode: 0o600 });
    const { tokens, level } = evidenceText(evidence);
    o.log(
      `evidence: ${evidence.steps.length} steps, ${evidence.noise.length} left out, ${evidence.proposals.length} proposals, ~${tokens} tokens${level > 0 ? ` (details cut to level ${level})` : ""}`,
    );
    return evidence;
  } catch (error) {
    o.log("evidence couldn't be built:", (error as Error).message);
    return undefined;
  }
}
