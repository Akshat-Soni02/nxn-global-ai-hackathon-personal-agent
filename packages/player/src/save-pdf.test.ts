// web.save_pdf (checkpoint 6): the page printed the way Print → Save as PDF does, without the browser's dialog. The
// extension prints it (Page.printToPDF); the daemon writes the file, where files live.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { savePdf } from "./node/fs-channel.ts";
import type { Cdp } from "./web/cdp.ts";
import { executeWebStep } from "./web/executor.ts";

const PDF = Buffer.from("%PDF-1.4 the page").toString("base64");
const step = (args: Record<string, unknown>) =>
  Skill.parse({
    id: "t",
    name: "t",
    version: 1,
    description: { goal: "t" },
    steps: [
      { id: "start", type: "trigger", intent: "t" },
      {
        id: "s",
        type: "action",
        intent: "Save the page as a PDF",
        channel: "web",
        action: "save_pdf",
        args,
        output: { name: "saved_1", type: { type: "file" } },
      },
    ],
  }).steps[1] as ActionStep;

describe("save the page as a PDF", () => {
  it("prints the page in the browser and hands back its bytes", async () => {
    const sent: string[] = [];
    const cdp: Cdp = {
      async send<T>(method: string) {
        sent.push(method);
        return { data: PDF } as T;
      },
    };
    const result = await executeWebStep(cdp, step({ dir: "~/Reading", name: "a.pdf" }));
    expect(result).toMatchObject({ ok: true, value: { pdf: PDF } });
    expect(sent).toEqual(["Page.printToPDF"]);
  });

  it("writes the PDF into the folder, never over another file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tp-pdf-"));
    writeFileSync(join(dir, "24 Oct - Thuggee.pdf"), "yesterday's");
    const file = await savePdf({ dir, name: "24 Oct - Thuggee.pdf" }, PDF);
    expect(file.name).toBe("24 Oct - Thuggee (1).pdf");
    expect(readFileSync(file.path, "utf8")).toBe("%PDF-1.4 the page");
  });

  it("keeps the name a file name: a title read from a page can't leave the folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tp-pdf-"));
    const file = await savePdf({ dir, name: "../../.ssh/AC/DC" }, PDF);
    expect(file.path).toBe(join(dir, "-..-.ssh-AC-DC.pdf"));
  });
});
