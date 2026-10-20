// pnpm evidence <recording folder> [--json]: what code understood of a recording, with no model (Checkpoint 2).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readPictures } from "../apps/daemon/src/evidence.ts";
import { TraceEvent } from "../packages/core/src/index.ts";
import { buildEvidence, compile, evidenceText, normaliseAll } from "../packages/recorder/src/index.ts";

const dir = resolve(process.argv[2] ?? ".");
const lines = (file: string) =>
  existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean) : [];
const trace = lines("trace.jsonl")
  .flatMap((l) => {
    const parsed = TraceEvent.safeParse(JSON.parse(l));
    return parsed.success ? [parsed.data] : [];
  })
  .sort((a, b) => a.at - b.at);
const form = existsSync(join(dir, "description.json"))
  ? JSON.parse(readFileSync(join(dir, "description.json"), "utf8"))
  : {};
const said = lines("transcript.jsonl").map((l) => JSON.parse(l) as { at: number; until?: number; text: string });
const { steps, noise } = normaliseAll(trace);
if (steps.length === 0) {
  console.log("no steps");
  process.exit(0);
}
const description = {
  goal: form.goal ?? "",
  changes: form.changes ?? [],
  constants: form.constants ?? [],
  never: form.never ?? [],
};
const compiled = await compile(steps, { form: { description, when: form.when ?? [{ type: "manual" }] } });
const consent = form.consent ?? { screen: false, microphone: false, pictures: false };
const evidence = buildEvidence({
  trace,
  steps,
  noise,
  skill: compiled.skill,
  idsByStep: compiled.base.idsByStep,
  goal: description.goal,
  switches: { screen: consent.screen, voice: consent.microphone, pictures: consent.pictures },
  said,
  pictures: readPictures(dir),
});
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}
const { text, tokens, level } = evidenceText(evidence);
const count = (xs: string[]) =>
  Object.entries(xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {}))
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
console.log(text);
console.log(
  `\n--- ${evidence.steps.length} steps (${count(evidence.steps.map((s) => s.class))}); ${evidence.noise.length} left out; proposals: ${count(evidence.proposals.map((p) => p.kind)) || "none"}; ~${tokens} tokens, level ${level}`,
);
