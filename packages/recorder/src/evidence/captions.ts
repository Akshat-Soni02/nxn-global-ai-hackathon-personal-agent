// Captions of the masked pictures (spec 2.13), with the Pictures switch on: what the step's picture shows, which item
// was acted on and the values visible, in at most 200 characters, from a crop around the click when there is one. The
// describer (the daemon's vision model, cached by picture and metered) is passed in; a failure leaves that step without
// a caption.
import type { Point } from "@shadow/core";
import type { NormalisedStep } from "../normalise.ts";
import { describeStep } from "./timeline.ts";

export type DescribePicture = (path: string, question: string, point?: Point) => Promise<string>;
export const CAPTION_CHARS = 200;

export function captionQuestion(step: NormalisedStep): string {
  // The picture is from just before the step (what was clicked): what changed is told by the lines that appeared, so
  // the model is asked only what it can see, never to guess an outcome (Checkpoint 2: "nothing was saved").
  const where = step.point ? " They clicked at the middle of this picture." : "";
  return `The user did: ${describeStep(step)}. This picture is from just before they did it.${where} In at most 40 words: what this is, which item they acted on (its place in a list, if any), and any values shown.`;
}

export async function captionsOf(
  steps: NormalisedStep[],
  pictureOf: (i: number) => string | undefined,
  describe: DescribePicture,
  log: (...args: unknown[]) => void = () => {},
): Promise<(string | undefined)[]> {
  const captions: (string | undefined)[] = [];
  for (const [i, step] of steps.entries()) {
    const path = pictureOf(i);
    if (!path) {
      captions.push(undefined);
      continue;
    }
    try {
      const text = (await describe(path, captionQuestion(step), step.point)).replace(/\s+/g, " ").trim();
      captions.push(text ? text.slice(0, CAPTION_CHARS) : undefined);
    } catch (error) {
      log("a caption failed:", (error as Error).message);
      captions.push(undefined);
    }
  }
  return captions;
}
