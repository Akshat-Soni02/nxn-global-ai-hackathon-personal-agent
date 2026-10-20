// The evidence package (spec 2.14): everything code understood of a recording, the design agent's only input.
// - Built once when the recording stops, and kept as evidence.json in its folder.
// - Its text, for the agent's first message, stays under 24k tokens (EVIDENCE_TOKENS). Steps that only revealed
//   something lose their screen words and captions first, then every step's screen words go, then the captions, then
//   what appeared is cut. Speech and proposals are never cut.
// - The agent reads the rest through EvidenceView (Plan 3's look and ask tools).
import type { Skill, TraceEvent } from "@shadow/core";
import type { EvidenceView, Proposal } from "../design/v2/contracts.ts";
import { maskText } from "../mask.ts";
import type { Noise, NormalisedStep } from "../normalise.ts";
import { classOf, type StepClass } from "./classes.ts";
import { type Flow, flowOf } from "./flow.ts";
import { proposalsOf } from "./proposals.ts";
import { type Picture, screensOf } from "./screens.ts";
import { type TabInfo, tabsOf } from "./tabs.ts";
import { describeStep, type TimelineLine, timelineOf, timelineSlice } from "./timeline.ts";

export const EVIDENCE_TOKENS = 24_000;
// About four characters a token, as the model client counts for its budget.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface EvidenceStep {
  id: string;
  ids: string[];
  at: number;
  class: StepClass;
  tab?: string;
  line: string;
  appeared: string[];
  near: string[];
  caption?: string;
  weak?: string;
  events: string[];
}
export interface Evidence {
  version: 1;
  goal: string;
  recordedOn: string;
  start: number;
  switches: { screen: boolean; voice: boolean; pictures: boolean };
  tabs: TabInfo[];
  steps: EvidenceStep[];
  noise: Noise[];
  flow: Flow[];
  proposals: Proposal[];
  said: { at: number; until?: number; text: string }[];
  timeline: TimelineLine[];
}
export interface EvidenceInput {
  trace: TraceEvent[];
  steps: NormalisedStep[];
  noise: Noise[];
  skill: Skill;
  idsByStep: string[][];
  goal: string;
  switches: Evidence["switches"];
  said: Evidence["said"];
  pictures: Picture[];
  captions?: (string | undefined)[];
  // The recording's Never and private words, masked with emails, keys and cards in all it shows a model.
  maskTerms?: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

// Spec 2.7: a click target found only by its text, or by nothing, is weak; a list item or a read is safer.
function weakness(s: NormalisedStep): string | undefined {
  const t = s.target;
  if (s.kind !== "click" || !t || (t.role && (t.name || t.label))) return undefined;
  if (!t.role && !t.name && !t.label && t.text) return "found only by its text: a list item or a read is safer";
  if (!t.name && !t.label && !t.text) return "nameless: nothing on it to find it by";
  return undefined;
}

// What a model reads of the evidence is masked like screen words: a value typed, copied or selected, a list item or a
// cell can hold an email, a key, or one of the recording's Never and private words ("Copy API key" put a key in a
// copy). The prepared changes (proposals' edits) and a left-out step's own record keep the real values: code applies
// them, no model reads them.
function masked(ev: Evidence, terms: string[]): Evidence {
  const m = (t: string) => maskText(t, terms).text;
  return {
    ...ev,
    tabs: ev.tabs.map((t) => ({ ...t, name: m(t.name) })),
    steps: ev.steps.map((s) => ({
      ...s,
      ...(s.tab ? { tab: m(s.tab) } : {}),
      line: m(s.line),
      appeared: s.appeared.map(m),
      near: s.near.map(m),
      ...(s.caption ? { caption: m(s.caption) } : {}),
    })),
    noise: ev.noise.map((n) => ({ ...n, what: m(n.what) })),
    flow: ev.flow.map((f) => (f.value ? { ...f, value: m(f.value) } : f)),
    proposals: ev.proposals.map((p) => ({ ...p, summary: m(p.summary) })),
    said: ev.said.map((s) => ({ ...s, text: m(s.text) })),
    timeline: ev.timeline.map((l) => ({ ...l, text: m(l.text) })),
  };
}

export function buildEvidence(input: EvidenceInput): Evidence {
  const times = [...input.trace.map((e) => e.at), ...input.steps.map((s) => s.at)];
  const start = times.length > 0 ? Math.min(...times) : Date.now();
  const { tabs, nameOf } = tabsOf(input.trace, input.steps);
  const screens = screensOf(input.steps, input.pictures, input.trace);
  const classes = input.steps.map(classOf);
  const recordedOn = new Date(start);
  const steps = input.steps.map((s, i): EvidenceStep => {
    const ids = input.idsByStep[i] ?? [];
    const screen = screens[i] ?? { near: [], appeared: [] };
    const caption = input.captions?.[i];
    const weak = weakness(s);
    const tab = nameOf(s.tabId);
    return {
      id: ids[0] ?? `n${i + 1}`,
      ids,
      at: s.at,
      class: classes[i] ?? "act",
      ...(tab ? { tab } : {}),
      line: describeStep(s),
      appeared: screen.appeared,
      near: screen.near,
      ...(caption ? { caption } : {}),
      ...(weak ? { weak } : {}),
      events: s.events,
    };
  });
  return masked(
    {
      version: 1,
      goal: input.goal,
      recordedOn: `${recordedOn.getFullYear()}-${pad(recordedOn.getMonth() + 1)}-${pad(recordedOn.getDate())}`,
      start,
      switches: input.switches,
      tabs,
      steps,
      noise: input.noise,
      flow: flowOf(input.steps, input.skill, input.idsByStep),
      proposals: proposalsOf({
        steps: input.steps,
        skill: input.skill,
        idsByStep: input.idsByStep,
        goal: input.goal,
        said: input.said,
        recordedOn,
      }),
      said: input.said,
      timeline: timelineOf({
        start,
        steps: input.steps,
        ids: input.idsByStep,
        classes,
        tabs,
        screens,
        said: input.said,
        noise: input.noise,
      }),
    },
    input.maskTerms ?? [],
  );
}

const q = (t: string) => `"${t}"`;
const LEVELS = 6;

// The timeline's lines with each step's details under it, as much as the level allows.
function render(ev: Evidence, lines: TimelineLine[], level: number): string[] {
  const byId = new Map(ev.steps.map((s) => [s.id, s]));
  const out: string[] = [];
  for (const line of lines) {
    out.push(line.text);
    const step = line.step ? byId.get(line.step) : undefined;
    if (!step) continue;
    const revealOnly = step.class === "reveal";
    const appeared =
      level >= 5 && (step.class === "go" || revealOnly) ? [] : step.appeared.slice(0, level >= 4 ? 3 : 12);
    if (appeared.length > 0) out.push(`        appeared: ${appeared.map(q).join(", ")}`);
    if (level < 2 && !(level >= 1 && revealOnly) && step.near.length > 0)
      out.push(`        near the click: ${step.near.map(q).join(", ")}`);
    if (step.caption && level < 3 && !(level >= 1 && revealOnly)) out.push(`        picture: ${step.caption}`);
    if (step.weak) out.push(`        weak target: ${step.weak}`);
  }
  return out;
}

export function evidenceText(ev: Evidence, cap = EVIDENCE_TOKENS): { text: string; tokens: number; level: number } {
  let best = { text: "", tokens: Number.POSITIVE_INFINITY, level: 0 };
  for (let level = 0; level < LEVELS; level++) {
    const on = (b: boolean) => (b ? "on" : "off");
    const text = [
      `Goal: ${ev.goal}`,
      `Recorded on ${ev.recordedOn}. Screen ${on(ev.switches.screen)}, voice ${on(ev.switches.voice)}, pictures ${on(ev.switches.pictures)}.`,
      "",
      "Timeline (steps by their draft ids; (left out) lines are not in the draft and can be put back):",
      ...render(ev, ev.timeline, level),
      "",
      "Proposals (code found these; accept or reject each):",
      ...(ev.proposals.length > 0
        ? ev.proposals.map(
            (p) =>
              `${p.id} ${p.kind}: ${p.summary}${p.edits.length > 0 ? " [change ready]" : ""}${p.runnable ? "" : " [can't run yet]"}`,
          )
        : ["(none)"]),
      "",
      `Where values go: ${ev.flow.map((f) => `${f.from} → ${f.to} ${f.how}${f.value ? ` ${q(f.value)}` : ""}`).join("; ") || "(nothing passed between steps)"}`,
    ].join("\n");
    best = { text, tokens: estimateTokens(text), level };
    if (best.tokens <= cap) return best;
  }
  return best;
}

const STOP = new Set([
  "which",
  "what",
  "when",
  "where",
  "should",
  "would",
  "next",
  "time",
  "this",
  "that",
  "with",
  "from",
  "your",
  "they",
]);

export function evidenceView(ev: Evidence): EvidenceView {
  return {
    step: (id) => ev.steps.find((s) => s.ids.includes(id)),
    timeline: (from, to) => render(ev, timelineSlice(ev.timeline, from, to), 0).join("\n"),
    about: (question) => {
      const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((w) => !STOP.has(w));
      const pool = [
        ev.goal,
        ...ev.said.map((s) => s.text),
        ...ev.steps.flatMap((s) => [...s.appeared, ...s.near, s.caption ?? ""]),
      ].filter(Boolean);
      return [...new Set(pool.filter((t) => words.some((w) => t.toLowerCase().includes(w))))].slice(0, 8);
    },
    appeared: () => new Set(ev.steps.flatMap((s) => s.appeared)),
  };
}
