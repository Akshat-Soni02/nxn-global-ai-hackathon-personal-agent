// Pictures for the model (docs/design.md, "Redaction"; decided 13 Oct: two consents). Words always: Apple Vision reads
// a picture on the Mac and only the masked words leave (screen.ts). Pictures only with the second consent ("Let the
// model see masked pictures", config.json consent.pictures): the picture is read and masked the same way, the masked
// lines and the known secret fields are blacked out, and that blacked-out picture goes to the vision model once, to be
// described (describe_screen, used by the design agent and the repair agent). Nothing leaves without the consent, and
// never unmasked; the working copy is deleted as soon as the model has answered.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describeImage, type Llm } from "@shadow/llm";
import { type Box, maskLines } from "@shadow/recorder";
import type { Consent } from "./recording-store.ts";
import type { ScreenTools } from "./screen.ts";

export interface Described {
  // What the vision model said about the masked picture.
  description: string;
  // The masked words read from it (what the words-only path would have sent).
  words: string;
}

export interface ScreenDescriber {
  // A fresh picture (a JPEG data URL from the page, or a file Shadow.app saved): masked, described, deleted.
  describe(
    picture: { image?: string; path?: string; masks?: Box[] },
    question: string,
    never: string[],
  ): Promise<Described>;
  // A picture a recording already masked (screen.ts, shots/<event>.jpg): described as it is.
  describeMasked(path: string, question: string): Promise<string>;
  // Whether a picture may be sent right now (the consent, and a model to send it to).
  allowed(): boolean;
  // A fresh path for a picture Shadow.app should save (under the data folder, mode 0700).
  tempPath(): string;
}

export function createScreenDescriber(options: {
  dataDir: string;
  tools?: ScreenTools;
  llm: () => Llm | undefined;
  consent: () => Consent;
  log: (...args: unknown[]) => void;
}): ScreenDescriber {
  const tmp = () => {
    const dir = join(options.dataDir, "tmp");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  };
  // A picture an earlier daemon left behind (killed in the middle of describing it) is deleted at start.
  rmSync(join(options.dataDir, "tmp"), { recursive: true, force: true });
  const allowed = (): Llm => {
    if (!options.consent().pictures) {
      throw new Error(
        "the user hasn't allowed pictures to be sent to the model (the Record form: let the model see masked pictures)",
      );
    }
    const llm = options.llm();
    if (!llm) throw new Error("no model is configured");
    return llm;
  };
  const dataUrl = (path: string) => `data:image/jpeg;base64,${readFileSync(path).toString("base64")}`;

  return {
    allowed: () => options.consent().pictures && options.llm() !== undefined,
    tempPath: () => join(tmp(), `shot-${randomUUID()}.jpg`),

    async describe(picture, question, never) {
      const file = join(tmp(), `describe-${randomUUID()}.jpg`);
      // Everything, the consent check included, inside the try: whatever throws, the pictures are deleted.
      try {
        const llm = allowed();
        if (!options.tools) throw new Error("describing a picture needs Shadow.app to mask it first (pnpm setup:mac)");
        if (picture.image) {
          const data = /^data:image\/(?:jpeg|png);base64,(.+)$/.exec(picture.image)?.[1];
          if (!data) throw new Error("not a picture");
          writeFileSync(file, Buffer.from(data, "base64"), { mode: 0o600 });
        } else if (picture.path && existsSync(picture.path)) {
          writeFileSync(file, readFileSync(picture.path), { mode: 0o600 });
        } else throw new Error("no picture to describe");
        // The same masking as a recording's screenshots: by recognised text, plus the fields the page named.
        const masked = maskLines(await options.tools.read(file), never);
        await options.tools.blackOut(file, [...masked.boxes, ...(picture.masks ?? [])]);
        const words = masked.lines
          .map((l) => l.text.trim())
          .filter(Boolean)
          .join("\n")
          .slice(0, 2_000);
        const description = await describeImage(llm, { dataUrl: dataUrl(file), question, consented: true });
        return { description, words };
      } finally {
        rmSync(file, { force: true });
        if (picture.path?.startsWith(join(options.dataDir, "tmp") + sep)) rmSync(picture.path, { force: true });
      }
    },

    async describeMasked(path, question) {
      const llm = allowed();
      if (!existsSync(path)) throw new Error("no picture was kept for that step");
      return describeImage(llm, { dataUrl: dataUrl(path), question, consented: true });
    },
  };
}
