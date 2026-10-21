import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, normaliseAll } from "@shadow/recorder";
import { describe, expect, it } from "vitest";
import { writeEvidence } from "./evidence.ts";
import { recordingDir } from "./recording-store.ts";

describe("evidence.json", () => {
  it("is written when a recording stops, with captions only when Pictures is on, and never throws", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "shadow-ev-"));
    const dir = recordingDir(dataDir, "rec1");
    mkdirSync(join(dir, "shots"), { recursive: true });
    const url = "http://localhost:5173/paste-form.html";
    const trace = [
      { id: "e1", sessionId: "rec1", at: 1_000, event: "navigate" as const, tabId: 1, url, transition: "typed" },
      {
        id: "e2",
        sessionId: "rec1",
        at: 2_000,
        event: "click" as const,
        tabId: 1,
        url,
        target: { tag: "button", url, role: "button", name: "Save", fallbacks: [], selectors: { css: "#s" } },
      },
    ];
    writeFileSync(join(dir, "shots", "e2.jpg"), "jpg");
    writeFileSync(
      join(dir, "screen.jsonl"),
      `${JSON.stringify({ at: 2_000, eventId: "e2", tabId: 1, text: "Save", lines: [{ text: "Save", box: { x: 0, y: 0, w: 1, h: 1 } }] })}\nnot json\n`,
    );
    const { steps, noise } = normaliseAll(trace);
    const { skill, base } = await compile(steps);
    const logs: string[] = [];
    const describer = {
      allowed: () => true,
      tempPath: () => join(dataDir, "tmp-crop"),
      describeMasked: async () => "A form with an Amount field and a Save button.",
      describe: async () => ({}) as never,
    };
    const common = {
      dataDir,
      sessionId: "rec1",
      trace,
      steps,
      noise,
      skill,
      idsByStep: base.idsByStep,
      notes: [],
      log: (...a: unknown[]) => logs.push(a.join(" ")),
    };
    const consent = (pictures: boolean) => ({
      goal: "Save the amount",
      changes: [],
      constants: [],
      never: [],
      private: [],
      when: [{ type: "manual" as const }],
      consent: { screen: true, microphone: false, pictures },
    });
    const off = await writeEvidence({ ...common, form: consent(false), describer });
    expect(off?.steps.some((s) => s.caption)).toBe(false);
    const on = await writeEvidence({ ...common, form: consent(true), describer });
    expect(on?.steps.find((s) => s.caption)?.caption).toContain("Save button");
    expect(JSON.parse(readFileSync(join(dir, "evidence.json"), "utf8")).version).toBe(1);
    expect(logs.at(-1)).toMatch(/^evidence: \d+ steps/);
    expect(await writeEvidence({ ...common, sessionId: "missing", form: consent(false) })).toBeUndefined();
    expect(existsSync(join(dataDir, "recordings", "missing"))).toBe(false);
  });
});
