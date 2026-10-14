// What was said and seen while recording, lined up with the steps by time (docs/design.md, "2. Record"). Two views:
// - by step: each note next to the step it was said or seen over (the design agent's recording view);
// - the narration on its own, in order, each piece with the steps it spans. Said words are the person's intent ("the
//   top 5", "skip the ones already in the sheet"), so both model calls read them whole, before the clicks, instead of
//   finding them scattered among the steps.
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

// The step (index) a moment belongs to: the last one that started before it, or -1 before any step.
function stepAt(steps: NormalisedStep[], at: number): number {
  let index = -1;
  for (let i = 0; i < steps.length; i++) if ((steps[i]?.at ?? 0) <= at + GRACE_MS) index = i;
  return index;
}

// Each note goes with the last step that started before it, or the first step when it came before any.
export function notesByStep(steps: NormalisedStep[], notes: Note[]): string[][] {
  const out: string[][] = steps.map(() => []);
  for (const note of [...notes].sort((a, b) => a.at - b.at)) {
    const index = Math.max(0, stepAt(steps, note.at));
    out[index]?.push(`${note.kind === "said" ? "said" : "on screen"}: ${note.text}`);
  }
  return out;
}

// The narration in order, each piece with the recorded steps (numbered from 1) it was said over: "before step 1",
// "step 4", or "steps 4-7" when the person kept talking while they acted.
export function narrationOf(steps: NormalisedStep[], notes: Note[]): { during: string; said: string }[] {
  return notes
    .filter((n) => n.kind === "said" && n.text.trim())
    .sort((a, b) => a.at - b.at)
    .map((note) => {
      const from = stepAt(steps, note.at);
      const to = Math.max(from, stepAt(steps, note.until ?? note.at));
      const during =
        from < 0 && to < 0
          ? "before step 1"
          : from === to
            ? `step ${from + 1}`
            : `steps ${Math.max(from, 0) + 1}-${to + 1}`;
      return { during, said: note.text.trim() };
    });
}
