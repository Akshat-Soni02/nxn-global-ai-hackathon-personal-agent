// One vision call: describes a masked screenshot (docs/design.md, "Models", the vision profile, and "Redaction").
// The caller passes `consented` only when the user allowed pictures to be sent ("Let the model see masked pictures");
// without it the client refuses the image. The picture must already be masked (apps/daemon/src/describe.ts): this
// layer never masks anything and never reads a file.
import type { Llm } from "./client.ts";
import type { UsageMeter } from "./usage.ts";

export interface DescribeImageRequest {
  // A JPEG or PNG data URL of the masked picture.
  dataUrl: string;
  // What to say about it: the step the user was doing, or the repair agent's question.
  question: string;
  consented: boolean;
  signal?: AbortSignal;
  meter?: UsageMeter;
}

const SYSTEM = `You describe a screenshot of a work app or web page for an automation assistant. In plain words and at
most 120 words, say: what app or page it is; what the user seems to be doing there; which controls and fields are
visible and their state (empty, filled, selected, disabled); any dialog, banner or error; and which control a person
would use next. Black boxes are private text that was hidden on purpose: say "hidden" for them. Never read out
emails, phone numbers, card numbers, keys or passwords, even if one is visible.`;

export async function describeImage(llm: Llm, request: DescribeImageRequest): Promise<string> {
  const reply = await llm.generate({
    profile: "vision",
    system: SYSTEM,
    user: request.question,
    images: [{ dataUrl: request.dataUrl }],
    imagesConsented: request.consented,
    // No cap below the profile's: GLM-5.3-Flash always reasons first, and on Nebius no switch turns that off (25 Oct:
    // ~80% of a plain picture's output was reasoning). At 400 a busy screenshot's reasoning took the whole budget and the
    // answer came back empty ("a caption failed: the model used its whole token budget"). The prompt keeps the answer short.
    signal: request.signal,
    meter: request.meter,
  });
  return reply.text.trim();
}
