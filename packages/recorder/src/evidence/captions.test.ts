import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { captionsOf } from "./captions.ts";

const step = (at: number): NormalisedStep => ({ index: 0, kind: "click", at, events: [`e${at}`] });

describe("captions", () => {
  it("describes each step that has a picture, short, and leaves out a step whose picture failed", async () => {
    const asked: string[] = [];
    const captions = await captionsOf(
      [step(1), step(2), step(3)],
      (i) => (i === 1 ? undefined : `/shots/${i}.jpg`),
      async (path, question) => {
        asked.push(question);
        if (path.endsWith("2.jpg")) throw new Error("vision is down");
        return `A list of emails. ${"x".repeat(300)}`;
      },
    );
    expect(captions.map((c) => c?.length)).toEqual([200, undefined, undefined]);
    expect(asked[0]).toContain("The user did: click");
  });
});
