// @vitest-environment jsdom
// Record and replay agree on the skill file: a recording of the-internet's uploader, described by the real
// describeElement on Akshat's saved snapshot and compiled by the recorder, must hold what his hand-written
// skills/real/upload-test-file.json gives the player for the same two controls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Skill, type Step } from "../../../packages/core/src/skill.ts";
import type { TraceEvent } from "../../../packages/core/src/trace.ts";
import { compile, normalise } from "../../../packages/recorder/src/index.ts";
import { describeElement } from "./describe.ts";

const root = join(import.meta.dirname, "../../..");
const PAGE = "https://the-internet.herokuapp.com/upload";

describe("golden: recorder output vs skills/real/upload-test-file.json", () => {
  it("records the same file input and Upload button the replay skill targets", async () => {
    const html = readFileSync(join(root, "fixtures/snapshots/the-internet-upload.html"), "utf8");
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "");
    const input = describeElement(document.querySelector("#file-upload") as Element);
    const submit = describeElement(document.querySelector("#file-submit") as Element);
    const ev = (id: string, at: number, extra: Partial<TraceEvent>): TraceEvent => ({
      id,
      sessionId: "s",
      at,
      event: "click",
      tabId: 1,
      frameId: 0,
      url: PAGE,
      ...extra,
    });
    const trace = [
      ev("e1", 1_000, { target: input }),
      ev("e2", 4_000, {
        event: "file",
        target: input,
        file: { name: "taskplayer-test-1.txt", size: 12, type: "text/plain" },
      }),
      ev("e3", 6_000, { target: submit }),
      ev("e4", 6_010, { event: "submit", target: describeElement(document.querySelector("form") as Element) }),
    ];
    const { skill } = await compile(normalise(trace));

    const expected = Skill.parse(JSON.parse(readFileSync(join(root, "skills/real/upload-test-file.json"), "utf8")));
    const byAction = (steps: Step[], action: string) => steps.find((s) => s.action === action);
    for (const action of ["upload", "click"]) {
      const ours = byAction(skill.steps, action)?.target;
      const theirs = byAction(expected.steps, action)?.target;
      expect(ours?.fallbacks[0], action).toBe(theirs?.fallbacks[0]);
      expect(ours?.attrs, action).toMatchObject(theirs?.attrs ?? {}); // his attributes are a subset of ours
      expect(ours?.near, action).toBe(theirs?.near);
      if (theirs?.role) expect(ours?.role, action).toBe(theirs.role);
      if (theirs?.name) expect(ours?.name, action).toBe(theirs.name);
    }
    expect(byAction(skill.steps, "click")?.requires_approval).toBe(true); // it submits the form, like his s3
  });
});
