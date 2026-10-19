# Record → workflow v2: fundamentals, capture, understanding in code, design agent v2

## Context

Three rounds of real recordings show the failures come from how parts are built, not from loose ends. The sources are
`reports/section-study.md` and the reports it cites.

**Capture is the start of the problem:**
- clicks that only selected text become steps replay can't find;
- links with no name are stored with an empty name;
- sheet cells are canvas, so a click on one has no element;
- tab switches are rebuilt by reloading the page.

**Code never generalises.** "The top job", "today's date" and "the next row" are all left to one model.

**The design agent is the only place a recording is generalised, and it doesn't work.**
- Its tools reject most of what Nemotron sends: 6 of 11 and 9 of 16 turns were rejected.
- It sees 40 steps and screen words cut to a few lines.
- It may delete everything but can't add a click.
- Nothing checks that its result still does the task. The Play Store workflow "succeeded" in 3 ms having done nothing.

Exploration on 19 Oct found further bugs the reports don't list (listed under Phase 0 and in the coverage table).

**Goal:** a recording becomes a workflow that does what the person *meant*.
- Capture records facts completely and never loses them silently.
- Code finds patterns and proposes generalisations, with evidence.
- A rebuilt design agent decides what was meant, tests the workflow itself in a safe mode, asks only what the evidence
  can't answer, and shows its changes for review.

Replay and recovery stay out, except the pieces record needs.

## Decisions (with Rushil, 19 Oct)

| Question | Decision |
|---|---|
| Order | Bugs and fundamentals → capture and understanding in code → design agent v2. **All of it now**, not paced over days |
| Framework | **Our own staged orchestrator** in TypeScript on `packages/agent`. No LangGraph, CrewAI or ADK |
| Replay side | **Build only what record needs:** a timeout on every DevTools call, steps that name their tab (multi-tab automation window), the safe test-run mode, `{{today}}` formats, keys with modifiers. Sheet writing and MCP come later. **Akshat reviews** the `skill.ts` and player changes in the PR |
| Real model | **I may spend up to $5** on real design runs. Each run is announced first with its estimated cost, and a ledger keeps the total |
| Record form | It stays a goal box with three switches (already the case on main). Frequency and Never are worked out after, and shown in the review |
| Private words (trade-off, **needs your OK**) | With no Never field before recording, Never-word masking no longer happens before screen words and the transcript reach the model. Only patterns (emails, cards, phones, keys, IBANs) are masked, while `docs/product.md` still promises Never masking. **Recommended:** an optional, folded "Private words" line under the goal box, empty by default and never required; masking uses it as today. Alternative: patterns only, and fix the privacy text |
| Old code removed (**approving this plan approves these removals**) | `packages/recorder/src/design/design.ts`, `design/tools.ts`, `design/changes.ts`, their tests in `design/design.test.ts`, and the dead model path in `compile.ts` (`compile.ts:132-221`: the one-call compile and `systemPrompt`). `describeChanges` is kept by moving it into the new `design/` files. Nothing else is deleted |

## The shape: who does what

```
Record ─► CAPTURE (code, on the Mac)        facts: events + effect, list position, cells, tabs, pictures, voice
Stop   ─► UNDERSTAND IN CODE (no model)     one timeline · steps by what they did · noise removed (listed)
                                            · proposals with evidence (loop, {{today}}, list item, open directly)
       ─► DESIGN AGENT v2 (Nemotron Super)  understand → build → test run (safe) → fix → ask → finish gate
       ─► REVIEW (you)                      added / changed / removed / not tested, highlighted, with reasons
       ─► saved as v1
```

**Why generalise in code too.** Take the KPI recording:
- five copy→paste pairs: code can prove these are the same shape;
- a typed "19 Oct": it equals the recording day, so it's a date;
- an email that was item 1 of 50 in the inbox list.

Those are structural facts. Code finds them exactly, for free, the same way every time, and tests can pin them down.
What code *can't* know is intent: "the newest one" versus "this exact email". So **code proposes, the agent decides,
and code checks**. Code never applies a generalisation silently: if it did, it would make the Play Store mistake from
the other direction.

**The tool error that blocks most of today's generalisation disappears.** With a prepared proposal, the model's
generalising step becomes `accept("p3")`, not a hand-built loop in nested JSON.

## Phase 0: bench, data-corrupting bugs, fundamental replay hooks

**0.1 Branch:** `feat/record-v2` from `main` (`2c32049`).

**0.2 Bench, so every later claim is measured:**
- Fixture recordings in `fixtures/recordings/{yc-top-job, kpi-email-to-sheet, playstore-to-chat, timesheet}/`.
  - Each holds `trace.jsonl`, `screen.jsonl`, `transcript.jsonl`, `description.json`, plus `expect.json`, which is
    the yardstick in Rushil's words turned into checks.
  - Check types: `has_loop_over`, `uses_today`, `write_kept`, `no_text_only_target`, `trigger`, `max_questions`,
    `not_asked`.
  - The first three are rebuilt from the reports' facts, with identifiers masked, and are synthetic only.
  - **Real recordings never go into git:** they hold real email contents and sheet ids, and the repo is public.
    Akshat's Oct 19 copies (**deleted on his Mac Oct 20, 11:34 / 11:56**) stay in `~/shadow-tests/`, and the eval
    reads that path. They're in the *old* trace format (no effect, list position, cell or `select_text`), so the
    evidence builder must accept missing fields, and they test Phase 3 on old-format input only.
  - `expect.json` marks known gaps **expected to fail** (⚠), such as "writes to the next empty row" in KPI and YC, so
    the final runs don't read as regressions.
- `scripts/design-eval.ts` → `pnpm design:eval <fixture|recording> [--real] [--model id]`.
  - Runs normalise → evidence → design, with the fake model or the real one.
  - Prints a ✓/✗ row per expectation, plus cost, calls and questions.
  - `--real` appends to `testing/design-eval-ledger.md`, and refuses to start if the ledger total + this run's
    estimate would pass $5.

**0.3 Data bugs, each with a failing test first:**
- **H1, the id is overwritten:** `label_steps` overwrites the daemon's skill id, so a new recording can be saved as vN
  of an older workflow (`compile.ts:382-385` merge, `record.ts:208`). Fix: the id and name are the daemon's, always.
- **H3, nested steps:** `applyAnswer` only finds top-level steps (`drill.ts:82-96`), so answers about a step inside a
  loop fail. Fix: use `walkSteps`.
- **H5, no context:** the drill asks without the step or the draft (`drill.ts:23-45`). Fix: pass both.

**0.4 Agent loop record-keeping** (`packages/agent/src/agent.ts`). All four are opt-in flags, so repair is unchanged:
- read `reasoning_content` / `reasoning` from replies and store it in `reply` events;
- store the raw input of invalid calls;
- save the full system prompt, including the rules suffix;
- `multiCall`: run every call in a turn, in order (cap 8), and return all the results.

**0.5 Vision:** metered against the design budget, and cached by picture hash (`apps/daemon/src/describe.ts`,
`packages/llm/src/vision.ts`).

**0.6 Fundamental replay hooks** (P9 / P7):
- **A timeout on every DevTools call**, in `apps/extension/src/replay.ts` `cdpFor().send`:
  - 15 s, or 30 s for navigate and screenshot;
  - on an `Accessibility.*` timeout, bring the automation window forward and retry once;
  - the error reads "Chrome did not answer X in 15 s" and is classed as environment, not unknown
    (`packages/player/src/repair/classify.ts`).
- **A run that did nothing isn't "succeeded"** (`packages/player/src/run.ts`): no action ran and no success check →
  `nothing_done`.

## Phase 1: capture (R1–R8)

**Where the web changes go:** `apps/extension/src/{capture,describe,background,shot}.ts`, a MAIN-world hook script, and
`apps/extension/src/adapters/google-sheets.ts`. New fields and events go into the trace schema
(`packages/core/src/trace.ts`), which strips unknown keys.

| # | What changes | Fixes |
|---|---|---|
| 1.1 | **Selecting text is its own event, `select_text`:** drag, double or triple click. It holds the text (≤2,000 chars, the same secret rules as copy) and the smallest element containing the selection. The click the browser fires afterwards isn't recorded | selection clicks becoming container steps |
| 1.2 | **Copy records the smallest element whose text equals or contains the copied text**, not the selection's anchor node, plus `via: keyboard \| menu \| button`. A page's "Copy" button (`navigator.clipboard.writeText` / `execCommand`) is caught by a MAIN-world hook and tied to its click | H10: extract read the whole element; H15: button copies lost |
| 1.3 | **Every click records what it did (`effect`)**, watched for 700 ms: navigated / opened a tab / expanded / opened a menu or dialog / changed the page / nothing; and whether a field was emptied (Enter that sends). "Changed the page" is measured **against the page's own background churn** in the 700 ms before the click (Gmail re-renders constantly), and only changes near the target or caused by it count | noise vs action vs reading; chat send not outward |
| 1.4 | **List position:** a click or copy inside one of ≥3 same-shaped siblings (listitem, row, article, gridcell, or same tag + stable classes) records `list {container, index, count, itemText}` | "the top job" was lost |
| 1.5 | **Names for nameless links and cards:** accessible name → title → img alt → heading inside → first text → last part of the href, with `nameFrom` | YC card recorded as `link:''` |
| 1.6 | **Generated ids:** `GENERATED` also catches Google's (`:1g`, `19fml5:17`) and UUIDs. **`href` is no longer dropped for containing digits** (kept, plus `hrefShape` with numbers as `*`) | per-session ids; H9: links with ids could never become "open this page" |
| 1.7 | **The page an event happened on** is the content script's `location.href` at that moment. It's already in the trace as `target.url`; normalise reads it first | stale address in single-page apps |
| 1.8 | **Keys:** shortcuts with ⌘/Ctrl/Alt anywhere, and single-key shortcuts outside text fields (Gmail `e`, `c`), recorded with their modifiers. **Never a keylogger:** a burst of printable keys (≥3 within 1 s) is typing, not shortcuts, and isn't recorded as keys; adapter domains (Sheets, Docs: canvas editors) record no single keys at all | H16: shortcuts lost |
| 1.9 | **⌘-click and middle-click** recorded with `newTab: true` | H17 |
| 1.10 | **Click point** (x, y, device pixel ratio, element box): **evidence only**, used to find the words and the part of the picture around the click. Locators still never use positions | words around a click chosen by text match |
| 1.11 | **Google Sheets adapter:** after a click, typing or a paste in a sheet, read the Name Box (cell `B3`), the formula bar (its value) and the active sheet tab → `cell {ref, value, sheet}`. A copy's row comes from the cell, not from "the first cell equal to the copied text". The DOM ids are checked on a live sheet in Phase 1 testing; the adapter interface leaves room for Docs and Maps | canvas cells; H11: wrong row when a value appears twice |
| 1.12 | **Tab registry per recording:** each tab's first address and title, its opener, whether it was open before Record, and its window. `window_focus` when you switch Chrome windows | H18; tab cases in 2.4 |
| 1.13 | **Shadow's own prompts never recorded** (universalAccessAuthWarn, UserNotificationCenter, SecurityAgent). Permissions are checked when you press Record, so the Screen Recording prompt comes before recording (`apps/mac/Sources/Recorder.swift`, `record-control.ts`) | macOS prompts recorded as steps |
| 1.14 | **Move to Trash recorded (`fs_trash`):** Finder's Move to Trash (menu or ⌘⌫, reported by Shadow.app) paired with the file vanishing (`fs-watch.ts`). Needs approval | Finder deletes not recorded (K3) |
| 1.15 | **No silent picture loss:** every action that should get a picture gets a line in `shots.jsonl`: taken / password / tab hidden / rate limit / error / unreadable → deleted. The Record screen warns *before* recording if Shadow.app can't read or mask pictures; today it deletes every picture and logs once | "screenshots aren't taken" |
| 1.16 | **Fewer pictures lost:** a small priority queue instead of "the newest replaces the waiting one". A click that opens a new tab is pictured when that tab shows | H14 |
| 1.17 | **Before and after:** a step's "before" picture is the previous picture of the same tab (free); its "after" is its own | what changed |
| 1.18 | **`screen.jsonl` keeps each line's box,** up to 8,000 chars per picture. "Around the click" is chosen by position (1.10), not by text match | H20: lower part of long pages lost |
| 1.19 | **What appeared:** lines in the after picture that weren't in the before picture ("Copied", "Message sent", a new row), kept per step. **Only these may become checks** | invented checks |
| 1.20 | **Transcription runs alongside picture reading,** so Stop is faster (`main.ts:231-238`) | |

Swift changes (1.13, 1.14) need **Rushil's `pnpm setup:mac`**: I don't rebuild `apps/mac/build`.

**Checkpoint 1: live capture, before any Phase 2 work.** Phases 2 and 3 build on a trace format nobody has recorded
yet. Fixtures I write myself would only test my own assumptions, which is how 348 passing tests happened. So:
- **Who:** Rushil, with the rebuilt dev extension (reload in `chrome://extensions`) and Shadow.app (`pnpm setup:mac`).
  I can't record.
- **What, two short tasks, Screen + Voice on:**
  - **A, fixture + two tabs:** a test Google Sheet in tab 1, `http://localhost:5173/paste-form.html` in tab 2 (from
    `pnpm fixtures`).
    1. Double-click a word in a sheet cell, then copy the cell.
    2. Switch tabs a few times.
    3. Paste into Amount and Save.
    4. Type today's date into the sheet's next empty row.
  - **B, Gmail:** open the newest email in a test label, select and copy its subject, press `e` (archive) on a
    throwaway email.
- **Gate:** I read the resulting `trace.jsonl`, `shots.jsonl` and `screen.jsonl`, and confirm all of these before
  Phase 2 starts: `select_text`, `effect` (Gmail churn measured), `list`, `cell` (Name Box ids right), tab registry,
  the shot ledger, line boxes, and no keylogging.

## Phase 2: understanding in code (R9–R10) → the evidence package

**Where:** `packages/recorder/src/`: `normalise.ts`, new `timeline.ts`, `effects.ts`, `tabs.ts`, `patterns.ts`,
`evidence.ts`; plus `skeleton.ts`, `locator.ts`.

**2.1 Steps by what they did:** act / go to / reveal / read / noise.
- Sources: the click's effect (1.3), what appeared (1.19), and whether a copy followed.

**2.2 Noise is removed and listed, not deleted silently.** Noise is:
- a click that changed nothing and wasn't followed by a copy;
- a tab switch with nothing done in between;
- focus clicks;
- double-click duplicates;
- Shadow's own prompts.

These aren't in the draft, but each is listed with its reason. The agent can put one back, and the review shows them.

**2.3 Selection + copy = one read step** on the copied element.

**2.4 Tabs.** Each tab gets a name from its page ("KPI Sheet", "Gmail"), and every page step says which tab it's in.

| Case | Becomes |
|---|---|
| Tab open before Record, used during it | opened at its first address the first time it's used |
| New tab you opened (⌘T, typed an address) | opened at the address you went to |
| Tab opened by your click (opener) | that click, or its address when the click is a plain link |
| Switch, then an action in that tab | "go to tab X" before the action |
| Switches with nothing done between them (spam) | dropped |
| Two tabs on the same site | told apart by name and first address |

**2.5 Data flow:**
- copy → paste pairs;
- copied text that reappears in typing;
- extract → its later use.

**2.6 Proposals: code-side generalisation, each with evidence, never applied by code.**

| Proposal | Found when | Change it prepares |
|---|---|---|
| repeat | ≥2 groups of steps with the same shape that differ only by list item, row or value | a loop over the list or rows, body = the first group, `{{item.x}}` in place of the values |
| list item | a click or copy on item k of a list (1.4) | "item k" / "the first" / "by its text" |
| date | a typed or pasted value equal to the recording day (or yesterday, or the week's Monday "w/c") | `{{today\|D MMM}}` in the format typed |
| next empty row | a sheet write whose row is the first empty row in the export | noted: **writing there isn't supported yet**, and the review says so |
| open directly | a chain of go-to steps ending on a page with a stable address that's used later | "open <address>" in place of the chain |
| all files | several files of the same pattern used | `pick: all` |
| constant | said or written as fixed ("always NX-202") | keep literal; no question |

**2.7 Locators:**
- no text-only container targets: a nameless click becomes a list item or a read, or is marked weak for the agent;
- Google ids gone; hrefs kept.

**2.8 Enter that empties a chat box = send →** approval.

**2.9 Step ids fixed once and used everywhere** (timeline, proposals, questions). Today the narration's "steps 4–5"
counts normalised steps, while the draft's s4/s5 are numbered differently (H12).

**2.10 Every question, including code's, goes through the evidence check before reaching you.** This is H2: "which
file next time?" was asked after "all the reports".

**2.11 Template:** `{{today|D MMM}}`, `{{today-1}}` and `{{week_start}}`.
- Files: player `template.ts`, `check.ts` reference parsing.
- A small replay change; Akshat reviews.

**2.12 One timeline instead of two lists.** It replaces the narration list with step ranges and the screen notes
attached by time.
- Speech, actions and screen words in time order; screen words are attached by event id, not time.
- This fixes H13: words landing on a step that started less than 1 s later.

```
00:03  tab "KPI Sheet": docs.google.com/spreadsheets/d/<id> (open before Record)
00:09  said: "every day I get KPI emails from my team"
00:12  s2 [Gmail] open email "Daily KPIs - w/c 19 Oct": item 1 of 50 in "Inbox"; appeared: "Daily KPIs…", "Hi All,"
00:15  said: "always take the newest one, never one already done"
00:18  s3 [Gmail] copy "Daily KPIs - w/c 19 Oct" (the open email's heading)
00:20  s4 [KPI Sheet] paste into cell A1 ← s3
```

**2.13 Captions,** with the Pictures switch on.
- **Which pictures:** **every** picture is described before the agent starts, as agreed: about $0.02 for a 42-picture
  recording on GLM-5.3-Flash.
- **How:** the masked before and after pictures, cropped around the click point when there is one, go to the vision
  model.
- **Returns** `{what it is, which item, what changed, values visible}`.
- **Limits:** cached by picture hash, so designing the same recording again is free; counted in cost.
- **What reaches the model:** the evidence builder chooses which captions to send (2.14).
- **With Pictures off:** the agent gets the masked screen words (around the click, and what appeared) and the timeline,
  and no captions. The review says which steps relied on words alone.
- **Why:** the agent never called the screenshot tool, so this no longer depends on it.

**2.14 `evidence.json` in the recording folder is the design agent's only input:**
- goal and switches;
- the timeline;
- the steps (effect, tab, target, values, what appeared, caption);
- proposals, data flow, tabs;
- dropped noise;
- memory found by code.

All steps go in, compactly, so there's no 40-step cut.

**Size cap: ≤ 24k tokens** for stage 1 (measured with the client's token estimate), so it fits the budget and the
context.
- **Each step gets, in order:**
  1. one line (what it did, tab, target, value);
  2. what appeared after it;
  3. the screen lines nearest the click point (≤ 6);
  4. its caption (≤ 200 chars).
- **Speech and proposals** are never cut.
- **If over the cap,** steps classed noise or reveal lose their screen lines and captions first, then repeated pages
  are shown once.
- **The rest stays on request:** `look(step)` returns a step's full evidence.

## Phase 3: design agent v2 (D1–D7)

**Where:** `packages/recorder/src/design/`, rewritten as `orchestrator.ts`, `understand.ts`, `tools.ts`, `gate.ts`,
`prompt.ts` (old code removed). The loop is `packages/agent` with the 0.4 flags on. The model is Nemotron 3 Super;
`SHADOW_MODEL_SMART` swaps it for a comparison within the $5.

| Stage | Who | Gets | Produces |
|---|---|---|---|
| 1 Understand | model, 1 structured call (≤2 retries on schema errors) | the evidence package | the **task model** |
| 2 Build | model, tool loop, several calls per turn | task model + draft | workflow |
| 3 Test run | code, safe mode | workflow | per step: found / ambiguous / not found, values read, items picked |
| 4 Fix | model | test report | workflow (≤2 rounds of test + fix) |
| 5 Ask | code, then you | unknowns left after the evidence check | answers |
| 6 Apply | model | answers | workflow (tested again if its structure changed) |
| 7 Finish gate | code | workflow + task model + test report | accepted, or the gaps go back to the model (≤2 times); otherwise saved with the gaps listed |

**Budget:** ≤ $0.25 and ≤ 40 calls per design. Today's 16 turns cost $0.085, mostly re-sent context. Here the full
package is sent once, in stage 1. Later stages get the task model, the outline, and details on request.

**The task model (the thinking layer):** saved in `design.json`, and summarised in plain words in the progress feed.
- **outcome:** what's true when the task is done;
- **cadence:** with the words it came from;
- **values:** each recorded value → constant / you give it / today / from step X / list item / worked out by AI, with
  evidence. *Recorded values are examples, not the task*;
- **rules:** every rule you said or wrote, quoted → how it will be built (this is the ledger the finish gate checks);
- **proposals:** accept or reject, with a reason;
- **unknowns:** what the evidence can't answer, why it matters, options, a default.

**Tools** (build, fix and apply stages):

| Tool | What it does |
|---|---|
| `accept(p)` / `reject(p, why)` | applies code's prepared change (loop, `{{today}}`, list item, open directly) |
| `remove(steps, why)` / `restore(step, why)` | drop steps, or bring back one code dropped as noise |
| `add(after, step, why)` | any step: click, type, open, read… A new target is "unverified" until the test run finds it on the live page |
| `change(step, fields, why)` | intent, values, target, tab, check, wait, output name |
| `move(step, after)` | reorder |
| `loop(steps, over, item)` / `branch(steps, if, else?)` / `ai_step(after, instruction, inputs, output)` | structure |
| `trigger(cadence)` / `input(name, default, about)` | how often it runs; values it starts with |
| `look(step \| proposal \| timeline range)` | details on request |
| `ask(question, why, step, options, default)` | queued, evidence-checked, never asked twice |
| `test()` / `done(summary)` | run the test; go to the finish gate |

**Forgiveness, so tool syntax stops eating turns:**
- JSON-string arguments are parsed.
- A step missing `type` or `channel` is filled in from its action (`do`).
- Using the wrong tool gets the right call back ("to repeat steps, use `loop(steps, over)`").
- An unknown id gets the list of real ids.
- Every call in a turn runs, in order.

**Rules v2: guardrails, not handcuffs.**

| Kind | Rule |
|---|---|
| **Never** (refused) | turn an approval off; script or shell steps; change your goal; open a site no tab of the recording visited (ask instead); touch files outside folders the recording touched (ask instead); anything matching Never |
| **Allowed, reported, highlighted** | remove, change or add steps (new clicks and typing too), change targets, shortcuts, reorder, set the frequency |
| **Always added by code** | approval on every outward step (send, submit, pay, delete, post, trash, Enter-that-sends), including steps the agent adds |
| **Finish gate** (code) | every write you showed still happens (kept, in a loop, replaced, or its removal flagged for your OK); every rule you said is built or listed "not built: why"; checks use only text that appeared in the recording (1.19) or the test run, never on canvas apps, never empty; the test run passed or each failure is explained; unattended inputs have defaults; the frequency matches what you said |
| **Prompt injection** | page and email text stays inside `<untrusted_data>`; any sending step the agent adds needs your approval and is highlighted |

**The prompt** is rewritten to about 80 lines.
- **What it says:** role → principles (do what they meant; recorded values are examples; build every stated rule or say
  why not; prefer accepting proposals; ask only what evidence can't answer) → the task model's fields → tools, with one
  worked example (KPI).
- **What it drops:** the stale "code and one model call" text and the restricting lines ("controls come only from the
  recording", "never invent a click").

**The test run in safe mode** (daemon `rehearse.ts` runs `runSkill` with an automatic `walk` + `highlight`):
- **Done for real (allow-list, nothing else):**
  - open pages and switch tabs;
  - clicks on **links, tabs, menus and expanders** (role link / tab / menuitem that opens a submenu /
    `aria-expanded` / `<summary>`) whose recorded effect was "went somewhere" or "opened something";
  - reading and extracting, finding files;
  - AI steps (≤3 calls).
- **Only found and highlighted, never done:**
  - every **button** that isn't an expander, and any control whose name is an action verb (archive, delete, mark,
    move, label, star, assign, approve, send, submit, pay, post, save…), even when its recorded effect was "went
    somewhere". Gmail's Archive returns you to the inbox but archives the email, so effect alone isn't safe;
  - typing, pasting into cells or documents;
  - uploads, submit / send / anything needing approval;
  - file move / rename / trash, downloads;
  - clicks whose recorded effect changed the page.
- **Side effects of reading are named.** Opening an email marks it read, and that can change what "the newest unread
  one" picks next time. So when the test run opens messages, the feed says so before it starts ("opening 1 email will
  mark it as read"). Where the task depends on unread state, the agent tests from the list without opening the
  message.
- **Before it starts**, the feed says what it will and won't do. If the agent wants a highlighted-only step done to reach
  a later page, it says why. The step still isn't done, and the rest is checked from the recorded page.
- **Afterwards** it closes the tabs it opened. Your own windows are never used.
- **New targets** get their locators from the live element.
- **Player work it needs** (Akshat reviews):
  - `step.tab` + one tab per name in the automation window, with the debugger attached per tab (`replay.ts`);
  - the timeouts (0.6);
  - the template formats (2.11);
  - `web.press {key, modifiers}`.

**Questions: who writes, who answers.**
- **Writers:** code (Phase 2) and the agent (the task model's unknowns, plus `ask`).
- **Answered in this order:**
  1. code's evidence check (memory included);
  2. the agent, which must answer from evidence with a quote or keep the question;
  3. **you, only what's left**.
- **How you're asked:** in one batch on the Record screen, next to the step and why it matters, with options, your own
  answer (Enter sends, paste works), and "you decide" (takes the default).
- **Never asked twice:** questions are de-duplicated by what they change.

## Phase 4: screens (`apps/ui`, `apps/daemon`)

**4.1 Live progress on the Record screen,** in plain words, streamed from picture reading, transcription and every
design stage:
- "Reading 42 pictures…"
- "You said 5 rules"
- "Removed 6 clicks that only selected text"
- "Testing in the automation window: step 4 ✓ found 'KPI Sheet'"
- "1 question for you"

How:
- **New SSE event** `{type:"progress", sessionId, line}`, wired from `onEvent` (`record.ts`). `useEvents` reads event
  contents; today it only reloads.
- **Where the lines are kept:** in `design.json`, and shown on the workflow page under "How this was made".

**4.2 Questions:** only this recording's (today every open question shows); Enter sends; your own answer always
offered.

**4.3 Review:** after design, the workflow opens with Added / Changed / Removed / Not tested badges and the reason for
each, plus "What you said → what was built". It's kept in a sidecar `skills/<id>/review.json`, not in `skill.ts`.
- **Go live and schedules** wait for "Looks right". Run now works.
- **After saving,** the Record screen goes to the new workflow (H24).

**4.4 Copy and paste** are already fixed on main (`b87397b`). They need Rushil's Shadow.app rebuild; checked in the
live test.

## Every open issue → fix (completeness)

| Section | Open issue (section-study appendix + new) | Fix |
|---|---|---|
| R1 | selection clicks → containers · nameless links · canvas cells · stale address | 1.1/1.2/2.3 · 1.5 · 1.11 · 1.7 |
| R2 | switches rebuilt by reload; window switches; pre-opened tabs | 1.12, 2.4, tab player work |
| R3 | macOS prompts recorded · nameless AX elements | 1.13 · captions 2.13 (Numbers cells: limit) |
| R4 | deletions not recorded | 1.14 |
| R5/R6 | silent picture loss · words cut · no before/after | 1.15–1.19 |
| R7/R8 | alignment drift · screen words on the wrong step | 2.9, 2.12 |
| R9 | selection / reading clicks kept · repetition not recognised · Drive detour | 2.1–2.3 · 2.6 repeat · 2.6 open directly |
| R10 | text-only targets · Google ids · list position · typed dates · Enter-to-send | 2.7 · 1.6 · 1.4 · 2.6 + 2.11 · 1.3 + 2.8 |
| D1 | 40-step cut · tokens re-sent | 2.14 · staged budget |
| D2 | invented checks · literal values | finish gate + 1.19 · task model values + proposals |
| D3 | `id` misuse · edits as string · wrap in edit · missing type · empty loop · `save_as` · pictures unused | v2 tools + forgiveness · captions in code |
| D4 | the work can be removed | finish gate |
| D5 | repeated / unchecked questions · lost questions · no context | 2.10 + question order · H5 · batch on Record screen |
| D6 | accepts a workflow that doesn't do the task | finish gate + test run |
| D7 | no reasoning · invalid input not kept | 0.4 + task model |
| Fundamental #4 | DevTools hang · one tab | 0.6 · tab player work |
| Fundamental #3 | "succeeded" doing nothing | 0.6 `nothing_done` + finish gate |
| New | H1 id overwrite · H3 nested answers · H4 baseline before labelling (gone with v2) · H6 vision unmetered · H8 no progress · H21 stale prompt · H22 Enter does nothing · H23 every open question shown | 0.3 · 0.3 · Phase 3 · 0.5 · 4.1 · Phase 3 · 4.2 · 4.2 |

## Not this round

Each of these will be named in the review wherever it affects a workflow.
- **Writing into a sheet's next empty row, and MCP / Nango.** The proposal is recorded but not runnable.
- **The matcher using text and `near`** (P3).
- **Repair and the ladder** (X1–X6). One item is flagged to Akshat as dangerous: the "Print all" retarget, committed
  without review.
- **Tavily.**
- **Canvas Mac apps** (Numbers) beyond captions.

## Verification

- **Each phase** keeps `pnpm test`, `pnpm typecheck` and `pnpm lint` green. Every fix starts as a failing test on a
  synthetic trace (TDD).
- **Bench with the fake model** (runs in `pnpm test`):
  - all fixture expectations pass for a scripted correct agent;
  - the finish gate refuses the scripted bad behaviours seen in the reports: delete all the steps, an invented check,
    an `id` misuse, an empty loop.
- **Real model**, at most $5, each run announced with its estimate:
  - after Phase 3, then after fixes, then final;
  - on the four fixtures (≈ $0.10–0.25 each);
  - `pnpm design:eval --real`, logged in `testing/design-eval-ledger.md`.
- **Live capture: Checkpoint 1** (end of Phase 1, a gate before Phase 2). Rushil records tasks A and B, and I read
  `trace.jsonl`, `shots.jsonl` and `screen.jsonl`.
- **Checkpoint 2** (end of Phase 2): the same two recordings through `evidence.json`. I check the timeline, the effect
  classes, the noise list, the proposals (repeat, date, list item) and the size cap.
- **Checkpoint 3** (end of Phase 3): the first real `design:eval` runs ($5 ledger), then a full record → review on
  Rushil's Mac, including the safe test run in the automation window.
- **End:** Rushil re-records KPI, Play Store (one report, two months) and YC, and I fill the
  `test-plan-record-replay.md` verdict table.

## After approval

1. `git switch -c feat/record-v2 main`.
2. Save **this file, verbatim,** as `docs/superpowers/specs/2026-10-19-record-v2-design.md` and commit.
   **Approving this plan approves that spec**, so writing-plans follows without another review round.
3. `superpowers:writing-plans` → `docs/superpowers/plans/2026-10-19-record-v2.md`: tasks in phase order, each TDD,
   with exact files. Rushil picks how it's executed, then work goes phase by phase with a commit per task. Push only
   when asked.
4. Memory: the $5 real-model budget for design evals, and "do it now, not paced over days".
