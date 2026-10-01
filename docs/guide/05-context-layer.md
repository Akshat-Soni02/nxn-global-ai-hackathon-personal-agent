# 05 · The context layer: your part, stage by stage

> *"there are many implementation stuff left + thinking about my part (context layer). many questions revolve that i have asked about the context layer."*
>
> Sprint 2 in the sheet: *"[Rushil] - Capture user input - Process input - extract info so that it is replayable in future"*. Carryover: *"Action Item - Pass structrued output required in Input flow"*.

## The short answer

Your part is a **compiler**:

- **in:** evidence of a task. That is a recorded event trace, or a description in words. Later, video or images.
- **out:** exactly one thing, a `Skill` that validates against `packages/core/src/skill.ts:86`.

It is correct **only if Akshat's player can run that skill** on the page it was recorded on.

The structured output the action item asks for already exists: it is the `Skill` schema plus the three files in `skills/examples/`. What does **not** exist is the format of your *input*, the trace. Defining it is your first deliverable, and it is a joint one.

## What "context layer" means: three things with one name

The sheet uses the phrase three ways. They are different kinds of thing, built at different times:

| Sheet wording | Kind | What it is in code | When |
|---|---|---|---|
| *"context layer [supporting user multi-format inputs, drilling layer while intake to structurize the task]"* | a **pipeline** that runs at teach time | **Intake**: capture → trace → normalise → compile → drill → dry run. `packages/recorder` + `apps/extension/src/content.ts` | **Sprint 2** (capture to compile), Sprint 3 (drill, dry run) |
| *"persistent memory"* (track requirement), *"Understanding user given context"* | a **place** | **Memory**: facts, preferences, run context, site notes. `packages/memory/src/index.ts:4-20` (interface only) | Sprint 3 |
| *"Context gathering in any point of time to support a task [gather from user or from internet]"* | **step types and run states** at replay time | **Run-time gathering**: `extract` (`skill.ts:12`), `fallback: "ask"` (`skill.ts:72`), `waiting_user` (`design.md:181`); Tavily is not in the schema | Sprint 3–4 |

Sprint 1's breakdown said the output would be *"some kind of structured output [playwright script or instructions etc]"*. The repo has resolved that:

- **"instructions"**: yes. They are the `intent` field on every step.
- **"playwright script"**: no. A script can't be parameterised, healed, approval-gated or audited, and Playwright can't drive the user's Chrome anyway ([03](03-tools-chrome-electron-openai.md)).

## The perspective that makes it simple

**Your output's correctness is decided by someone else's code.** So test the context layer by *replaying* what it produces, not by reading it. Every design choice below follows from that:

- capture the signals the matcher scores on;
- copy targets verbatim instead of letting a model retype them;
- validate against the same zod schema the player parses.

## The pipeline at a glance

| # | Stage | Input → Output | Where | Status | Sprint 2? |
|---|---|---|---|---|---|
| 1 | **Capture** | your clicks and typing → `record.event` messages | `apps/extension/src/content.ts`, `background.ts` | 🔴 build bug, no listeners | ✅ |
| 2 | **Trace** | `record.event` stream → `traces/<sessionId>.jsonl` | `packages/core/src/trace.ts` (new), `apps/daemon` | ⬜ | ✅ |
| 3 | **Normalise** | trace → `NormalisedStep[]` (no LLM) | `packages/recorder/src/trace.ts` | ⬜ | ✅ |
| 4 | **Compile** | normalised steps + memory → `{ skill, questions }` | `packages/recorder/src/compile.ts` | ⬜ | ✅ v0 |
| 5 | **Drill** | questions → your answers → patched skill + memory | `packages/recorder/src/drill.ts` | ⬜ | stdin v0 if time |
| 6 | **Dry run** | skill → targets highlighted on the live page → your OK | player (Akshat) | ⬜ | ❌ Sprint 3 |

Your three sheet bullets, mapped:

- *"Capture user input"* = stages 1–2.
- *"Process input"* = stage 3.
- *"extract info so that it is replayable"* = stages 4–6. The word "replayable" is the acceptance test.

---

### Stage 1 · Capture

Covered in full in [04](04-capture-without-coordinates.md). In summary: capture-phase listeners, describe on `pointerdown`, coalesce typing, redact secrets, file *names* only. `describeElement` is shared with the player.

**One thing that lives here and not in 04:** the background worker knows *which tab and frame* each event came from, and the content script doesn't. `background.ts:67` receives a `_sender` argument and ignores it. That argument is where `tabId`, `frameId` and the frame's `url` come from:

```ts
// apps/extension/src/background.ts:67-70 today
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === "recording?") reply({ sessionId: recordingSession });
  else if (message?.type === "record.event" && recordingSession) send({ ...message, sessionId: recordingSession });
});
// proposed: send({ ...message, sessionId, tabId: sender.tab?.id, frameId: sender.frameId, url: sender.url })
```

---

### Stage 2 · Trace

**Today** (from code), the only shape is the message (`messages.ts:29-37`):

```ts
{ id, type: "record.event", sessionId, at: number, event: string, value?: string, target?: ElementDescriptor }
```

`event` is a free string, so the compiler has no list of what to expect. Nothing is written to disk: `daemon.ts:50-53` logs the event name and drops it.

**Proposed** (a joint change, in `packages/core/src/trace.ts`). Name the event kinds and give each event the context the compiler needs:

```ts
import { z } from "zod";
import type { ElementDescriptor } from "./descriptor.ts";

export const TRACE_EVENTS = [
  "click", "type", "select", "check", "file", "submit", "key",       // page (content script)
  "navigate", "tab_open", "tab_close", "download",                   // browser (background worker)
  "fs_create", "fs_move", "fs_rename",                               // filesystem (daemon FSEvents)
] as const;

export const TraceEvent = z.object({
  id: z.string(),
  sessionId: z.string(),
  at: z.number(),                                   // Date.now(); orders events across tabs, frames and fs
  event: z.enum(TRACE_EVENTS),
  tabId: z.number().optional(), frameId: z.number().optional(), url: z.string().optional(),
  target: z.custom<ElementDescriptor>().optional(),
  value: z.string().optional(),                     // final typed / selected value; absent when secret
  secret: z.boolean().optional(),
  file: z.object({ name: z.string(), size: z.number(), type: z.string() }).optional(),
  path: z.string().optional(), toPath: z.string().optional(),     // fs events, downloads
  echo: z.boolean().optional(),                     // echo verification result (04)
});
export type TraceEvent = z.infer<typeof TraceEvent>;
```

`messages.ts:34` then becomes `event: z.enum(TRACE_EVENTS)`, so a typo in the content script is rejected at the daemon instead of reaching the compiler.

**On disk**: one JSON object per line, appended to `~/Library/Application Support/TaskPlayer/traces/<sessionId>.jsonl` (under `APP_SUPPORT_DIR`, `paths.ts:4`).

Why JSONL:

- **Append-only.** Events arrive one at a time.
- **Crash-safe.** A crash loses at most the line being written.
- **Never rewritten.** The trace is evidence. You can recompile it later with a better model or better rules.

What a recording of the upload task should look like (**synthetic values**; `target` abbreviated):

```jsonl
{"id":"e1","sessionId":"s-7f3a","at":1790812800120,"event":"navigate","tabId":412,"frameId":0,"url":"http://localhost:5173/upload.html"}
{"id":"e2","sessionId":"s-7f3a","at":1790812803410,"event":"click","tabId":412,"frameId":0,"url":"http://localhost:5173/upload.html","target":{"role":"button","name":"Upload invoice","near":"Documents","…":"…"},"echo":true}
{"id":"e3","sessionId":"s-7f3a","at":1790812809905,"event":"file","tabId":412,"frameId":0,"target":{"role":"button","name":"Upload invoice","…":"…"},"file":{"name":"invoice-0923.pdf","size":48213,"type":"application/pdf"}}
{"id":"e4","sessionId":"s-7f3a","at":1790812812230,"event":"click","tabId":412,"frameId":0,"target":{"role":"button","name":"Submit","near":"Documents","…":"…"},"echo":true}
```

Persisting this means editing `daemon.ts:50-53`. That file belongs to Akshat (`readme.md:107`). Write it as a small `apps/daemon/src/trace-store.ts` and ask him to review the three-line hook into the switch.

---

### Stage 3 · Normalise

Deterministic rules, no LLM, unit-tested against real recorded traces. Run them *before* the model sees anything, for three reasons:

- they are mechanical, so a model would only add randomness;
- they make the compiler's input stable, which makes its output testable;
- they cut the tokens you send.

| Rule | Example | Why |
|---|---|---|
| **Merge typing** per field: keep the last value within one focus span | 14 `type` events on Hours → 1 with `"38"` | A skill step is "enter the hours", not 14 keystrokes |
| **Merge file picks**: a click on a file input or its label, followed by `file` on the same element → one `file` event | e2 + e3 above → one | Replay uploads with `DOM.setFileInputFiles`, so there's no click to replay |
| **Drop non-actionable clicks**: no role, no actionable ancestor, not followed by navigation or `file` | a click on empty page background | Noise. Later, with a MutationObserver, use the dossier's "no DOM change within 1.5 s" rule |
| **Collapse repeats** | double-clicking Submit | Keep the last |
| **Segment at navigations and long pauses (> 4 s)** | the session splits at `navigate` events | Groups become candidate step intents |
| **Mark parameter candidates** | `invoice-0923.pdf` → glob `invoice-*.pdf`; a typed `2026-10-01` → a date; typed `38` → a number | The model decides; the rule only proposes |

Expected result for the trace above: **3 normalised steps**. `navigate`, then `file` (target: Upload invoice; candidate input `invoice-*.pdf`), then `click` (Submit). Those are exactly the three steps of `skills/examples/upload-invoice.json`. Make that your first unit test.

---

### Stage 4 · Compile

**Who decides what.** This split is the most important design choice in your part:

| Decided by the **model** | **Copied** by code, never retyped by the model |
|---|---|
| `intent` of the skill and of each step | `target`: role, name, label, text, near, attrs |
| which values become `inputs`, and their `resolve` rules | `fallbacks`: the CSS and XPath from the descriptor |
| `check` per step, `success` for the whole skill | `framePath` |
| `requires_approval` (submit, pay, send, delete) | URLs for `navigate` |
| `id`, `triggers` (proposed, then confirmed in the drill) | |
| `questions[]` for the drill | |

**Why the split.** A model asked to reproduce `//section[h2='Documents']//input[@type='file']` will now and then get one character wrong, and a wrong selector fails *silently* at replay. Making the model refer to steps by number (`"targetOf": 2`) and having code splice in the recorded locator removes a whole class of bug. It also cuts tokens and leaves the model nowhere to invent a selector.

The splice is a pure function from `ElementDescriptor` to `Locator`:

```ts
import type { ElementDescriptor, Locator } from "@taskplayer/core";

export function toLocator(d: ElementDescriptor): Locator {
  const { role, name, label, text, near, attrs, framePath } = d;
  const fallbacks = [d.selectors.css, d.selectors.xpath].filter((s): s is string => Boolean(s));
  return { role, name, label, text, near, attrs, framePath, fallbacks };   // drops tag, url, crop, shadowPath
}
```

It drops `crop` on purpose. `run.step` ships the whole skill (`messages.ts:40`) under a 1 MB cap (`framing.ts:7`).

**The compile loop**, using only functions that exist today (`chat`, `configFromEnv` in `packages/llm`; `Skill` in `packages/core`):

```ts
// packages/recorder/src/compile.ts  (proposed)
import { ACTIONS, Skill } from "@taskplayer/core";
import { chat, configFromEnv, type ChatMessage } from "@taskplayer/llm";

export async function compile(steps: NormalisedStep[], notes: string[]) {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ACTIONS) },   // built FROM skill.ts:11, so prompt and schema can't drift
    { role: "user", content: JSON.stringify({ steps: steps.map(forModel), memory: notes }) },
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chat(configFromEnv(), messages, { json: true });       // response_format json_object, llm/index.ts:38
    const draft = spliceTargets(safeJson(raw), steps);                       // code inserts toLocator(...) by step number
    const parsed = Skill.safeParse(draft.skill);
    if (parsed.success) return { skill: parsed.data, questions: draft.questions ?? [] };
    messages.push({ role: "assistant", content: raw },
                  { role: "user", content: `Schema errors: ${JSON.stringify(parsed.error.issues)}. Return corrected JSON only.` });
  }
  throw new Error("compile: no valid skill after 3 attempts");
}
```

The schema already produces precise error messages for the two mistakes a model will most likely make:

- an action the channel doesn't support: *"action is not supported by this channel"* (`skill.ts:76-79`);
- a vision step: *"vision steps are chosen by replay at run time, never written into a skill"* (`skill.ts:80-83`).

Feeding `issues` back is cheap and usually converges. That's the experience with structured-output retry loops, **reasoned** and not measured here.

**What to check on day 1** (see [06](06-processing-and-learning.md)): that your endpoint honours `response_format: {type: "json_object"}` for the chosen Nemotron model, and which model ID to put in `NEMOTRON_MODEL`.

---

### Stage 5 · Drill

The compiler cannot know some things from a single demonstration. It returns them as questions instead of guessing (`design.md:104`: *"Ask, don't guess"*):

| What the trace can't tell | Question | Lands in |
|---|---|---|
| Which file next time | "Always the newest `invoice-*.pdf` in ~/Downloads?" | `inputs.invoice.resolve` |
| When to run | "Run whenever a new invoice appears in Downloads?" | `triggers` → `folder_watch` |
| Is this step risky | "Ask you before pressing Submit?" | `requires_approval` |
| What "done" looks like | "Is 'Upload complete' the sign it worked?" | `success` |
| Durable facts | "Do Acme invoices always go to this portal?" | memory, `kind: "fact"` |

Give questions structure, so answers can be applied mechanically: `{ id, text, options?, default?, appliesTo: "inputs.invoice.resolve" }`.

- **Sprint 2 version:** print them in the daemon terminal and read answers from stdin, the same pattern as `main.ts:12-18`.
- **Sprint 3:** save durable answers to memory, so the next compile doesn't ask again. That is milestone 5's acceptance test (`design.md:209`).

### Stage 6 · Dry run

Replay highlights each target without acting, and you confirm (`design.md:76`). It needs Akshat's matcher, so it is Sprint 3. In Sprint 2, the stand-in is: **Akshat runs your compiled skill on `upload.html`, and it passes.**

---

## The other intake: describing a task in words

The same `compile` with a different input. Natural language gives intents, and *guessed* targets from the words ("click Submit" → `{ role: "button", name: "Submit" }`), with no fallbacks and no verification.

Those targets must be **grounded** before the skill is trusted: at dry run, the matcher or agent finds each one on the live page and you confirm it. That makes NL input depend on the dry run, so it belongs in **Sprint 3**. Images and video join this same path ([04](04-capture-without-coordinates.md#so-what-is-the-screen-recording-for)).

## The seams your work crosses

Every item here is a file someone else also depends on. Agree on each one before writing it:

| # | Seam | File | Owner | Agree on |
|---|---|---|---|---|
| 1 | Trace format | `packages/core/src/trace.ts` (new) | joint | `TraceEvent` fields; `messages.ts:34` becomes an enum |
| 2 | Element description | `apps/extension/src/describe.ts` (new) | joint | One function used by recorder **and** matcher (`descriptor.ts:15-16`) |
| 3 | Content script build | `apps/extension/build.mjs:10-13` | joint | `content` entry → `format: "iife"` |
| 4 | Tab/frame context | `background.ts:67` | Akshat | Add `sender.tab.id`, `sender.frameId`, `sender.url` |
| 5 | Trace persistence | `daemon.ts:50-53` | Akshat | Hook `trace-store.ts` into the `record.event` case |
| 6 | Role vocabulary | matcher vs `log-weekly-hours.json:31` | joint | `textbox`/`spinbutton`/`searchbox` equivalence, or fix the example |
| 7 | Template grammar | `{{inputs.invoice}}`, `{{inputs.invoice.name}}`, `{{today}}` in `skills/examples/` | joint | **Used in examples but implemented nowhere.** You emit them; the player resolves them. Write the grammar down |
| 8 | Action vocabulary | `skill.ts:11-17` | joint | The compiler only emits these. The player implements all of them |
| 9 | Skill size | `messages.ts:40`, `framing.ts:7` | joint | No crops or screenshots inside skills |

---

## Memory: the second "context"

**Kind:** a place. **Status:** interface only (`packages/memory/src/index.ts:14-20`: `add`, `search`, `list`, `remove`).

| Kind (`index.ts:4`) | Example (`design.md:167-172`) | Written by | Read by |
|---|---|---|---|
| `fact` | "Invoices from Acme go to portal X" | drill answers | compiler, agent |
| `preference` | "Name uploads YYYY-MM-DD-vendor.pdf" | drill, you | compiler |
| `run_context` | an order number pulled out by an `extract` step | replay | later steps and later runs |
| `site_note` | "Portal X shows a cookie banner first" | learn-back | replay, agent |

How compile uses it: `search(skill intent or site)` → top few entries → the `memory` field of the compile prompt (as in the sketch above). For a hackathon demo, a JSON file with substring search is enough in Sprint 3. Move to SQLite with full-text search (the plan, `index.ts:22`) when it actually hurts. Memory **never stores secrets** (`index.ts:2`).

## Run-time gathering: the third "context"

Gathering context *during a run* is replay-side machinery that your skills switch on:

- **`extract`** (`skill.ts:12`) reads a value off a page into `run_context`.
- **`fallback: "ask"`** (`skill.ts:72`) and the `waiting_user` run state (`design.md:181`) pause and ask you.
- **Web search (Tavily)** is in the sheet but **not in the schema**. Adding it means a new channel or action, which is a joint schema change. Treat it as Sprint 4 at the earliest. It isn't what makes this product different.

## What the context layer is NOT

- **Not a script generator.** It emits a `Skill` (data), never Playwright or JS code.
- **Not cookie or token management.** The user's Chrome already holds the session ([08](08-faq.md#do-we-need-to-pull-cookies-or-tokens-from-the-users-browser)).
- **Not where drift is handled.** That's replay plus learn-back ([06](06-processing-and-learning.md)). But it is where drift is made *survivable*: every signal you don't capture is a fallback replay won't have.
- **Not a model being trained** on your recordings. The model is called; it never changes.
