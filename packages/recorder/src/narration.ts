// What was said and seen while recording, lined up with the steps by time (docs/design.md, "2. Record"). Each kind
// lives in one place:
// - what was seen (a screenshot's masked words) is about one moment, so it goes next to the step it was taken after
//   (notesByStep, the design agent's recording view);
// - what was said is the person's intent ("the top 5", "skip the ones already in the sheet"), often about the whole
//   task, so it is a list of its own, in order, each piece marked with the steps it spans (narrationOf). The design
//   agent reads it first, before the steps. It is never repeated as a note on a step: there it would sit next to
//   whatever happened that second, a tab being switched included.
import type { NormalisedStep } from "./normalise.ts";

// Something said or seen while recording, on the recording's clock: the narration's text (with when the piece
// ended), or the masked words read from a screenshot.
export interface Note {
  at: number;
  until?: number;
  kind: "said" | "screen";
  text: string;
}

// A second's grace: people talk as they click, so a word said just before a click belongs to it.
const GRACE_MS = 1000;

// The step (index) a moment belongs to: the last one that started before it (and that may be marked: see anchors),
// or -1 before any.
function stepAt(steps: NormalisedStep[], at: number, marks?: boolean[]): number {
  let index = -1;
  for (let i = 0; i < steps.length; i++) {
    if ((steps[i]?.at ?? 0) <= at + GRACE_MS && (marks?.[i] ?? true)) index = i;
  }
  return index;
}

// The steps a sentence may be marked against: real actions, and the first time a page was opened. A page opened again
// that the recording had already been on is noise for this (switching back to a tab reloads it, or a page reports its
// own address again), so "said over steps 4-5" always points at something the person did.
function anchors(steps: NormalisedStep[]): boolean[] {
  const seen = new Set<string>();
  return steps.map((step) => {
    const page = pageOf(step.url);
    const real = step.kind !== "navigate" || !page || !seen.has(page);
    for (const url of [step.url, step.navigatesTo]) {
      const p = pageOf(url);
      if (p) seen.add(p);
    }
    return real;
  });
}

// A page without its per-visit parts (query, fragment).
function pageOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

// Each screenshot's words go with the last step that started before it, or the first step when they came before any.
// Only what was seen: what was said is the narration's own list.
export function notesByStep(steps: NormalisedStep[], notes: Note[]): string[][] {
  const out: string[][] = steps.map(() => []);
  for (const note of [...notes].filter((n) => n.kind === "screen").sort((a, b) => a.at - b.at)) {
    const index = Math.max(0, stepAt(steps, note.at));
    out[index]?.push(`on screen: ${note.text}`);
  }
  return out;
}

// The narration in order, each piece with the recorded steps (numbered from 1) it was said over: "before step 1",
// "step 4", or "steps 4-7" when the person kept talking while they acted. Pages opened again (anchors) are skipped.
export function narrationOf(steps: NormalisedStep[], notes: Note[]): { during: string; said: string }[] {
  const marks = anchors(steps);
  return notes
    .filter((n) => n.kind === "said" && n.text.trim())
    .sort((a, b) => a.at - b.at)
    .map((note) => {
      const from = stepAt(steps, note.at, marks);
      const to = Math.max(from, stepAt(steps, note.until ?? note.at, marks));
      const during =
        from < 0 && to < 0
          ? "before step 1"
          : from === to
            ? `step ${from + 1}`
            : `steps ${Math.max(from, 0) + 1}-${to + 1}`;
      return { during, said: note.text.trim() };
    });
}
