import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { captionQuestion, captionsOf } from "./captions.ts";

const step = (at: number): NormalisedStep => ({ index: 0, kind: "click", at, events: [`e${at}`] });

describe("captions", () => {
  it("asks a few at once, keeps each caption with its step, and says which step's caption failed", async () => {
    let inFlight = 0;
    let most = 0;
    const logged: string[] = [];
    const captions = await captionsOf(
      [1, 2, 3, 4, 5, 6].map(step),
      (i) => `/shots/${i}.jpg`,
      async (path) => {
        inFlight++;
        most = Math.max(most, inFlight);
        // Later pictures answer first: order must still follow the steps.
        const n = Number(/(\d)\.jpg$/.exec(path)?.[1]);
        await new Promise((r) => setTimeout(r, (6 - n) * 5));
        inFlight--;
        if (n === 4) throw new Error("the model used its whole token budget");
        return `picture ${n}`;
      },
      (...args) => logged.push(args.join(" ")),
    );
    expect(captions).toEqual(["picture 0", "picture 1", "picture 2", "picture 3", undefined, "picture 5"]);
    expect(most).toBe(3);
    expect(logged).toEqual([expect.stringMatching(/^a caption failed \(step 5: click/)]);
  });

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

  it("hides private words in the question, and only those", async () => {
    const typed: NormalisedStep = {
      index: 0,
      kind: "type",
      at: 0,
      events: [],
      value: "Project Falcon for jane@client.com",
    };
    const asked: string[] = [];
    await captionsOf(
      [typed],
      () => "/shots/1.jpg",
      async (_path, question) => {
        asked.push(question);
        return "A search box.";
      },
      () => {},
      ["Project Falcon"],
    );
    expect(asked[0]).toContain("███");
    expect(asked[0]).not.toContain("Project Falcon");
    expect(asked[0]).toContain("jane@client.com");
  });

  it("says the picture is from just before the step, so the model names what was acted on, not an outcome", () => {
    const question = captionQuestion({ index: 0, kind: "click", at: 0, events: [] });
    expect(question).toContain("just before");
    expect(question).not.toContain("what changed");
  });
});
