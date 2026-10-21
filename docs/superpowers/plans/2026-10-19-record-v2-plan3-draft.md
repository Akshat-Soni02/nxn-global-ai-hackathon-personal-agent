# Record v2, Plan 3 (DRAFT): the format-independent parts of the design agent v2 and the screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DRAFT.** Written while Plan 1 runs and before Checkpoint 1.
> - **Covers** only the parts that don't depend on the final shape of `evidence.json` (Plan 2).
> - **Revised after Checkpoint 1:** any task that reads evidence or the task model's inputs (Tasks 1, 3 and 4 name
>   them).
> - **Not here:** the orchestrator itself (the stages, the prompt, the understand call, wiring these pieces into
>   `finishRecording`) is written in Plan 3 proper, after Plan 2.
> - **Depends on Plan 1:** Task 5 (agent loop: `callsPerTurn`, `runCall`) and Task 9 (the trace's `Effect`).

**Goal:** the pieces of design agent v2 that can be built and tested now:
- the contracts between Plan 2 and Plan 3 (task model, proposals, the evidence view, the test report);
- guardrails that refuse only what is harmful and record every other change with its reason;
- the finish gate;
- forgiving tools;
- the safe test run;
- multi-tab replay with keys that carry modifiers;
- the progress feed and per-recording questions.

**Architecture:**
- **New code lives in `packages/recorder/src/design/v2/`,** next to the old design agent, which stays until Plan 3
  proper switches `finishRecording` over and removes `design.ts`, `tools.ts` and `changes.ts` (removal already approved
  with the spec).
- **The safe test run:**
  - its pure decisions live in `packages/player/src/rehearse.ts`;
  - the daemon runs it through the existing walk-through path (`runSkillOn` with an automatic `walk`).
- **Multi-tab** adds `tab` to action steps (a `skill.ts` change: Akshat signs off) and one automation tab per name in
  the extension.

**Tech stack:** TypeScript 7, vitest 5, zod 4, React 19 (UI), Chrome MV3 (extension).

**Spec:** `docs/superpowers/specs/2026-10-19-record-v2-design.md` (Phase 3, Phase 4). **Plan 1:**
`docs/superpowers/plans/2026-10-19-record-v2.md`.

## Global Constraints

- After every task: `corepack pnpm test`, `corepack pnpm typecheck` and `corepack pnpm lint` exit 0.
- **No real model calls.** Agent tools are tested by calling `tool.run` directly, or through `runAgent` with `fakeLlm`.
- **`skill.ts` changes** (`tab` on action steps) need Akshat's sign-off in the PR. Say so in the commit body.
- **Locators never store positions.** Guardrails never let an approval be turned off. Outward steps always get
  approval from code (`requireApprovals`), including steps the agent adds.
- **Page, email and screen text** reaching a tool's output is marked `untrusted: true`.
- **Commits** (same rules as Plan 1):
  - `git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit`;
  - a conventional subject plus 2–4 bullets;
  - the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
  - Never push unless asked.
- **No pre-existing file is deleted in this plan.**

## Review Focus

1. **A whole tool input, or one field, sent as a JSON string** (`"edits": "[{…}]"`, five times in the Oct 19 runs) is
   parsed, not rejected. Test in Task 4.
2. **The agent removes every recorded write** (the Play Store run: all 20 steps gone, "succeeded" in 3 ms). The gate
   refuses and names each one. Test in Task 3.
3. **An invented check** (`text_visible: "Job entry added to sheet"`, never on screen) and a text check on a Google
   Sheet: the gate refuses both. Test in Task 3.
4. **Gmail's Archive in the test run:** a button whose recorded effect was "went somewhere" is outlined, never
   pressed. Test in Task 5.
5. **Going back to a tab that holds a selected sheet cell:** the same tab name gets the same automation tab, not a
   reload. Test in Task 6.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/recorder/src/design/v2/contracts.ts` (new) | `TaskModel`, `DoneReport` (zod); `Proposal`, `EvidenceView`, `TestReport` (interfaces Plan 2 must satisfy) | 1 |
| `packages/recorder/src/design/v2/places.ts` (new) | paths and sites: `expand`, `inside`, `isReference`, `climbs`, `originOf`, `samePage` | 2 |
| `packages/recorder/src/design/v2/rules.ts` (new) | `refusals` (the never-list) and `changeNotes` (everything else, with reasons) | 2 |
| `packages/recorder/src/design/v2/gate.ts` (new) | the finish gate | 3 |
| `packages/agent/src/{tool,agent}.ts` | `Tool.prepare`: a tool may clean its input before the schema sees it | 4 |
| `packages/recorder/src/compile.ts` | export `producedType` | 4 |
| `packages/recorder/src/design/v2/session.ts`, `tools.ts` (new) | the design session and the forgiving tools | 4 |
| `packages/player/src/rehearse.ts` (new), `apps/daemon/src/rehearse.ts` (new), `apps/daemon/src/runner.ts` | the safe test run | 5 |
| `packages/core/src/skill.ts`, `packages/player/src/web/executor.ts`, `apps/extension/src/tab-map.ts` (new), `apps/extension/src/replay.ts` | steps that name their tab; keys with modifiers | 6 |
| `apps/daemon/src/{record-control,types,main,record}.ts`, `packages/recorder/src/design/progress.ts` (new), `apps/ui/src/questions.ts` (new), `apps/ui/src/screens/{Record,Inbox}.tsx` | the progress feed; this recording's questions only; Enter sends | 7 |

---

### Task 1 (moved to Plan 2, Task 1): The contracts between the evidence (Plan 2) and the agent (Plan 3)

**Files:**
- Create: `packages/recorder/src/design/v2/contracts.ts`
- Create: `packages/recorder/src/design/v2/contracts.test.ts`
- Modify: `packages/recorder/src/index.ts` (export the v2 contracts)

**Interfaces:**
- **Produces (zod):** `TaskModel`, `DoneReport`.
- **Produces (interfaces):** `Proposal`, `EvidenceView`, `TestStep`, `TestReport`.
- **Plan 2 must produce** `Proposal[]` and implement `EvidenceView`.
- **Task 5's report** has the `TestReport` shape (structural: the player does not import the recorder).

- [ ] **Step 1: Write the failing test** `packages/recorder/src/design/v2/contracts.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DoneReport, TaskModel } from "./contracts.ts";

describe("the task model", () => {
  it("holds what the model understood, with defaults for what it left out", () => {
    const model = TaskModel.parse({
      outcome: "Each new KPI email's numbers are in the next row of the KPI sheet",
      cadence: { kind: "schedule", cron: "0 9 * * *", quote: "every day" },
      rules: [{ quote: "always take the newest one", where: "said" }],
    });
    expect(model).toMatchObject({ values: [], proposals: [], unknowns: [] });
    expect(model.rules[0]?.steps).toEqual([]);
  });

  it("refuses a model with no outcome, or a cadence it can't run", () => {
    expect(TaskModel.safeParse({ cadence: { kind: "manual" } }).success).toBe(false);
    expect(TaskModel.safeParse({ outcome: "x", cadence: { kind: "sometimes" } }).success).toBe(false);
  });
});

describe("the done report", () => {
  it("says, per stated rule, which steps build it or why it isn't built", () => {
    const done = DoneReport.parse({
      summary: "Takes the newest unread KPI email",
      rules: [{ rule: 0, steps: ["l1", "s4"], how: "a loop over new emails" }, { rule: 1, not_built: "no write action for the next empty row yet" }],
    });
    expect(done.rules).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/recorder/src/design/v2/contracts.test.ts`
Expected: FAIL: no module.

- [ ] **Step 3: Write `packages/recorder/src/design/v2/contracts.ts`**

```ts
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
}
```

Add to `packages/recorder/src/index.ts`:
```ts
export {
  DoneReport,
  type EvidenceView,
  PROPOSAL_KINDS,
  type Proposal,
  TaskModel,
  type TestReport,
  type TestStep,
} from "./design/v2/contracts.ts";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm vitest run packages/recorder/src/design/v2/contracts.test.ts && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/design/v2/contracts.ts packages/recorder/src/design/v2/contracts.test.ts packages/recorder/src/index.ts
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(design-v2): the task model, proposals, evidence view and test report

- the contracts between the evidence builder (Plan 2) and design agent v2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Guardrails, not handcuffs: refuse only what's harmful, record everything else with its reason

**Files:**
- Create: `packages/recorder/src/design/v2/places.ts`
- Create: `packages/recorder/src/design/v2/rules.ts`
- Create: `packages/recorder/src/design/v2/rules.test.ts`

**Interfaces:**
- Produces:
  - `RecordingFacts { pages: string[]; folders: string[] }`;
  - `refusals(original: Skill, draft: Skill, facts: RecordingFacts): string[]`;
  - `ChangeNote`;
  - `changeNotes(original: Skill, draft: Skill, whys: Map<string, string>, unverified: Set<string>): ChangeNote[]`.

- [ ] **Step 1: Write the failing test** `packages/recorder/src/design/v2/rules.test.ts`

```ts
import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { changeNotes, refusals } from "./rules.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/S/edit";
const base = (steps: unknown[], never: string[] = []) =>
  Skill.parse({
    id: "kpi",
    name: "kpi",
    version: 1,
    description: { goal: "KPIs into the sheet", never },
    steps: [{ id: "start", type: "trigger", intent: "by hand" }, ...steps],
  });
const open = (id: string, url: string) => ({
  id,
  type: "action",
  intent: "open",
  channel: "web",
  action: "navigate",
  args: { url },
});
const click = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `click ${name}`,
  channel: "web",
  action: "click",
  target: { role: "button", name, fallbacks: [] },
  ...extra,
});
const facts = { pages: [SHEET, "https://mail.google.com/mail/u/0/#inbox"], folders: ["/Users/me/Downloads"] };

describe("refusals: what the design agent may never do", () => {
  const original = base([open("s1", SHEET), click("s2", "Send", { requires_approval: true })], ["Archive"]);

  it("allows new clicks, new targets, removals and reordering: those are changes for the review, not refusals", () => {
    const draft = base([open("s1", SHEET), click("s9", "Next page")], ["Archive"]);
    expect(refusals(original, draft, facts)).toEqual([]);
  });

  it("refuses turning approval off, scripts, a changed goal, an unvisited site, files elsewhere and Never matches", () => {
    const draft = Skill.parse({
      ...original,
      description: { goal: "something else", never: ["Archive"] },
      steps: [
        // {{link}}: a value the run is given (a link read from an email, say).
        { id: "start", type: "trigger", intent: "by hand", inputs: { link: { type: { type: "text" } } } },
        open("s1", "https://evil.example/"),
        click("s2", "Send", { requires_approval: false }),
        { id: "s3", type: "action", intent: "run it", channel: "script", action: "shell", args: { command: "ls" } },
        { id: "s4", type: "action", intent: "find", channel: "fs", action: "find", args: { dir: "~/.ssh", glob: "*", pick: "all" } },
        click("s5", "Archive"),
        open("s6", "{{link}}"),
      ],
    });
    const why = refusals(original, draft, facts).join("\n");
    expect(why).toMatch(/goal/);
    expect(why).toMatch(/s1: https:\/\/evil\.example is a site the recording didn't visit/);
    expect(why).toMatch(/s2: approval can't be turned off/);
    expect(why).toMatch(/s3: script/);
    expect(why).toMatch(/s4: .*folders the recording touched/);
    expect(why).toMatch(/s5: .*Never rule "Archive"/);
    expect(why).toMatch(/s6: an address built from a value/);
  });
});

describe("change notes: everything else, with the agent's reason", () => {
  it("lists added, removed, changed and moved steps, and which new targets the test run hasn't found yet", () => {
    const original = base([open("s1", SHEET), click("s2", "Print all"), click("s3", "Next")]);
    const draft = base([
      open("s1", "https://mail.google.com/mail/u/0/#inbox"),
      click("s9", "Newest email"),
      click("s3", "Next"),
    ]);
    const notes = changeNotes(original, draft, new Map([["s2", "a click that changed nothing"], ["s9", "open the newest email, not this one"]]), new Set(["s9"]));
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "s2", change: "removed", why: "a click that changed nothing" }),
        expect.objectContaining({ step: "s9", change: "added", unverified: true }),
        expect.objectContaining({ step: "s1", change: "changed" }),
      ]),
    );
    expect(notes.some((n) => n.step === "s3")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/recorder/src/design/v2/rules.test.ts`
Expected: FAIL: no module.

- [ ] **Step 3: Implement**

`packages/recorder/src/design/v2/places.ts`: the path and site helpers of `design/tools.ts`, exported. They are copied
because the old file goes away with Plan 3 proper.
```ts
// Where a step may reach: paths as the player opens them (~ expanded, symlinks followed, so a link inside an allowed
// folder can't reach outside it), and sites by origin. Shared by the guardrails (rules.ts).
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export function expand(path: string): string {
  const abs = resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return abs;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

export const inside = (where: unknown, folders: string[]): boolean =>
  typeof where === "string" && folders.some((f) => expand(where) === f || expand(where).startsWith(`${f}${sep}`));

// A whole-string reference to a value an earlier step produced, or a run was given.
export const isReference = (where: unknown): boolean => typeof where === "string" && /^\{\{[^}]+\}\}$/.test(where.trim());

// A glob that leaves its folder: absolute, from ~, or climbing with "..".
export const climbs = (glob: unknown): boolean =>
  typeof glob === "string" && (isAbsolute(glob) || glob.startsWith("~") || /(^|[\\/])\.\.([\\/]|$)/.test(glob));

export const originOf = (url: unknown): string | undefined => {
  try {
    return typeof url === "string" ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};
```

`packages/recorder/src/design/v2/rules.ts`:
```ts
// Design agent v2's rules (spec, "Rules v2: guardrails, not handcuffs"). The agent may change the workflow freely
// (remove, change and add steps, new clicks and typing too, new targets, shortcuts, reorder, the frequency): each
// change is recorded with its reason and highlighted for the user (changeNotes). Only what is harmful is refused, so it
// never reaches the user: turning an approval off, scripts, changing their goal, a site the recording never visited,
// files outside the folders it touched, anything matching their Never list. Approval on outward steps is added by code
// afterwards (requireApprovals), on the agent's new steps too.
import { isAction, neverMatch, type Skill, type Step, walkSteps } from "@shadow/core";
import { climbs, expand, inside, isReference, originOf } from "./places.ts";

export interface RecordingFacts {
  // Every page the recording was on or reached (by a click, too): the only sites a step may open.
  pages: string[];
  // The folders it touched, expanded: the only places a file step may reach.
  folders: string[];
}

const PATH_ARGS = ["dir", "path", "from", "to"] as const;

export function refusals(original: Skill, draft: Skill, facts: RecordingFacts): string[] {
  const problems: string[] = [];
  if (draft.description.goal !== original.description.goal) {
    problems.push("the goal is the user's own words: it can't change");
  }
  const before = new Map<string, Step>([...walkSteps(original.steps)].map(({ step }) => [step.id, step]));
  const visited = [
    ...facts.pages,
    ...[...before.values()].filter(isAction).flatMap((s) => (s.action === "navigate" ? [String(s.args.url)] : [])),
  ];
  const sites = new Set(visited.map(originOf).filter((o): o is string => !!o && o !== "null"));
  const files = new Set(visited.filter((u) => /^file:/i.test(u)));
  const folders = facts.folders.map(expand);
  const where = `folders the recording touched (${folders.join(", ") || "none"})`;

  for (const { step } of walkSteps(draft.steps)) {
    const old = before.get(step.id);
    if (old && "requires_approval" in old && old.requires_approval && !("requires_approval" in step && step.requires_approval)) {
      problems.push(`${step.id}: approval can't be turned off`);
    }
    if (!isAction(step)) continue;
    if (old && JSON.stringify(old) === JSON.stringify(step)) continue; // as recorded: nothing new to judge
    if (step.channel === "script") problems.push(`${step.id}: script and shell steps can't be added or changed`);
    if (step.action === "navigate") {
      const why = reach(step.args.url, sites, files);
      if (why) problems.push(`${step.id}: ${why}`);
    }
    if (step.channel === "fs") {
      for (const key of PATH_ARGS) {
        const place = step.args[key];
        if (place === undefined || isReference(place) || inside(place, folders)) continue;
        problems.push(`${step.id}: it may only reach ${where}, not ${String(place)}: ask the user instead`);
      }
      if (climbs(step.args.glob)) problems.push(`${step.id}: its glob (${String(step.args.glob)}) must stay inside its folder`);
    }
    const never = neverMatch(step, original.description.never);
    if (never) problems.push(`${step.id}: it matches the user's Never rule "${never}": ask them instead`);
  }
  return problems;
}

// Why an address can't be opened, or undefined when it can. An address made from a value (a link read from an email)
// could go anywhere, so it must start with a visited site.
function reach(url: unknown, sites: Set<string>, files: Set<string>): string | undefined {
  if (typeof url !== "string" || !url.trim()) return "it has no address";
  if (/^file:/i.test(url)) return files.has(url) ? undefined : "a local file the recording didn't open";
  const at = url.indexOf("{{");
  const origin = originOf(at < 0 ? url : url.slice(0, at));
  if (!origin || origin === "null") {
    return "an address built from a value could go anywhere: click the item instead, or start the address with its site (https://…/{{…}})";
  }
  return sites.has(origin) ? undefined : `${origin} is a site the recording didn't visit: ask the user instead`;
}

// What the agent changed, step by step, with its reason: the review highlights each one for the user to check.
export interface ChangeNote {
  step: string;
  change: "added" | "removed" | "changed" | "moved";
  // The step in a few words: its intent, or what it does.
  what: string;
  why?: string;
  // A new target the safe test run hasn't found on the live page yet.
  unverified?: boolean;
}

export function changeNotes(
  original: Skill,
  draft: Skill,
  whys: Map<string, string>,
  unverified: Set<string>,
): ChangeNote[] {
  const placed = (skill: Skill) =>
    new Map([...walkSteps(skill.steps)].map(({ step, parents }) => [step.id, { step, parent: parents.at(-1) ?? "" }]));
  const was = placed(original);
  const now = placed(draft);
  const note = (step: Step, change: ChangeNote["change"]): ChangeNote => ({
    step: step.id,
    change,
    what: step.intent || step.type,
    ...(whys.has(step.id) ? { why: whys.get(step.id) } : {}),
    ...(unverified.has(step.id) ? { unverified: true } : {}),
  });
  const notes: ChangeNote[] = [];
  for (const [id, { step }] of was) if (!now.has(id) && step.type !== "trigger") notes.push(note(step, "removed"));
  for (const [id, { step, parent }] of now) {
    const old = was.get(id);
    if (step.type === "trigger") continue;
    if (!old) notes.push(note(step, "added"));
    else if (JSON.stringify(old.step) !== JSON.stringify(step)) notes.push(note(step, "changed"));
    else if (old.parent !== parent) notes.push(note(step, "moved"));
  }
  return notes;
}
```

  Two details:
  - The trigger is left out of the notes, so a changed frequency isn't listed there. The review shows it from the
    task model's cadence instead.
  - `changeNotes` doesn't need `isAction`; import only what `rules.ts` uses, or `pnpm lint` reports it.

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm vitest run packages/recorder/src/design/v2 && corepack pnpm lint`
Expected: PASS. If `expand` resolves `/Users/me` against the real disk differently, compare against
`facts.folders.map(expand)`, as the code already does.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/design/v2/places.ts packages/recorder/src/design/v2/rules.ts packages/recorder/src/design/v2/rules.test.ts
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(design-v2): guardrails that refuse only harm, and a reasoned note for every other change

- refused: approval off, scripts, a changed goal, unvisited sites, files elsewhere, Never matches
- every other change (new clicks and targets too) is a note with the agent's reason for the review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The finish gate

**Files:**
- Create: `packages/recorder/src/design/v2/gate.ts`
- Create: `packages/recorder/src/design/v2/gate.test.ts`

**Interfaces:**
- Consumes: `TaskModel`, `DoneReport`, `TestReport` (Task 1).
- Produces: `GateInput` and `gate(input: GateInput): string[]`. An empty result means the workflow may be saved.
  - `appeared` is a plain `Set<string>`, so the gate doesn't depend on the evidence format. Plan 2 supplies it from
    `EvidenceView.appeared()` plus the test run's page text.

- [ ] **Step 1: Write the failing test** `packages/recorder/src/design/v2/gate.test.ts`

```ts
import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { DoneReport, TaskModel } from "./contracts.ts";
import { gate } from "./gate.ts";

const CHAT = "https://chat.google.com/room/X";
const SHEET = "https://docs.google.com/spreadsheets/d/S/edit";
const skill = (steps: unknown[], when: unknown[] = [{ type: "manual" }], success: unknown[] = []) =>
  Skill.parse({
    id: "w",
    name: "w",
    version: 1,
    description: { goal: "stats to chat" },
    success,
    steps: [{ id: "start", type: "trigger", intent: "by hand", when }, ...steps],
  });
const act = (id: string, channel: string, action: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  intent: `${action} ${id}`,
  channel,
  action,
  args,
  ...(channel === "web" && action !== "navigate" ? { target: { role: "textbox", name: id, fallbacks: [] } } : {}),
  ...extra,
});
const recorded = skill([
  act("s1", "web", "navigate", { url: CHAT }),
  act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
  act("s3", "web", "type", { text: "Date - 19 Oct" }),
  act("s4", "web", "press", { key: "Enter" }),
]);
const task = TaskModel.parse({
  outcome: "every report of every month is posted in the Chat space with today's date",
  cadence: { kind: "schedule", cron: "0 9 1 * *", quote: "monthly" },
  rules: [{ quote: "every report", where: "said" }, { quote: "today's date", where: "said" }],
});
const done = (rules: unknown[] = []) => DoneReport.parse({ summary: "done", rules });
const input = (workflow: Skill, extra: Partial<Parameters<typeof gate>[0]> = {}) => ({
  recorded,
  workflow,
  task,
  done: done([{ rule: 0, steps: ["s2"] }, { rule: 1, steps: ["s3"] }]),
  appeared: new Set(["Message sent", "Arilo Stats"]),
  explained: new Map<string, string>(),
  ...extra,
});

describe("the finish gate", () => {
  it("refuses a workflow that lost the work the user showed (the Play Store run: one fs.find left)", () => {
    const lost = skill([act("s9", "fs", "find", { dir: "~/Downloads", glob: "*.csv", pick: "all" })], [{ type: "schedule", cron: "0 9 1 * *" }]);
    const problems = gate(input(lost)).join("\n");
    expect(problems).toMatch(/s2 .*gone/);
    expect(problems).toMatch(/s3 .*gone/);
  });

  it("refuses invented checks, empty ones, and text checks on a sheet's drawn cells", () => {
    const wf = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
        act("s3", "web", "type", { text: "Date - {{today}}" }, { check: { text_visible: "Job entry added to sheet" } }),
        act("s4", "web", "press", { key: "Enter" }, { check: { text_visible: "" } }),
        act("s5", "web", "navigate", { url: SHEET }, { check: { text_visible: "Arilo Stats" } }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    const problems = gate(input(wf)).join("\n");
    expect(problems).toMatch(/s3: .*"Job entry added to sheet" never appeared/);
    expect(problems).toMatch(/s4: .*empty/);
    expect(problems).toMatch(/s5: .*drawn/);
  });

  it("wants every stated rule built or explained, the frequency they said, and test failures explained", () => {
    const wf = skill([
      act("s1", "web", "navigate", { url: CHAT }),
      act("s2", "web", "upload", { file: "~/Downloads/x.csv" }),
      act("s3", "web", "type", { text: "Date - {{today}}" }),
      act("s4", "web", "press", { key: "Enter" }),
    ]);
    const problems = gate(
      input(wf, {
        done: done([{ rule: 0, steps: ["l9"] }]),
        test: { outcome: "succeeded", steps: [{ id: "s2", path: "s2", status: "not_found" }] },
      }),
    ).join("\n");
    expect(problems).toMatch(/rule 0 .*l9/);
    expect(problems).toMatch(/rule 1 "today's date" is neither built nor explained/);
    expect(problems).toMatch(/monthly/);
    expect(problems).toMatch(/s2: the test run didn't find it/);
  });

  it("accepts a removal or a failure the agent explained, a rule it says isn't built, and a right workflow", () => {
    const wf = skill(
      [
        act("s1", "web", "navigate", { url: CHAT }),
        act("s2", "web", "upload", { file: "~/Downloads/y.csv" }),
        act("s3", "web", "type", { text: "Date - {{today}}" }),
      ],
      [{ type: "schedule", cron: "0 9 1 * *" }],
    );
    expect(
      gate(
        input(wf, {
          done: done([{ rule: 0, steps: ["s2"] }, { rule: 1, not_built: "the date format isn't known" }]),
          explained: new Map([["s4", "Enter is sent by the upload's own Send button now"]]),
        }),
      ),
    ).toEqual([]);
  });

  it("wants a web workflow to open a page first: runs start on a blank window", () => {
    const wf = skill([act("s3", "web", "type", { text: "x" })]);
    expect(gate(input(wf)).join("\n")).toMatch(/open a page first/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/recorder/src/design/v2/gate.test.ts`
Expected: FAIL: no module.

- [ ] **Step 3: Write `packages/recorder/src/design/v2/gate.ts`**

```ts
// The finish gate (spec, "Rules v2"): code, not the model, decides whether a design is done. A workflow is saved only
// when the work the user showed still happens, every rule they said is built or said not to be, its checks look for
// text that can appear, the test run passed or each failure is explained, an unattended run can fill its inputs, and
// it runs as often as they said. Each problem is a sentence the agent reads and fixes (twice at most; then it is saved
// with the gaps listed for the user). Oct 19: the agent finished with all 20 recorded steps removed, and with checks
// for text never on screen.
import { type Check, isAction, isOutward, type Skill, type Step, triggerOf, walkSteps } from "@shadow/core";
import type { DoneReport, TaskModel, TestReport } from "./contracts.ts";

// Actions that change something the user cares about: what they typed, chose, uploaded or moved.
const WRITES = new Set([
  "web.type",
  "web.select",
  "web.upload",
  "web.drag",
  "fs.move",
  "fs.copy",
  "fs.rename",
  "fs.write",
  "ax.set_value",
]);
// Apps that draw their content: no text check can see it (it isn't in the page's text).
const CANVAS = /^https:\/\/docs\.google\.com\/(spreadsheets|document|presentation)\//;

export interface GateInput {
  // The plain recorded workflow: what the user showed.
  recorded: Skill;
  workflow: Skill;
  task: TaskModel;
  done: DoneReport;
  test?: TestReport;
  // Every text that appeared on screen after an action, while recording or in the test run.
  appeared: Set<string>;
  // Steps whose removal or test failure the agent explained (its tools' `why`): flagged for the user, not a problem.
  explained: Map<string, string>;
  // What an unattended run still needs (the daemon's go-live checks).
  unattended?: (skill: Skill) => string[];
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export function gate(input: GateInput): string[] {
  const { recorded, workflow, task, done, test, appeared, explained } = input;
  const problems: string[] = [];
  const now = new Map<string, Step>([...walkSteps(workflow.steps)].map(({ step }) => [step.id, step]));

  // The work the user showed still happens: kept (in a loop counts), or its removal explained for the review.
  for (const { step } of walkSteps(recorded.steps)) {
    if (!isAction(step) || now.has(step.id) || explained.has(step.id)) continue;
    if (!WRITES.has(`${step.channel}.${step.action}`) && !isOutward(step)) continue;
    problems.push(
      `${step.id} (${step.intent}) was work the user showed, and it is gone: keep it, repeat it in a loop, or remove it with a why the user will see`,
    );
  }

  // Every rule they said or wrote: built by steps that exist, or explained.
  task.rules.forEach((rule, i) => {
    const said = done.rules.find((r) => r.rule === i);
    if (!said || (!said.not_built && said.steps.length === 0)) {
      problems.push(`rule ${i} "${rule.quote}" is neither built nor explained: name the steps that build it, or say why it isn't built`);
      return;
    }
    const missing = said.not_built ? [] : said.steps.filter((id) => !now.has(id));
    if (missing.length > 0) problems.push(`rule ${i} "${rule.quote}": no step ${missing.join(", ")} in the workflow`);
  });

  // Checks look only for text that can appear: seen on screen after an action, never on a drawn app, never empty.
  let page = "";
  const judge = (where: string, check: Check | undefined) => {
    const text = check?.text_visible;
    if (text === undefined) return;
    if (!text.trim()) problems.push(`${where}: a text check can't be empty (it would always hold)`);
    else if (CANVAS.test(page)) problems.push(`${where}: a text check can't see a sheet's or document's drawn content: use url_matches or none`);
    else if (![...appeared].some((seen) => norm(seen).includes(norm(text)))) {
      problems.push(`${where}: "${text}" never appeared on screen: check for text that did, or for the page (url_matches)`);
    }
  };
  for (const { step } of walkSteps(workflow.steps)) {
    if (!isAction(step)) continue;
    if (step.channel === "web" && step.action === "navigate") page = String(step.args.url ?? "");
    judge(step.id, step.wait);
    judge(step.id, step.check);
  }
  for (const check of workflow.success) judge("success", check);

  // The test run: every step it couldn't find or that failed is fixed, or explained.
  for (const step of test?.steps ?? []) {
    if (step.status !== "failed" && step.status !== "not_found") continue;
    if (explained.has(step.id)) continue;
    const what = step.status === "not_found" ? "the test run didn't find it" : `it failed in the test run (${step.error ?? "no reason given"})`;
    problems.push(`${step.id}: ${what}: fix it, or explain why it will work in a real run`);
  }

  problems.push(...(input.unattended?.(workflow) ?? []));

  // As often as they said.
  if (task.cadence.kind !== "manual" && triggerOf(workflow).when.every((w) => w.type === "manual")) {
    problems.push(
      `they said ${task.cadence.quote ? `"${task.cadence.quote}"` : `it runs on a ${task.cadence.kind}`}, but it only runs when started by hand: set it with trigger`,
    );
  }

  // Runs start on a blank window: a workflow that works in the browser opens a page first.
  const firstWeb = [...walkSteps(workflow.steps)].map(({ step }) => step).find((s) => isAction(s) && s.channel === "web");
  if (firstWeb && isAction(firstWeb) && firstWeb.action !== "navigate") {
    problems.push(`${firstWeb.id}: runs start on a blank window, so the workflow must open a page first`);
  }
  return problems;
}
```

  `Check` is exported from `@shadow/core` (`skill.ts`). If it isn't re-exported, import it from there.

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm vitest run packages/recorder/src/design/v2/gate.test.ts && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/design/v2/gate.ts packages/recorder/src/design/v2/gate.test.ts
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(design-v2): the finish gate

- a design is saved only when the shown work still happens and every stated rule is built or explained
- checks must look for text that appeared (never on drawn sheets, never empty); test failures explained; frequency as said

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Forgiving tools, so tool syntax stops eating turns

**Files:**
- Modify: `packages/agent/src/tool.ts` (`Tool.prepare`), `packages/agent/src/agent.ts` (`runCall` uses it)
- Modify: `packages/recorder/src/compile.ts` (export `producedType`)
- Create: `packages/recorder/src/design/v2/session.ts`
- Create: `packages/recorder/src/design/v2/tools.ts`
- Create: `packages/recorder/src/design/v2/tools.test.ts`
- Test: `packages/agent/src/agent.test.ts` (prepare)

**Interfaces:**
- Consumes:
  - `refusals`, `RecordingFacts` (Task 2);
  - `Proposal`, `EvidenceView`, `DoneReport` (Task 1);
  - `runCall` from Plan 1 Task 5;
  - `requireApprovals` (`approvals.ts`), `outlineOf` (`design/tools.ts`, which moves into v2 when the old file goes).
- Produces:
  - **`Tool.prepare?(input: unknown): unknown`**, applied before the schema.
  - **`SessionV2`, `newSession(original, facts, extra?)`, `QueuedQuestion`.**
  - **`designToolsV2(session): AnyTool<DoneReport>[]`,** with these tools:
    - `accept`, `reject`, `remove`, `restore`, `add`, `change`, `move`;
    - `loop`, `branch`, `ai_step`, `trigger`, `input`;
    - `look`, `ask`, `test`, `done`;
    - aliases for the old names (`wrap_in_loop`, `wrap_in_branch`, `add_llm_step`, `ask_user`, `finish`), plus `edit`,
      which only says what to use instead.
  - **`unstring(value)`.**
- **Revised after Checkpoint 1:** `look`'s and `ask`'s evidence (through `EvidenceView`) and the `dropped` map's
  source (Plan 2's noise list).

- [ ] **Step 1: Write the failing tests**

Add to `packages/agent/src/agent.test.ts` (uses the file's `done` and `call` helpers):
```ts
  it("lets a tool clean its input before the schema checks it (a field sent as a JSON string)", async () => {
    const take = tool({
      name: "take",
      kind: "edit",
      description: "Take steps",
      input: z.object({ steps: z.array(z.string()) }),
      prepare: (input) => {
        const v = input as { steps?: unknown };
        return typeof v.steps === "string" ? { ...v, steps: JSON.parse(v.steps) } : v;
      },
      run: ({ steps }) => ({ output: `took ${steps.join(",")}` }),
    });
    const llm = fakeLlm([call("take", { steps: '["s2","s3"]' }), call("done", { summary: "ok" })]);
    const episode = await runAgent({ llm, system: "s", task: "t", tools: [take, done] });
    expect(episode.transcript.some((e) => e.type === "result" && e.output.startsWith("took s2,s3"))).toBe(true);
  });
```

`packages/recorder/src/design/v2/tools.test.ts`:
```ts
import { type AnyTool, runAgent } from "@shadow/agent";
import { findStep, Skill } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import type { DoneReport, EvidenceView, Proposal } from "./contracts.ts";
import { newSession, type SessionV2 } from "./session.ts";
import { designToolsV2, unstring } from "./tools.ts";

const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const recorded = Skill.parse({
  id: "kpi",
  name: "kpi",
  version: 1,
  description: { goal: "KPIs into the sheet" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand", inputs: { emails: { type: { type: "list", items: { type: "text" } }, default: [] } } },
    { id: "s1", type: "action", intent: "open Gmail", channel: "web", action: "navigate", args: { url: MAIL } },
    { id: "s2", type: "action", intent: "click the header", channel: "web", action: "click", target: { text: "Print all", fallbacks: [] } },
    { id: "s3", type: "action", intent: "type the subject", channel: "web", action: "type", target: { role: "textbox", name: "Subject", fallbacks: [] }, args: { text: "Daily KPIs - w/c 19 Oct" } },
  ],
});
const facts = { pages: [MAIL], folders: [] };
const session = (extra: Partial<SessionV2> = {}) => newSession(recorded, facts, extra);
const run = async (s: SessionV2, name: string, input: unknown) => {
  const t = designToolsV2(s).find((x) => x.name === name) as AnyTool<DoneReport>;
  const prepared = t.prepare ? t.prepare(input) : input;
  const parsed = t.input.safeParse(prepared);
  if (!parsed.success) throw new Error(parsed.error.message);
  return (await t.run(parsed.data, { turn: 1 })) as { output: Record<string, unknown>; finish?: DoneReport };
};

describe("forgiving input", () => {
  it("parses a whole input, or one field, sent as a JSON string", () => {
    expect(unstring('{"steps":["s2"]}')).toEqual({ steps: ["s2"] });
    expect(unstring({ steps: '["s2","s3"]', why: "noise" })).toEqual({ steps: ["s2", "s3"], why: "noise" });
    expect(unstring({ why: "[not json" })).toEqual({ why: "[not json" });
  });

  it("runs several changes in one turn, and keeps each change's reason for the review", async () => {
    const s = session();
    const llm = fakeLlm([
      {
        toolCalls: [
          { name: "remove", arguments: { steps: '["s2"]', why: "a click that only selected text" } },
          { name: "change", arguments: { step: "s3", args: { text: "{{today}}" }, why: "the date is the day it runs" } },
          { name: "done", arguments: { summary: "cleaned", rules: [] } },
        ],
      },
    ]);
    const episode = await runAgent({ llm, system: "s", task: "t", tools: designToolsV2(s), callsPerTurn: 8 });
    expect(episode.outcome.kind).toBe("finished");
    expect(findStep(s.draft, "s2")).toBeUndefined();
    expect(s.whys.get("s2")).toBe("a click that only selected text");
    expect(s.whys.get("s3")).toBe("the date is the day it runs");
  });
});

describe("the tools", () => {
  it("apply a proposal code prepared, all at once, and list the real ids for an unknown one", async () => {
    const p: Proposal = {
      id: "p1",
      kind: "date",
      summary: "the typed 19 Oct is the day it runs",
      steps: ["s3"],
      evidence: ["k17"],
      edits: [{ op: "set", step: "s3", field: "args", value: { text: "Daily KPIs - w/c {{today}}" } }],
      runnable: true,
    };
    const s = session({ proposals: new Map([["p1", p]]) });
    expect((await run(s, "accept", { proposal: "p9", why: "x" })).output.problems).toEqual(["no proposal p9. Proposals: p1"]);
    expect((await run(s, "accept", { proposal: "p1", why: "they said the date is today" })).output.ok).toBe(true);
    const step = findStep(s.draft, "s3");
    expect(step && "args" in step ? step.args.text : "").toContain("{{today}}");
    expect(s.decisions.get("p1")?.decision).toBe("accept");
  });

  it("add a new click as unverified, with approval added by code when it sends; an unknown verb lists the right ones", async () => {
    const s = session();
    const added = await run(s, "add", {
      after: "s3",
      step: { do: "click", intent: "Send the reply", target: { role: "button", name: "Send" } },
      why: "they always send it",
    });
    expect(added.output.ok).toBe(true);
    expect(added.output.approval_added).toEqual(["s4"]);
    expect(s.unverified.has("s4")).toBe(true);
    const bad = await run(s, "add", { step: { do: "teleport", intent: "x" }, why: "x" });
    expect(String(bad.output.problems)).toMatch(/"teleport" is not something a step can do. Use one of: open, click/);
  });

  it("copy a recorded target with like, and say what to use when a loop is empty", async () => {
    const s = session();
    const copied = await run(s, "add", { after: "s3", step: { do: "type", intent: "type it again", target: { like: "s3" }, text: "x" }, why: "x" });
    expect(copied.output.ok).toBe(true);
    expect(s.unverified.size).toBe(0);
    const empty = await run(s, "loop", { steps: [], over: "emails", item: { name: "email" }, intent: "each", why: "x" });
    expect(String(empty.output.problems)).toMatch(/the steps to repeat/);
    const ok = await run(s, "loop", { steps: ["s3"], over: "emails", item: { name: "email" }, intent: "each email", why: "every email" });
    expect(ok.output.ok).toBe(true);
  });

  it("show the evidence before queuing a question, never queue it twice, and queue it for one batch", async () => {
    const evidence: EvidenceView = {
      step: () => undefined,
      timeline: () => "",
      about: (q) => (/sheet/i.test(q) ? ["page at s1: https://docs.google.com/spreadsheets/d/S/edit"] : []),
      appeared: () => new Set(),
    };
    const s = session({ evidence });
    const shown = await run(s, "ask", { question: "Which sheet?", why: "where it writes", step: "s3" });
    expect(shown.output.not_asked).toBeDefined();
    const queued = await run(s, "ask", { question: "Newest email, or all unread?", why: "which emails", step: "s1", options: ["newest", "all unread"] });
    expect(queued.output.queued).toBe("q1");
    const again = await run(s, "ask", { question: "newest email or all unread", why: "x", step: "s1" });
    expect(again.output.queued).toBeUndefined();
    expect(s.questions).toHaveLength(1);
  });

  it("finish only when the gate has nothing left", async () => {
    const s = session({ finish: () => ["s3 (type the subject) was work the user showed, and it is gone"] });
    const refused = await run(s, "done", { summary: "done", rules: [] });
    expect(refused.finish).toBeUndefined();
    expect(String(refused.output.problems)).toMatch(/s3/);
    const s2 = session({ finish: () => [] });
    expect((await run(s2, "done", { summary: "done" })).finish).toEqual({ summary: "done", rules: [] });
  });

  it("answer the old tool names the model reaches for", async () => {
    const s = session();
    const names = designToolsV2(s).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["wrap_in_loop", "wrap_in_branch", "add_llm_step", "ask_user", "finish", "edit"]));
    expect(String((await run(s, "edit", { edits: [] })).output.use)).toMatch(/add, change, remove, move, loop, branch/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/agent/src/agent.test.ts packages/recorder/src/design/v2/tools.test.ts`
Expected: FAIL: no `prepare`, no v2 tools.

- [ ] **Step 3: Implement**

`packages/agent/src/tool.ts`, in `Tool`, after `input`:
```ts
  // Cleans what the model sent before `input` checks it (a field sent as a JSON string): forgiving the shape, never
  // the meaning. The schema still decides.
  prepare?(input: unknown): unknown;
```
`packages/agent/src/agent.ts`, in `runCall` (Plan 1 Task 5): replace `const parsed = tool.input.safeParse(call.args ?? {});`
with `const parsed = tool.input.safeParse(tool.prepare ? tool.prepare(call.args ?? {}) : (call.args ?? {}));`.

`packages/recorder/src/compile.ts`: export `producedType`, i.e. `export function producedType(step: ActionDraft): VarType`.

`packages/recorder/src/design/v2/session.ts`:
```ts
// One design session of design agent v2: the recorded workflow (code's plain list), the draft being changed, what the
// recording allows, code's proposals and what the agent decided about each, the steps code left out as noise (the
// agent may put one back), the reason for every change (the review shows them), the steps whose new target no test has
// found yet, and the questions it queued (asked in one batch after the build). The tools change it; the orchestrator
// (Plan 3 proper) reads it between stages.
import type { Skill, StepInput } from "@shadow/core";
import type { DoneReport, EvidenceView, Proposal } from "./contracts.ts";
import type { RecordingFacts } from "./rules.ts";

export interface QueuedQuestion {
  id: string;
  text: string;
  why: string;
  step: string;
  options: string[];
  default?: string;
}

export interface SessionV2 {
  original: Skill;
  draft: Skill;
  facts: RecordingFacts;
  proposals: Map<string, Proposal>;
  decisions: Map<string, { decision: "accept" | "reject"; why: string }>;
  dropped: Map<string, { step: StepInput; why: string; after: string }>;
  whys: Map<string, string>;
  unverified: Set<string>;
  questions: QueuedQuestion[];
  wantsTest: boolean;
  evidence?: EvidenceView;
  // The finish gate with all but the agent's report bound in (gate.ts; the orchestrator sets it).
  finish?: (report: DoneReport) => string[];
}

export function newSession(original: Skill, facts: RecordingFacts, extra: Partial<SessionV2> = {}): SessionV2 {
  return {
    original,
    draft: original,
    facts,
    proposals: new Map(),
    decisions: new Map(),
    dropped: new Map(),
    whys: new Map(),
    unverified: new Set(),
    questions: [],
    wantsTest: false,
    ...extra,
  };
}
```

`packages/recorder/src/design/v2/tools.ts`:
```ts
// Design agent v2's tools (spec, "Tools" and "Forgiveness"). Built from the Oct 19 runs, where 6 of 11 and 9 of 16
// turns went on calls the old tools rejected: inputs sent as JSON strings, a loop with no steps, a step missing its
// type, an id the tool didn't know. Here a field sent as a string is parsed; a step is written as what it does
// ({ do: "click" }) and code fills in its channel, action and type; an unknown id is answered with the real ones; a
// wrong tool gets the right call back; and several calls run in one turn (callsPerTurn). Every change carries a `why`
// the review shows. Only what is harmful is refused (rules.ts); approval on outward steps is added by code.
import { type AnyTool, tool } from "@shadow/agent";
import {
  applyEdits,
  type EditInput,
  isAction,
  type Locator,
  type Step,
  triggerOf,
  type VarType,
  walkSteps,
} from "@shadow/core";
import { z } from "zod";
import { requireApprovals } from "../../approvals.ts";
import { producedType } from "../../compile.ts";
import { outlineOf } from "../tools.ts";
import { DoneReport } from "./contracts.ts";
import { refusals } from "./rules.ts";
import type { SessionV2 } from "./session.ts";

// A tool input, or one of its fields, sent as a JSON string: parsed. Anything that isn't JSON stays as it was.
export function unstring(value: unknown): unknown {
  const parse = (v: unknown) => {
    if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const top = parse(value);
  if (!top || typeof top !== "object" || Array.isArray(top)) return top;
  return Object.fromEntries(Object.entries(top).map(([k, v]) => [k, parse(v)]));
}

// What a step can do, as the model writes it, and the channel and action it becomes. "web.click" works too.
const DO: Record<string, [string, string]> = {
  open: ["web", "navigate"],
  click: ["web", "click"],
  type: ["web", "type"],
  select: ["web", "select"],
  press: ["web", "press"],
  read: ["web", "extract"],
  read_all: ["web", "extract"],
  read_sheet: ["web", "extract"],
  wait: ["web", "wait_for"],
  upload: ["web", "upload"],
  find_files: ["fs", "find"],
  read_file: ["fs", "read"],
  move_file: ["fs", "move"],
  copy_file: ["fs", "copy"],
  rename_file: ["fs", "rename"],
  pick_row: ["data", "pick"],
  open_app: ["ax", "open"],
  press_in_app: ["ax", "press"],
  type_in_app: ["ax", "set_value"],
  menu: ["ax", "menu"],
  key_in_app: ["ax", "key"],
};

const LocatorSpec = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  near: z.string().optional(),
});
// A control: the target of a recorded step ({ like: "s3" }), or one described by role and name (a new target: it
// stays unverified until the test run finds it on the live page).
const TargetSpec = z.union([z.object({ like: z.string() }), LocatorSpec]);
// A step as the model writes it: what it does, what for, its control, and its values (at the top or under args).
const StepSpec = z
  .object({
    do: z.string(),
    intent: z.string().min(1),
    target: TargetSpec.optional(),
    tab: z.string().optional(),
    save_as: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
type StepSpec = z.infer<typeof StepSpec>;
const Where = { after: z.string().optional(), before: z.string().optional(), into: z.string().optional() };
const Why = z.string().default("");

export function designToolsV2(session: SessionV2): AnyTool<DoneReport>[] {
  const ids = () => [...walkSteps(session.draft.steps)].map(({ step }) => step.id);
  const known = (id: string) => ids().includes(id);
  const unknown = (id: string) => `no step ${id}. Steps: ${ids().join(", ")}`;
  const nextId = (prefix: string) => {
    const used = new Set([...ids(), ...session.dropped.keys()]);
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  };
  // A recorded step anywhere: in the draft, the recording, or what code left out.
  const anyStep = (id: string): Step | undefined =>
    [...walkSteps(session.draft.steps), ...walkSteps(session.original.steps)].find(({ step }) => step.id === id)?.step;
  const position = (where: { after?: string; before?: string; into?: string }) =>
    where.into ? { into: where.into } : where.before ? { before: where.before } : { after: where.after ?? lastTop() };
  const lastTop = () => session.draft.steps.at(-1)?.id ?? "start";

  // Edits applied to the draft: they must parse and break no rule. Approval on outward steps is added here, by code.
  const apply = (edits: EditInput[], why: string, touched: string[], unverified: string[] = []) => {
    const result = applyEdits(session.draft, edits);
    if (!result.ok) return { output: { ok: false, problems: result.problems.map(hint) } };
    const refused = refusals(session.original, result.skill, session.facts);
    if (refused.length > 0) return { output: { ok: false, refused } };
    const approved = requireApprovals(result.skill);
    session.draft = approved.skill;
    for (const id of touched) if (why) session.whys.set(id, why);
    for (const id of unverified) session.unverified.add(id);
    return {
      output: {
        ok: true,
        ...(approved.added.length > 0 ? { approval_added: approved.added } : {}),
        workflow: outlineOf(session.draft),
      },
    };
  };
  // The edit layer's messages, with what to do about them.
  const hint = (problem: string): string => {
    const missing = /no step (\S+)/.exec(problem)?.[1];
    if (missing) return `${problem}. Steps: ${ids().join(", ")}`;
    if (/steps.*(at least|too small)/i.test(problem)) return `${problem}: give loop or branch the steps to repeat (steps: [ids])`;
    return problem;
  };

  // A step spec -> an action step: channel, action and type from `do`, the target copied or new, values as args.
  const compile = (spec: StepSpec, id: string): { step: Record<string, unknown>; unverified: boolean } | { error: string } => {
    const { do: verb, intent, target, tab, save_as, args, ...rest } = spec;
    const pair = DO[verb] ?? (/^(web|fs|data|ax)\.\w+$/.test(verb) ? (verb.split(".") as [string, string]) : undefined);
    if (!pair) {
      return { error: `"${verb}" is not something a step can do. Use one of: ${Object.keys(DO).join(", ")} (or channel.action, such as web.click). To repeat steps use loop; to decide use branch; to work something out from text use ai_step` };
    }
    const [channel, action] = pair;
    const values: Record<string, unknown> = { ...rest, ...(args ?? {}) };
    if (verb === "read_all") values.all = true;
    if (verb === "read_sheet") values.source = "google_sheet";
    let locator: Locator | undefined;
    let unverified = false;
    if (target && "like" in target) {
      const like = anyStep(target.like);
      if (!like || !isAction(like) || !like.target) return { error: `${target.like} has no control to copy: ${unknown(target.like)}` };
      locator = like.target;
    } else if (target) {
      locator = { ...target, fallbacks: [] };
      unverified = true;
    }
    const step: Record<string, unknown> = {
      id,
      type: "action",
      intent,
      channel,
      action,
      args: values,
      ...(locator ? { target: locator } : {}),
      ...(tab ? { tab } : {}),
    };
    if (save_as) step.output = { name: save_as, type: producedType({ channel, action, args: values } as never) };
    return { step, unverified };
  };

  // The type of the items of a list variable, so a loop's item fits it (check.ts compares them).
  const itemType = (name: string): VarType | undefined => {
    const bare = name.replace(/^\{\{|\}\}$/g, "").trim();
    const input = triggerOf(session.draft).inputs[bare];
    const found =
      input?.type ??
      [...walkSteps(session.draft.steps)]
        .map(({ step }) => ("output" in step && step.output?.name === bare ? step.output.type : undefined))
        .find(Boolean);
    return found?.type === "list" ? found.items : undefined;
  };

  const loop = tool({
    name: "loop",
    kind: "edit",
    description:
      'Repeat steps that sit next to each other for every item of a list an earlier step produces: over "{{list}}" (or its name), item { name } (used inside as {{name}}). The common shape: read a list, pick the items wanted (ai_step or a pick_row), loop over them',
    input: z.object({
      steps: z.array(z.string()),
      over: z.string().min(1),
      item: z.object({ name: z.string().min(1), type: z.record(z.string(), z.unknown()).optional() }),
      intent: z.string().min(1),
      on_item_fail: z.enum(["stop", "skip"]).optional(),
      why: Why,
    }),
    prepare: unstring,
    run: ({ steps, over, item, intent, on_item_fail, why }) => {
      if (steps.length === 0) return { output: { ok: false, problems: ["loop needs the steps to repeat (steps: [ids]): it moves them inside"] } };
      const missing = steps.find((s) => !known(s));
      if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
      const id = nextId("l");
      const list = /^\{\{.*\}\}$/.test(over.trim()) ? over.trim() : `{{${over.trim()}}}`;
      const type = item.type ?? itemType(list) ?? { type: "object" };
      const shell = { id, type: "control", kind: "loop", intent, over: list, item: { name: item.name, type }, on_item_fail, steps: [] };
      return apply(
        [{ op: "insert", at: { before: steps[0] as string }, step: shell }, ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } }))],
        why,
        [id, ...steps],
      );
    },
  });

  const branch = tool({
    name: "branch",
    kind: "edit",
    description:
      "Do steps that sit next to each other only when a condition holds: if { left, op, right } (equals, not_equals, contains, greater_than, less_than, exists, not_exists), else: steps for when it doesn't",
    input: z.object({
      steps: z.array(z.string()),
      if: z.record(z.string(), z.unknown()),
      else: z.array(z.string()).optional(),
      intent: z.string().min(1),
      why: Why,
    }),
    prepare: unstring,
    run: ({ steps, if: condition, else: otherwise, intent, why }) => {
      if (steps.length === 0) return { output: { ok: false, problems: ["branch needs the steps it guards (steps: [ids])"] } };
      const missing = [...steps, ...(otherwise ?? [])].find((s) => !known(s));
      if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
      const id = nextId("b");
      return apply(
        [
          { op: "insert", at: { before: steps[0] as string }, step: { id, type: "control", kind: "branch", intent, if: condition, steps: [], else: [] } },
          ...steps.map((s): EditInput => ({ op: "move", step: s, to: { into: id } })),
          ...(otherwise ?? []).map((s): EditInput => ({ op: "move", step: s, to: { into: id, arm: "else" } })),
        ],
        why,
        [id, ...steps, ...(otherwise ?? [])],
      );
    },
  });

  const aiStep = tool({
    name: "ai_step",
    kind: "edit",
    description:
      "Add a step that reads text and works one value out of it (pick the newest, the ones not already in the sheet, a category, a summary). It never clicks or types. inputs: references such as {{emails}}",
    input: z.object({
      after: z.string(),
      intent: z.string().min(1),
      instruction: z.string().min(1),
      inputs: z.array(z.string()).min(1),
      output: z.object({ name: z.string().min(1), type: z.record(z.string(), z.unknown()).optional() }),
      why: Why,
    }),
    prepare: unstring,
    run: ({ after, intent, instruction, inputs, output, why }) => {
      if (!known(after)) return { output: { ok: false, problems: [unknown(after)] } };
      const id = nextId("ai");
      const refs = inputs.map((i) => (/^\{\{.*\}\}$/.test(i.trim()) ? i.trim() : `{{${i.trim()}}}`));
      return apply(
        [{ op: "insert", at: { after }, step: { id, type: "llm", intent, instruction, inputs: refs, output: { name: output.name, type: output.type ?? { type: "text" } } } }],
        why,
        [id],
      );
    },
  });

  const ask = tool({
    name: "ask",
    kind: "look",
    description:
      'Queue a question for the user: only what the recording, the goal and what they said can\'t answer. step: the step its answer changes ("start" for how often it runs and its inputs). Asked after you build, with the others, in one batch',
    input: z.object({
      question: z.string().min(1),
      why: z.string().min(1),
      step: z.string(),
      options: z.array(z.string()).max(6).optional(),
      default: z.string().optional(),
      confirm: z.boolean().optional(),
    }),
    prepare: unstring,
    run: ({ question, why, step, options, default: fallback, confirm }) => {
      if (step !== "start" && !known(step)) return { output: { ok: false, problems: [unknown(step)] } };
      const seen = session.evidence?.about(question) ?? [];
      if (seen.length > 0 && !confirm) {
        return {
          output: { not_asked: "The recording may already answer this: use it. If it doesn't, ask again with confirm: true.", seen },
          untrusted: true,
        };
      }
      const key = (s: string, q: string) => `${s}|${q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
      if (session.questions.some((q) => key(q.step, q.text) === key(step, question))) {
        return { output: { ok: true, note: "already queued" } };
      }
      const id = `q${session.questions.length + 1}`;
      session.questions.push({ id, text: question, why, step, options: options ?? [], ...(fallback ? { default: fallback } : {}) });
      return { output: { queued: id, note: "asked after you build, with the other questions, in one batch" } };
    },
  });

  const done = tool({
    name: "done",
    kind: "finish",
    description:
      "The workflow does what they meant: one sentence on what you changed, and for each rule of the task model (by its number) the steps that build it, or not_built with why",
    input: DoneReport,
    prepare: unstring,
    run: (report) => {
      const left = session.finish?.(report) ?? [];
      if (left.length > 0) return { output: { refused: "not finished yet", problems: left } };
      return { output: "finished", finish: report };
    },
  });

  const tools: AnyTool<DoneReport>[] = [
    tool({
      name: "accept",
      kind: "edit",
      description:
        "Use a change code prepared from the recording (a proposal, by id): repeat steps for every item, today's date, an item of a list, open a page directly. Say why it fits what they meant",
      input: z.object({ proposal: z.string(), why: Why }),
      prepare: unstring,
      run: ({ proposal, why }) => {
        const p = session.proposals.get(proposal);
        if (!p) return { output: { ok: false, problems: [`no proposal ${proposal}. Proposals: ${[...session.proposals.keys()].join(", ") || "none"}`] } };
        if (session.decisions.has(proposal)) return { output: { ok: false, problems: [`${proposal} is decided already`] } };
        if (!p.runnable || p.edits.length === 0) {
          session.decisions.set(proposal, { decision: "accept", why });
          return { output: { ok: true, note: p.runnable ? "nothing to change" : "noted for the review: replay can't do this yet" } };
        }
        const result = apply(p.edits, why, p.steps);
        if ((result.output as { ok: boolean }).ok) session.decisions.set(proposal, { decision: "accept", why });
        return result;
      },
    }),
    tool({
      name: "reject",
      kind: "edit",
      description: "Say a proposal doesn't fit what they meant, and why (it is shown in the review)",
      input: z.object({ proposal: z.string(), why: z.string().min(1) }),
      prepare: unstring,
      run: ({ proposal, why }) => {
        if (!session.proposals.has(proposal)) return { output: { ok: false, problems: [`no proposal ${proposal}`] } };
        session.decisions.set(proposal, { decision: "reject", why });
        return { output: { ok: true } };
      },
    }),
    tool({
      name: "remove",
      kind: "edit",
      description: "Remove steps that aren't part of the task (a click that changed nothing, a detour), with why: the user sees it",
      input: z.object({ steps: z.union([z.string(), z.array(z.string())]).transform((s) => (Array.isArray(s) ? s : [s])), why: Why }),
      prepare: unstring,
      run: ({ steps, why }) => {
        const missing = steps.find((s) => !known(s));
        if (missing) return { output: { ok: false, problems: [unknown(missing)] } };
        return apply(steps.map((s): EditInput => ({ op: "remove", step: s })), why, steps);
      },
    }),
    tool({
      name: "restore",
      kind: "edit",
      description: "Put back a step code left out as noise (the list is in your first message), with why",
      input: z.object({ step: z.string(), why: Why }),
      prepare: unstring,
      run: ({ step, why }) => {
        const gone = session.dropped.get(step);
        if (!gone) return { output: { ok: false, problems: [`no left-out step ${step}. Left out: ${[...session.dropped.keys()].join(", ") || "none"}`] } };
        const at = known(gone.after) ? { after: gone.after } : { after: lastTop() };
        const result = apply([{ op: "insert", at, step: gone.step as Record<string, unknown> }], why, [step]);
        if ((result.output as { ok: boolean }).ok) session.dropped.delete(step);
        return result;
      },
    }),
    tool({
      name: "add",
      kind: "edit",
      description:
        'Add any step: { do, intent, target?, values }. do: open, click, type, select, press, read, read_all, read_sheet, wait, upload, find_files, move_file, pick_row, open_app, press_in_app, type_in_app, menu (or channel.action). target: { like: "s3" } for a control they used, or { role, name } for a new one (unverified until the test run finds it). Where: after, before or into',
      input: z.object({ step: StepSpec, ...Where, why: Why }),
      prepare: unstring,
      run: ({ step, after, before, into, why }) => {
        for (const id of [after, before, into]) if (id && !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        const id = nextId("s");
        const built = compile(step, id);
        if ("error" in built) return { output: { ok: false, problems: [built.error] } };
        return apply([{ op: "insert", at: position({ after, before, into }), step: built.step }], why, [id], built.unverified ? [id] : []);
      },
    }),
    tool({
      name: "change",
      kind: "edit",
      description:
        'Change a step: its intent, its values (args, merged; e.g. { text: "{{today}}" }), its control (target: { like } or { role, name }), its tab, its check or wait, or save_as (its result becomes a variable)',
      input: z.object({
        step: z.string(),
        intent: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
        target: TargetSpec.optional(),
        tab: z.string().optional(),
        check: z.record(z.string(), z.unknown()).optional(),
        wait: z.record(z.string(), z.unknown()).optional(),
        save_as: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
        why: Why,
      }),
      prepare: unstring,
      run: ({ step: id, intent, args, target, tab, check, wait, save_as, why }) => {
        const step = anyStep(id);
        if (!step || !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        const edits: EditInput[] = [];
        let unverified = false;
        if (intent) edits.push({ op: "set", step: id, field: "intent", value: intent });
        if (!isAction(step) && (args || target || tab || check || wait || save_as)) {
          return { output: { ok: false, problems: [`${id} is a ${step.type} step: only actions have values, a control, a tab or checks`] } };
        }
        if (isAction(step)) {
          if (args) edits.push({ op: "set", step: id, field: "args", value: { ...step.args, ...args } });
          if (check) edits.push({ op: "set", step: id, field: "check", value: check });
          if (wait) edits.push({ op: "set", step: id, field: "wait", value: wait });
          if (save_as) edits.push({ op: "set", step: id, field: "output", value: { name: save_as, type: producedType({ ...step, args: { ...step.args, ...(args ?? {}) } } as never) } });
          if (target) {
            if ("like" in target) {
              const like = anyStep(target.like);
              if (!like || !isAction(like) || !like.target) return { output: { ok: false, problems: [`${target.like} has no control to copy`] } };
              edits.push({ op: "retarget", step: id, target: like.target });
            } else {
              edits.push({ op: "retarget", step: id, target: { ...target, fallbacks: [] } });
              unverified = true;
            }
          }
          if (tab) edits.push({ op: "replace", step: id, with: { ...step, ...(args ? { args: { ...step.args, ...args } } : {}), tab } as never });
        }
        if (edits.length === 0) return { output: { ok: false, problems: ["say what to change: intent, args, target, tab, check, wait or save_as"] } };
        return apply(edits, why, [id], unverified ? [id] : []);
      },
    }),
    tool({
      name: "move",
      kind: "edit",
      description: "Move a step (with what is inside it): after, before or into a loop or branch",
      input: z.object({ step: z.string(), ...Where, why: Why }),
      prepare: unstring,
      run: ({ step, after, before, into, why }) => {
        for (const id of [step, after, before, into]) if (id && !known(id)) return { output: { ok: false, problems: [unknown(id)] } };
        return apply([{ op: "move", step, to: position({ after, before, into }) }], why, [step]);
      },
    }),
    loop,
    branch,
    aiStep,
    tool({
      name: "trigger",
      kind: "edit",
      description:
        'How often it runs: "manual", { schedule: "0 9 * * *" } (a cron in the Mac\'s time), or { folder: "~/Downloads", glob: "*.pdf" }',
      input: z.object({
        when: z.union([z.literal("manual"), z.object({ schedule: z.string() }), z.object({ folder: z.string(), glob: z.string().optional() })]),
        why: Why,
      }),
      prepare: unstring,
      run: ({ when, why }) => {
        const value =
          when === "manual"
            ? [{ type: "manual" }]
            : "schedule" in when
              ? [{ type: "schedule", cron: when.schedule }]
              : [{ type: "folder_watch", dir: when.folder, ...(when.glob ? { glob: when.glob } : {}) }];
        return apply([{ op: "set", step: "start", field: "when", value }], why, ["start"]);
      },
    }),
    tool({
      name: "input",
      kind: "edit",
      description: "A value the run starts with (one that changes each time and no step can read): its name, type, a default and what it is",
      input: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]*$/),
        type: z.enum(["text", "number", "date", "boolean", "file"]),
        default: z.unknown().optional(),
        about: z.string().min(1),
        why: Why,
      }),
      prepare: unstring,
      run: ({ name, type, default: value, about, why }) => {
        const inputs = { ...triggerOf(session.draft).inputs, [name]: { type: { type }, description: about, ...(value !== undefined ? { default: value } : {}) } };
        return apply([{ op: "set", step: "start", field: "inputs", value: inputs }], why, ["start"]);
      },
    }),
    tool({
      name: "look",
      kind: "look",
      description: "A step's full evidence (step), a proposal (proposal), the timeline between two steps (from, to), or the workflow as it is now (nothing)",
      input: z.object({ step: z.string().optional(), proposal: z.string().optional(), from: z.string().optional(), to: z.string().optional() }),
      prepare: unstring,
      run: ({ step, proposal, from, to }) => {
        if (proposal) return { output: session.proposals.get(proposal) ?? `no proposal ${proposal}` };
        if (step) return { output: session.evidence?.step(step) ?? anyStep(step) ?? unknown(step), untrusted: true };
        if (from || to) return { output: session.evidence?.timeline(from, to) ?? "no timeline", untrusted: true };
        return { output: outlineOf(session.draft) };
      },
    }),
    ask,
    tool({
      name: "test",
      kind: "look",
      description: "Test the workflow in the automation window, safely, when this turn ends: it opens pages and reads, and only outlines what would type, send or change something",
      input: z.object({}),
      run: () => {
        session.wantsTest = true;
        return { output: "the test run starts when this turn ends" };
      },
    }),
    done,
  ];

  // The old names the model reaches for (Oct 19: wrap_in_branch sent as an edit op, wrap_in_loop never found).
  const alias = (name: string, to: AnyTool<DoneReport>): AnyTool<DoneReport> => ({ ...to, name, description: `Same as ${to.name}. ${to.description}` });
  tools.push(
    alias("wrap_in_loop", loop),
    alias("wrap_in_branch", branch),
    alias("add_llm_step", aiStep),
    alias("ask_user", ask),
    alias("finish", done),
    tool({
      name: "edit",
      kind: "look",
      description: "Not a tool any more: says which tools change the workflow",
      input: z.record(z.string(), z.unknown()),
      run: () => ({ output: { use: "add, change, remove, move, loop, branch, ai_step, trigger, input (several calls per turn are fine)" } }),
    }),
  );
  return tools;
}

```

  Keep imports to what the file uses: `pnpm lint` flags any unused one.

- [ ] **Step 4: Run them to verify they pass,** then everything

Run: `corepack pnpm vitest run packages/agent packages/recorder/src/design/v2 && corepack pnpm test && corepack pnpm lint`
Expected: PASS.
- **`change` with `tab`:** until Task 6 adds `tab` to `skill.ts`, it parses but is dropped by the schema, and no test
  here depends on it.
- **Before Task 6:** keep `tab` out of `change`'s test expectations.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/tool.ts packages/agent/src/agent.ts packages/agent/src/agent.test.ts packages/recorder/src/compile.ts packages/recorder/src/design/v2/session.ts packages/recorder/src/design/v2/tools.ts packages/recorder/src/design/v2/tools.test.ts
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(design-v2): forgiving tools

- steps written as what they do ({ do: click }); JSON-string fields parsed; unknown ids answered with the real ones
- accept/reject code's proposals; remove, restore, add, change, move, loop, branch, ai_step, trigger, input, ask, test, done
- every change keeps its why for the review; old tool names point at the new ones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The safe test run

**Files:**
- Create: `packages/player/src/rehearse.ts`
- Create: `packages/player/src/rehearse.test.ts`
- Modify: `packages/player/src/index.ts` (export)
- Modify: `apps/daemon/src/runner.ts` (`RunHooks.onHighlight`)
- Create: `apps/daemon/src/rehearse.ts`

**Interfaces:**
- Consumes: the walk-through path of `runSkill` (`deps.walk`, `deps.highlight`, `step.walk` / `step.result` log
  events) and `runSkillOn` (daemon).
- Produces:
  - **`rehearsalChoice(step, effect, llmSoFar): { choice: "do" | "skip"; why: string }`** and **`ACTION_VERBS`**.
  - **`rehearsal(skill, effects, onLine?)`,** returning
    `{ walk, onHighlight, log, report(outcome) }`; `report` returns `{ steps: TestStep[]; outcome }` (Task 1's shape).
  - **Daemon:** `rehearse(daemon, skill, options)`.
- **Revised after Checkpoint 1:** `effects` comes from Plan 2's evidence (each step's recorded effect).

- [ ] **Step 1: Write the failing test** `packages/player/src/rehearse.test.ts`

```ts
import { ActionStep, Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { rehearsal, rehearsalChoice } from "./rehearse.ts";
import { runSkill } from "./run.ts";
import type { RunDeps } from "./types.ts";

const act = (id: string, action: string, target?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ActionStep.parse({
    id,
    type: "action",
    intent: `${action} ${id}`,
    channel: "web",
    action,
    ...(target ? { target: { fallbacks: [], ...target } } : {}),
    args: action === "navigate" ? { url: "https://mail.google.com/" } : {},
    ...extra,
  });

describe("what the test run does for real", () => {
  it("opens and reads; follows links, tabs and menus that only went somewhere; never presses Archive", () => {
    expect(rehearsalChoice(act("s1", "navigate"), undefined, 0).choice).toBe("do");
    expect(rehearsalChoice(act("s2", "extract", { role: "list" }), undefined, 0).choice).toBe("do");
    expect(rehearsalChoice(act("s3", "click", { role: "link", name: "Daily KPIs" }), { changed: "large", navigated: true }, 0).choice).toBe("do");
    expect(rehearsalChoice(act("s4", "click", { role: "button", name: "More" }), { changed: "small", expanded: true }, 0).choice).toBe("do");
    // Gmail's Archive returns to the inbox ("went somewhere") but archives the email.
    expect(rehearsalChoice(act("s5", "click", { role: "button", name: "Archive" }), { changed: "large", navigated: true }, 0)).toMatchObject({ choice: "skip", why: expect.stringMatching(/Archive/) });
    expect(rehearsalChoice(act("s6", "type", { role: "textbox", name: "Subject" }), undefined, 0).choice).toBe("skip");
    expect(rehearsalChoice(act("s7", "click", { role: "button", name: "Next" }, { requires_approval: true }), { changed: "large" }, 0).choice).toBe("skip");
    expect(rehearsalChoice(act("s8", "click", { role: "button", name: "Apply" }), { changed: "large" }, 0).choice).toBe("skip");
  });
});

describe("the test run", () => {
  it("reports what it did, what it only found, and what it couldn't find", async () => {
    const skill = Skill.parse({
      id: "w",
      name: "w",
      version: 1,
      description: { goal: "g" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand" },
        act("s1", "navigate"),
        act("s5", "click", { role: "button", name: "Archive" }),
        act("s6", "type", { role: "textbox", name: "Gone" }),
      ],
    });
    const r = rehearsal(skill, new Map([["s5", { changed: "large", navigated: true }]]));
    const deps: RunDeps = {
      web: async () => ({ ok: true }),
      fs: async () => ({ ok: true }),
      script: async () => ({ ok: true }),
      fileExists: async () => true,
      webCheck: async () => true,
      approve: async () => false,
      walk: r.walk,
      highlight: async (step) => {
        if (step.target?.name === "Gone") {
          r.onHighlight(step, "target not found");
          throw new Error("target not found");
        }
        r.onHighlight(step);
      },
      log: r.log,
    };
    const outcome = await runSkill(skill, deps, { inputs: {} });
    const report = r.report(outcome.status);
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ["s1", "done"],
      ["s5", "found"],
      ["s6", "not_found"],
    ]);
    expect(report.steps[2]?.error).toBe("target not found");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/player/src/rehearse.test.ts`
Expected: FAIL: no module.

- [ ] **Step 3: Implement**

`packages/player/src/rehearse.ts`:
```ts
// The design agent's safe test run (spec, "The test run in safe mode"): the workflow walked through in the automation
// window with nobody pressing the buttons. Done for real: opening pages and switching tabs, reading, finding files, AI
// steps (3 at most), and clicks on links, tabs, menu items and expanders that only went somewhere or opened something
// when recorded. Only found and outlined, never done: typing, uploads, anything needing approval, anything outward,
// file changes, and any button that acts. A name like Archive, Mark, Move or Save is never pressed even when its
// recorded effect was "went somewhere": Gmail's Archive returns to the inbox, and archives the email.
import { type ActionStep, isAction, isOutward, type LlmStep, type Skill, walkSteps } from "@shadow/core";
import type { RunLogEvent, WalkChoice } from "./types.ts";

export const ACTION_VERBS =
  /\b(archive|delete|remove|trash|mark|move|label|star|assign|approve|send|submit|pay|post|save|publish|share|confirm|reply|forward|invite|upload|buy|order|book|apply|unsubscribe)\b/i;
const READS = new Set(["web.navigate", "web.wait_for", "web.extract", "fs.find", "fs.read", "data.pick", "ax.open"]);
const SAFE_ROLES = new Set(["link", "tab", "menuitem", "treeitem"]);
export const MAX_LLM = 3;

// What a step's click did when it was recorded (Plan 1's trace effect, through Plan 2's evidence).
export interface RecordedEffect {
  changed?: string;
  navigated?: boolean;
  opened?: string;
  expanded?: boolean;
}

export function rehearsalChoice(
  step: ActionStep | LlmStep,
  effect: RecordedEffect | undefined,
  llmSoFar: number,
): { choice: WalkChoice; why: string } {
  if (step.type === "llm") {
    return llmSoFar < MAX_LLM ? { choice: "do", why: "reads text" } : { choice: "skip", why: `at most ${MAX_LLM} AI steps in a test run` };
  }
  const key = `${step.channel}.${step.action}`;
  if (step.requires_approval || isOutward(step)) return { choice: "skip", why: "it needs your approval" };
  if (READS.has(key)) return { choice: "do", why: "it only reads or opens a page" };
  if (key !== "web.click") return { choice: "skip", why: "it would change something" };
  const words = [step.target?.name, step.target?.label, step.target?.text].filter(Boolean).join(" ");
  if (ACTION_VERBS.test(words)) return { choice: "skip", why: `"${words}" acts on something` };
  const role = step.target?.role ?? "";
  const went = Boolean(effect?.navigated || effect?.opened || effect?.expanded);
  // A link or tab with no recorded effect (an older recording) only goes somewhere; a menu item needs its effect.
  if (SAFE_ROLES.has(role) && (went || (effect === undefined && (role === "link" || role === "tab")))) {
    return { choice: "do", why: `a ${role} that only goes somewhere` };
  }
  if (effect?.expanded || effect?.opened) return { choice: "do", why: "it opens a menu or a section" };
  return { choice: "skip", why: "a button: it may change something" };
}

export interface RehearsalStep {
  id: string;
  path: string;
  status: "done" | "failed" | "found" | "not_found" | "not_reached";
  error?: string;
  value?: unknown;
}

export interface Rehearsal {
  walk(step: ActionStep | LlmStep, path: string): Promise<WalkChoice>;
  // Called by the highlight around each outline: no error means the control was found.
  onHighlight(step: ActionStep, error?: string): void;
  log(event: RunLogEvent): void;
  report(outcome: string): { steps: RehearsalStep[]; outcome: string };
}

export function rehearsal(
  skill: Skill,
  effects: Map<string, RecordedEffect>,
  onLine?: (line: string) => void,
): Rehearsal {
  let llm = 0;
  const steps = new Map<string, RehearsalStep>(); // by path
  const missed = new Map<string, string>(); // step id -> why the outline failed
  const say = (line: string) => onLine?.(line);
  return {
    async walk(step, path) {
      const { choice, why } = rehearsalChoice(step, effects.get(step.id), llm);
      if (choice === "do" && step.type === "llm") llm++;
      if (choice === "skip") {
        const target = isAction(step) && step.target ? (step.target.name ?? step.target.label ?? step.target.text) : undefined;
        steps.set(path, { id: step.id, path, status: missed.has(step.id) ? "not_found" : "found", ...(missed.has(step.id) ? { error: missed.get(step.id) } : {}) });
        say(missed.has(step.id) ? `Test run: couldn't find "${target ?? step.intent}"` : `Test run: found "${target ?? step.intent}" (not done: ${why})`);
      }
      return choice;
    },
    onHighlight(step, error) {
      if (error) missed.set(step.id, error);
      else missed.delete(step.id);
    },
    log(event) {
      if (event.type !== "step.result") return;
      const ok = event.result.ok;
      steps.set(event.path, {
        id: event.stepId,
        path: event.path,
        status: ok ? "done" : "failed",
        ...(ok ? (event.result.value !== undefined ? { value: event.result.value } : {}) : { error: event.result.error }),
      });
      say(`Test run: ${event.stepId} ${ok ? "✓" : `failed: ${event.result.error ?? "no reason"}`}`);
    },
    report(outcome) {
      const reached = new Set([...steps.values()].map((s) => s.id));
      const rest: RehearsalStep[] = [...walkSteps(skill.steps)]
        .map(({ step }) => step)
        .filter((s) => (s.type === "action" || s.type === "llm") && !reached.has(s.id))
        .map((s) => ({ id: s.id, path: s.id, status: "not_reached" }));
      return { steps: [...steps.values(), ...rest], outcome };
    },
  };
}
```

  Notes on `walk` and `highlight` order:
  - **In `run.ts`, `highlight` runs before `walk`,** so `missed` is filled before `walk` reads it.
  - **A "do" step** gets its status from `step.result`.
  - **A "skip" step** is reported in `walk`: `step.walk` comes after the highlight.
  - **If the order differs:** check `run.ts`'s walk block (`highlight` → `walk(resolved, path)`). If it ever changes,
    move the report into `log` on `step.walk` instead.

Export from `packages/player/src/index.ts`:
`export { ACTION_VERBS, rehearsal, rehearsalChoice, type RecordedEffect, type Rehearsal } from "./rehearse.ts";`

`apps/daemon/src/runner.ts`:
- **`RunHooks`:** add `// The test run (rehearse.ts): told whether each outline found its control.` and
  `onHighlight?(step: ActionStep, error?: string): void;`.
- **In `deps`:**

```ts
      highlight: hooks.walk
        ? async (step: ActionStep) => {
            try {
              await highlight(step);
              hooks.onHighlight?.(step);
            } catch (error) {
              hooks.onHighlight?.(step, (error as Error).message);
              throw error;
            }
          }
        : undefined,
```

`apps/daemon/src/rehearse.ts`:
```ts
// The design agent's test run, in the automation window (spec, "The test run in safe mode"): the workflow as a
// walk-through nobody presses, through the same path as Walk through (runSkillOn with a walk). Its log goes next to the
// recording, not with the runs: it is part of designing, not a run of the workflow. Your own windows are never used,
// and the tabs it opened are closed when it ends (the extension's endRun).
import type { Skill } from "@shadow/core";
import { type RecordedEffect, rehearsal } from "@shadow/player";
import type { Daemon } from "./daemon.ts";
import { type RunHooks, runSkillOn } from "./runner.ts";

export async function rehearse(
  daemon: Daemon,
  skill: Skill,
  options: {
    effects: Map<string, RecordedEffect>;
    inputs?: Record<string, unknown>;
    hooks: Pick<RunHooks, "data" | "llm">;
    logDir: string;
    onLine?: (line: string) => void;
    signal?: AbortSignal;
  },
) {
  const r = rehearsal(skill, options.effects, options.onLine);
  try {
    const outcome = await runSkillOn(
      daemon,
      skill,
      { provided: options.inputs ?? {}, signal: options.signal },
      {
        walk: r.walk,
        onHighlight: r.onHighlight,
        // Nothing that needs approval is ever done in a test run, and no one answers its questions.
        approve: async () => false,
        ask: async (ask) => (ask.kind === "confirm" ? false : ""),
        log: r.log,
        data: options.hooks.data,
        llm: options.hooks.llm,
      },
      options.logDir,
    );
    return r.report(outcome.error ? `${outcome.status}: ${outcome.error}` : outcome.status);
  } catch (error) {
    // An input the run can't fill (no default yet), Chrome not connected: said in the report, not thrown.
    return r.report(`not run: ${(error as Error).message}`);
  }
}
```

  `runSkillOn`'s `RunHooks` requires `approve` and `log`. Both are given; `ask` is optional.

- [ ] **Step 4: Run it to verify it passes,** then everything

Run: `corepack pnpm vitest run packages/player && corepack pnpm test && corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/player/src/rehearse.ts packages/player/src/rehearse.test.ts packages/player/src/index.ts apps/daemon/src/runner.ts apps/daemon/src/rehearse.ts
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(design-v2): the safe test run

- reads and page-opening clicks are done; typing, sending, approvals and acting buttons (Archive) are only outlined
- a report per step: done, failed, found, not found, not reached; its log stays with the recording

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Steps that name their tab; keys with modifiers

**Files:**
- Modify: `packages/core/src/skill.ts` (`ActionStep.tab`): **Akshat signs off in the PR**
- Modify: `packages/player/src/web/executor.ts` (`keyEvents`, `press` with modifiers)
- Create: `packages/player/src/web/keys.test.ts`
- Create: `apps/extension/src/tab-map.ts`
- Create: `apps/extension/src/tab-map.test.ts`
- Modify: `apps/extension/src/replay.ts` (one automation tab per name)
- Test: `packages/core/src/skill.test.ts`

**Interfaces:**
- Produces:
  - **`ActionStep.tab?: string`.**
  - **`keyEvents(key: string, modifiers?: string[]): Record<string, unknown>[] | string`,** returning CDP params, or
    an error string.
  - **`class TabMap`.**
  - **`web.press { key, modifiers }`** is now played.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/skill.test.ts`:
```ts
  it("lets an action say which tab it runs in", () => {
    const skill = Skill.parse({
      id: "t",
      name: "t",
      version: 1,
      description: { goal: "g" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand" },
        { id: "s1", type: "action", intent: "open the sheet", channel: "web", action: "navigate", tab: "KPI Sheet", args: { url: "https://docs.google.com/" } },
      ],
    });
    const step = skill.steps[1];
    expect(step && "tab" in step ? step.tab : undefined).toBe("KPI Sheet");
  });
```

`packages/player/src/web/keys.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { keyEvents } from "./executor.ts";

describe("keys with modifiers", () => {
  it("send ⌘Enter as Meta + Enter without typing a newline, and plain Enter as before", () => {
    const sent = keyEvents("Enter", ["cmd"]);
    expect(sent).toEqual([
      { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 },
      { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 },
    ]);
    expect((keyEvents("Enter") as Record<string, unknown>[])[0]).toMatchObject({ text: "\r", modifiers: 0 });
  });

  it("send single-letter shortcuts (Gmail's e, Ctrl+K), and refuse a key it doesn't know", () => {
    expect((keyEvents("e") as Record<string, unknown>[])[0]).toMatchObject({ key: "e", code: "KeyE", windowsVirtualKeyCode: 69, text: "e" });
    expect((keyEvents("k", ["ctrl"]) as Record<string, unknown>[])[0]).toMatchObject({ code: "KeyK", modifiers: 2 });
    expect((keyEvents("k", ["ctrl"]) as Record<string, unknown>[])[0]).not.toHaveProperty("text");
    expect(keyEvents("F13")).toBe("unsupported key F13");
  });
});
```

`apps/extension/src/tab-map.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TabMap } from "./tab-map.ts";

describe("the automation window's tabs", () => {
  it("keeps one tab per name for the whole run, and closes the extra ones at the end", () => {
    const tabs = new TabMap(10);
    expect(tabs.lookup(undefined)).toBe(10);
    expect(tabs.lookup("Gmail")).toBeUndefined();
    tabs.remember("Gmail", 11);
    tabs.remember("KPI Sheet", 12);
    expect(tabs.lookup("Gmail")).toBe(11); // back to it: the same tab, not a reload
    expect(tabs.has(12)).toBe(true);
    tabs.forget(12); // you closed it
    expect(tabs.lookup("KPI Sheet")).toBeUndefined();
    expect(tabs.extras()).toEqual([11]);
    expect(TabMap.from(tabs.toJSON()).lookup("Gmail")).toBe(11);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/core/src/skill.test.ts packages/player/src/web/keys.test.ts apps/extension/src/tab-map.test.ts`
Expected: FAIL: `tab` is stripped, no `keyEvents`, no `TabMap`.

- [ ] **Step 3: Implement**

`packages/core/src/skill.ts`: in `ActionStep`'s object, after `target`:
```ts
    // Which tab of the automation window it runs in, by name ("KPI Sheet", "Gmail"). Without one: the first tab. A
    // name stays the same tab for the whole run, so going back to it keeps its page as it was (a selected cell, a
    // scrolled list) instead of opening it again. Needs replay's sign-off: the extension keeps a tab per name.
    tab: z.string().min(1).max(60).optional(),
```
Also add to the args comment block at the top: `// Any action step: tab?: the automation tab it runs in, by name.`

`packages/player/src/web/executor.ts`:
- **Replace `press`** with:
```ts
const MODIFIER_BITS: Record<string, number> = { option: 1, ctrl: 2, cmd: 4, shift: 8 };

// The two DevTools key events for a key and its modifiers, or why it can't be pressed. Named keys from KEYS; single
// letters and digits as themselves (Gmail's e, Ctrl+K). A key with ⌘, Ctrl or Alt types no text: it is a shortcut.
export function keyEvents(key: string, modifiers: string[] = []): Record<string, unknown>[] | string {
  const named = KEYS[key];
  const single = !named && /^[a-z0-9]$/i.test(key);
  if (!named && !single) return `unsupported key ${key}`;
  const code = named?.code ?? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);
  const keyCode = named?.keyCode ?? key.toUpperCase().charCodeAt(0);
  const bits = modifiers.reduce((n, m) => n | (MODIFIER_BITS[m] ?? 0), 0);
  const typing = !modifiers.some((m) => m === "cmd" || m === "ctrl" || m === "option");
  const text = named ? named.text : modifiers.includes("shift") ? key.toUpperCase() : key;
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: bits };
  return [
    { type: "keyDown", ...common, ...(text && typing ? { text } : {}) },
    { type: "keyUp", ...common },
  ];
}

async function press(cdp: Cdp, key: string, modifiers: string[] = []): Promise<string | undefined> {
  const events = keyEvents(key, modifiers);
  if (typeof events === "string") return events;
  for (const event of events) await cdp.send("Input.dispatchKeyEvent", event);
  return undefined;
}
```
  The test's expected keyDown for ⌘Enter has no `text`, and the object key order is
  `type, key, code, windowsVirtualKeyCode, nativeVirtualKeyCode, modifiers`, matching `common`. `toEqual` ignores key
  order anyway.
- **Both callers:** pass the modifiers:
  `press(cdp, String(a.key ?? ""), Array.isArray(a.modifiers) ? (a.modifiers as string[]) : [])`. In `typeText`, the
  `press(cdp, "Enter")` call stays as is.

`apps/extension/src/tab-map.ts`:
```ts
// The automation window's tabs, by the names steps give them (spec 2.4). The first tab is the window's own; a step with
// no tab, or tab "main", runs there. Every other name gets a tab the first time it is used and the same tab after that,
// so a recording that copied in one tab and pasted in another replays the same way, without reloading either page.
// Kept in chrome.storage.session (toJSON/from), since the service worker may be stopped between steps.
export class TabMap {
  private byName = new Map<string, number>();
  constructor(private first?: number) {}

  static from(json: { first?: number; byName: [string, number][] }): TabMap {
    const map = new TabMap(json.first);
    for (const [name, id] of json.byName) map.byName.set(name, id);
    return map;
  }
  toJSON(): { first?: number; byName: [string, number][] } {
    return { first: this.first, byName: [...this.byName] };
  }
  get main(): number | undefined {
    return this.first;
  }
  setMain(id: number): void {
    this.first = id;
  }
  lookup(name: string | undefined): number | undefined {
    return !name || name === "main" ? this.first : this.byName.get(name);
  }
  remember(name: string, id: number): void {
    this.byName.set(name, id);
  }
  // A tab that closed (you closed it, or the run ended).
  forget(id: number): void {
    for (const [name, tab] of this.byName) if (tab === id) this.byName.delete(name);
    if (this.first === id) this.first = undefined;
  }
  has(id: number): boolean {
    return id === this.first || [...this.byName.values()].includes(id);
  }
  // The tabs to close when a run ends: all but the first.
  extras(): number[] {
    return [...new Set(this.byName.values())].filter((id) => id !== this.first);
  }
}
```

`apps/extension/src/replay.ts` is Chrome-only and verified by building the extension, then by Rushil's Checkpoint 3.
Replace the single-tab state with a `TabMap`:
- **State:** `const TABS_KEY = "automationTabs";`, then `let tabs: TabMap | undefined;`,
  `const attached = new Set<number>();` and `let current: number | undefined;`.
- **`loadTabs()`:** read `TabMap.from(stored ?? { byName: [] })` from `chrome.storage.session`, and drop ids whose tab
  no longer exists (`chrome.tabs.get(id).catch`).
- **`saveTabs()`:** write `tabs.toJSON()` back.
- **`automationTab()`** (the first tab) works as today, and calls `tabs.setMain(tabId)` instead of storing a single id.
- **`tabFor(name)`:**
  - `const id = tabs.lookup(name)`; if it exists, use it;
  - else `chrome.tabs.create({ windowId: (await chrome.tabs.get(await automationTab())).windowId, url: "about:blank", active: true })`,
    then `tabs.remember(name, created.id)` and `saveTabs()`;
  - before returning, `chrome.tabs.update(id, { active: true })`, so pictures and accessibility queries see it.
- **`cdpFor(tabId)`:**
  - attaches if `!attached.has(tabId)`; several tabs may be attached at once, and `attached.add` comes after the
    `chrome.debugger.attach` call;
  - brings the window forward on its first attach;
  - sets `current = tabId`;
  - keeps Plan 1's `withTimeouts` wrapper.
- **`runWebStep(step)`:** `executeWebStep(await cdpFor(await tabFor(step.tab)), step, { fetchText })`.
- **`runPageCheck` and `runPageOp`:** use `current ?? await automationTab()`, the tab the last step ran in.
- **`isAutomationTab(tabId)`:** `tabs?.has(tabId) ?? false`. Recording ignores every automation tab.
- **`chrome.debugger.onDetach`:** `attached.delete(source.tabId)`.
- **`endRun()`:**
  - detach every id in `attached`;
  - close every `tabs.extras()` id (`chrome.tabs.remove(...).catch(() => {})`) and `tabs.forget` each;
  - `saveTabs()`, so the next run starts with the window's one tab.
- **`chrome.tabs.onRemoved`** (in background.ts) also calls `forgetAutomationTab(tabId)` exported from replay.ts
  (`tabs?.forget(tabId); saveTabs()`), so a tab you close isn't used again.

- [ ] **Step 4: Run them,** then everything, then build the extension

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm --filter @shadow/extension build`
Expected: PASS, and the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill.ts packages/core/src/skill.test.ts packages/player/src/web/executor.ts packages/player/src/web/keys.test.ts apps/extension/src/tab-map.ts apps/extension/src/tab-map.test.ts apps/extension/src/replay.ts apps/extension/src/background.ts
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(replay): steps run in the tab they name; keys with modifiers

- one automation tab per name for a run, so going back to a tab keeps its page (needs Akshat's sign-off on skill.ts)
- web.press plays ⌘/Ctrl/Alt shortcuts and single-letter keys (Gmail's e)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A progress feed in plain words; this recording's questions only; Enter sends

**Files:**
- Create: `packages/recorder/src/design/progress.ts`
- Create: `packages/recorder/src/design/progress.test.ts`
- Modify: `packages/recorder/src/index.ts` (export `progressLine`)
- Modify: `apps/daemon/src/types.ts` (`RecordingView.progress`, `Question.sessionId`)
- Modify: `apps/daemon/src/record-control.ts` (`progress(line)`; `finish(sessionId, progress)`)
- Modify: `apps/daemon/src/record.ts` (`FinishOptions.progress`; lines at each stage; the design agent's events)
- Modify: `apps/daemon/src/main.ts` (pass `progress`; the prompter tags questions with the recording)
- Modify: `apps/daemon/src/service.ts` (`ask` keeps `sessionId` in the item's detail)
- Create: `apps/ui/src/questions.ts`, `apps/ui/src/questions.test.ts`
- Modify: `apps/ui/src/screens/Record.tsx` (the feed; this recording's questions), `apps/ui/src/screens/Inbox.tsx` (Enter sends), `apps/ui/src/styles.css`
- Test: `apps/daemon/src/record-control.test.ts`

**Interfaces:**
- Produces:
  - **`progressLine(event: AgentEvent): string | undefined`.**
  - **`RecordControl.progress(line: string): void`,** with `RecordingView.progress: { at: number; line: string }[]`.
    The view carries the lines, so the Record screen's existing refetch on every event shows them. A reload in the
    middle keeps them.
  - **`questionsFor(items: InboxItem[], sessionId: string | undefined): InboxItem[]`.**

- [ ] **Step 1: Write the failing tests**

`packages/recorder/src/design/progress.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { progressLine } from "./progress.ts";

describe("the design agent's work, in plain words", () => {
  it("says what it changes and asks, never its bookkeeping", () => {
    const call = (tool: string, input: unknown) => progressLine({ type: "call", turn: 1, tool, input });
    expect(call("remove", { steps: ["s2", "s5"], why: "clicks that changed nothing" })).toBe("Removing s2, s5: clicks that changed nothing");
    expect(call("loop", { steps: ["s4"], item: { name: "email" } })).toBe("Repeating s4 for each email");
    expect(call("accept", { proposal: "p1", why: "the date is today" })).toBe("Using a pattern from the recording: the date is today");
    expect(call("ask", { question: "Newest email, or all unread?" })).toBe("A question for you: Newest email, or all unread?");
    expect(call("look", { step: "s3" })).toBeUndefined();
    expect(progressLine({ type: "invalid", turn: 1, error: "bad input" })).toBeUndefined();
    expect(progressLine({ type: "end", turn: 3, outcome: { kind: "finished", tool: "done", value: {} } })).toBe("Done");
  });
});
```

`apps/ui/src/questions.test.ts`:
```ts
import type { InboxItem } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import { questionsFor } from "./questions.ts";

const item = (id: string, kind: string, sessionId?: string) =>
  ({ id, kind, title: id, detail: sessionId ? { sessionId } : {}, createdAt: 0 }) as unknown as InboxItem;

describe("the Record screen's questions", () => {
  it("are this recording's, plus ones from no recording (the form from the terminal), newest last", () => {
    const items = [item("a", "question", "rec-1"), item("b", "question", "rec-2"), item("c", "question"), item("d", "approval", "rec-1")];
    expect(questionsFor(items, "rec-1").map((i) => i.id)).toEqual(["c", "a"]);
  });
});
```

Add to `apps/daemon/src/record-control.test.ts` (build the control the way that file does; `options` is its setup):
```ts
  it("keeps the lines of progress while a recording becomes a workflow, for the Record screen", () => {
    const control = createRecordControl(options);
    const events: unknown[] = [];
    control.subscribe((e) => events.push(e));
    control.progress("Read 42 actions as 18 steps");
    expect(control.view().progress.map((p) => p.line)).toEqual(["Read 42 actions as 18 steps"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "recording" }));
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/recorder/src/design/progress.test.ts apps/ui/src/questions.test.ts apps/daemon/src/record-control.test.ts`
Expected: FAIL: no modules, no `progress`.

- [ ] **Step 3: Implement**

`packages/recorder/src/design/progress.ts`:
```ts
// The design agent's work in plain words, for the Record screen's feed (spec 4.1): what it changes, uses, asks and
// tests, the way a person watching would say it. Nothing for its own bookkeeping (looking, a call it got wrong): the
// feed is for trust, not for debugging; design.json has the whole transcript.
import type { AgentEvent } from "@shadow/agent";

const list = (steps: unknown) => (Array.isArray(steps) ? steps.join(", ") : String(steps ?? ""));

export function progressLine(event: AgentEvent): string | undefined {
  if (event.type === "end") {
    if (event.outcome.kind === "finished") return "Done";
    if (event.outcome.kind === "out_of_budget") return "Stopped at its budget: keeping what it reached";
    return undefined;
  }
  if (event.type !== "call") return undefined;
  const input = (event.input ?? {}) as Record<string, unknown>;
  const why = typeof input.why === "string" && input.why ? `: ${input.why}` : "";
  switch (event.tool) {
    case "label_steps":
      return "Naming each step by what it does";
    case "accept":
      return `Using a pattern from the recording${why}`;
    case "reject":
      return `Not using a pattern from the recording${why}`;
    case "remove":
      return `Removing ${list(input.steps)}${why}`;
    case "restore":
      return `Putting back ${String(input.step)}${why}`;
    case "add":
      return `Adding a step: ${String((input.step as { intent?: unknown } | undefined)?.intent ?? "")}`;
    case "change":
      return `Changing ${String(input.step)}${why}`;
    case "loop":
    case "wrap_in_loop":
      return `Repeating ${list(input.steps)} for each ${String((input.item as { name?: unknown } | undefined)?.name ?? "item")}`;
    case "branch":
    case "wrap_in_branch":
      return `Doing ${list(input.steps)} only when it applies`;
    case "ai_step":
    case "add_llm_step":
      return `Adding an AI step: ${String(input.intent ?? "")}`;
    case "trigger":
      return "Setting how often it runs";
    case "ask":
    case "ask_user":
      return `A question for you: ${String(input.question ?? "")}`;
    case "describe_step_screenshot":
      return `Looking at the picture of step ${String(input.step)}`;
    case "test":
      return "Testing the workflow in the automation window";
    case "done":
    case "finish":
      return "Checking the workflow is complete";
    default:
      return undefined;
  }
}
```
Export it from `packages/recorder/src/index.ts`: `export { progressLine } from "./design/progress.ts";`.

`apps/daemon/src/types.ts`:
- **`Question`:** add `// The recording the question is about: the Record screen shows only its questions.` and
  `sessionId?: string;`.
- **`RecordingView`:** add `// What is happening while a recording becomes a workflow, in plain words, oldest first.`
  and `progress: { at: number; line: string }[];`.

`apps/daemon/src/record-control.ts`:
- **`RecordControlOptions.finish`** becomes
  `finish(sessionId: string, progress: (line: string) => void): Promise<{ skill: { id: string } } | undefined>;`.
- **`RecordControl`:** add `progress(line: string): void;`.
- **In `createRecordControl`:** keep `let progress: { at: number; line: string }[] = [];`, and add `progress` to
  `view()`.
- **In `compile(id)`:** reset `progress = []` before `changed()`, and call `await options.finish(id, control.progress)`.
- **Clearing the lines:** progress is reset to `[]` only at the next `compile` (and in `start`), not in `finally`. That
  way the last lines stay visible next to "Last recording: …" until the next recording.
- **The method on `control`:**

```ts
    progress(line) {
      progress = [...progress, { at: Date.now(), line }].slice(-200);
      changed();
    },
```

`apps/daemon/src/record.ts`:
- **`FinishOptions`:** add `// Plain-language lines for the Record screen as the work goes on.` and
  `progress?: (line: string) => void;`.
- **In `finishRecording`:**
  - after normalise: `options.progress?.(`Read ${trace.length} actions as ${steps.length} steps`);`;
  - before the design agent: `options.progress?.("The design agent is reading what you did and said");`;
  - pass `onEvent: (event) => { const line = progressLine(event); if (line) options.progress?.(line); }` into the
    `designWorkflow({...})` options (`DesignOptions.onEvent` already passes events through);
  - before the drill:
    `if (questions.length > 0) options.progress?.(`${questions.length} question(s) for you`);`;
  - after saving: `options.progress?.(`Saved ${saved.skill.name}`);`.
  - Import `progressLine` from `@shadow/recorder`.

`apps/daemon/src/main.ts`:
- **`finish`:** becomes `finish: async (sessionId, progress) => { … }`.
  - before the picture and voice processing: `progress("Reading the words on your screen and turning your voice into text");`;
  - pass `progress` into `finishRecording({ …, progress })`.
- **The prompter:** add `sessionId: record?.view().sessionId,` to the object given to `service.ask`.

`apps/daemon/src/service.ts`, in `ask`: add `sessionId: question.sessionId,` to `detail`.

`apps/ui/src/questions.ts`:
```ts
// The questions the Record screen shows: this recording's, and those that belong to no recording (the form asked
// from the terminal). Before, every open question showed, another recording's too.
import type { InboxItem } from "@shadow/daemon/src/types.ts";

export function questionsFor(items: InboxItem[], sessionId: string | undefined): InboxItem[] {
  return items
    .filter((i) => i.kind === "question")
    .filter((i) => {
      const of = (i.detail as { sessionId?: unknown }).sessionId;
      return of === undefined || of === sessionId;
    })
    .reverse();
}
```

`apps/ui/src/screens/Record.tsx`:
- **Questions:** replace `const questions = (inbox.data ?? []).filter((i) => i.kind === "question").reverse();` with
  `const questions = questionsFor(inbox.data ?? [], data.sessionId);`, importing `questionsFor` from `../questions.ts`.
  The fixtures in the test above are in the inbox's newest-first order, so reversing gives oldest first, as the screen
  did before.
- **The compiling section** becomes:

```tsx
      {data.phase === "compiling" ? (
        <section className="section">
          <h2>Turning your recording into a workflow…</h2>
          <p className="muted">{data.form?.goal}</p>
          {data.progress.length > 0 ? (
            <ol className="progress-feed" aria-live="polite">
              {data.progress.map((p) => (
                <li key={`${p.at}-${p.line}`}>{p.line}</li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
```

`apps/ui/src/styles.css`: add
```css
.progress-feed {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--muted, #6b6b73);
}
.progress-feed li:last-child {
  color: inherit;
}
```

`apps/ui/src/screens/Inbox.tsx`, in `TextAnswer`, make Enter send. Change both forms' `onSubmit` to:
- **required form:**
  `onSubmit={(e) => { e.preventDefault(); if (text.trim()) void onSend(text.trim()); }}`;
- **plain form:**
  `onSubmit={(e) => { e.preventDefault(); void onSend(text || placeholder || ""); }}`.

The Send buttons stay. An input inside a `<form>` submits on Enter by itself.

- [ ] **Step 4: Run them,** then everything

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm lint`
Expected: PASS. Any test that builds a `RecordingView` literal or a `RecordControlOptions.finish` needs the new fields
(`progress: []`, the second `finish` argument). Update those fixtures, and name them in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/design/progress.ts packages/recorder/src/design/progress.test.ts packages/recorder/src/index.ts apps/daemon/src apps/ui/src
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(record): a plain-language feed while a recording becomes a workflow; only its questions

- the Record screen shows what is happening as it happens (actions read, steps removed, loops made, questions)
- only this recording's questions are shown; Enter sends an answer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Left for Plan 3 proper (after Plan 2)

- **The orchestrator,** in this order:
  1. stage 1 understand (one structured call: `TaskModel`, with the evidence package);
  2. build with `designToolsV2` and `callsPerTurn: 8`;
  3. test (`rehearse`) and fix, at most twice;
  4. ask the queued questions in one batch;
  5. apply the answers;
  6. the finish gate (`gate`, bound into `session.finish`).
- **Budget:** ≤ $0.25 and ≤ 40 calls, on one meter that also counts captions.
- **The prompt:** about 80 lines, with the KPI worked example.
- **Wiring:** into `finishRecording` in place of `designWorkflow`, then removing `design.ts`, `tools.ts`, `changes.ts`
  and the dead compile path (approved). `outlineOf` and `describeChanges` move into `v2/`.
- **The review sidecar** (`skills/<id>/review.json`, from `changeNotes` + decisions + the gate's listed gaps), and the
  workflow page's badges and "Looks right" gate on Go live.
- **The test run's side-effect warning** ("opening 1 email will mark it as read"), from the steps it will do for real.
- **`design:eval` switching to v2,** and the $5 real runs (Checkpoint 3).

