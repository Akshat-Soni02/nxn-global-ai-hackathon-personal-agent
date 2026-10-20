// What each step saw (spec 1.10, 1.17–1.19).
// - The words near where it clicked, from its tab's picture before it: a click's own picture is often taken after the
//   page changed (Checkpoint 1: the Japan link's picture shows the next page).
// - What appeared: lines in the tab's last picture before the next step that weren't in the picture before. Only these
//   may become checks (Plan 3's finish gate).
// Picture boxes are in picture pixels; a click point is in CSS pixels with its device pixel ratio.
import type { TraceEvent } from "@shadow/core";
import type { Line } from "../mask.ts";
import type { NormalisedStep } from "../normalise.ts";

export interface Picture {
  eventId: string;
  at: number;
  tabId?: number;
  lines: Line[];
}
export interface StepScreen {
  before?: string;
  after?: string;
  near: string[];
  appeared: string[];
}

const NEAR_LINES = 6;
const APPEARED_LINES = 12;
const NEAR_CSS_PX = 150;
const clean = (t: string) => t.replace(/\s+/g, " ").trim();
const useful = (t: string) => t.length >= 2 && !/^[█\s]+$/.test(t);

export function screensOf(steps: NormalisedStep[], pictures: Picture[], trace: TraceEvent[]): StepScreen[] {
  const tabOfEvent = new Map(trace.map((e) => [e.id, e.tabId]));
  const shots = pictures
    .map((p) => ({ ...p, tabId: p.tabId ?? tabOfEvent.get(p.eventId) }))
    .sort((a, b) => a.at - b.at);
  return steps.map((step, i) => {
    const mine = new Set(step.events);
    const nextAt = steps[i + 1]?.at ?? Number.POSITIVE_INFINITY;
    const tab = shots.filter((s) => step.tabId === undefined || s.tabId === step.tabId);
    const before = tab.filter((s) => s.at < step.at && !mine.has(s.eventId)).at(-1);
    const after = tab.filter((s) => (s.at >= step.at || mine.has(s.eventId)) && s.at < nextAt).at(-1);
    const seen = new Set((before?.lines ?? []).map((l) => clean(l.text)));
    const appeared = after
      ? [...new Set(after.lines.map((l) => clean(l.text)))]
          .filter((t) => useful(t) && !seen.has(t))
          .slice(0, APPEARED_LINES)
          .map((t) => t.slice(0, 120))
      : [];
    return {
      ...(before ? { before: before.eventId } : {}),
      ...(after ? { after: after.eventId } : {}),
      near: nearLines(step, before ?? after),
      appeared,
    };
  });
}

function nearLines(step: NormalisedStep, picture?: Picture): string[] {
  if (!picture) return [];
  const lines = picture.lines.filter((l) => useful(clean(l.text)));
  if (step.point) {
    const { x, y, dpr } = step.point;
    const px = x * dpr;
    const py = y * dpr;
    const away = (l: Line) =>
      Math.hypot(
        Math.max(l.box.x - px, 0, px - (l.box.x + l.box.w)),
        Math.max(l.box.y - py, 0, py - (l.box.y + l.box.h)),
      );
    return lines
      .map((l) => ({ text: clean(l.text).slice(0, 120), d: away(l) }))
      .filter(({ d }) => d <= NEAR_CSS_PX * dpr)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEAR_LINES)
      .map(({ text }) => text);
  }
  const words = [step.target?.name, step.target?.text, step.value]
    .filter((w): w is string => Boolean(w && w.length >= 3))
    .map((w) => w.toLowerCase().slice(0, 40));
  if (words.length === 0) return [];
  return lines
    .filter((l) => words.some((w) => l.text.toLowerCase().includes(w)))
    .slice(0, NEAR_LINES)
    .map((l) => clean(l.text).slice(0, 120));
}
