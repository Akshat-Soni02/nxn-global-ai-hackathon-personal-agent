import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { compile } from "../compile.ts";
import { Expectations } from "../eval/expect.ts";
import { normaliseAll } from "../normalise.ts";
import { buildEvidence } from "./evidence.ts";

const DIR = join(import.meta.dirname, "../../../../fixtures/recordings");
const lines = (name: string, file: string) =>
  readFileSync(join(DIR, name, file), "utf8")
    .split("\n")
    .filter(Boolean);

async function evidenceOf(name: string) {
  const trace = lines(name, "trace.jsonl").map((l) => TraceEvent.parse(JSON.parse(l)));
  const said = lines(name, "transcript.jsonl").map((l) => JSON.parse(l) as { at: number; text: string });
  const form = JSON.parse(readFileSync(join(DIR, name, "description.json"), "utf8")) as { goal: string };
  const { steps, noise } = normaliseAll(trace);
  const { skill, base } = await compile(steps);
  return buildEvidence({
    trace,
    steps,
    noise,
    skill,
    idsByStep: base.idsByStep,
    goal: form.goal,
    switches: { screen: false, voice: true, pictures: false },
    said,
    pictures: [],
  });
}

describe("the bench's recordings", () => {
  it.each([
    ["kpi-email-to-sheet", 12, ["date"]],
    ["timesheet", 4, []],
    ["yc-top-job", 5, ["list_item"]],
    ["playstore-to-chat", 4, ["date"]],
  ])("%s builds its evidence: %i steps, its proposals, and an expect.json that parses", async (name, count, kinds) => {
    const evidence = await evidenceOf(name);
    expect(evidence.steps).toHaveLength(count);
    expect(evidence.proposals.map((p) => p.kind)).toEqual(kinds);
    expect(() => Expectations.parse(JSON.parse(readFileSync(join(DIR, name, "expect.json"), "utf8")))).not.toThrow();
  });
});
