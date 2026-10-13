// Pictures for the model (describe.ts): nothing leaves without the "pictures" consent, and what leaves is the
// blacked-out picture, never the one that came in. The masking tools are stand-ins that rewrite the file, so the
// test can tell the two apart byte for byte.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { createScreenDescriber } from "./describe.ts";
import type { ScreenTools } from "./screen.ts";

const ORIGINAL = Buffer.from("ORIGINAL-PICTURE-WITH-jane@acme.com");
const MASKED = Buffer.from("MASKED-PICTURE");
const asDataUrl = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString("base64")}`;

// Reads two lines (one with an email) and blacks out by replacing the whole file.
function tools(): ScreenTools & { blackedOut: { x: number; y: number; w: number; h: number }[][] } {
  const blackedOut: { x: number; y: number; w: number; h: number }[][] = [];
  return {
    blackedOut,
    read: async () => [
      { text: "Weekly metrics", box: { x: 0, y: 0, w: 100, h: 20 } },
      { text: "From jane@acme.com", box: { x: 0, y: 30, w: 100, h: 20 } },
    ],
    blackOut: async (path, boxes) => {
      blackedOut.push(boxes);
      writeFileSync(path, MASKED);
    },
  };
}

function setup(pictures: boolean, withTools = true) {
  const dataDir = mkdtempSync(join(tmpdir(), "describe-"));
  const llm = fakeLlm(["A compose window with the To field empty and a blue Send button."]);
  const t = tools();
  const describer = createScreenDescriber({
    dataDir,
    tools: withTools ? t : undefined,
    llm: () => llm,
    consent: () => ({ screen: true, microphone: false, pictures }),
    log: () => {},
  });
  return { dataDir, llm, describer, tools: t };
}

// The image_url parts sent in a request body.
const imagesIn = (body: Record<string, unknown>) =>
  ((body.messages as { content: unknown }[]) ?? []).flatMap((m) =>
    Array.isArray(m.content)
      ? (m.content as { type: string; image_url?: { url: string } }[])
          .filter((p) => p.type === "image_url")
          .map((p) => p.image_url?.url ?? "")
      : [],
  );

describe("describing a picture for the model", () => {
  it("sends nothing without the pictures consent", async () => {
    const { llm, describer } = setup(false);
    expect(describer.allowed()).toBe(false);
    await expect(describer.describe({ image: asDataUrl(ORIGINAL) }, "what is this?", [])).rejects.toThrow(
      /hasn't allowed pictures/,
    );
    expect(llm.requests).toEqual([]);
  });

  it("masks first, sends only the blacked-out picture and the masked words, and deletes its copy", async () => {
    const { dataDir, llm, describer, tools } = setup(true);
    const result = await describer.describe({ image: asDataUrl(ORIGINAL) }, "what is this?", ["metrics"]);
    expect(result.description).toBe("A compose window with the To field empty and a blue Send button.");
    // The words: the email masked, and the Never term too.
    expect(result.words).toBe("Weekly ███\nFrom ███");
    // Both lines had something masked, so both were blacked out in the picture.
    expect(tools.blackedOut).toEqual([
      [
        { x: 0, y: 0, w: 100, h: 20 },
        { x: 0, y: 30, w: 100, h: 20 },
      ],
    ]);
    // What the model got is the blacked-out file, byte for byte, and never the original.
    const sent = imagesIn(llm.requests[0] ?? {});
    expect(sent).toEqual([asDataUrl(MASKED)]);
    expect(JSON.stringify(llm.requests)).not.toContain(ORIGINAL.toString("base64"));
    expect(JSON.stringify(llm.requests)).not.toContain("jane@acme.com");
    // The vision profile.
    expect(llm.requests[0]?.model).toBe("zai-org/GLM-5.3-Flash");
    expect(readdirSync(join(dataDir, "tmp"))).toEqual([]);
  });

  it("refuses without the masking tools, so a picture can never go out unmasked", async () => {
    const { llm, describer } = setup(true, false);
    await expect(describer.describe({ image: asDataUrl(ORIGINAL) }, "?", [])).rejects.toThrow(/mask it first/);
    expect(llm.requests).toEqual([]);
  });

  it("describes a picture a recording already masked, as it is", async () => {
    const { dataDir, llm, describer } = setup(true);
    const shot = join(dataDir, "shot.jpg");
    writeFileSync(shot, MASKED);
    expect(await describer.describeMasked(shot, "the user clicked Send")).toMatch(/compose window/);
    expect(imagesIn(llm.requests[0] ?? {})).toEqual([asDataUrl(MASKED)]);
    expect(existsSync(shot)).toBe(true); // the recording's own copy stays until the folder goes
    expect(readFileSync(shot)).toEqual(MASKED);
  });
});
