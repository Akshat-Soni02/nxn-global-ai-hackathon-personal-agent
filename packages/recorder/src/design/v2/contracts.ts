// Design agent v2's contracts (docs/superpowers/specs/2026-10-19-record-v2-design.md, Phase 3). What crosses the line
// between code and the model, and between the evidence builder (Plan 2) and the agent (Plan 3):
//   TaskModel     what the model understood the task to be (stage 1: understand), checked by the finish gate
//   DoneReport    what the agent says at the end: for each rule in the task model, the steps that build it, or why not
//   Proposal      a generalisation code found in the recording, with the change already prepared (Plan 2 builds them)
//   EvidenceView  how the agent's look and ask tools read the recording (Plan 2 implements it)
//   TestReport    what the safe test run found (packages/player/src/rehearse.ts has the same shape)
import type { EditInput } from "@shadow/core";
import { z } from "zod";

// The thinking layer, written once before any change: recorded values are examples, the rules are what was said.
export const TaskModel = z.object({
  // What is true when the task is done, in the user's terms.
  outcome: z.string().min(1),
  // How often it runs, and the words that say so.
  cadence: z.object({
    kind: z.enum(["manual", "schedule", "folder"]),
    cron: z.string().optional(),
    dir: z.string().optional(),
    quote: z.string().optional(),
  }),
  // Every value the recording shows (typed, pasted, picked, copied) and where it comes from next time.
  values: z
    .array(
      z.object({
        value: z.string(),
        step: z.string().optional(),
        kind: z.enum(["constant", "input", "today", "from_step", "list_item", "computed"]),
        source: z.string().optional(),
        evidence: z.string().optional(),
      }),
    )
    .default([]),
  // Every rule the user said or wrote, quoted. The finish gate checks each is built or explained.
  rules: z
    .array(
      z.object({
        quote: z.string().min(1),
        where: z.enum(["goal", "said", "shown"]),
        steps: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  proposals: z
    .array(z.object({ id: z.string(), decision: z.enum(["accept", "reject"]), why: z.string().min(1) }))
    .default([]),
  // What the evidence can't answer: asked only after code and the agent found no answer.
  unknowns: z
    .array(
      z.object({
        question: z.string().min(1),
        why: z.string().min(1),
        step: z.string().optional(),
        options: z.array(z.string()).max(6).default([]),
        default: z.string().optional(),
      }),
    )
    .default([]),
});
export type TaskModel = z.infer<typeof TaskModel>;

// The agent's last word: one sentence, and for each rule of the task model (by its index), the steps that build it or
// why it isn't built. The finish gate holds it against the workflow.
export const DoneReport = z.object({
  summary: z.string().min(1).max(500),
  rules: z
    .array(
      z.object({
        rule: z.number().int().min(0),
        steps: z.array(z.string()).default([]),
        how: z.string().optional(),
        not_built: z.string().optional(),
      }),
    )
    .default([]),
});
export type DoneReport = z.infer<typeof DoneReport>;

export const PROPOSAL_KINDS = [
  "repeat",
  "list_item",
  "date",
  "next_empty_row",
  "open_directly",
  "all_files",
  "constant",
] as const;

// A generalisation code found (spec 2.6), with its change prepared. Plan 2's evidence builder produces these; the
// agent accepts or rejects them (accept applies `edits` as one batch, all or nothing).
export interface Proposal {
  id: string; // "p1"
  kind: (typeof PROPOSAL_KINDS)[number];
  // One plain line the agent and the review read: "s4–s7 happen for 2 emails of the list: repeat them for each".
  summary: string;
  // The draft steps it is about.
  steps: string[];
  // What it rests on: event ids, a quote, the screen line.
  evidence: string[];
  // The prepared change. Empty for a proposal that is only a note.
  edits: EditInput[];
  // False when replay can't run it yet (writing to the next empty row): accepting it records it for the review.
  runnable: boolean;
}

// How the agent reads the recording. Plan 2 implements it over evidence.json; tests use a stand-in.
export interface EvidenceView {
  // One step's full evidence (what it did, its target, values, what appeared, its caption). Unknown id: undefined.
  step(id: string): unknown;
  // The timeline between two draft steps (or all of it), as the lines of the agent's first message.
  timeline(from?: string, to?: string): string;
  // What the goal, the narration, the pages, values and screen words hold about a question (the evidence check).
  about(question: string): string[];
  // Every text that appeared on screen after an action while recording: what a check may look for.
  appeared(): Set<string>;
}

// One step of the safe test run: done for real (ok or failed), or only outlined (found or not), or never reached.
export interface TestStep {
  id: string;
  path: string;
  status: "done" | "failed" | "found" | "not_found" | "not_reached";
  error?: string;
  value?: unknown;
}
export interface TestReport {
  steps: TestStep[];
  // How the run ended (the player's status), and why when it stopped early.
  outcome: string;
  // The final check only: the files it made for real, then put in the Trash; and those a second run made again.
  made?: string[];
  again?: string[];
}
