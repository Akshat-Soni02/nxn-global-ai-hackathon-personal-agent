import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readNotes, recordingDir, writeForm } from "./recording-store.ts";
import { transcribeRecording } from "./voice.ts";

const temp = () => mkdtempSync(join(tmpdir(), "voice-"));
function recording(home: string, startedAt?: number) {
  writeForm(home, "s1", {
    goal: "x",
    changes: [],
    constants: [],
    never: ["Project Falcon"],
    when: [{ type: "manual" }],
    consent: { screen: false, microphone: true, pictures: false },
  });
  const dir = recordingDir(home, "s1");
  writeFileSync(join(dir, "voice.m4a"), "audio");
  if (startedAt !== undefined) writeFileSync(join(dir, "voice.json"), JSON.stringify({ startedAt }));
  return dir;
}

describe("narration", () => {
  it("becomes masked text on the recording's clock, which the design agent reads as said", async () => {
    const home = temp();
    const dir = recording(home, 1_000_000);
    const count = await transcribeRecording({
      dataDir: home,
      sessionId: "s1",
      never: ["Project Falcon"],
      log: () => {},
      transcribe: async () => [
        { start: 0.5, end: 3, text: "I always take the newest email from Reporting Bot" },
        { start: 4, end: 6, text: "send it to jane@acme.com about Project Falcon" },
        { start: 7, end: 7.5, text: "  " },
      ],
    });
    expect(count).toBe(2);
    const saved = readFileSync(join(dir, "transcript.jsonl"), "utf8");
    expect(saved).not.toMatch(/jane|acme|Falcon/);
    expect(readNotes(home, "s1")).toEqual([
      { at: 1_000_500, kind: "said", text: "I always take the newest email from Reporting Bot" },
      { at: 1_004_000, kind: "said", text: "send it to ███ about ███" },
    ]);
  });

  it("is left out when it can't be lined up with the steps, or when there is nothing to turn it into text", async () => {
    const said: string[] = [];
    const log = (...a: unknown[]) => said.push(a.join(" "));
    const home = temp();
    const dir = recording(home); // no voice.json
    expect(
      await transcribeRecording({ dataDir: home, sessionId: "s1", never: [], log, transcribe: async () => [] }),
    ).toBe(0);
    expect(await transcribeRecording({ dataDir: home, sessionId: "s1", never: [], log })).toBe(0);
    expect(existsSync(join(dir, "transcript.jsonl"))).toBe(false);
    expect(said.join("\n")).toMatch(/no start time/);
    expect(said.join("\n")).toMatch(/needs Shadow.app/);
  });
});
