// Captions of the masked pictures (spec 2.13), with the Pictures switch on: what the step's picture shows, which item
// was acted on and the values visible, in at most 200 characters, from a crop around the click when there is one. The
// describer (the daemon's vision model, cached by picture and metered) is passed in; a failure leaves that step without
// a caption.
import type { Point } from "@shadow/core";
import { maskText } from "../mask.ts";
import type { NormalisedStep } from "../normalise.ts";
import { describeStep } from "./timeline.ts";

export type DescribePicture = (path: string, question: string, point?: Point) => Promise<string>;
export const CAPTION_CHARS = 200;

// What was typed or copied goes to the vision model masked, like every value a model reads (an email, a key, a Never
// or private word).
export function captionQuestion(step: NormalisedStep, terms: string[] = []): string {
  // The picture is from just before the step (what was clicked): what changed is told by the lines that appeared, so
  // the model is asked only what it can see, never to guess an outcome (Checkpoint 2: "nothing was saved").
  const where = step.point ? " They clicked at the middle of this picture." : "";
  return `The user did: ${maskText(describeStep(step), terms).text}. This picture is from just before they did it.${where} In at most 40 words: what this is, which item they acted on (its place in a list, if any), and any values shown.`;
}

// Captions asked at once: each is one vision call of up to a minute, so one at a time made 33 steps take 3½ minutes
// (25 Oct); a few at once keeps within the service's rate limits.
export const CAPTIONS_AT_ONCE = 3;
// No new caption is started after this long: a long recording (a design waits for every caption) took over ten minutes
// (Oct 26, recording E). The steps left go without one, as a failed caption does; the design reads what the code
// already knows about them.
export const CAPTIONS_DEADLINE_MS = 150_000;

export async function captionsOf(
  steps: NormalisedStep[],
  pictureOf: (i: number) => string | undefined,
  describe: DescribePicture,
  log: (...args: unknown[]) => void = () => {},
  terms: string[] = [],
  options: { deadlineMs?: number; signal?: AbortSignal } = {},
): Promise<(string | undefined)[]> {
  const captions: (string | undefined)[] = steps.map(() => undefined);
  const deadlineMs = options.deadlineMs ?? CAPTIONS_DEADLINE_MS;
  const stopAt = Date.now() + deadlineMs;
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (next < steps.length) {
      if (options.signal?.aborted) return; // Stop was pressed (W1): no new picture
      if (Date.now() > stopAt) {
        if (!stopped)
          log(`captions stopped after ${Math.round(deadlineMs / 1000)} s: the other steps go without a caption`);
        stopped = true;
        return;
      }
      const i = next++;
      const step = steps[i];
      const path = pictureOf(i);
      if (!step || !path) continue;
      try {
        const text = (await describe(path, captionQuestion(step, terms), step.point)).replace(/\s+/g, " ").trim();
        captions[i] = text ? text.slice(0, CAPTION_CHARS) : undefined;
      } catch (error) {
        log(`a caption failed (step ${i + 1}: ${describeStep(step).slice(0, 60)}):`, (error as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CAPTIONS_AT_ONCE, steps.length) }, worker));
  return captions;
}
