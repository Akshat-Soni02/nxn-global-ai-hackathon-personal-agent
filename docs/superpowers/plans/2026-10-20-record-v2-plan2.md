# Record v2, Plan 2: understanding in code → the evidence package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when a recording stops, code turns it into `evidence.json`: one timeline, steps classed by what they did,
noise removed and listed, tabs named, data flow, prepared generalisations (proposals) and captions. Design agent v2
(Plan 3) reads only this.

**Architecture:**
- **The step builder** (`normalise.ts`) now reads what Plan 1's capture records (effect, list place, cell, click
  point, opened tab, Back), turns keys into presses, and returns the noise it removed with a reason for each
  (`normaliseAll`).
- **New pure modules** in `packages/recorder/src/evidence/` turn steps, pictures and speech into the evidence:
  - `classes.ts`, `tabs.ts`, `screens.ts`, `flow.ts`, `proposals.ts`, `timeline.ts`, `answers.ts`, `captions.ts`;
  - `evidence.ts` assembles them, keeps the text under 24k tokens, and implements Plan 3's `EvidenceView`.
- **The daemon** (`apps/daemon/src/evidence.ts`) reads the recording folder, asks the vision model for captions
  (Pictures switch only), and writes `evidence.json` after compile, before the design agent.
- **The player** learns date templates and keys with modifiers. These are replay changes; Akshat reviews.

**Tech stack:** TypeScript 7, vitest 5, zod 4, Chrome MV3, macOS `sips` (cropping pictures).

**Spec:** `docs/superpowers/specs/2026-10-19-record-v2-design.md`, Phase 2 (2.1–2.14).
- **Inputs:** the results of Checkpoint 1 (`testing/checkpoint-1.md`, "For Plan 2") and the Plan 3 draft's contracts
  (`docs/superpowers/plans/2026-10-19-record-v2-plan3-draft.md`, Task 1).

## Global Constraints

- After every task: `corepack pnpm test`, `corepack pnpm typecheck` and `corepack pnpm lint` exit 0.
- **No real model calls in tests.** Captions are tested with a stand-in describer. Real captions only in Checkpoint 2,
  inside the $5 budget, each run announced first and logged in `testing/design-eval-ledger.md`.
- **Code proposes, the agent decides:** a proposal never changes the draft by itself. Its edits are applied only when
  the agent accepts it (Plan 3).
- **Locators never store positions.** A list place is evidence and a proposal, never a locator.
- **Old recordings** (no `effect`, `list`, `cell`, `point`, `select_text`) must still normalise and build evidence. A
  missing fact never makes a step noise.
- **Replay changes** (`packages/core/src/{dates,vars,check}.ts`, `packages/player/src/{template.ts,web/keys.ts,web/executor.ts}`):
  the commit body says "Akshat reviews".
- **Commits:**
  - `git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit`;
  - a conventional subject plus 2–4 bullets;
  - the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
  - Commit only behind `corepack pnpm -s test && corepack pnpm -s lint && corepack pnpm -s typecheck`. Never push
    unless asked.
- **No pre-existing file is deleted.** The evidence step never fails a recording: any error is logged and the recording
  goes on without `evidence.json`.

## Review Focus

1. **An old-format recording** (the KPI fixture: no effects, lists or cells): it normalises as before and evidence
   still builds. No click becomes noise for lack of an effect. Tests in Task 5 and Task 14.
2. **A recording with Screen and Voice off:** no pictures, no speech. Evidence builds with empty `appeared`, `near` and
   `said`, and no captions are asked for. Test in Task 14.
3. **Enter in a Google Sheet's cell** empties the cell editor (`emptied: true`). That is not a message sent: no approval.
   Test in Task 4.
4. **Two tabs with the same title** (two Gmail tabs): the tabs get different names. Test in Task 7.
5. **A typed date that is not the recording day** ("12 Oct" typed on 20 Oct) gives no date proposal. "w/c 19 Oct" typed
   on Tuesday 20 Oct gives `{{week_start|D MMM}}`, not `{{today-1|D MMM}}`. Test in Task 10.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/recorder/src/design/v2/contracts.ts` (new) | `TaskModel`, `DoneReport`, `Proposal`, `EvidenceView`, `TestReport` (moved here from the Plan 3 draft) | 1 |
| `packages/core/src/dates.ts` (new), `vars.ts`, `check.ts`, `briefing.ts`, `index.ts`; `packages/player/src/template.ts`; `packages/recorder/src/skeleton.ts` | `{{today\|D MMM}}`, `{{today-1}}`, `{{week_start}}` | 2 |
| `packages/player/src/web/keys.ts` (new), `executor.ts`; `packages/core/src/briefing.ts` | `web.press {key, modifiers}` for any key | 3 |
| `packages/core/src/trace.ts`, `apps/extension/src/background.ts`, `packages/recorder/src/normalise.ts`, `skeleton.ts` | steps keep effect, list, cell, point, opened tab, Back; keys become presses; Enter that sends | 4 |
| `packages/recorder/src/normalise.ts` | `normaliseAll`: noise listed with reasons; selection + copy = one read | 5 |
| `packages/recorder/src/evidence/classes.ts` (new) | act / go / reveal / read | 6 |
| `packages/recorder/src/evidence/tabs.ts` (new) | tab names, which tab each step is in | 7 |
| `packages/recorder/src/evidence/screens.ts` (new) | words near the click, what appeared | 8 |
| `packages/recorder/src/evidence/flow.ts` (new) | copy → paste, typed again, output → use | 9 |
| `packages/recorder/src/evidence/proposals.ts` (new) | date, list item, open directly, next empty row, repeat, all files, constant | 10 |
| `packages/recorder/src/evidence/timeline.ts` (new), `narration.ts` | one timeline; narration by draft ids | 11 |
| `packages/recorder/src/evidence/answers.ts` (new), `apps/daemon/src/record.ts` | questions the evidence answers are not asked | 12 |
| `packages/recorder/src/evidence/captions.ts` (new), `apps/daemon/src/crop.ts` (new) | captions of the masked pictures | 13 |
| `packages/recorder/src/evidence/evidence.ts` (new), `apps/daemon/src/evidence.ts` (new), `record.ts`, `scripts/evidence.ts` (new), `package.json` | `evidence.json`, the 24k cap, `EvidenceView`, `pnpm evidence` | 14 |
| `testing/checkpoint-2.md` (new) | Checkpoint 2: the real recordings through the evidence | 15 |

---

### Task 1: The contracts between the evidence and the agent

Moved here from the Plan 3 draft (its Task 1): Plan 2 produces `Proposal[]` and implements `EvidenceView`, so the
types must exist first.

**Files:**
- Create: `packages/recorder/src/design/v2/contracts.ts`, `packages/recorder/src/design/v2/contracts.test.ts`
- Modify: `packages/recorder/src/index.ts`
- Modify: `docs/superpowers/plans/2026-10-19-record-v2-plan3-draft.md` (Task 1 heading: "moved to Plan 2, Task 1")

**Interfaces:**
- Produces: `TaskModel`, `DoneReport` (zod), `PROPOSAL_KINDS`, `Proposal`, `EvidenceView`, `TestStep`, `TestReport`
  exactly as written in the Plan 3 draft, Task 1, Step 3.

- [ ] **Step 1: Write the failing test.** Copy the test of the Plan 3 draft, Task 1, Step 1, verbatim
  (`docs/superpowers/plans/2026-10-19-record-v2-plan3-draft.md`, the code block under "Step 1") into
  `packages/recorder/src/design/v2/contracts.test.ts`.
- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/design/v2/contracts.test.ts`. Expected: FAIL,
  no module.
- [ ] **Step 3: Write `contracts.ts`.** Copy the code block of the Plan 3 draft, Task 1, Step 3 verbatim, and add its
  `export {…} from "./design/v2/contracts.ts"` block to `packages/recorder/src/index.ts`.
- [ ] **Step 4: Run it.** Same command plus `corepack pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Mark the draft's Task 1 as moved.** Change its heading to
  `### Task 1 (moved to Plan 2, Task 1): The contracts between the evidence (Plan 2) and the agent (Plan 3)`.
- [ ] **Step 6: Commit.**

```bash
git add packages/recorder/src/design/v2 packages/recorder/src/index.ts docs/superpowers/plans/2026-10-19-record-v2-plan3-draft.md
git -c user.name=ruseellkj -c user.email=112114308+ruseellkj@users.noreply.github.com commit -m "feat(design-v2): the task model, proposals, evidence view and test report

- the contracts between the evidence builder (Plan 2) and design agent v2, moved from the Plan 3 draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Dates in templates: `{{today|D MMM}}`, `{{today-1}}`, `{{week_start}}` (spec 2.11)

A recording types "20 Oct" or "w/c 19 Oct". Next time that must be the run's day, in the same format. Today the only
built-in is `{{today}}` as `YYYY-MM-DD`.

**Files:**
- Create: `packages/core/src/dates.ts`, `packages/core/src/dates.test.ts`
- Modify: `packages/core/src/vars.ts` (`BUILT_INS` gets `week_start`), `packages/core/src/check.ts` (`refType`),
  `packages/core/src/index.ts`, `packages/core/src/briefing.ts` (the `{{today}}` sentence)
- Modify: `packages/player/src/template.ts` (`lookup`), `packages/player/src/template.test.ts`
- Modify: `packages/recorder/src/skeleton.ts` (an input named like a built-in is renamed)

**Interfaces:**
- Produces (`@shadow/core`):
  - `interface DateRef { base: "today" | "week_start"; offset: number; format?: string }`
  - `parseDateRef(expr: string): DateRef | undefined`
  - `formatDate(d: Date, format: string): string`
  - `dateOf(ref: DateRef, now: Date): Date`
  - `dateValue(ref: DateRef, now: Date): string` (YYYY-MM-DD without a format)
- Consumed by Task 10 (`formatDate`, `dateOf`).

- [ ] **Step 1: Write the failing tests.**

`packages/core/src/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDateRef } from "./dates.ts";
import { Skill } from "./skill.ts";

const typing = (text: string, inputs: Record<string, unknown> = {}) =>
  Skill.safeParse({
    id: "d",
    version: 1,
    name: "d",
    description: { goal: "g" },
    steps: [
      { id: "start", type: "trigger", intent: "by hand", inputs },
      { id: "s1", type: "action", intent: "type", channel: "web", action: "type", args: { text } },
    ],
  });

describe("dates in a workflow", () => {
  it("reads today or the week's Monday, a few days before or after, and a format", () => {
    expect(parseDateRef("today|D MMM")).toEqual({ base: "today", offset: 0, format: "D MMM" });
    expect(parseDateRef(" today - 1 ")).toEqual({ base: "today", offset: -1 });
    expect(parseDateRef("week_start|[w/c] D MMM")).toEqual({ base: "week_start", offset: 0, format: "[w/c] D MMM" });
    expect(parseDateRef("todays")).toBeUndefined();
  });

  it("lets a step use them, and keeps week_start a reserved name", () => {
    expect(typing("{{today|D MMM}}").success).toBe(true);
    expect(typing("w/c {{week_start|D.M.YYYY}}").success).toBe(true);
    expect(typing("{{today-1}}").success).toBe(true);
    expect(typing("{{tomorrow}}").success).toBe(false);
    expect(typing("x", { week_start: { type: { type: "date" } } }).success).toBe(false);
  });
});
```

Add to `packages/player/src/template.test.ts` (it already imports `resolveTemplates`):

```ts
describe("dates in templates (spec 2.11)", () => {
  const tuesday = new Date(2026, 9, 20, 9, 30); // Tuesday 20 Oct 2026
  const at = (t: string, now = tuesday) => resolveTemplates(t, { vars: {} }, now);

  it("gives today, a day before or after, and the week's Monday, in the format typed", () => {
    expect(at("{{today}}")).toBe("2026-10-20");
    expect(at("{{today-1}}")).toBe("2026-10-19");
    expect(at("{{today+3|ddd D MMMM YYYY}}")).toBe("Fri 23 October 2026");
    expect(at("{{today|D MMM}}")).toBe("20 Oct");
    expect(at("{{ today | DD/MM/YYYY }}")).toBe("20/10/2026");
    expect(at("{{today|D.M.YYYY}}")).toBe("20.10.2026");
    expect(at("{{week_start}}")).toBe("2026-10-19");
    expect(at("Daily KPIs - {{week_start|[w/c] D MMM}}")).toBe("Daily KPIs - w/c 19 Oct");
  });

  it("starts the week on Monday, also on a Sunday", () => {
    expect(at("{{week_start}}", new Date(2026, 9, 25))).toBe("2026-10-19");
  });
});
```

- [ ] **Step 2: Run them.** `corepack pnpm vitest run packages/core/src/dates.test.ts packages/player/src/template.test.ts`.
  Expected: FAIL (no `dates.ts`; `{{today|D MMM}}` "is not a variable reference").

- [ ] **Step 3: Write `packages/core/src/dates.ts`.**

```ts
// Dates built into templates (spec 2.11): {{today}}, {{today-1}}, {{today+7}}, {{week_start}} (this week's Monday),
// each with an optional format after a bar: {{today|D MMM}} is "20 Oct". Text in brackets is kept as it is:
// {{week_start|[w/c] D MMM}} is "w/c 19 Oct". Without a format a date is YYYY-MM-DD, as {{today}} always was.
// Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd (English names).
export interface DateRef {
  base: "today" | "week_start";
  offset: number;
  format?: string;
}

const DATE_REF = /^(today|week_start)\s*(?:([+-])\s*(\d{1,3}))?\s*(?:\|\s*(.+?))?\s*$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKEN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g;
const pad = (n: number) => String(n).padStart(2, "0");

export function parseDateRef(expr: string): DateRef | undefined {
  const m = DATE_REF.exec(expr.trim());
  if (!m) return undefined;
  const offset = m[2] ? Number(m[3]) * (m[2] === "-" ? -1 : 1) : 0;
  return { base: m[1] as DateRef["base"], offset, ...(m[4] ? { format: m[4] } : {}) };
}

export function formatDate(d: Date, format: string): string {
  return format.replace(TOKEN, (token: string, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return String(d.getFullYear()).slice(-2);
      case "MMMM":
        return MONTHS[d.getMonth()] ?? "";
      case "MMM":
        return (MONTHS[d.getMonth()] ?? "").slice(0, 3);
      case "MM":
        return pad(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "DD":
        return pad(d.getDate());
      case "D":
        return String(d.getDate());
      case "dddd":
        return DAYS[d.getDay()] ?? "";
      default:
        return (DAYS[d.getDay()] ?? "").slice(0, 3);
    }
  });
}

// The run's local day (or its week's Monday), moved by the offset in days.
export function dateOf(ref: DateRef, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (ref.base === "week_start") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setDate(d.getDate() + ref.offset);
  return d;
}

export function dateValue(ref: DateRef, now: Date): string {
  return formatDate(dateOf(ref, now), ref.format ?? "YYYY-MM-DD");
}
```

- [ ] **Step 4: Wire it in.**
  - `packages/core/src/index.ts`: add `export * from "./dates.ts";`.
  - `packages/core/src/vars.ts`: `BUILT_INS` becomes `{ today: { type: "date" }, week_start: { type: "date" } }`.
  - `packages/core/src/check.ts`, first lines of `refType` (import `parseDateRef` from `./dates.ts`):

```ts
  // A built-in date: {{today|D MMM}} is text, {{today-1}} and {{week_start}} are dates.
  const date = parseDateRef(expr);
  if (date) return date.format ? { type: "text" } : { type: "date" };
```

  - `packages/player/src/template.ts`, `lookup`, before `parseRef` (import both from `@shadow/core`); then delete the
    line that special-cased `ref.name === "today"`, which `dateValue` now covers:

```ts
  const date = parseDateRef(expr);
  if (date) return dateValue(date, now);
```

  - `packages/recorder/src/skeleton.ts`: the clash rename `base === "today" ? "today_input" : base` becomes
    ``base in BUILT_INS ? `${base}_input` : base`` (import `BUILT_INS` from `@shadow/core`).
  - `packages/core/src/briefing.ts`: after the sentence saying `{{today}}` is built in (YYYY-MM-DD), add
    `Also {{today-1}}, {{today+7}}, {{week_start}} (this week's Monday), and a format after a bar: {{today|D MMM}} is "20 Oct", {{week_start|[w/c] D MMM}} is "w/c 19 Oct".`

- [ ] **Step 5: Run them.** Same command, then `corepack pnpm -s test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(templates): dates in a format, a day before or after, and the week's Monday`.
  - Bullets: the three forms, checked when saved and resolved at run time.
  - "Akshat reviews: core dates.ts and check.ts, player template.ts".

---

### Task 3: Keys with modifiers, and any key

Moved here from the Plan 3 draft (its Task 6, the keys half). Gmail's `e` archives and ⌘Enter sends. Capture records
both (Plan 1), and Task 4 turns them into steps. The player's `web.press` takes only `{key}`, and only six named keys.

**Files:**
- Create: `packages/player/src/web/keys.ts`, `packages/player/src/web/keys.test.ts`
- Modify: `packages/player/src/web/executor.ts` (`press` and its two callers), `packages/core/src/briefing.ts`
  (`ACTION_DOCS["web.press"]`), `packages/core/src/skill.ts` (the `web.press` comment line)

**Interfaces:**
- Produces: `type Modifier = "cmd" | "shift" | "option" | "ctrl"`, `interface KeyEvent`,
  `keyEvents(key: string, modifiers?: Modifier[]): KeyEvent[] | string` (the string is an error),
  `modifiersOf(value: unknown): Modifier[]`.
- `web.press` args become `{ key, modifiers? }`.

- [ ] **Step 1: Write the failing test** `packages/player/src/web/keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { keyEvents } from "./keys.ts";

describe("the keys a press sends", () => {
  it("types a single letter (Gmail's e)", () => {
    const common = { key: "e", code: "KeyE", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69, modifiers: 0 };
    expect(keyEvents("e")).toEqual([
      { type: "keyDown", ...common, text: "e" },
      { type: "keyUp", ...common },
    ]);
  });

  it("presses a shortcut with its modifiers, typing nothing (⌘Enter sends in Gmail)", () => {
    const common = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 };
    expect(keyEvents("Enter", ["cmd"])).toEqual([
      { type: "keyDown", ...common },
      { type: "keyUp", ...common },
    ]);
    expect(keyEvents("k", ["ctrl", "shift"])).toMatchObject([{ code: "KeyK", modifiers: 10 }, { modifiers: 10 }]);
    expect((keyEvents("k", ["ctrl"]) as { text?: string }[])[0]?.text).toBeUndefined();
  });

  it("says which key it can't press", () => {
    expect(keyEvents("F13")).toBe("unsupported key F13");
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/player/src/web/keys.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/player/src/web/keys.ts`.**

```ts
// The key events a press sends (CDP Input.dispatchKeyEvent): named keys and any single character, with ⌘, Ctrl,
// Option and Shift. A recording keeps Gmail's e and ⌘Enter (spec 1.8); replay presses them the same way.
export type Modifier = "cmd" | "shift" | "option" | "ctrl";

export interface KeyEvent {
  type: "keyDown" | "keyUp";
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
  modifiers: number;
  text?: string;
}

const NAMED: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  " ": { code: "Space", keyCode: 32, text: " " },
};
// CDP's modifier bits.
const BITS: Record<Modifier, number> = { option: 1, ctrl: 2, cmd: 4, shift: 8 };

export function keyEvents(key: string, modifiers: Modifier[] = []): KeyEvent[] | string {
  let code: string;
  let keyCode: number;
  let text: string | undefined;
  const named = NAMED[key];
  if (named) ({ code, keyCode, text } = named);
  else if ([...key].length === 1) {
    const upper = key.toUpperCase();
    code = /[A-Z]/.test(upper) ? `Key${upper}` : /\d/.test(key) ? `Digit${key}` : "";
    keyCode = /[A-Z0-9]/.test(upper) ? upper.charCodeAt(0) : 0;
    text = key;
  } else return `unsupported key ${key}`;
  const bits = modifiers.reduce((sum, m) => sum | BITS[m], 0);
  // With ⌘ or Ctrl a key is a shortcut: it types nothing.
  const typed = text !== undefined && !modifiers.includes("cmd") && !modifiers.includes("ctrl") ? { text } : {};
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: bits };
  return [
    { type: "keyDown", ...common, ...typed },
    { type: "keyUp", ...common },
  ];
}

export function modifiersOf(value: unknown): Modifier[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is Modifier => m === "cmd" || m === "shift" || m === "option" || m === "ctrl");
}
```

- [ ] **Step 4: Use it.** In `executor.ts`, delete the `KEYS` table. `press` becomes:

```ts
async function press(cdp: Cdp, key: string, modifiers: Modifier[] = []): Promise<string | undefined> {
  const events = keyEvents(key, modifiers);
  if (typeof events === "string") return events;
  for (const event of events) await cdp.send("Input.dispatchKeyEvent", event);
  return undefined;
}
```

  - Both `press(cdp, String(a.key ?? ""))` calls become `press(cdp, String(a.key ?? ""), modifiersOf(a.modifiers))`.
    Import `keyEvents`, `type Modifier` and `modifiersOf` from `./keys.ts`. `typeText`'s `press(cdp, "Enter")` stays.
  - `briefing.ts`: `"web.press": { args: '{ key, modifiers?: ("cmd" | "shift" | "option" | "ctrl")[] }  e.g. "Enter", "Escape", "e"; ⌘Enter is key "Enter" with ["cmd"]' }`.
  - `skill.ts`: the `web.press` comment line says the same.

- [ ] **Step 5: Run it.** The test, then `corepack pnpm -s test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(player): press any key, with its modifiers`.
  - Bullets: Gmail's e and ⌘Enter can be replayed; the named keys are kept.
  - "Akshat reviews: executor press".

---

### Task 4: Steps keep what capture saw; keys become presses; Enter that sends (spec 2.8, Checkpoint 1)

`normalise` ignores every fact Plan 1 added: what a click did, its list place, its cell, where it landed, the tab it
opened. It also drops every key except Enter and Escape. Checkpoint 1 also showed that Enter in a sheet's cell reads
`emptied: true`, which is not a message sent.

**Files:**
- Modify: `packages/core/src/trace.ts` (`back`), `packages/core/src/trace.test.ts`
- Modify: `apps/extension/src/background.ts` (`webNavigation.onCommitted`: Back/Forward)
- Modify: `packages/recorder/src/normalise.ts`, `packages/recorder/src/skeleton.ts` (`press`)
- Create: `packages/recorder/src/normalise.test.ts`

**Interfaces:**
- Produces, on `NormalisedStep`:
  - `effect?: Effect`, `list?: ListPosition`, `cell?: Cell`, `point?: Point`
  - `opensTab?: number`, `sends?: boolean`, `back?: boolean`
  - `press` steps for single keys and shortcuts, with `modifiers`.
- Skeleton: `web.press {key, modifiers?}`. An Enter that sends gets `requires_approval: true`.
- Consumed by Tasks 5–14.

- [ ] **Step 1: Write the failing tests** `packages/recorder/src/normalise.test.ts`:

```ts
import type { ElementDescriptor, TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { normalise } from "./normalise.ts";
import { skeletonOf } from "./skeleton.ts";

const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const SHEET = "https://docs.google.com/spreadsheets/d/ID/edit#gid=0";
let n = 0;
const ev = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${++n}`,
  sessionId: "s",
  at,
  event,
  tabId: 1,
  frameId: 0,
  url: MAIL,
  ...extra,
});
const el = (role: string, name: string, extra: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  tag: role === "link" ? "a" : "div",
  url: MAIL,
  role,
  name,
  fallbacks: [],
  selectors: { css: `[aria-label='${name}']` },
  ...extra,
});
const start = () => ev("navigate", 0, { transition: "typed" });

describe("steps keep what capture saw", () => {
  it("keeps what a click did, where it sat in a list and where it landed", () => {
    const list = {
      container: { tag: "table", url: MAIL, fallbacks: [], selectors: {} },
      index: 0,
      count: 50,
      itemText: "Daily KPIs - w/c 19 Oct",
    };
    const point = { x: 10, y: 20, dpr: 2, box: { x: 0, y: 10, w: 100, h: 20 } };
    const steps = normalise([
      start(),
      ev("click", 1_000, { target: el("link", "Daily KPIs - w/c 19 Oct"), cid: "c1", list, point }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "large", navigated: true } }),
    ]);
    expect(steps.at(-1)).toMatchObject({
      kind: "click",
      effect: { changed: "large", navigated: true },
      list: { index: 0, count: 50 },
      point: { x: 10, dpr: 2 },
    });
  });

  it("says which tab a click opened", () => {
    const steps = normalise([
      start(),
      ev("click", 1_000, { target: el("link", "Product Engineer"), cid: "c2" }),
      ev("tab_open", 1_020, { tabId: 2, openerTabId: 1, url: "" }),
      ev("navigate", 1_500, { tabId: 2, url: "https://www.ycombinator.com/companies/x/jobs/1", transition: "link" }),
    ]);
    expect(steps.find((s) => s.kind === "click")).toMatchObject({ opensTab: 2 });
  });

  it("turns single keys and shortcuts into presses with their modifiers", () => {
    const steps = normalise([
      start(),
      ev("key", 2_000, { value: "e", target: el("main", "Inbox") }),
      ev("key", 4_000, { value: "Enter", modifiers: ["cmd"], target: el("textbox", "Message body") }),
    ]);
    expect(steps.filter((s) => s.kind === "press").map((s) => [s.value, s.modifiers])).toEqual([
      ["e", undefined],
      ["Enter", ["cmd"]],
    ]);
    const presses = skeletonOf(steps).draft.steps.filter((s) => s.action === "press");
    expect(presses.map((s) => s.args)).toEqual([{ key: "e" }, { key: "Enter", modifiers: ["cmd"] }]);
  });

  it("makes an Enter that emptied a chat box a send that needs your OK, but not Enter in a sheet's cell", () => {
    const sent = normalise([
      start(),
      ev("key", 1_000, { value: "Enter", target: el("textbox", "Message"), cid: "k1" }),
      ev("effect", 1_700, { of: "k1", effect: { changed: "small", emptied: true } }),
    ]);
    expect(sent.at(-1)).toMatchObject({ kind: "press", sends: true });
    expect(skeletonOf(sent).draft.steps.at(-1)).toMatchObject({ action: "press", requires_approval: true });
    const cell = normalise([
      ev("navigate", 0, { url: SHEET, transition: "typed" }),
      ev("key", 1_000, { url: SHEET, value: "Enter", target: el("textbox", "A4", { url: SHEET }), cid: "k2" }),
      ev("effect", 1_700, { url: SHEET, of: "k2", effect: { changed: "small", emptied: true } }),
    ]);
    expect(cell.at(-1)?.sends).toBeUndefined();
    expect(skeletonOf(cell).draft.steps.at(-1)).toMatchObject({ action: "press", requires_approval: false });
  });

  it("keeps a Back", () => {
    const steps = normalise([
      start(),
      ev("navigate", 9_000, { url: "https://example.com/list", transition: "link", back: true }),
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: "navigate", back: true });
  });
});
```

  - In `packages/core/src/trace.test.ts`, add an assertion that `TraceEvent.parse({...a navigate..., back: true}).back`
    is `true`.

- [ ] **Step 2: Run them.** `corepack pnpm vitest run packages/recorder/src/normalise.test.ts packages/core/src/trace.test.ts`.
  Expected: FAIL (no `effect` on the step, keys dropped, `back` stripped).

- [ ] **Step 3: Trace and capture.**
  - `packages/core/src/trace.ts`, after `transition`:

```ts
  // navigate: the browser's Back or Forward (webNavigation's forward_back qualifier).
  back: z.boolean().optional(),
```

  - `apps/extension/src/background.ts`, in `webNavigation.onCommitted`'s `record({...})`, add:

```ts
...(nav.transitionQualifiers.includes("forward_back") ? { back: true } : {}),
```

- [ ] **Step 4: `normalise.ts`.**
  - Import `type Cell, type Effect, type ListPosition, type Point` from `@shadow/core`.
  - Add to `NormalisedStep`, after `navigatesTo`:

```ts
  // What capture saw (spec 1.3, 1.4, 1.10, 1.11): what the click or key did in the 700 ms after it, the item of a list
  // it was in, the sheet cell, and where the pointer landed. Absent in recordings made before Oct 20.
  effect?: Effect;
  list?: ListPosition;
  cell?: Cell;
  point?: Point;
  // This click opened a new tab (that tab's id).
  opensTab?: number;
  // An Enter that emptied the field it was pressed in: a chat message sent (spec 2.8). Needs your OK at run time.
  sends?: boolean;
  // The browser's Back or Forward.
  back?: boolean;
```

  - Module constants:

```ts
// Google's drawn editors: a cell editor empties on Enter (it only moves to the next cell), and is not a chat box.
const CANVAS_EDITORS = /^https:\/\/docs\.google\.com\/(spreadsheets|document|presentation)\//;
const OPENS_TAB_MS = 2_000; // a tab opened this soon after a click, naming its tab as opener, was opened by it
```

  - At the start of `normalise`, after the events are sorted:

```ts
  // What each click or key did: capture's effect events point back at it by cid (spec 1.3).
  const effects = new Map<string, Effect>();
  for (const e of events) if (e.event === "effect" && e.of && e.effect) effects.set(e.of, e.effect);
  // Tabs opened by a click: their tab_open names the tab it came from.
  const openedTabs = events.filter((e) => e.event === "tab_open" && e.openerTabId !== undefined);
  const opensTab = (e: TraceEvent) => {
    const tab = openedTabs.find((o) => o.openerTabId === e.tabId && o.at >= e.at && o.at - e.at <= OPENS_TAB_MS);
    return tab?.tabId !== undefined ? { opensTab: tab.tabId } : {};
  };
```

  - `base(e)` adds:

```ts
    ...(e.cid && effects.has(e.cid) ? { effect: effects.get(e.cid) } : {}),
    ...(e.list ? { list: e.list } : {}),
    ...(e.cell ? { cell: e.cell } : {}),
    ...(e.point ? { point: e.point } : {}),
```

  - In `case "click"`, the push becomes `steps.push({ ...base(e), drawn: e.drawn, ...opensTab(e) })`.
  - In `case "navigate"`, the push of a new navigate step adds `...(e.back ? { back: true } : {})`.
  - `case "key"` becomes:

```ts
      case "key": {
        // Enter and Escape, single keys outside a field (Gmail's e) and shortcuts (⌘Enter): capture already kept
        // typing out (spec 1.8).
        const named = e.value === "Enter" || e.value === "Escape";
        const shortcut = (e.modifiers?.length ?? 0) > 0 || [...(e.value ?? "")].length === 1;
        if (!e.value || (!named && !shortcut)) break;
        const sends =
          e.value === "Enter" && Boolean(effects.get(e.cid ?? "")?.emptied) && !CANVAS_EDITORS.test(e.url ?? "");
        steps.push({
          ...base(e),
          kind: "press",
          value: e.value,
          ...(e.modifiers?.length ? { modifiers: e.modifiers } : {}),
          ...(sends ? { sends: true } : {}),
        });
        break;
      }
```

  - `isMeaningfulClick`: a click with `opensTab !== undefined` is kept, like one with `navigatesTo`.

- [ ] **Step 5: `skeleton.ts`.** The `press` case's step gets:
  - `args: { key: step.value, ...(step.modifiers?.length ? { modifiers: step.modifiers } : {}) }`;
  - `requires_approval: isRisky(step) || step.sends === true`;
  - when `step.sends`, intent `Send the message (Enter)`.

- [ ] **Step 6: Run them.** Same command, then `corepack pnpm -s test`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(recorder): steps keep what capture saw; keys are steps; Enter that sends needs your OK`.
  - Bullets:
    - effect, list place, cell, click point and opened tab on each step;
    - single keys and shortcuts become presses with modifiers;
    - an Enter that empties a chat box needs approval (not a sheet's cell);
    - Back is recorded.

---

### Task 5: Noise is removed and listed; selecting then copying is one read (spec 2.2, 2.3)

Today `normalise` keeps clicks that changed nothing, keeps the first click of a double-click, and drops some steps
silently (drawn clicks, focus clicks). The agent can neither see nor restore any of those.

**Files:**
- Modify: `packages/recorder/src/normalise.ts`, `packages/recorder/src/normalise.test.ts`, `packages/recorder/src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface Noise {
  events: string[]; // the trace events it was
  at: number;
  tabId?: number;
  what: string; // `clicked "Print all"`, `selected "fluctuations"`
  why: string; // one plain reason
  step?: Omit<NormalisedStep, "index">; // the step it would have been: Plan 3's restore puts it back
}
export function normaliseAll(trace: TraceEvent[]): { steps: NormalisedStep[]; noise: Noise[] };
```

- `normalise(trace)` keeps its signature and returns `normaliseAll(trace).steps`.
- The reasons, exactly (tests and the timeline use them):
  - `NOISE.selected = "selected text but didn't copy it"`
  - `NOISE.quiet = "changed nothing on the page, and nothing was copied from it"`
  - `NOISE.switched = "switched to a tab and away again without doing anything there"`
  - `NOISE.afterKeys = "the page clicked it after the keys you pressed"`
  - `NOISE.byPage = "the page's own code clicked it, not you"`
  - `NOISE.drawn = "a click on a drawn grid: its cell goes with the copy or typing after it"`
  - `NOISE.focus = "only put the cursor in a field: the typing after it is the step"`
  - `NOISE.nameless = "nothing to find it by again"`

- [ ] **Step 1: Write the failing tests.** Append to `packages/recorder/src/normalise.test.ts` (and add `normaliseAll`
  to its import):

```ts
describe("noise, removed and listed with its reason (spec 2.2)", () => {
  const p = { tag: "p", url: MAIL, text: "GDP fluctuates", fallbacks: [], selectors: { css: "#intro" } };
  const header = { tag: "div", url: MAIL, text: "Print all In new window", fallbacks: [], selectors: { css: "#h" } };
  const body = { tag: "body", url: MAIL, fallbacks: [], selectors: {} };

  it("makes a double click and the copy after it one read step", () => {
    const { steps, noise } = normaliseAll([
      start(),
      ev("click", 1_000, { target: p, cid: "c1" }),
      ev("select_text", 1_010, { target: p, value: "fluctuations" }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "none" } }),
      ev("copy", 3_000, { target: p, value: "fluctuations", via: "keyboard" }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "copy"]);
    expect(steps[1]?.events).toHaveLength(3);
    expect(noise).toEqual([]);
  });

  it("lists a selection never copied, with the double click that made it", () => {
    const { steps, noise } = normaliseAll([
      start(),
      ev("click", 1_000, { target: p, cid: "c1" }),
      ev("select_text", 1_010, { target: p, value: "fluctuations" }),
      ev("click", 5_000, { target: el("button", "Save"), cid: "c2" }),
      ev("effect", 5_700, { of: "c2", effect: { changed: "small" } }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "click"]);
    expect(noise).toMatchObject([{ events: [expect.any(String), expect.any(String)], why: "selected text but didn't copy it" }]);
  });

  it("lists a click that changed nothing (Gmail's header), unless the next action came too soon to tell", () => {
    const quiet = normaliseAll([
      start(),
      ev("click", 1_000, { target: header, cid: "c1" }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "none" } }),
      ev("click", 6_000, { target: el("button", "Archive"), cid: "c2" }),
      ev("effect", 6_700, { of: "c2", effect: { changed: "large" } }),
    ]);
    expect(quiet.steps.map((s) => s.target?.name ?? s.kind)).toEqual(["navigate", "Archive"]);
    expect(quiet.noise).toMatchObject([{ why: "changed nothing on the page, and nothing was copied from it" }]);
    const soon = normaliseAll([
      start(),
      ev("click", 1_000, { target: header, cid: "c1" }),
      ev("effect", 1_700, { of: "c1", effect: { changed: "none" } }),
      ev("click", 1_300, { target: el("button", "Archive"), cid: "c2" }),
    ]);
    expect(soon.steps).toHaveLength(3);
  });

  it("keeps a click with no recorded effect (an older recording)", () => {
    const { steps, noise } = normaliseAll([start(), ev("click", 1_000, { target: header })]);
    expect(steps).toHaveLength(2);
    expect(noise).toEqual([]);
  });

  it("lists switching to a tab and away without doing anything there", () => {
    const { noise } = normaliseAll([
      start(),
      ev("tab_switch", 1_000, { tabId: 2 }),
      ev("tab_switch", 2_000, { tabId: 1 }),
      ev("click", 3_000, { target: el("button", "Save") }),
    ]);
    expect(noise).toMatchObject([{ why: "switched to a tab and away again without doing anything there" }]);
  });

  it("lists the click a page made after your keys (GitHub's g i); the keys are the steps", () => {
    const { steps, noise } = normaliseAll([
      start(),
      ev("key", 1_000, { value: "g", target: body }),
      ev("key", 1_300, { value: "i", target: body }),
      ev("click", 1_320, { target: el("link", "Issues"), synthetic: true }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "press", "press"]);
    expect(noise).toMatchObject([{ why: "the page clicked it after the keys you pressed" }]);
  });

  it("lists what was dropped quietly before: a drawn click and a click that only focused a field", () => {
    const grid = { tag: "div", url: SHEET, fallbacks: [], selectors: {} };
    const { noise } = normaliseAll([
      ev("navigate", 0, { url: SHEET, transition: "typed" }),
      ev("click", 1_000, { url: SHEET, target: grid, drawn: true, cell: { ref: "C3" } }),
      ev("click", 4_000, { target: el("textbox", "Search mail") }),
    ]);
    expect(noise.map((x) => x.why)).toEqual([
      "a click on a drawn grid: its cell goes with the copy or typing after it",
      "only put the cursor in a field: the typing after it is the step",
    ]);
  });
});
```

- [ ] **Step 2: Run them.** `corepack pnpm vitest run packages/recorder/src/normalise.test.ts`. Expected: FAIL, no
  `normaliseAll`.

- [ ] **Step 3: Implement in `normalise.ts`.**
  - Export `Noise` (above) and:

```ts
export const NOISE = {
  selected: "selected text but didn't copy it",
  quiet: "changed nothing on the page, and nothing was copied from it",
  switched: "switched to a tab and away again without doing anything there",
  afterKeys: "the page clicked it after the keys you pressed",
  byPage: "the page's own code clicked it, not you",
  drawn: "a click on a drawn grid: its cell goes with the copy or typing after it",
  focus: "only put the cursor in a field: the typing after it is the step",
  nameless: "nothing to find it by again",
} as const;
const WATCH_MS = 700; // capture watches a click this long; a next action sooner mixes their effects
const STEP_EVENTS = new Set(["click", "type", "select", "check", "file", "drop", "drag", "key", "navigate"]);
const labelOf = (t?: ElementDescriptor) => (t?.name ?? t?.label ?? t?.text ?? t?.tag ?? "").slice(0, 40);
```

  - Rename `normalise` to `normaliseAll`, returning `{ steps, noise }`, and add:

```ts
export function normalise(trace: TraceEvent[]): NormalisedStep[] {
  return normaliseAll(trace).steps;
}
```

  - Inside, next to `steps`:

```ts
  const noise: Noise[] = [];
  const drop = (events: string[], at: number, tabId: number | undefined, what: string, why: string, step?: Draft) =>
    noise.push({ events, at, ...(tabId !== undefined ? { tabId } : {}), what, why, ...(step ? { step } : {}) });
  // Selected text waits for its copy (one read step); the click that made a double-click selection goes with it.
  let selection: { e: TraceEvent; clicks: string[] } | undefined;
  const settleSelection = () => {
    if (selection) {
      const { e, clicks } = selection;
      drop([...clicks, e.id], e.at, e.tabId, `selected "${(e.value ?? "").slice(0, 40)}"`, NOISE.selected);
    }
    selection = undefined;
  };
```

  - At the top of the event loop: `if (selection && STEP_EVENTS.has(e.event)) settleSelection();`
  - A new case:

```ts
      case "select_text": {
        settleSelection();
        const prev = last();
        const clicks =
          prev?.kind === "click" && sameTarget(prev.target, e.target) && e.at - prev.at < 600
            ? (steps.pop()?.events ?? [])
            : [];
        selection = { e, clicks };
        break;
      }
```

  - In `case "copy"`, after the secret/empty check:

```ts
        const selected =
          selection && selection.e.tabId === e.tabId && e.at - selection.e.at <= 10_000
            ? [...selection.clicks, selection.e.id]
            : [];
        if (selected.length > 0) selection = undefined;
```

    The copy step's `events` start with `...selected`.
  - In `case "click"`, first:

```ts
        if (e.synthetic && !(e.target?.tag === "input" && e.target.attrs?.type === "file")) {
          const prev = last();
          const why = prev?.kind === "press" && e.at - prev.at < 1_000 ? NOISE.afterKeys : NOISE.byPage;
          drop([e.id], e.at, e.tabId, `clicked "${labelOf(e.target)}"`, why);
          break;
        }
```

  - After the loop: `settleSelection();`
  - In the post-pass:
    - A drawn click that is dropped is also `drop(step.events, step.at, step.tabId, "a click on a drawn grid", NOISE.drawn, step)`.
    - A click that fails `isMeaningfulClick`: reason `NOISE.focus` when its role is in `FOCUS_ONLY_ROLES`, else
      `NOISE.nameless`.
    - **New, before `isMeaningfulClick`.** A click is quiet when all of these hold:
      - `effect?.changed === "none"`;
      - no `navigated`, `expanded` or `opened` in its effect;
      - no `navigatesTo`, `submits`, `checked` or `opensTab`;
      - the next step starts `WATCH_MS` or more after it.

      A quiet click is dropped with `NOISE.quiet` and `` `clicked "${labelOf(step.target)}"` ``.
  - Tab switches, after the post-pass (they never become steps; this lists the idle ones):

```ts
  const switches = events.filter((e) => e.event === "tab_switch");
  switches.forEach((sw, i) => {
    const until = switches[i + 1]?.at ?? Number.POSITIVE_INFINITY;
    const used = kept.some((s) => s.tabId === sw.tabId && s.at >= sw.at && s.at < until);
    if (!used) drop([sw.id], sw.at, sw.tabId, "switched tabs", NOISE.switched);
  });
```

    (`kept` is the final step list).
  - Return `{ steps: kept, noise: noise.sort((a, b) => a.at - b.at) }`.
  - `index.ts` exports `type Noise`, `NOISE` and `normaliseAll`.

- [ ] **Step 4: Run them.** The test, then `corepack pnpm -s test` (the recorder, design and e2e tests must stay
  green). Expected: PASS.
- [ ] **Step 5: Commit** `feat(recorder): noise is removed and listed with a reason; select then copy is one read`.
  - Bullets: quiet clicks, unused selections, idle tab switches, clicks made by the page, drawn and focus clicks listed;
    a double-click selection and its copy are one step.

---

### Task 6: What each step did: act, go, reveal or read (spec 2.1)

**Files:**
- Create: `packages/recorder/src/evidence/classes.ts`, `packages/recorder/src/evidence/classes.test.ts`

**Interfaces:**
- Produces: `type StepClass = "act" | "go" | "reveal" | "read"`; `classOf(step: NormalisedStep): StepClass`.
- Noise is not a class here: it never reaches the step list (Task 5 lists it).

- [ ] **Step 1: Write the failing test** `packages/recorder/src/evidence/classes.test.ts`:

```ts
import type { ElementDescriptor } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { classOf } from "./classes.ts";

const PAGE = "https://mail.google.com/mail/u/0/#inbox";
const target = (role: string): ElementDescriptor => ({ tag: "div", url: PAGE, role, name: "x", fallbacks: [], selectors: {} });
const step = (kind: NormalisedStep["kind"], extra: Partial<NormalisedStep> = {}): NormalisedStep => ({
  index: 0,
  kind,
  at: 0,
  url: PAGE,
  events: ["e1"],
  ...extra,
});

describe("what a step did", () => {
  it("goes somewhere: a page opened, a link followed, a tab opened", () => {
    expect(classOf(step("navigate"))).toBe("go");
    expect(classOf(step("click", { target: target("link"), navigatesTo: "https://x.test/a" }))).toBe("go");
    expect(classOf(step("click", { target: target("link"), opensTab: 2 }))).toBe("go");
    expect(classOf(step("click", { target: target("link"), effect: { changed: "large", navigated: true } }))).toBe("go");
    expect(classOf(step("click", { target: target("link") }))).toBe("go"); // an older recording: no effect kept
  });

  it("reveals something: a menu, an expanded section, an opened email that stays on the page", () => {
    expect(classOf(step("click", { target: target("button"), effect: { changed: "small", expanded: true } }))).toBe("reveal");
    expect(classOf(step("click", { target: target("gridcell"), effect: { changed: "large" } }))).toBe("reveal");
  });

  it("acts: types, presses, submits, and clicks a button that changed the page", () => {
    expect(classOf(step("type", { value: "20 Oct" }))).toBe("act");
    expect(classOf(step("press", { value: "Enter", sends: true }))).toBe("act");
    expect(classOf(step("click", { target: target("button"), effect: { changed: "small" } }))).toBe("act");
    expect(classOf(step("click", { target: target("button"), submits: true }))).toBe("act");
  });

  it("reads: a copy", () => {
    expect(classOf(step("copy", { value: "1,234" }))).toBe("read");
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/evidence/classes.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/recorder/src/evidence/classes.ts`.**

```ts
// What a recorded step did (spec 2.1), for the agent and the review: went somewhere, showed something, changed
// something, or read something. Noise never reaches here: normaliseAll lists it apart.
import type { NormalisedStep } from "../normalise.ts";

export type StepClass = "act" | "go" | "reveal" | "read";

// Controls whose click changes something: a button, a menu item, a choice.
const ACTING_ROLES = new Set([
  "button",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "checkbox",
  "radio",
  "switch",
]);

export function classOf(step: NormalisedStep): StepClass {
  switch (step.kind) {
    case "navigate":
    case "app_open":
      return "go";
    case "copy":
      return "read";
    case "click":
    case "press": {
      if (step.navigatesTo || step.opensTab !== undefined || step.effect?.navigated) return "go";
      if (step.submits || step.checked !== undefined || step.sends || step.kind === "press") return "act";
      if (step.effect?.expanded || step.effect?.opened) return "reveal";
      const role = step.target?.role ?? "";
      if (ACTING_ROLES.has(role)) return "act";
      // An older recording kept no effect: a link went somewhere.
      if (role === "link" && !step.effect) return "go";
      return "reveal";
    }
    default:
      return "act";
  }
}
```

- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(evidence): each step is classed by what it did`.
  - Bullet: go, reveal, act and read, from the click's effect and role; older recordings are classed by role.

---

### Task 7: Tabs named from their pages (spec 2.4)

**Files:**
- Create: `packages/recorder/src/evidence/tabs.ts`, `packages/recorder/src/evidence/tabs.test.ts`

**Interfaces:**
- Produces:
  - `interface TabInfo { id: number; name: string; firstUrl?: string; preexisting?: boolean; openedBy?: number; windowId?: number }`;
  - `tabName(title?: string, url?: string): string`;
  - `tabsOf(trace: TraceEvent[], steps: NormalisedStep[]): { tabs: TabInfo[]; nameOf(tabId?: number): string | undefined }`.
- Only tabs a step happened in are listed.

- [ ] **Step 1: Write the failing test** `packages/recorder/src/evidence/tabs.test.ts`:

```ts
import type { TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { tabName, tabsOf } from "./tabs.ts";

const ev = (event: TraceEvent["event"], tabId: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `t${tabId}-${event}`,
  sessionId: "s",
  at: tabId,
  event,
  tabId,
  ...extra,
});
const at = (tabId: number): NormalisedStep => ({ index: 0, kind: "click", at: 10, tabId, events: [] });

describe("tab names", () => {
  it("takes the title's own part, not the site, a mail count or an address", () => {
    expect(tabName("Shadow checkpoint 1 test - Google Sheets")).toBe("Shadow checkpoint 1 test");
    expect(tabName("(298) - rushil@example.com - Searce Mail")).toBe("Searce Mail");
    expect(tabName("Find the best startup jobs and remote jobs curated by Y Combinator. | Y Combinator")).toBe(
      "Y Combinator",
    );
    expect(tabName(undefined, "https://www.ycombinator.com/jobs")).toBe("ycombinator.com");
  });

  it("lists the tabs used, with how each was opened, and tells two of the same name apart", () => {
    const trace = [
      ev("tab_open", 1, { title: "Inbox (3) - Searce Mail", url: "https://mail.google.com/mail/u/0/#inbox", preexisting: true }),
      ev("tab_open", 2, { title: "Inbox (3) - Searce Mail", url: "https://mail.google.com/mail/u/1/#inbox", openerTabId: 1 }),
      ev("tab_open", 3, { title: "Unused", url: "https://example.com" }),
    ];
    const { tabs, nameOf } = tabsOf(trace, [at(1), at(2)]);
    expect(tabs.map((t) => [t.id, t.name, t.preexisting, t.openedBy])).toEqual([
      [1, "Searce Mail", true, undefined],
      [2, "Searce Mail (2)", undefined, 1],
    ]);
    expect(nameOf(2)).toBe("Searce Mail (2)");
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/evidence/tabs.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/recorder/src/evidence/tabs.ts`.**

```ts
// The tabs of a recording (spec 2.4), each named from its page so the agent and the review can say "in KPI Sheet":
// the title's own part (not a mail count or an address), the site name when the first part is long, else the site's
// host. Two tabs of one name get a number; their first addresses tell them apart.
import type { TraceEvent } from "@shadow/core";
import type { NormalisedStep } from "../normalise.ts";

export interface TabInfo {
  id: number;
  name: string;
  firstUrl?: string;
  preexisting?: boolean;
  openedBy?: number;
  windowId?: number;
}

const SEPARATOR = /\s+[-–|·]\s+/;
const COUNTER = /^(\w+\s)?\(\d+\)$/; // "(298)", "Inbox (3)"
const ADDRESS = /^\S+@\S+$/;
const NAME_MAX = 40;

export function tabName(title?: string, url?: string): string {
  const parts = (title ?? "")
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p && !COUNTER.test(p) && !ADDRESS.test(p));
  const first = parts[0];
  const lastPart = parts.at(-1);
  if (first && first.length <= NAME_MAX) return first;
  if (lastPart && lastPart.length <= NAME_MAX) return lastPart;
  if (first) return `${first.slice(0, NAME_MAX - 1)}…`;
  try {
    return new URL(url ?? "").host.replace(/^www\./, "") || "a tab";
  } catch {
    return "a tab";
  }
}

export function tabsOf(
  trace: TraceEvent[],
  steps: NormalisedStep[],
): { tabs: TabInfo[]; nameOf: (tabId?: number) => string | undefined } {
  const seen = new Map<number, TabInfo & { title?: string }>();
  for (const e of [...trace].sort((a, b) => a.at - b.at)) {
    if (e.tabId === undefined) continue;
    const tab = seen.get(e.tabId) ?? { id: e.tabId, name: "" };
    const url = e.url && /^(https?|file):/.test(e.url) ? e.url : undefined;
    if (e.event === "tab_open") {
      tab.title ??= e.title;
      if (e.preexisting) tab.preexisting = true;
      if (e.openerTabId !== undefined) tab.openedBy ??= e.openerTabId;
      if (e.windowId !== undefined) tab.windowId ??= e.windowId;
    }
    tab.firstUrl ??= url;
    seen.set(e.tabId, tab);
  }
  const used = new Set(steps.map((s) => s.tabId));
  const list = [...seen.values()].filter((t) => used.has(t.id));
  for (const tab of list) tab.name = tabName(tab.title, tab.firstUrl);
  const counts = new Map<string, number>();
  for (const tab of list) {
    const n = (counts.get(tab.name) ?? 0) + 1;
    counts.set(tab.name, n);
    if (n > 1) tab.name = `${tab.name} (${n})`;
  }
  const tabs = list.map(({ title: _title, ...t }) => t);
  return { tabs, nameOf: (id) => tabs.find((t) => t.id === id)?.name };
}
```

- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(evidence): tabs are named from their pages`.
  - Bullet: only the tabs used are listed, with opener, whether open before Record, first address; twins numbered.

---

### Task 8: What each step saw: words near the click, what appeared (spec 1.17–1.19, 1.10)

Checkpoint 1 showed that a click's own picture is often taken after the page changed: the Japan link's picture shows
the next page. So the words near the click come from the tab's picture *before* the step. What appeared is the tab's
last picture before the next step, minus the picture before.

**Files:**
- Create: `packages/recorder/src/evidence/screens.ts`, `packages/recorder/src/evidence/screens.test.ts`

**Interfaces:**
- Produces:
  - `interface Picture { eventId: string; at: number; tabId?: number; lines: Line[] }` (a `screen.jsonl` line);
  - `interface StepScreen { before?: string; after?: string; near: string[]; appeared: string[] }` (`before`/`after`
    are picture event ids);
  - `screensOf(steps: NormalisedStep[], pictures: Picture[], trace: TraceEvent[]): StepScreen[]`.
- Boxes are picture pixels; a click point is CSS px, so it is multiplied by `dpr` (checked on Checkpoint 1's
  Wikipedia recording).

- [ ] **Step 1: Write the failing test** `packages/recorder/src/evidence/screens.test.ts`:

```ts
import type { TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { type Picture, screensOf } from "./screens.ts";

const line = (text: string, x: number, y: number) => ({ text, box: { x, y, w: 60, h: 30 } });
const picture = (eventId: string, at: number, texts: [string, number, number][], tabId = 1): Picture => ({
  eventId,
  at,
  tabId,
  lines: texts.map(([t, x, y]) => line(t, x, y)),
});

describe("what a step saw", () => {
  const save: NormalisedStep = {
    index: 1,
    kind: "click",
    at: 1_000,
    tabId: 1,
    events: ["c1"],
    point: { x: 238, y: 90, dpr: 2, box: { x: 215, y: 80, w: 46, h: 22 } },
    target: { tag: "button", url: "", role: "button", name: "Save", fallbacks: [], selectors: {} },
  };
  const before = picture("p0", 900, [["Amount", 30, 170], ["Save", 450, 168], ["New expense", 20, 60]]);
  const after = picture("c1", 1_000, [["Amount", 30, 170], ["Save", 450, 168], ["Saved amount 1,234", 20, 240]]);
  const elsewhere = picture("p9", 950, [["Inbox", 10, 10]], 2);

  it("finds the words near the click in the picture before it, and what appeared after it", () => {
    const [screen] = screensOf([save], [after, before, elsewhere], [] as TraceEvent[]);
    expect(screen).toMatchObject({ before: "p0", after: "c1", appeared: ["Saved amount 1,234"] });
    expect(screen?.near[0]).toBe("Save");
  });

  it("finds nothing when there were no pictures", () => {
    expect(screensOf([save], [], [])).toEqual([{ near: [], appeared: [] }]);
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/evidence/screens.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/recorder/src/evidence/screens.ts`.**

```ts
// What each step saw (spec 1.10, 1.17–1.19).
// - The words near where it clicked, from its tab's picture before it: a click's own picture is often taken after the
//   page changed (Checkpoint 1: the Japan link's picture shows the next page).
// - What appeared: lines in the tab's last picture before the next step that weren't in the picture before. Only these
//   may become checks (Plan 3's finish gate).
// Picture boxes are in picture pixels; a click point is in CSS pixels with its device pixel ratio.
import type { TraceEvent } from "@shadow/core";
import type { Line } from "../mask.ts";
import type { NormalisedStep } from "../normalise.ts";

export interface Picture {
  eventId: string;
  at: number;
  tabId?: number;
  lines: Line[];
}
export interface StepScreen {
  before?: string;
  after?: string;
  near: string[];
  appeared: string[];
}

const NEAR_LINES = 6;
const APPEARED_LINES = 12;
const NEAR_CSS_PX = 150;
const clean = (t: string) => t.replace(/\s+/g, " ").trim();
const useful = (t: string) => t.length >= 2 && !/^[█\s]+$/.test(t);

export function screensOf(steps: NormalisedStep[], pictures: Picture[], trace: TraceEvent[]): StepScreen[] {
  const tabOfEvent = new Map(trace.map((e) => [e.id, e.tabId]));
  const shots = pictures
    .map((p) => ({ ...p, tabId: p.tabId ?? tabOfEvent.get(p.eventId) }))
    .sort((a, b) => a.at - b.at);
  return steps.map((step, i) => {
    const mine = new Set(step.events);
    const nextAt = steps[i + 1]?.at ?? Number.POSITIVE_INFINITY;
    const tab = shots.filter((s) => step.tabId === undefined || s.tabId === step.tabId);
    const before = tab.filter((s) => s.at < step.at && !mine.has(s.eventId)).at(-1);
    const after = tab.filter((s) => (s.at >= step.at || mine.has(s.eventId)) && s.at < nextAt).at(-1);
    const seen = new Set((before?.lines ?? []).map((l) => clean(l.text)));
    const appeared = after
      ? [...new Set(after.lines.map((l) => clean(l.text)))]
          .filter((t) => useful(t) && !seen.has(t))
          .slice(0, APPEARED_LINES)
          .map((t) => t.slice(0, 120))
      : [];
    return {
      ...(before ? { before: before.eventId } : {}),
      ...(after ? { after: after.eventId } : {}),
      near: nearLines(step, before ?? after),
      appeared,
    };
  });
}

function nearLines(step: NormalisedStep, picture?: Picture): string[] {
  if (!picture) return [];
  const lines = picture.lines.filter((l) => useful(clean(l.text)));
  if (step.point) {
    const { x, y, dpr } = step.point;
    const px = x * dpr;
    const py = y * dpr;
    const away = (l: Line) =>
      Math.hypot(Math.max(l.box.x - px, 0, px - (l.box.x + l.box.w)), Math.max(l.box.y - py, 0, py - (l.box.y + l.box.h)));
    return lines
      .map((l) => ({ text: clean(l.text).slice(0, 120), d: away(l) }))
      .filter(({ d }) => d <= NEAR_CSS_PX * dpr)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEAR_LINES)
      .map(({ text }) => text);
  }
  const words = [step.target?.name, step.target?.text, step.value]
    .filter((w): w is string => Boolean(w && w.length >= 3))
    .map((w) => w.toLowerCase().slice(0, 40));
  if (words.length === 0) return [];
  return lines
    .filter((l) => words.some((w) => l.text.toLowerCase().includes(w)))
    .slice(0, NEAR_LINES)
    .map((l) => clean(l.text).slice(0, 120));
}
```

- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(evidence): the words near each click, and what appeared after it`.
  - Bullet: from the tab's pictures before and after the step; the click point scaled to picture pixels.

---

### Task 9: Where values go (spec 2.5)

**Files:**
- Create: `packages/recorder/src/evidence/flow.ts`, `packages/recorder/src/evidence/flow.test.ts`

**Interfaces:**
- Produces:
  - `interface Flow { from: string; to: string; how: "pasted" | "typed" | "used"; value?: string }` (draft step ids);
  - `flowOf(steps: NormalisedStep[], skill: Skill, idsByStep: string[][]): Flow[]`.

- [ ] **Step 1: Write the failing test** `packages/recorder/src/evidence/flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compile } from "../compile.ts";
import type { NormalisedStep } from "../normalise.ts";
import { flowOf } from "./flow.ts";

const PAGE = "http://localhost:5173/paste-form.html";
const target = (name: string) => ({ tag: "input", url: PAGE, role: "textbox", name, fallbacks: [], selectors: { css: `[name='${name}']` } });
let k = 0;
const step = (kind: NormalisedStep["kind"], extra: Partial<NormalisedStep>): NormalisedStep => ({
  index: k,
  kind,
  at: ++k * 1_000,
  tabId: 1,
  url: PAGE,
  events: [`e${k}`],
  ...extra,
});

describe("where values go", () => {
  it("follows a copy into the field it was pasted in, and into a field it was typed in again", async () => {
    const steps = [
      step("navigate", { events: [] }),
      step("copy", { value: "1,234", target: target("Total") }),
      step("type", { pasted: true, fromCopy: "e2", target: target("Amount") }),
      step("type", { value: "Total 1,234 for Oct", target: target("Note") }),
    ].map((s, index) => ({ ...s, index }));
    const { skill, base } = await compile(steps);
    const flows = flowOf(steps, skill, base.idsByStep);
    expect(flows).toEqual([
      { from: "s2", to: "s3", how: "pasted", value: "1,234" },
      { from: "s2", to: "s4", how: "typed", value: "1,234" },
    ]);
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/evidence/flow.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/recorder/src/evidence/flow.ts`.**

```ts
// Where values go (spec 2.5): a copy pasted later, a copied text typed again, a step's output used by a later step.
// By draft step ids, so the timeline, the proposals and the agent all name steps the same way (spec 2.9).
import { findRefs, isAction, isLlm, type Skill, walkSteps } from "@shadow/core";
import type { NormalisedStep } from "../normalise.ts";

export interface Flow {
  from: string;
  to: string;
  how: "pasted" | "typed" | "used";
  value?: string;
}

export function flowOf(steps: NormalisedStep[], skill: Skill, idsByStep: string[][]): Flow[] {
  const flows: Flow[] = [];
  const has = (from: string, to: string) => flows.some((f) => f.from === from && f.to === to);
  // A copy from a sheet is two draft steps (read the sheet, pick the value): the value comes from the last.
  const outOf = (i: number) => idsByStep[i]?.at(-1);
  const copies = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "copy");
  steps.forEach((s, i) => {
    if (s.kind !== "type" && s.kind !== "app_type") return;
    const to = idsByStep[i]?.[0];
    if (!to) return;
    if (s.fromCopy) {
      const copy = copies.find(({ s: c }) => c.events.includes(s.fromCopy as string));
      const from = copy && outOf(copy.i);
      if (from) flows.push({ from, to, how: "pasted", ...(copy.s.value ? { value: copy.s.value.slice(0, 80) } : {}) });
      return;
    }
    for (const { s: c, i: ci } of copies) {
      if (ci >= i || !c.value || c.value.length < 3 || !s.value?.includes(c.value)) continue;
      const from = outOf(ci);
      if (from && !has(from, to)) flows.push({ from, to, how: "typed", value: c.value.slice(0, 80) });
    }
  });
  const producer = new Map<string, string>();
  for (const { step } of walkSteps(skill.steps)) {
    const names = isAction(step)
      ? findRefs({ target: step.target, args: step.args }).map((r) => r.expr)
      : isLlm(step)
        ? step.inputs
        : [];
    for (const expr of names) {
      const from = producer.get(expr.replace(/[{}\s]/g, "").split(/[.|+-]/)[0] ?? "");
      if (from && from !== step.id && !has(from, step.id)) flows.push({ from, to: step.id, how: "used" });
    }
    if ((isAction(step) || isLlm(step)) && step.output) producer.set(step.output.name, step.id);
  }
  return flows;
}
```

- [ ] **Step 4: Run it.** Expected: PASS. (If the draft numbers the steps differently, read `base.idsByStep` and fix the
  expected ids. The rule is that `from` is the copy's last draft id and `to` the typing step's first.)
- [ ] **Step 5: Commit** `feat(evidence): where values go, by draft step id`.
  - Bullet: pasted, typed again, and an output used later.

---

### Task 10: Proposals: generalisations code finds, with the change prepared (spec 2.6)

**Files:**
- Create: `packages/recorder/src/evidence/proposals.ts`, `packages/recorder/src/evidence/proposals.test.ts`

**Interfaces:**
- Consumes: `Proposal` (Task 1), `formatDate`/`dateOf`/`DateRef` (Task 2), `classOf` (Task 6), the new step fields
  (Task 4).
- Produces:
  - `interface ProposalInput { steps: NormalisedStep[]; skill: Skill; idsByStep: string[][]; goal: string; said: { at: number; text: string }[]; recordedOn: Date }`;
  - `proposalsOf(input: ProposalInput): Proposal[]` (ids `p1`, `p2`… in the order date, open directly, list item,
    repeat, next empty row, all files, constant);
  - `dateIn(text: string, on: Date): { text: string; template: string; says: string } | undefined`.
- **Which proposals carry edits:**
  - `date` and `open_directly` carry `edits` that `applyEdits` accepts on the draft.
  - `list_item`, `repeat`, `all_files` and `constant` are notes (`edits: []`): the agent builds them with its tools.
  - `next_empty_row` is a note with `runnable: false`.

- [ ] **Step 1: Write the failing test** `packages/recorder/src/evidence/proposals.test.ts`:

```ts
import { applyEdits, findStep } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { compile } from "../compile.ts";
import type { NormalisedStep } from "../normalise.ts";
import { dateIn, proposalsOf } from "./proposals.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/DOC1/edit#gid=0";
const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const TUESDAY = new Date(2026, 9, 20, 10);
const el = (role: string, name: string, url = MAIL) => ({ tag: "div", url, role, name, fallbacks: [], selectors: { css: `[aria-label='${name}']` } });
let k = 0;
const step = (kind: NormalisedStep["kind"], extra: Partial<NormalisedStep>): NormalisedStep => ({
  index: 0,
  kind,
  at: ++k * 1_000,
  tabId: 1,
  url: MAIL,
  events: [`e${k}`],
  ...extra,
});
const indexed = (steps: NormalisedStep[]) => steps.map((s, index) => ({ ...s, index }));
async function propose(raw: NormalisedStep[], said: string[] = [], goal = "g") {
  const steps = indexed(raw);
  const { skill, base } = await compile(steps);
  const proposals = proposalsOf({
    steps,
    skill,
    idsByStep: base.idsByStep,
    goal,
    said: said.map((text, at) => ({ at, text })),
    recordedOn: TUESDAY,
  });
  return { skill, proposals };
}

describe("dates", () => {
  it("finds the recording day in what was typed, in the format typed", () => {
    expect(dateIn("20 Oct", TUESDAY)?.text).toBe("{{today|D MMM}}");
    expect(dateIn("Daily KPIs - w/c 19 Oct", TUESDAY)?.text).toBe("Daily KPIs - w/c {{week_start|D MMM}}");
    expect(dateIn("19 Oct", TUESDAY)?.text).toBe("{{today-1|D MMM}}");
    expect(dateIn("20/10/2026", TUESDAY)?.text).toBe("{{today|DD/MM/YYYY}}");
    expect(dateIn("12 Oct", TUESDAY)).toBeUndefined();
    expect(dateIn("120 Oct", TUESDAY)).toBeUndefined();
  });

  it("prepares the change to type today's date next time", async () => {
    const { skill, proposals } = await propose([
      step("navigate", { url: SHEET, events: [] }),
      step("type", { url: SHEET, value: "20 Oct", target: el("textbox", "A4", SHEET), cell: { ref: "A4" } }),
    ]);
    const date = proposals.find((p) => p.kind === "date");
    expect(date?.summary).toContain("{{today|D MMM}}");
    const applied = applyEdits(skill, date?.edits ?? []);
    expect(applied.ok && findStep(applied.skill, date?.steps[0] ?? "")).toMatchObject({ args: { text: "{{today|D MMM}}" } });
  });
});

describe("other generalisations", () => {
  it("notes a click on an item of a list, but not on a navigation bar", async () => {
    const list = (role: string) => ({
      container: { tag: "table", url: MAIL, role, fallbacks: [], selectors: { css: "table.F" } },
      index: 0,
      count: 50,
      itemText: "Daily KPIs",
    });
    const { proposals } = await propose([
      step("navigate", { events: [] }),
      step("click", { target: el("link", "Daily KPIs"), list: list("grid"), effect: { changed: "large" } }),
      step("click", { target: el("link", "Sent"), list: list("navigation"), navigatesTo: `${MAIL}/sent` }),
    ]);
    expect(proposals.filter((p) => p.kind === "list_item").map((p) => p.summary)).toEqual([
      expect.stringContaining("item 1 of 50"),
    ]);
  });

  it("notes typing into the first empty row of a sheet, which can't run yet", async () => {
    const { proposals } = await propose([
      step("navigate", { url: SHEET, events: [] }),
      step("copy", {
        url: SHEET,
        value: "1,234",
        context: { sheet: "https://docs.google.com/spreadsheets/d/DOC1/export?format=csv&gid=0", rows: 2 },
      }),
      step("type", { url: SHEET, value: "Lunch", target: el("textbox", "B4", SHEET), cell: { ref: "B4" } }),
    ]);
    expect(proposals.find((p) => p.kind === "next_empty_row")).toMatchObject({ runnable: false, edits: [] });
  });

  it("notes the same steps done for two items of a list", async () => {
    const item = (index: number) => ({
      container: { tag: "table", url: MAIL, role: "grid", fallbacks: [], selectors: { css: "table.F" } },
      index,
      count: 50,
    });
    const { proposals } = await propose([
      step("navigate", { events: [] }),
      step("click", { target: el("link", "KPIs Mon"), list: item(0), effect: { changed: "large" } }),
      step("copy", { value: "4928", target: el("cell", "Tickets") }),
      step("click", { target: el("link", "KPIs Tue"), list: item(1), effect: { changed: "large" } }),
      step("copy", { value: "5011", target: el("cell", "Tickets") }),
    ]);
    expect(proposals.find((p) => p.kind === "repeat")?.summary).toContain("2 times");
  });

  it("prepares opening a page directly instead of the clicks that reached it", async () => {
    const { skill, proposals } = await propose([
      step("navigate", { url: "https://drive.google.com/drive/home", events: [] }),
      step("click", {
        url: "https://drive.google.com/drive/home",
        target: el("link", "Reports"),
        navigatesTo: "https://drive.google.com/drive/folders/reports",
      }),
      step("click", {
        url: "https://drive.google.com/drive/folders/reports",
        target: el("button", "New"),
        effect: { changed: "small", opened: "menu" },
      }),
    ]);
    const open = proposals.find((p) => p.kind === "open_directly");
    expect(open?.steps).toEqual(["s1", "s2"]);
    expect(applyEdits(skill, open?.edits ?? []).ok).toBe(true);
  });

  it("notes a value you said is always the same", async () => {
    const { proposals } = await propose(
      [step("navigate", { events: [] }), step("type", { value: "NX-202", target: el("textbox", "Project") })],
      ["The project is always NX-202."],
    );
    expect(proposals.find((p) => p.kind === "constant")?.summary).toContain("NX-202");
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/evidence/proposals.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/recorder/src/evidence/proposals.ts`.**

```ts
// Generalisations code finds in a recording (spec 2.6), each with its evidence and, where code can, the change already
// prepared against the draft. Code proposes; the agent accepts or rejects (Plan 3). Nothing here changes the draft.
import { type DateRef, dateOf, type EditInput, findStep, formatDate, isAction, type Skill } from "@shadow/core";
import type { Proposal } from "../design/v2/contracts.ts";
import type { NormalisedStep } from "../normalise.ts";
import { classOf } from "./classes.ts";

export interface ProposalInput {
  steps: NormalisedStep[];
  skill: Skill;
  idsByStep: string[][];
  goal: string;
  said: { at: number; text: string }[];
  recordedOn: Date;
}
type Found = Omit<Proposal, "id">;

export function proposalsOf(input: ProposalInput): Proposal[] {
  return [
    ...dates(input),
    ...openDirectly(input),
    ...listItems(input),
    ...repeats(input),
    ...nextEmptyRows(input),
    ...allFiles(input),
    ...constants(input),
  ].map((p, i) => ({ id: `p${i + 1}`, ...p }));
}

const firstId = (input: ProposalInput, i: number) => input.idsByStep[i]?.[0];
const idsOf = (input: ProposalInput, from: number, to: number) => input.idsByStep.slice(from, to + 1).flat();
const typed = (s: NormalisedStep) => (s.kind === "type" || s.kind === "app_type") && Boolean(s.value) && !s.secret && !s.pasted;

// --- date: a typed value that is the recording day, the day before, or the week's Monday ---------------------------
const DATE_FORMATS = [
  "D MMM",
  "DD MMM",
  "D MMMM",
  "MMM D",
  "MMMM D",
  "D MMM YYYY",
  "DD/MM/YYYY",
  "D/M/YYYY",
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "DD-MM-YYYY",
];
const TODAY = { expr: "today", ref: { base: "today", offset: 0 } as DateRef, says: "the day it was recorded" };
const YESTERDAY = { expr: "today-1", ref: { base: "today", offset: -1 } as DateRef, says: "the day before it was recorded" };
const MONDAY = { expr: "week_start", ref: { base: "week_start", offset: 0 } as DateRef, says: "the Monday of the week it was recorded" };

export function dateIn(text: string, on: Date): { text: string; template: string; says: string } | undefined {
  // "w/c 19 Oct" is a week's Monday; on a Monday, plain "19 Oct" is today.
  const days = /\bw\/c\b|\bweek\b/i.test(text) ? [MONDAY, TODAY, YESTERDAY] : [TODAY, YESTERDAY, MONDAY];
  for (const day of days) {
    for (const format of DATE_FORMATS) {
      const shown = formatDate(dateOf(day.ref, on), format);
      const at = text.indexOf(shown);
      if (at < 0) continue;
      const before = text[at - 1] ?? " ";
      const after = text[at + shown.length] ?? " ";
      if (/[\w/.-]/.test(before) || /[\w/-]/.test(after)) continue; // whole dates only: not "120 Oct"
      const template = format === "YYYY-MM-DD" ? `{{${day.expr}}}` : `{{${day.expr}|${format}}}`;
      return { text: text.slice(0, at) + template + text.slice(at + shown.length), template, says: day.says };
    }
  }
  return undefined;
}

function dates(input: ProposalInput): Found[] {
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    const step = id ? findStep(input.skill, id) : undefined;
    const date = typed(s) ? dateIn(s.value as string, input.recordedOn) : undefined;
    // Only where the draft still types the recorded text (an input or a copy may already make it change).
    if (!id || !date || !step || !isAction(step) || step.args.text !== s.value) return;
    found.push({
      kind: "date",
      summary: `${id} types "${s.value}", ${date.says}: ${date.text} next time`,
      steps: [id],
      evidence: s.events,
      edits: [{ op: "set", step: id, field: "args", value: { ...step.args, text: date.text } }],
      runnable: true,
    });
  });
  return found;
}

// --- open directly: pages gone through only to reach one -----------------------------------------------------------
const goes = (s?: NormalisedStep) =>
  Boolean(s && (s.kind === "navigate" || s.kind === "click") && classOf(s) === "go" && s.opensTab === undefined && !s.submits);
const samePage = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
};
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 80);
const idLike = (u: string) => /\/(?=[\w-]*\d)[\w-]{12,}|#\w*\/[\w-]{12,}/.test(u);

function openDirectly(input: ProposalInput): Found[] {
  const { steps } = input;
  const found: Found[] = [];
  for (let i = 0; i < steps.length; ) {
    if (!goes(steps[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < steps.length && goes(steps[j + 1]) && steps[j + 1]?.tabId === steps[i]?.tabId) j++;
    const last = steps[j];
    const url = last?.navigatesTo ?? last?.url;
    const usedAfter = Boolean(url && steps.slice(j + 1).some((s) => s.tabId === last?.tabId && s.url && samePage(s.url, url)));
    const ids = idsOf(input, i, j);
    const [first, ...rest] = ids;
    if (j > i && first && url && /^https?:/.test(url) && usedAfter) {
      const edits: EditInput[] = [
        { op: "replace", step: first, with: { type: "action", channel: "web", action: "navigate", intent: `Open ${shortUrl(url)}`, args: { url } } },
        ...rest.map((id): EditInput => ({ op: "remove", step: id })),
      ];
      found.push({
        kind: "open_directly",
        summary: `${first}–${ids.at(-1)} go through ${j - i + 1} pages to reach ${shortUrl(url)}: open it directly${idLike(url) ? " (its address holds an id: it may differ next time)" : ""}`,
        steps: ids,
        evidence: steps.slice(i, j + 1).flatMap((s) => s.events),
        edits,
        runnable: true,
      });
    }
    i = j + 1;
  }
  return found;
}

// --- list item: a click or copy on an item of a list ---------------------------------------------------------------
const PAGE_CHROME = new Set(["navigation", "menubar", "tablist", "toolbar", "banner", "tree"]);

function listItems(input: ProposalInput): Found[] {
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    const list = s.list;
    if (!id || !list || list.count < 3 || PAGE_CHROME.has(list.container.role ?? "")) return;
    if (s.kind !== "click" && s.kind !== "copy") return;
    const where = list.container.name ?? list.container.role ?? list.container.tag;
    const item = list.itemText ? ` ("${list.itemText.slice(0, 60)}")` : "";
    found.push({
      kind: "list_item",
      summary: `${id} ${s.kind === "copy" ? "copied from" : "clicked"} item ${list.index + 1} of ${list.count} in ${where}${item}: next time the item in that place (the newest, the top one), or the one with this text?`,
      steps: [id],
      evidence: s.events,
      edits: [],
      runnable: true,
    });
  });
  return found;
}

// --- repeat: the same steps for two or more items, rows or values --------------------------------------------------
const shape = (s: NormalisedStep) =>
  [s.kind, s.tabId ?? "", s.target?.role ?? "", s.list?.container.selectors.css ?? s.list?.container.tag ?? "", s.cell?.ref.replace(/\d+$/, "") ?? "", s.app?.id ?? ""].join("|");
const detail = (s: NormalisedStep) => [s.list?.index, s.value, s.cell?.ref, s.target?.name].join("|");
const alike = (a: NormalisedStep[], b: NormalisedStep[]) =>
  a.length === b.length && a.every((s, d) => shape(s) === shape(b[d] as NormalisedStep)) && a.some((s, d) => detail(s) !== detail(b[d] as NormalisedStep));

function repeats(input: ProposalInput): Found[] {
  const { steps } = input;
  const found: Found[] = [];
  const taken = new Set<number>();
  for (let k = Math.min(6, Math.floor(steps.length / 2)); k >= 1; k--) {
    for (let i = 0; i + 2 * k <= steps.length; i++) {
      const group = steps.slice(i, i + k);
      if (group.every((s) => s.kind === "navigate") || group.some((_, d) => taken.has(i + d))) continue;
      let times = 1;
      while (i + (times + 1) * k <= steps.length && alike(group, steps.slice(i + times * k, i + (times + 1) * k))) times++;
      if (times < 2) continue;
      for (let d = 0; d < times * k; d++) taken.add(i + d);
      const first = idsOf(input, i, i + k - 1);
      const heads = Array.from({ length: times }, (_, t) => steps[i + t * k] as NormalisedStep);
      const what = heads.every((s) => s.list)
        ? `items ${heads.map((s) => (s.list?.index ?? 0) + 1).join(", ")} of a list`
        : heads.every((s) => s.cell)
          ? `cells ${heads.map((s) => s.cell?.ref).join(", ")}`
          : `with ${heads.map((s) => `"${String(s.value ?? s.target?.name ?? "").slice(0, 30)}"`).join(", ")}`;
      found.push({
        kind: "repeat",
        summary: `${first[0]}–${first.at(-1)} happen ${times} times (${what}): repeat them for each item`,
        steps: idsOf(input, i, i + times * k - 1),
        evidence: steps.slice(i, i + times * k).flatMap((s) => s.events),
        edits: [],
        runnable: true,
      });
    }
  }
  return found;
}

// --- next empty row: typing into the first empty row of a sheet (not runnable yet) ---------------------------------
const docOf = (u: string) => /\/d\/([\w-]+)/.exec(u)?.[1];

function nextEmptyRows(input: ProposalInput): Found[] {
  const sheets = input.steps
    .filter((s) => s.kind === "copy" && s.context)
    .map((s) => s.context as { sheet?: string; rows?: number });
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    const ref = /^([A-Z]+)(\d+)$/.exec(s.cell?.ref ?? "");
    if (!id || s.kind !== "type" || !ref || !s.url) return;
    const sheet = sheets.find((c) => c.sheet && docOf(c.sheet) === docOf(s.url as string) && typeof c.rows === "number");
    if (!sheet || Number(ref[2]) !== (sheet.rows as number) + 2) return;
    found.push({
      kind: "next_empty_row",
      summary: `${id} types into ${s.cell?.ref}, the first empty row: next time the next empty row (writing there isn't supported yet)`,
      steps: [id],
      evidence: s.events,
      edits: [],
      runnable: false,
    });
  });
  return found;
}

// --- all files: several files of one pattern -----------------------------------------------------------------------
function allFiles(input: ProposalInput): Found[] {
  const groups = new Map<string, number[]>();
  input.steps.forEach((s, i) => {
    const glob = s.candidate?.kind === "file" ? s.candidate.glob : undefined;
    if (glob) groups.set(glob, [...(groups.get(glob) ?? []), i]);
  });
  return [...groups]
    .filter(([, at]) => at.length >= 2)
    .map(([glob, at]) => {
      const ids = at.flatMap((i) => input.idsByStep[i] ?? []);
      return {
        kind: "all_files" as const,
        summary: `${ids.join(", ")} use ${at.length} files named ${glob}: take every file that matches, not one`,
        steps: ids,
        evidence: at.flatMap((i) => input.steps[i]?.events ?? []),
        edits: [],
        runnable: true,
      };
    });
}

// --- constant: a value you said or wrote is always the same --------------------------------------------------------
const FIXED = /\b(always|every time|each time|the same|never changes|fixed)\b/i;

function constants(input: ProposalInput): Found[] {
  const quotes = [input.goal, ...input.said.map((s) => s.text)]
    .flatMap((t) => t.split(/(?<=[.!?])\s+/))
    .filter((q) => FIXED.test(q));
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    if (!id || !typed(s) || (s.value as string).length < 2 || (s.value as string).length > 40) return;
    const quote = quotes.find((q) => q.toLowerCase().includes((s.value as string).toLowerCase()));
    if (!quote) return;
    found.push({
      kind: "constant",
      summary: `${id} types "${s.value}"; you said "${quote.slice(0, 120)}": keep it as it is, don't ask`,
      steps: [id],
      evidence: [quote],
      edits: [],
      runnable: true,
    });
  });
  return found;
}
```

- [ ] **Step 4: Run it.** Expected: PASS.
  - If the draft numbers steps differently from the test's expectation (`["s1", "s2"]` for open directly), check
    `base.idsByStep`. The rule: the chain's draft ids.
- [ ] **Step 5: Commit** `feat(evidence): proposals: dates, list items, repeats, open directly, next empty row, files, constants`.
  - Bullets:
    - date and open-directly changes are prepared and apply cleanly;
    - the others are notes the agent builds;
    - writing to the next empty row is noted as not runnable yet.

---

### Task 11: One timeline; narration names draft steps (spec 2.12, 2.9)

Today the narration says "steps 4–5" by recorded-step order, while the draft's ids are `s4`/`s5` numbered differently
(H12). Screen words land on steps by time.

**Files:**
- Create: `packages/recorder/src/evidence/timeline.ts`, `packages/recorder/src/evidence/timeline.test.ts`
- Modify: `packages/recorder/src/narration.ts` (`narrationOf` takes the draft ids), its callers in `compile.ts` and
  `design/design.ts` (pass `idsByStep`)

**Interfaces:**
- Produces:
  - `interface TimelineLine { at: number; text: string; step?: string }`;
  - `interface TimelineInput { start: number; steps: NormalisedStep[]; ids: string[][]; classes: StepClass[]; tabs: TabInfo[]; screens: StepScreen[]; said: { at: number; until?: number; text: string }[]; noise: Noise[] }`;
  - `timelineOf(input: TimelineInput): TimelineLine[]`; `timelineSlice(lines: TimelineLine[], from?: string, to?: string): TimelineLine[]`;
  - `describeStep(step: NormalisedStep): string`; `clock(ms: number): string` ("mm:ss").
  - `narrationOf(steps, notes, ids?: string[][])`: with ids, `during` is `"s3"` or `"s3–s5"`.
- Screen words are not in the step lines. Task 14 adds them under each step, at the size the cap allows.

- [ ] **Step 1: Write the failing test** `packages/recorder/src/evidence/timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { narrationOf } from "../narration.ts";
import type { NormalisedStep } from "../normalise.ts";
import { timelineOf, timelineSlice } from "./timeline.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/ID/edit";
const MAIL = "https://mail.google.com/mail/u/0/#inbox";
const steps: NormalisedStep[] = [
  { index: 0, kind: "navigate", at: 3_000, tabId: 1, url: SHEET, events: [] },
  {
    index: 1,
    kind: "click",
    at: 12_000,
    tabId: 2,
    url: MAIL,
    events: ["e2"],
    target: { tag: "div", url: MAIL, role: "link", name: "Daily KPIs", fallbacks: [], selectors: {} },
    list: { container: { tag: "table", url: MAIL, fallbacks: [], selectors: {} }, index: 0, count: 50 },
    effect: { changed: "large" },
  },
];

describe("one timeline", () => {
  it("puts tabs, steps by draft id, speech and what was left out in time order", () => {
    const lines = timelineOf({
      start: 0,
      steps,
      ids: [["s1"], ["s2"]],
      classes: ["go", "reveal"],
      tabs: [
        { id: 1, name: "KPI Sheet", firstUrl: SHEET, preexisting: true },
        { id: 2, name: "Gmail", firstUrl: MAIL, openedBy: 1 },
      ],
      screens: [
        { near: [], appeared: [] },
        { near: [], appeared: ["Hi All,"] },
      ],
      said: [{ at: 9_000, text: "every day I get KPI emails" }],
      noise: [{ events: ["e3"], at: 14_000, what: 'clicked "Print all"', why: "changed nothing on the page, and nothing was copied from it" }],
    });
    expect(lines.map((l) => l.text)).toEqual([
      '00:00  tab "KPI Sheet": docs.google.com/spreadsheets/d/ID/edit (open before Record)',
      "00:03  s1 [KPI Sheet] go: open docs.google.com/spreadsheets/d/ID/edit",
      '00:09  said: "every day I get KPI emails"',
      '00:12  tab "Gmail": mail.google.com/mail/u/0/#inbox (opened from "KPI Sheet")',
      '00:12  s2 [Gmail] reveal: click link "Daily KPIs": item 1 of 50; changed the page (large)',
      '00:14  (left out) clicked "Print all": changed nothing on the page, and nothing was copied from it',
    ]);
    expect(timelineSlice(lines, "s2", "s2").map((l) => l.step)).toEqual(["s2"]);
  });

  it("names the draft's steps in the narration, not the recorded order", () => {
    const said = [{ at: 12_500, until: 12_900, kind: "said" as const, text: "always the newest one" }];
    expect(narrationOf(steps, said, [["s1"], ["s2", "s3"]])).toEqual([{ during: "s2", said: "always the newest one" }]);
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/evidence/timeline.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/recorder/src/evidence/timeline.ts`.**

```ts
// One timeline (spec 2.12): the tabs, the steps by their draft ids (spec 2.9), what was said, and what was left out,
// in time order on the recording's clock. A step's screen words and caption are added under it by the evidence text
// (evidence.ts), as the size cap allows.
import type { Effect } from "@shadow/core";
import type { Noise, NormalisedStep } from "../normalise.ts";
import type { StepClass } from "./classes.ts";
import type { StepScreen } from "./screens.ts";
import type { TabInfo } from "./tabs.ts";

export interface TimelineLine {
  at: number;
  text: string;
  step?: string;
}
export interface TimelineInput {
  start: number;
  steps: NormalisedStep[];
  ids: string[][];
  classes: StepClass[];
  tabs: TabInfo[];
  screens: StepScreen[];
  said: { at: number; until?: number; text: string }[];
  noise: Noise[];
}

const MODS: Record<string, string> = { cmd: "⌘", ctrl: "Ctrl+", option: "⌥", shift: "⇧" };
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const quote = (t: string, max = 60) => `"${t.length > max ? `${t.slice(0, max - 1)}…` : t}"`;
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 80);
const labelOf = (s: NormalisedStep) =>
  s.target?.name ?? s.target?.label ?? s.target?.seenAs ?? s.target?.text ?? s.element?.title ?? "";

export function describeStep(s: NormalisedStep): string {
  const on = s.target ? ` ${s.target.role ?? s.target.tag} ${quote(labelOf(s))}` : "";
  switch (s.kind) {
    case "navigate":
      return `${s.back ? "go back to" : "open"} ${shortUrl(s.navigatesTo ?? s.url ?? "")}`;
    case "click":
      return `click${on}${s.navigatesTo ? ` → ${shortUrl(s.navigatesTo)}` : ""}${s.opensTab !== undefined ? " (opens a tab)" : ""}`;
    case "type":
      return `type ${s.secret ? "(a secret)" : s.pasted ? "(the copied text)" : quote(s.value ?? "")} into${on}`;
    case "copy":
      return `copy ${quote(s.value ?? "")}${on ? ` from${on}` : ""}`;
    case "press":
      return `press ${(s.modifiers ?? []).map((m) => MODS[m] ?? "").join("")}${s.value ?? ""}${on ? ` in${on}` : ""}${s.sends ? " (sends it)" : ""}`;
    case "select":
      return `choose ${quote(s.value ?? "")} in${on}`;
    case "upload":
      return `upload ${s.file?.name ?? "a file"}${on ? ` with${on}` : ""}`;
    default:
      return `${s.kind.replace(/_/g, " ")}${on}${s.value ? ` ${quote(s.value)}` : ""}${s.path ? ` ${s.path}` : ""}${s.toPath ? ` → ${s.toPath}` : ""}`;
  }
}

const effectText = (e: Effect) =>
  e.navigated
    ? "went to another page"
    : e.opened
      ? `opened a ${e.opened}`
      : e.expanded
        ? "expanded"
        : e.emptied
          ? "emptied the field"
          : e.changed === "none"
            ? "changed nothing"
            : `changed the page (${e.changed})`;

function facts(s: NormalisedStep): string {
  const parts: string[] = [];
  if (s.list)
    parts.push(`item ${s.list.index + 1} of ${s.list.count}${s.list.container.name ? ` in "${s.list.container.name}"` : ""}`);
  if (s.cell) parts.push(`cell ${s.cell.ref}${s.cell.sheet ? ` of "${s.cell.sheet}"` : ""}`);
  if (s.effect) parts.push(effectText(s.effect));
  return parts.length > 0 ? `: ${parts.join("; ")}` : "";
}

export function timelineOf(input: TimelineInput): TimelineLine[] {
  const nameOf = (id?: number) => input.tabs.find((t) => t.id === id)?.name;
  const lines: TimelineLine[] = [];
  for (const tab of input.tabs) {
    const first = input.steps.find((s) => s.tabId === tab.id)?.at ?? input.start;
    const how = tab.preexisting
      ? " (open before Record)"
      : tab.openedBy !== undefined
        ? ` (opened from "${nameOf(tab.openedBy) ?? "another tab"}")`
        : "";
    lines.push({ at: tab.preexisting ? input.start : first, text: `tab "${tab.name}": ${shortUrl(tab.firstUrl ?? "")}${how}` });
  }
  input.steps.forEach((s, i) => {
    const ids = input.ids[i] ?? [];
    const tab = nameOf(s.tabId);
    lines.push({
      at: s.at,
      ...(ids[0] ? { step: ids[0] } : {}),
      text: `${ids.join("+") || "-"}${tab ? ` [${tab}]` : ""} ${input.classes[i] ?? "act"}: ${describeStep(s)}${facts(s)}`,
    });
  });
  for (const said of input.said) {
    const text = said.text.trim();
    if (text) lines.push({ at: said.at, text: `said: ${quote(text, 300)}` });
  }
  for (const n of input.noise) lines.push({ at: n.at, text: `(left out) ${n.what}: ${n.why}` });
  return lines
    .sort((a, b) => a.at - b.at)
    .map((l) => ({ ...l, text: `${clock(l.at - input.start)}  ${l.text}` }));
}

export function timelineSlice(lines: TimelineLine[], from?: string, to?: string): TimelineLine[] {
  const a = from ? lines.findIndex((l) => l.step === from) : 0;
  const b = to ? lines.findIndex((l) => l.step === to) : lines.length - 1;
  return a < 0 || b < 0 || b < a ? [] : lines.slice(a, b + 1);
}
```

  - Tab lines come before steps at the same time: `sort` is stable and tabs are pushed first.

- [ ] **Step 4: `narrationOf` names draft steps.** In `narration.ts`, add a third parameter `ids?: string[][]`. Build
  `during` with:
  - `const name = (i: number) => ids?.[i]?.[0] ?? \`step ${i + 1}\``;
  - `const end = (i: number) => ids?.[i]?.at(-1) ?? \`${i + 1}\``;
  - `"before the first step"` when both are below 0;
  - `name(from)` when they are equal;
  - `` `${name(Math.max(from, 0))}–${ids ? end(to) : to + 1}` `` otherwise.

  Without ids the old text stays. Pass `idsByStep` at its call sites: `design.ts` has `session.idsByStep`, and in
  `compile.ts` use the skeleton's `idsByStep`.
- [ ] **Step 5: Run it.** The test, then `corepack pnpm -s test` (narration tests that expect "step N" without ids
  stay). Expected: PASS.
- [ ] **Step 6: Commit** `feat(evidence): one timeline, and narration by draft step ids`.
  - Bullets: tabs, steps, speech and left-out lines in time order; "said during s3–s5" matches the draft.

---

### Task 12: Questions the recording already answers are not asked (spec 2.10)

H2: "which file next time?" was asked after the user said "all the reports".

**Files:**
- Create: `packages/recorder/src/evidence/answers.ts`, `packages/recorder/src/evidence/answers.test.ts`
- Modify: `apps/daemon/src/record.ts` (after compile, before the design agent), `packages/recorder/src/index.ts`

**Interfaces:**
- Produces: `answerFromEvidence(question: Question, evidence: { goal: string; said: { text: string }[] }): { answer: string; quote: string } | undefined`.
  - `answer` is the option label passed to `applyAnswer`.
  - Rules: a file question with an "all" option, against words like "all the reports"; the "newest" option, against
    "the newest/latest"; a `row-…` question's `{{today}}` option, against "today".

- [ ] **Step 1: Write the failing test** `packages/recorder/src/evidence/answers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Question } from "../compile.ts";
import { answerFromEvidence } from "./answers.ts";

const said = (...texts: string[]) => ({ goal: "Upload this month's invoice", said: texts.map((text) => ({ text })) });

describe("questions the recording answers", () => {
  const file: Question = {
    id: "file-s2",
    text: "Which file next time?",
    appliesTo: "steps.start.inputs.invoice.resolve.pick",
    options: [{ label: "the newest one", value: "newest" }, { label: "all of them", value: "all" }],
  };

  it("answers which file from what was said, with the words it came from", () => {
    expect(answerFromEvidence(file, said("I always upload all the reports in that folder."))).toEqual({
      answer: "all of them",
      quote: "I always upload all the reports in that folder.",
    });
    expect(answerFromEvidence(file, said("Take the latest one."))?.answer).toBe("the newest one");
    expect(answerFromEvidence(file, said("Then I click upload."))).toBeUndefined();
  });

  it("answers which row from 'today'", () => {
    const row: Question = {
      id: "row-s3",
      text: "Which row next time?",
      appliesTo: "steps.s3.args.where",
      options: [{ label: "today's row", value: { Date: "{{today}}" } }, { label: "this row", value: { Date: "19 Oct" } }],
    };
    expect(answerFromEvidence(row, said("I always take today's row"))?.answer).toBe("today's row");
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/recorder/src/evidence/answers.test.ts`. Expected: FAIL, no module.

- [ ] **Step 3: Write `packages/recorder/src/evidence/answers.ts`.**

```ts
// Code's questions that the recording already answers are not asked (spec 2.10): "which file next time?" after "all
// the reports" (H2), "which row?" after "today's row". The answer carries the words it came from, for the log and the
// review.
import type { Question } from "../compile.ts";

const ALL = /\b(all|every|each)\b[^.!?]{0,40}\b(files?|reports?|invoices?|pdfs?|documents?|attachments?|ones?)\b/i;
const NEWEST = /\b(newest|latest|most recent|last one)\b/i;
const TODAY = /\btoday'?s?\b/i;
type Option = NonNullable<Question["options"]>[number];
const optionText = (o: Option) => `${o.label} ${typeof o.value === "string" ? o.value : JSON.stringify(o.value ?? "")}`;

export function answerFromEvidence(
  question: Question,
  evidence: { goal: string; said: { text: string }[] },
): { answer: string; quote: string } | undefined {
  const sentences = [evidence.goal, ...evidence.said.map((s) => s.text)].flatMap((t) => t.split(/(?<=[.!?])\s+/));
  const options = question.options ?? [];
  const pick = (fits: (o: Option) => boolean, words: RegExp) => {
    const option = options.find(fits);
    const quote = option && sentences.find((s) => words.test(s));
    return option && quote ? { answer: option.label, quote: quote.trim().slice(0, 160) } : undefined;
  };
  if (/\bfiles?\b/i.test(question.text) || (question.appliesTo ?? "").includes(".resolve")) {
    return pick((o) => /\ball\b/i.test(optionText(o)), ALL) ?? pick((o) => /newest|latest/i.test(optionText(o)), NEWEST);
  }
  if (question.id.startsWith("row-")) return pick((o) => optionText(o).includes("{{today"), TODAY);
  return undefined;
}
```

- [ ] **Step 4: Use it in `record.ts`.** After `questions = compiled.questions`, before the design agent:

```ts
  // Questions the recording already answers are not asked (spec 2.10).
  const said = notes.filter((n) => n.kind === "said");
  questions = questions.filter((q) => {
    const found = answerFromEvidence(q, { goal: form.description.goal, said });
    if (!found) return true;
    const applied = applyAnswer(skill, q, found.answer);
    if (!applied.ok) return true;
    skill = applied.skill;
    log(`answered from what you said ("${found.quote}"): ${q.text} → ${found.answer}`);
    return false;
  });
```

  - Import `answerFromEvidence` and `applyAnswer` from `@shadow/recorder`, and export `answerFromEvidence` from
    `index.ts`.
  - If `applyAnswer` expects the option's value rather than its label, pass what the drill passes. Read `drill.ts`
    and rule it.
- [ ] **Step 5: Run it.** The test, then `corepack pnpm -s test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(record): a question the recording answers is not asked`.
  - Bullet: which file (all, newest) and which row (today) from what was said, logged with the quote.

---

### Task 13: Captions of the pictures (spec 2.13)

With the Pictures switch on, every step's picture is described before the agent starts. The agent never called the
screenshot tool, so this no longer depends on it.

**Files:**
- Create: `packages/recorder/src/evidence/captions.ts`, `packages/recorder/src/evidence/captions.test.ts`
- Create: `apps/daemon/src/crop.ts`, `apps/daemon/src/crop.test.ts`

**Interfaces:**
- Produces:
  - recorder: `type DescribePicture = (path: string, question: string, point?: Point) => Promise<string>`,
    `CAPTION_CHARS = 200`, `captionQuestion(step): string`,
    `captionsOf(steps, pictureOf: (i: number) => string | undefined, describe: DescribePicture, log?): Promise<(string | undefined)[]>`;
  - daemon: `cropAround(path: string, point: Point, out: string, exec?: Run): Promise<string>`. It returns the path
    to use: the crop, or the whole picture on any error.
- Task 14 wires them: picture = the step's "before" picture, else its "after" picture.
  `describe = describer.describeMasked(crop, question, meter)`, which is cached by picture and metered.

- [ ] **Step 1: Write the failing tests.**

`packages/recorder/src/evidence/captions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { NormalisedStep } from "../normalise.ts";
import { captionsOf } from "./captions.ts";

const step = (at: number): NormalisedStep => ({ index: 0, kind: "click", at, events: [`e${at}`] });

describe("captions", () => {
  it("describes each step that has a picture, short, and leaves out a step whose picture failed", async () => {
    const asked: string[] = [];
    const captions = await captionsOf(
      [step(1), step(2), step(3)],
      (i) => (i === 1 ? undefined : `/shots/${i}.jpg`),
      async (path, question) => {
        asked.push(question);
        if (path.endsWith("2.jpg")) throw new Error("vision is down");
        return `A list of emails. ${"x".repeat(300)}`;
      },
    );
    expect(captions.map((c) => c?.length)).toEqual([200, undefined, undefined]);
    expect(asked[0]).toContain("The user did: click");
  });
});
```

`apps/daemon/src/crop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cropAround } from "./crop.ts";

describe("cropping a picture around a click", () => {
  it("cuts 900 × 600 pixels around the point, kept inside the picture", async () => {
    const calls: string[][] = [];
    const exec = async (_cmd: string, args: string[]) => {
      calls.push(args);
      return { stdout: args[0] === "-g" ? "  pixelWidth: 2800\n  pixelHeight: 1626\n" : "" };
    };
    const out = await cropAround("/s/a.jpg", { x: 238, y: 90, dpr: 2, box: { x: 0, y: 0, w: 1, h: 1 } }, "/tmp/c.jpg", exec);
    expect(out).toBe("/tmp/c.jpg");
    expect(calls[1]).toEqual(["-c", "600", "900", "--cropOffset", "0", "26", "/s/a.jpg", "--out", "/tmp/c.jpg"]);
  });

  it("uses the whole picture when cropping fails", async () => {
    const exec = async () => {
      throw new Error("no sips");
    };
    expect(await cropAround("/s/a.jpg", { x: 1, y: 1, dpr: 1, box: { x: 0, y: 0, w: 1, h: 1 } }, "/tmp/c.jpg", exec)).toBe("/s/a.jpg");
  });
});
```

- [ ] **Step 2: Run them.** `corepack pnpm vitest run packages/recorder/src/evidence/captions.test.ts apps/daemon/src/crop.test.ts`.
  Expected: FAIL, no modules.

- [ ] **Step 3: Write `packages/recorder/src/evidence/captions.ts`.**

```ts
// Captions of the masked pictures (spec 2.13), with the Pictures switch on: what the step's picture shows, which item,
// what changed and the values visible, in at most 200 characters, from a crop around the click when there is one. The
// describer (the daemon's vision model, cached by picture and metered) is passed in; a failure leaves that step without
// a caption.
import type { Point } from "@shadow/core";
import type { NormalisedStep } from "../normalise.ts";
import { describeStep } from "./timeline.ts";

export type DescribePicture = (path: string, question: string, point?: Point) => Promise<string>;
export const CAPTION_CHARS = 200;

export function captionQuestion(step: NormalisedStep): string {
  const where = step.point ? " They clicked at the middle of this picture." : "";
  return `The user did: ${describeStep(step)}.${where} In at most 40 words: what this is, which item it is (its place in a list), what changed, and any values shown.`;
}

export async function captionsOf(
  steps: NormalisedStep[],
  pictureOf: (i: number) => string | undefined,
  describe: DescribePicture,
  log: (...args: unknown[]) => void = () => {},
): Promise<(string | undefined)[]> {
  const captions: (string | undefined)[] = [];
  for (const [i, step] of steps.entries()) {
    const path = pictureOf(i);
    if (!path) {
      captions.push(undefined);
      continue;
    }
    try {
      const text = (await describe(path, captionQuestion(step), step.point)).replace(/\s+/g, " ").trim();
      captions.push(text ? text.slice(0, CAPTION_CHARS) : undefined);
    } catch (error) {
      log("a caption failed:", (error as Error).message);
      captions.push(undefined);
    }
  }
  return captions;
}
```

- [ ] **Step 4: Write `apps/daemon/src/crop.ts`.**

```ts
// A picture cropped around a click (spec 2.13), with macOS's sips: the vision model sees what was clicked and what is
// around it. On any error the whole picture is used. Click points are CSS pixels; pictures are device pixels.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Point } from "@shadow/core";

export type Run = (cmd: string, args: string[]) => Promise<{ stdout: string }>;
const run = promisify(execFile) as unknown as Run;
export const CROP = { w: 900, h: 600 };

export async function cropAround(path: string, point: Point, out: string, exec: Run = run): Promise<string> {
  try {
    const { stdout } = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
    const width = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1]);
    const height = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1]);
    if (!width || !height) return path;
    const w = Math.min(CROP.w, width);
    const h = Math.min(CROP.h, height);
    const x = Math.round(Math.min(Math.max(point.x * point.dpr - w / 2, 0), width - w));
    const y = Math.round(Math.min(Math.max(point.y * point.dpr - h / 2, 0), height - h));
    await exec("sips", ["-c", String(h), String(w), "--cropOffset", String(y), String(x), path, "--out", out]);
    return out;
  } catch {
    return path;
  }
}
```

- [ ] **Step 5: Run them.** Expected: PASS. Export `captionsOf`, `captionQuestion`, `CAPTION_CHARS` and
  `type DescribePicture` from the recorder's `index.ts`.
- [ ] **Step 6: Commit** `feat(evidence): captions of the masked pictures, cropped around the click`.
  - Bullets: one short caption per step with a picture; a failed caption is skipped; the crop falls back to the
    whole picture.

---

### Task 14: The evidence package: `evidence.json`, the 24k cap, the evidence view (spec 2.14, 2.7)

**Files:**
- Create: `packages/recorder/src/evidence/evidence.ts`, `packages/recorder/src/evidence/evidence.test.ts`
- Create: `apps/daemon/src/evidence.ts`, `apps/daemon/src/evidence.test.ts`, `scripts/evidence.ts`
- Modify: `apps/daemon/src/record.ts`, `packages/recorder/src/index.ts`, `package.json` (`"evidence": "tsx scripts/evidence.ts"`)

**Interfaces:**
- Produces (recorder):

```ts
export const EVIDENCE_TOKENS = 24_000;
export const estimateTokens: (text: string) => number; // about four characters a token
export interface EvidenceStep {
  id: string; // its first draft id
  ids: string[];
  at: number;
  class: StepClass;
  tab?: string;
  line: string; // describeStep
  appeared: string[];
  near: string[];
  caption?: string;
  weak?: string; // spec 2.7: found only by its text, or by nothing
  events: string[];
}
export interface Evidence {
  version: 1;
  goal: string;
  recordedOn: string; // YYYY-MM-DD, local
  start: number;
  switches: { screen: boolean; voice: boolean; pictures: boolean };
  tabs: TabInfo[];
  steps: EvidenceStep[];
  noise: Noise[]; // with the would-be steps, for restore
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
}
export function buildEvidence(input: EvidenceInput): Evidence;
export function evidenceText(ev: Evidence, cap?: number): { text: string; tokens: number; level: number };
export function evidenceView(ev: Evidence): EvidenceView; // Plan 3's contract
```

- Produces (daemon):
  - `readPictures(dir): Picture[]`;
  - `writeEvidence(options): Promise<Evidence | undefined>`. It writes `evidence.json` and logs one line. It never
    throws.
- **The cap's levels, in order:**
  - 0: everything;
  - 1: reveal steps lose screen words and captions;
  - 2: every step loses screen words;
  - 3: captions go;
  - 4: what appeared is cut to 3 lines a step;
  - 5: only act and read steps keep what appeared.
  - Speech and proposals are never cut.

- [ ] **Step 1: Write the failing tests** `packages/recorder/src/evidence/evidence.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TraceEvent } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { compile } from "../compile.ts";
import { normaliseAll } from "../normalise.ts";
import { buildEvidence, type Evidence, evidenceText, evidenceView } from "./evidence.ts";

const MAIL = "https://mail.google.com/mail/u/0/#inbox";
let n = 0;
const ev = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${++n}`,
  sessionId: "s",
  at,
  event,
  tabId: 1,
  frameId: 0,
  url: MAIL,
  ...extra,
});
const row = { tag: "div", url: MAIL, role: "link", name: "Daily KPIs - w/c 19 Oct", fallbacks: [], selectors: { css: "#r1" } };
const header = { tag: "div", url: MAIL, text: "Print all In new window", fallbacks: [], selectors: { css: "#h" } };
const subject = { tag: "h2", url: MAIL, role: "heading", name: "Daily KPIs - w/c 19 Oct", fallbacks: [], selectors: { css: "h2" } };
const list = { container: { tag: "table", url: MAIL, role: "grid", fallbacks: [], selectors: { css: "table.F" } }, index: 0, count: 50, itemText: "Daily KPIs" };

async function evidenceOf(trace: TraceEvent[], pictures: Parameters<typeof buildEvidence>[0]["pictures"] = [], said: Evidence["said"] = []) {
  const { steps, noise } = normaliseAll(trace);
  const { skill, base } = await compile(steps);
  return buildEvidence({
    trace,
    steps,
    noise,
    skill,
    idsByStep: base.idsByStep,
    goal: "Note the newest KPI email's subject",
    switches: { screen: pictures.length > 0, voice: said.length > 0, pictures: false },
    said,
    pictures,
  });
}

const gmail = () => [
  ev("tab_open", 0, { title: "Inbox (3) - Searce Mail", preexisting: true }),
  ev("navigate", 1, { transition: "typed" }),
  ev("click", 2_000, { target: row, cid: "c1", list }),
  ev("effect", 2_700, { of: "c1", effect: { changed: "large" } }),
  ev("click", 5_000, { target: header, cid: "c2" }),
  ev("effect", 5_700, { of: "c2", effect: { changed: "none" } }),
  ev("select_text", 7_000, { target: subject, value: "Daily KPIs - w/c 19 Oct" }),
  ev("copy", 8_000, { target: subject, value: "Daily KPIs - w/c 19 Oct", via: "keyboard" }),
];

describe("the evidence package", () => {
  it("holds the steps by draft id and class, the tab, what was left out, and the proposals", async () => {
    const pictures = [{ eventId: "e3", at: 2_000, tabId: 1, lines: [{ text: "Hi All,", box: { x: 0, y: 0, w: 10, h: 10 } }] }];
    const evidence = await evidenceOf(gmail(), pictures, [{ at: 3_000, text: "always take the newest one" }]);
    expect(evidence.steps.map((s) => [s.id, s.class, s.tab])).toEqual([
      ["s1", "go", "Searce Mail"],
      ["s2", "reveal", "Searce Mail"],
      ["s3", "read", "Searce Mail"],
    ]);
    expect(evidence.steps[1]?.appeared).toEqual(["Hi All,"]);
    expect(evidence.noise.map((x) => x.why)).toEqual(["changed nothing on the page, and nothing was copied from it"]);
    expect(evidence.proposals.map((p) => p.kind)).toContain("list_item");
    expect(evidence.timeline.map((l) => l.text).join("\n")).toContain('said: "always take the newest one"');
  });

  it("builds from an older recording with no effects, lists or cells (the KPI fixture)", async () => {
    const dir = join(import.meta.dirname, "../../../../fixtures/recordings/kpi-email-to-sheet");
    const trace = readFileSync(join(dir, "trace.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => TraceEvent.parse(JSON.parse(l)));
    const evidence = await evidenceOf(trace);
    expect(evidence.steps.length).toBeGreaterThan(3);
    expect(evidence.noise.filter((x) => x.why.startsWith("changed nothing"))).toEqual([]);
  });

  it("builds with Screen and Voice off: no pictures, no speech, no captions", async () => {
    const evidence = await evidenceOf(gmail());
    expect(evidence.steps.every((s) => s.appeared.length === 0 && s.near.length === 0 && !s.caption)).toBe(true);
    expect(evidence.said).toEqual([]);
    expect(evidence.switches).toEqual({ screen: false, voice: false, pictures: false });
  });

  it("keeps its text under the cap by cutting screen words first, never speech or proposals", async () => {
    const evidence = await evidenceOf(gmail(), [], [{ at: 3_000, text: "always take the newest one" }]);
    const big: Evidence = {
      ...evidence,
      steps: evidence.steps.map((s) => ({ ...s, near: Array(6).fill("x".repeat(120)), appeared: Array(12).fill("y".repeat(120)), caption: "z".repeat(200) })),
    };
    const full = evidenceText(big, 1_000_000);
    const cut = evidenceText(big, Math.floor(full.tokens / 2));
    expect(full.level).toBe(0);
    expect(cut.level).toBeGreaterThan(0);
    expect(cut.text).toContain("always take the newest one");
    for (const p of big.proposals) expect(cut.text).toContain(p.summary);
  });

  it("lets the agent look up a step, a stretch of the timeline, the words about a question, and what appeared", async () => {
    const pictures = [{ eventId: "e3", at: 2_000, tabId: 1, lines: [{ text: "Hi All,", box: { x: 0, y: 0, w: 10, h: 10 } }] }];
    const view = evidenceView(await evidenceOf(gmail(), pictures, [{ at: 3_000, text: "always take the newest one" }]));
    expect(view.step("s2")).toMatchObject({ class: "reveal" });
    expect(view.timeline("s2", "s2")).toContain("s2 [Searce Mail]");
    expect(view.about("Which email is the newest one?")).toContain("always take the newest one");
    expect(view.appeared().has("Hi All,")).toBe(true);
  });
});
```

`apps/daemon/src/evidence.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseAll } from "@shadow/recorder";
import { compile } from "@shadow/recorder";
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
    writeFileSync(join(dir, "screen.jsonl"), `${JSON.stringify({ at: 2_000, eventId: "e2", tabId: 1, text: "Save", lines: [{ text: "Save", box: { x: 0, y: 0, w: 1, h: 1 } }] })}\nnot json\n`);
    const { steps, noise } = normaliseAll(trace);
    const { skill, base } = await compile(steps);
    const logs: string[] = [];
    const describer = {
      allowed: () => true,
      tempPath: () => join(dataDir, "tmp-crop"),
      describeMasked: async () => "A form with an Amount field and a Save button.",
      describe: async () => ({}) as never,
    };
    const common = { dataDir, sessionId: "rec1", trace, steps, noise, skill, idsByStep: base.idsByStep, notes: [], log: (...a: unknown[]) => logs.push(a.join(" ")) };
    const consent = (pictures: boolean) => ({ goal: "Save the amount", changes: [], constants: [], never: [], private: [], when: [{ type: "manual" as const }], consent: { screen: true, microphone: false, pictures } });
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
```

  - The fixture path in the first test is relative to `packages/recorder/src/evidence/`. Adjust the `..` count if the
    folder sits elsewhere.

- [ ] **Step 2: Run them.** `corepack pnpm vitest run packages/recorder/src/evidence/evidence.test.ts apps/daemon/src/evidence.test.ts`.
  Expected: FAIL, no modules.

- [ ] **Step 3: Write `packages/recorder/src/evidence/evidence.ts`.**

```ts
// The evidence package (spec 2.14): everything code understood of a recording, the design agent's only input.
// - Built once when the recording stops, and kept as evidence.json in its folder.
// - Its text, for the agent's first message, stays under 24k tokens (EVIDENCE_TOKENS). Steps that only revealed
//   something lose their screen words and captions first, then every step's screen words go, then the captions, then
//   what appeared is cut. Speech and proposals are never cut.
// - The agent reads the rest through EvidenceView (Plan 3's look and ask tools).
import type { Skill, TraceEvent } from "@shadow/core";
import type { EvidenceView, Proposal } from "../design/v2/contracts.ts";
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
  return {
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
    timeline: timelineOf({ start, steps: input.steps, ids: input.idsByStep, classes, tabs, screens, said: input.said, noise: input.noise }),
  };
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
        ? ev.proposals.map((p) => `${p.id} ${p.kind}: ${p.summary}${p.edits.length > 0 ? " [change ready]" : ""}${p.runnable ? "" : " [can't run yet]"}`)
        : ["(none)"]),
      "",
      `Where values go: ${ev.flow.map((f) => `${f.from} → ${f.to} ${f.how}${f.value ? ` ${q(f.value)}` : ""}`).join("; ") || "(nothing passed between steps)"}`,
    ].join("\n");
    best = { text, tokens: estimateTokens(text), level };
    if (best.tokens <= cap) return best;
  }
  return best;
}

const STOP = new Set(["which", "what", "when", "where", "should", "would", "next", "time", "this", "that", "with", "from", "your", "they"]);

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
```

- [ ] **Step 4: Write `apps/daemon/src/evidence.ts`.**

```ts
// The evidence package of a recording (spec 2.14), written as evidence.json in its folder when it stops, before the
// design agent. Captions only with the recording's Pictures switch and a vision model. Never fails a recording: an
// error is logged and the recording goes on without it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Skill, TraceEvent } from "@shadow/core";
import type { UsageMeter } from "@shadow/llm";
import {
  buildEvidence,
  captionsOf,
  type Evidence,
  evidenceText,
  type Noise,
  type NormalisedStep,
  type Note,
  type Picture,
  screensOf,
} from "@shadow/recorder";
import { cropAround } from "./crop.ts";
import type { ScreenDescriber } from "./describe.ts";
import { type RecordForm, recordingDir } from "./recording-store.ts";

export function readPictures(dir: string): Picture[] {
  const file = join(dir, "screen.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const p = JSON.parse(line) as Partial<Picture>;
        if (!p.eventId || typeof p.at !== "number" || !Array.isArray(p.lines)) return [];
        return [{ eventId: p.eventId, at: p.at, ...(p.tabId !== undefined ? { tabId: p.tabId } : {}), lines: p.lines }];
      } catch {
        return [];
      }
    });
}

export interface EvidenceOptions {
  dataDir: string;
  sessionId: string;
  trace: TraceEvent[];
  steps: NormalisedStep[];
  noise: Noise[];
  skill: Skill;
  idsByStep: string[][];
  form?: RecordForm;
  notes: Note[];
  describer?: Pick<ScreenDescriber, "allowed" | "describeMasked" | "tempPath">;
  meter?: UsageMeter;
  log: (...args: unknown[]) => void;
}

export async function writeEvidence(o: EvidenceOptions): Promise<Evidence | undefined> {
  try {
    const dir = recordingDir(o.dataDir, o.sessionId);
    if (!existsSync(dir)) return undefined;
    const pictures = readPictures(dir);
    const consent = o.form?.consent ?? { screen: false, microphone: false, pictures: false };
    let captions: (string | undefined)[] | undefined;
    const describer = o.describer;
    if (consent.pictures && describer?.allowed() && pictures.length > 0) {
      const screens = screensOf(o.steps, pictures, o.trace);
      const shot = (id?: string) => {
        const path = id && /^[\w-]+$/.test(id) ? join(dir, "shots", `${id}.jpg`) : undefined;
        return path && existsSync(path) ? path : undefined;
      };
      captions = await captionsOf(
        o.steps,
        (i) => shot(screens[i]?.before) ?? shot(screens[i]?.after),
        async (path, question, point) =>
          describer.describeMasked(point ? await cropAround(path, point, `${describer.tempPath()}.jpg`) : path, question, o.meter),
        o.log,
      );
    }
    const evidence = buildEvidence({
      trace: o.trace,
      steps: o.steps,
      noise: o.noise,
      skill: o.skill,
      idsByStep: o.idsByStep,
      goal: o.form?.goal ?? "",
      switches: { screen: consent.screen, voice: consent.microphone, pictures: consent.pictures },
      said: o.notes
        .filter((n) => n.kind === "said")
        .map(({ at, until, text }) => ({ at, ...(until !== undefined ? { until } : {}), text })),
      pictures,
      ...(captions ? { captions } : {}),
    });
    writeFileSync(join(dir, "evidence.json"), JSON.stringify(evidence), { mode: 0o600 });
    const { tokens, level } = evidenceText(evidence);
    o.log(
      `evidence: ${evidence.steps.length} steps, ${evidence.noise.length} left out, ${evidence.proposals.length} proposals, ~${tokens} tokens${level > 0 ? ` (details cut to level ${level})` : ""}`,
    );
    return evidence;
  } catch (error) {
    o.log("evidence couldn't be built:", (error as Error).message);
    return undefined;
  }
}
```

- [ ] **Step 5: Wire it.**
  - **`record.ts`:**
    - `const { steps, noise } = normaliseAll(trace)` replaces `normalise(trace)`.
    - After Task 12's answered questions, before the design agent:

```ts
  await writeEvidence({
    dataDir,
    sessionId,
    trace,
    steps,
    noise,
    skill,
    idsByStep: compiled.base.idsByStep,
    form: recorded,
    notes,
    describer: options.describer,
    meter: options.meter,
    log,
  });
```

      Use the names `record.ts` already has for the form and the trace.
  - **The recorder's `index.ts`** exports every new module's public names: `buildEvidence`, `evidenceText`,
    `evidenceView`, `EVIDENCE_TOKENS`, `estimateTokens`, `type Evidence`, `type EvidenceStep`, `type EvidenceInput`,
    `classOf`, `type StepClass`, `tabsOf`, `tabName`, `type TabInfo`, `screensOf`, `type Picture`,
    `type StepScreen`, `flowOf`, `type Flow`, `proposalsOf`, `dateIn`, `timelineOf`, `timelineSlice`,
    `describeStep`, `type TimelineLine`, `answerFromEvidence`, `captionsOf`, `captionQuestion`, `CAPTION_CHARS`,
    `type DescribePicture`.
  - **`scripts/evidence.ts`** (`pnpm evidence <recording folder> [--json]`):

```ts
// pnpm evidence <recording folder> [--json]: what code understood of a recording, with no model (Checkpoint 2).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TraceEvent } from "@shadow/core";
import { buildEvidence, compile, evidenceText, normaliseAll } from "@shadow/recorder";
import { readPictures } from "../apps/daemon/src/evidence.ts";

const dir = resolve(process.argv[2] ?? ".");
const lines = (file: string) =>
  existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean) : [];
const trace = lines("trace.jsonl")
  .flatMap((l) => {
    const parsed = TraceEvent.safeParse(JSON.parse(l));
    return parsed.success ? [parsed.data] : [];
  })
  .sort((a, b) => a.at - b.at);
const form = existsSync(join(dir, "description.json")) ? JSON.parse(readFileSync(join(dir, "description.json"), "utf8")) : {};
const said = lines("transcript.jsonl").map((l) => JSON.parse(l) as { at: number; until?: number; text: string });
const { steps, noise } = normaliseAll(trace);
if (steps.length === 0) {
  console.log("no steps");
  process.exit(0);
}
const description = { goal: form.goal ?? "", changes: form.changes ?? [], constants: form.constants ?? [], never: form.never ?? [] };
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
```

- [ ] **Step 6: Run them.** The two tests, then `corepack pnpm -s test`. Also run
  `corepack pnpm evidence fixtures/recordings/kpi-email-to-sheet` and read the output. Expected: PASS, and the script
  prints a timeline.
- [ ] **Step 7: Commit** `feat(evidence): evidence.json, written when a recording stops, under 24k tokens`.
  - Bullets:
    - the timeline, classes, tabs, left-out steps, data flow, proposals and captions in one file;
    - the agent's view of it (Plan 3's contract);
    - `pnpm evidence <folder>` prints it.

---

### Task 15: Checkpoint 2: the real recordings through the evidence

**Files:**
- Create: `testing/checkpoint-2.md`
- Fixes found here: each its own RED→GREEN change in the owning module, committed separately.

- [ ] **Step 1: Run the evidence on every real recording and fixture.** For each folder:
  - in `~/shadow-tests/checkpoint-1/test-browser/*`,
  - in `~/shadow-tests/checkpoint-1/your-chrome/*`,
  - and `fixtures/recordings/kpi-email-to-sheet`, `fixtures/recordings/timesheet`:

  run `corepack pnpm -s evidence <folder> > $CLAUDE_JOB_DIR/tmp/cp2-<name>.txt` and read the output.
- [ ] **Step 2: Check each against what happened in it** (the recordings' stories are in `testing/checkpoint-1.md`):

| Recording | Must show |
|---|---|
| A' Wikipedia → form | the double-click left out with its selection or merged into a read; the copy a `read` with `list` "row 3 of 191"; the GDP table link `go`; Save `act` with "Saved amount …" appeared; idle tab switches left out |
| C YC jobs | the top job's click `go` with "item 1 of 20" and a `list_item` proposal; the copy of the title on the job tab a `read`; tabs named "Y Combinator" and the job page |
| D GitHub | the Code button `reveal`; Escape a press; `g` and `i` presses and the page's click on Issues left out |
| F sample sheet | two cell copies `read`, with cells B8 and A12 |
| your-chrome A | "20 Oct" in A4 gets a `date` proposal `{{today\|D MMM}}`; `next_empty_row` for A4; the click on the "New expense" heading left out; Save `act` |
| your-chrome B | the email row `go`/`reveal` with "item 1 of 50" and a `list_item` proposal; the header click left out; the subject copy a `read`; `j` a press |
| KPI fixture | builds; a `date` proposal for "w/c 19 Oct" (`{{week_start\|D MMM}}`) if the draft types it literally; no click left out for lack of an effect |

- [ ] **Step 3: Captions, live, once.**
  - **Announce the cost first:** a short recording (about 5 pictures) on GLM-5.3-Flash costs about $0.01. Add the v1
    design run on Stop (about $0.05), and log both in `testing/design-eval-ledger.md`.
  - Record it in the isolated test setup (`reference-test-browser-setup` in memory) with
    `consent.pictures: true`, on public pages only.
  - Check that `evidence.json` has a caption on the steps that have a picture.
- [ ] **Step 4: Fix what Step 2 or 3 finds.** Each fix:
  - starts with a failing test built from the real trace's shape;
  - is committed on its own;
  - is listed in the checkpoint doc.

  Notes that belong to Plan 3 go in the doc's "For Plan 3" list.
- [ ] **Step 5: Write `testing/checkpoint-2.md`.** For each recording:
  - steps by class, what was left out, the proposals, tokens and level;
  - ✓ or ✗ against Step 2's table, with the fix commit for each ✗.

  Commit it with `docs(testing): checkpoint 2, the evidence of the real recordings`.

---

## Self-review

- **Spec coverage:**

| Spec item | Task |
|---|---|
| 2.1 classes | 6 |
| 2.2 noise | 5 |
| 2.3 select + copy | 5 |
| 2.4 tabs | 7 |
| 2.5 data flow | 9 |
| 2.6 proposals | 10 |
| 2.7 weak targets | 14 (`weak`) |
| 2.8 Enter that sends | 4 |
| 2.9 step ids | 9, 10, 11, 14: everything by draft id; narration fixed in 11 |
| 2.10 questions checked | 12 |
| 2.11 templates | 2 |
| 2.12 timeline | 11 |
| 2.13 captions | 13, 14 |
| 2.14 evidence.json | 14 |

  Checkpoint 1's "For Plan 2" notes:

| Note | Task |
|---|---|
| a click that opened a tab | 4 (`opensTab`) |
| Back | 4 |
| single-page navigation 780 ms late | `FOLLOW_MS` is 3 s already |
| shared effect window | 5 (`WATCH_MS` rule) |
| the double-click's first click | 5 |
| synthetic clicks once keys are steps | 3, 4, 5 |
| Enter in a cell | 4 |
| weak list places from page chrome | 10 (`PAGE_CHROME`) |

  Still open:
  - A tab step that says "go to tab X" is Plan 3's (`step.tab`, Akshat's sign-off). Plan 2 only names each step's
    tab in the evidence.
  - Memory found by code (in 2.14's list) is left out. The memory store's facts already reach the design agent
    through its `memory` option, and Plan 3 decides how they join the evidence. This is a ruling at execution.
- **Placeholders:** none. The code in each step is the code to write.
- **Fitting to the real code:** two places say "if the draft numbers differ, read `idsByStep`" (Task 9, Task 10), and
  Task 12 says "pass what the drill passes". These points fit the plan to code read at execution time. They are not
  open design.
- **Types:**
  - `Noise` (Task 5) is used by Tasks 11 and 14.
  - `StepClass` (6) is used by 10, 11 and 14.
  - `TabInfo` (7) is used by 11 and 14.
  - `Picture` and `StepScreen` (8) are used by 11, 13 and 14.
  - `Flow` (9) and `Proposal` (1) are used by 14.
  - `describeStep` (11) is used by 13 and 14.
