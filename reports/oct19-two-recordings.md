# Two recordings, section by section (Oct 19, 2026)

**The 11 quick fixes (PR #13) work as built; the design agent still can't use its tools, and two older replay faults hit again.** Both recordings were made on `main` at `b602e73`, which includes every fix since the second report. Capture was good in both: tab switches are now recorded, copied values are exact, masking held, and the narration is accurate.

**A · KPI email → sheet.** The agent set "every day" as a schedule (new rule, working) and the history says honestly what changed. But all three of its questions were silently dropped, and 6 of its 11 turns went on calls the tools rejected, so nothing that makes the task repeatable got built: the newest email only, the right week columns, the next empty row. On replay:
- the cheap fixer (the ladder) fixed one step correctly;
- then it fixed another *wrongly*, retargeting a meaningless click onto Gmail's **"Print all"** button, and saved that as v3;
- from there every step hung ("extension did not answer"), the third time this hang has been seen.

**B · Play Store reports → Google Chat.** The agent **deleted all 20 recorded steps** and kept a single "find files in Downloads". It ran, "succeeded" in 3 ms, and did nothing. It had tried four times to put the steps in a loop and failed each time, because the `edit` tool rejects an empty loop, and the error doesn't say that `wrap_in_loop` exists. Letting the agent remove steps (fix 5) without checking at `finish` that the work still happens made this possible.

Verdicts use the sections of [`test-plan-record-replay.md`](test-plan-record-replay.md): ✅ works · 🟡 partly · ❌ breaks · — not exercised. Identifiers are masked (`<sheet-id>`, `<dev-id>`, `<email>`).

---

## 1. What was recorded

### A · KPI email → sheet (11:29–11:32, run 11:35–11:40)
- **Form goal:** "Every day i frequently recieve kpi emails from my team. my goal is to add them to a sheet in my drive"
- **Shown:**
  1. Opened the sheet (tab "KPI Sheet").
  2. In a second tab, opened Gmail and clicked the newest email, "Daily KPIs - w/c 19 Oct".
  3. Copied the subject → `A1`.
  4. From the email's tables, copied Tickets Resolved `4,928` → `B1`, `4,862` → `C1`, and Cost per Resolved Ticket `₹131` → `D1`, `₹142` → `E1`.
  5. Switched between the two tabs ten times.
- **Said (18 pieces), the rules:**
  - the email can come many times a day, from anyone, with the same kind of subject;
  - take the newest, and never one already done;
  - take two sections (Tickets Resolved; Cost per Resolved Ticket) for the current and previous week;
  - "the weeks will change as the time grows";
  - do it again and again.

### B · Play Store reports → Google Chat (11:51–11:54, run 11:58)
- **Form goal:** "I have this task of getting all the stats from play store for my app and then send them to an space in google chat"
- **Shown:**
  1. Play Console → Download reports → Statistics → 2026 → expanded Installs.
  2. Downloaded the March "Android version" report (CSV).
  3. Opened it in Numbers; macOS also asked for Screen Recording.
  4. In Google Chat, the space "Arilo Stats": upload, dropped the CSV, typed `Date - 19 Oct`, pressed Enter.
- **Said (22 pieces), the rules:**
  - do it for **every report** (overview, Android version, app version…);
  - for **every month from March to October**;
  - each file goes to the Chat space with **today's date**.

---

## 2. The verdict table

| Section | A · KPI | B · Play Store | Evidence |
|---|---|---|---|
| **Record** | | | |
| R1 web capture | ✅ | 🟡 | A: copies exact (`4,928`, `₹131`), cells named (`A1`–`E1`). B: events on `/download` are labelled `/app-list` (stale page address in a single-page app, trace 7–10) |
| R2 tab capture | ✅ | ✅ | `tab_switch` recorded: A ×10, B ×2 (new in PR #13) |
| R3 Mac-app capture | — | 🟡 | B: Numbers clicks recorded as nameless `AXScrollArea`; **Shadow's own Screen Recording prompt** (`universalAccessAuthWarn`, System Settings) recorded as part of the task (trace 16–30) |
| R4 file capture | — | ✅ | B: the download, the file arriving in `~/Downloads`, and the file dropped into Chat |
| R5 screenshots | ✅ | ✅ | A: 42, B: 13 |
| R6 OCR + masking | ✅ | ✅ | A: the email address masked `███`; B: only lone `@` icons, no addresses |
| R7 transcription | 🟡 | ✅ | accurate overall; A mishears a few words ("tickets resort", "scoreguard") |
| R8 narration alignment | ✅ | ✅ | every piece marked with its step range in the first message |
| R9 normalise | 🟡 | 🟡 | noise kept as steps: clicks to read or select (A: "Print all In new window…", "Hi All,", "21 min"; B: the side menu, "Crashes…2026"); A writes to **row 1** |
| R10 first draft / locators | 🟡 | 🟡 | container-text targets (A s5, B s2/s5); **Google's per-session ids stored as attributes** (A s2 `id: 19fml5:17`, which failed next time) |
| **Design agent** | | | |
| D1 what it was given | 🟡 | ✅ | A: only steps 1–40 of 52 in the first message ("… and 12 more"); B: all 20 |
| D2 `label_steps` | 🟡 | 🟡 | sensible intents; many checks `{}` (empty); values left literal (A: no week, no date; B: `19 Oct`) |
| D3 tools | ❌ | ❌ | §3: dropped questions, rejected edits, `wrap_in_loop` never used |
| D4 rules stated vs built | ❌ | ❌ | §4: 1 of 5 rules built (A), 0 of 5 (B) |
| D5 reasoning | ❌ | ❌ | A: 6 of 11 turns rejected; B: 9 of 16; no screenshot looked at in either |
| D6 changes | 🟡 | ❌ | A: schedule + labels only; B: every recorded step removed |
| D7 questions | ❌ | 🟡 | A: 3 asked, 0 reached you; B: none asked, one left for the drill |
| D8 rules and refusals | 🟡 | ❌ | B: removing all the work allowed; adding back a click refused (right rule, dead end) |
| D9 honesty | 🟡 | 🟡 | history = real changes ✅ (PR #13); the agent's own `claimed` is false in both; `finish` accepted with nothing built ❌ |
| D10 cost | 🟡 | 🟡 | A $0.086, 11 turns, 246k tokens in; B $0.085, 16 turns, 238k in: near the $0.10 cap, ~15–22k tokens per turn re-sent |
| **Replay** | | | |
| P1 start | ✅ | ✅ | |
| P2 navigation, tabs | ✅ | — | A: sheet → Gmail opened in order |
| P3 finding targets | 🟡 | — | A s2: per-session id → not found; s4 ✅ (same day); s5 container → not found |
| P4 actions | ❌ | ❌ | A: never reached a paste; B: no action left to run |
| P7 checks, success | — | ❌ | B: "succeeded" in 3 ms with nothing done: no success check, no work |
| P9 DevTools calls | ❌ | — | A: every step after "Print all" hung 35–50 s |
| **Repair** | | | |
| X1 was repair right | 🟡 | — | A s2 ✅ drift; s5 ❌ not drift (a meaningless click), but "fixed"; s7 the hang |
| X5 changes | ❌ | — | **v3 retargets a reading click onto "Print all"** |
| X6 tries | ❌ | — | 4 tries, all hung |
| X7 outcome | ❌ | — | out of turns (12) after 3 min, $0.051 |

---

## 3. The design agent's tools, call by call

### A · KPI (11 turns)

| Turn | Tool | Input | Result | What it did next |
|---|---|---|---|---|
| 1 | `label_steps` | intents and checks for 52 steps | ✅ | — |
| 2 | `ask_user` | `id: "metric_extraction_method"` + its own question (which week columns) | ❌ *"No open question metric_extraction_method. Open: "* | moved on: **question lost** |
| 3 | `edit` | schedule `0 9 * * *`, intent | ✅ | — |
| 4 | `ask_user` | `id: "week_handling"` + question | ❌ same | moved on: **lost** |
| 5–7 | `edit` | (not recorded) | ❌ *"edits: expected array, received string"* ×3 | the same call three times |
| 8 | `ask_user` | `id: "destination_cell"` + "overwrite A1:E1 or append to the next empty row?" | ❌ same | moved on: **lost** |
| 9 | `workflow` | start | ✅ | — |
| 10 | `edit` | read column A of the sheet; check the subject isn't there; `op: "wrap_in_branch"` around s13–s51 | ❌ steps without `type`; `wrap_in_branch` isn't an edit op | gave up |
| 11 | `finish` | "…kept the core steps… writing to cells A1:E1 (overwriting each run), and added a placeholder…" | ✅ accepted | — |

**Turn 10 is the right design** (read the sheet, skip a done email, branch). It failed only on tool syntax.

### B · Play Store (16 turns)

| Turn | Tool | Result | Note |
|---|---|---|---|
| 1 | `label_steps` | ✅ | added a file input `stats` (Downloads, newest) |
| 2 | `edit` (schedule monthly + input) | 🟡 1 of 2 kept | partial edits (PR #13) working |
| 3 | `edit` | ❌ `"after"` at the wrong level | |
| 4 | `edit` | ❌ step without `type` | |
| 5 | `edit` | 🟡 `find_files` kept; removing the input refused (s16 uses `{{stats}}`) | the step's `save_as` is ignored: `edit` doesn't turn it into an output |
| 6, 7 | `edit` | ❌ a loop with `steps: []` (must have ≥ 1); duplicate id | **it needed `wrap_in_loop`** |
| 8–10 | `workflow`, `edit`, `workflow` | ❌ the input still used by s16 | |
| 11 | `edit`: **remove s1 … s20** | ✅ accepted | **every recorded step gone** |
| 12 | `edit`: navigate to Chat, click the space, an empty loop | 🟡 navigate kept; the click refused (new click); the loop refused | dead end: what it deleted can't be added back |
| 13 | `edit`: remove the navigate | ✅ | |
| 14, 15 | `edit` | ❌ *"expected array, received string"* ×2 | |
| 16 | `finish` | ✅ accepted, with one `fs.find` step | |

### Tools never used (both)
- **`wrap_in_loop`**: the one tool that does what B needed.
- **`wrap_in_branch` as a tool** (A tried it as an edit op).
- **`add_llm_step`**: picking the newest email and the week columns.
- **`describe_step_screenshot`**, despite 8 (A) and 2 (B) steps marked nameless.
- **`recall`** and **`read_recording`** (A was cut at step 40).

---

## 4. Rules stated vs built

| Rule | Where | Built | |
|---|---|---|---|
| **A** runs every day | goal: "Every day" | schedule `0 9 * * *` | ✅ |
| **A** the newest KPI email | narration | a fixed click on the 19 Oct email row | ❌ |
| **A** never one already done | narration ×2 | — (tried in turn 10, failed) | ❌ |
| **A** the current and previous week's columns | narration: "the weeks will change" | fixed copies of `4,928`, `₹131`… by position | ❌ |
| **A** the next row, not row 1 | (implied: "again and again") | `A1`–`E1` every run | ❌ |
| **B** every report type | narration | — | ❌ |
| **B** every month, March → October | narration | — | ❌ |
| **B** upload each to the Chat space | shown | removed | ❌ |
| **B** today's date above it | narration: "today's date" | removed (was `Date - 19 Oct`) | ❌ |
| **B** how often | narration: a backfill, then monthly? | schedule `0 9 1 * *` | 🟡 |

---

## 5. Replay and repair, A

| Time | Step | What happened | Verdict |
|---|---|---|---|
| 11:35:17 | s1 open the sheet | ✅ | |
| 11:35:28 | s2 click the "KPI Sheet" tab | ❌ not found: the stored attribute `id: 19fml5:17` is Google's per-session id | |
| | ladder: fuzzy match | retargeted, tried, **v2** | ✅ right fix |
| 11:35:41 | s5 "Expand the email body" (a click on the header block) | ❌ not found (container text) | |
| | ladder: fuzzy match | retargeted to **"Print all"**, **v3** | ❌ **wrong fix, committed** |
| | s6 | ✅ | |
| 11:37:09 | s7 click "Close" | ❌ *extension did not answer run.step within 50000 ms* | the hang |
| 11:37–11:40 | the repair agent | found Close, retargeted, tried (hung); clicked it directly (109 ms, fine); added a wait, tried (hung); Escape; tried (hung) → out of turns | ✅ reasoning, ❌ outcome |

### Why the ladder picked "Print all"
s5's target was the text of Gmail's whole header block (`"Print allIn new windowDaily KPIs - w/c 19 Oct…"`). The fuzzy match compares names, and the button whose name is the *start* of that text, "Print all", scored as one clear winner. It was tried for one step. A click that doesn't throw counts as evidence when the next step's target is visible, and it was. So it was committed.

### The hang, third time
- **Same pattern as Oct 15:** steps with a `role` hang (`run.step` and `try_steps`), while the repair's page operations (`find` 22 ms, `click_safe` 109 ms) answer.
- **This time it started right after "Print all" was clicked.** That opens Gmail's print window, which takes the front.
- **Both earlier cases had the automation window behind another window**, most likely because a step's matching goes through Chrome's accessibility tree, which doesn't answer for a page in a background window.

---

## 6. What to fix, in order

| # | Fix | Issues | Where | Effort |
|---|---|---|---|---|
| 1 | **A timeout on every DevTools call**, and bring the automation window to the front before every step and try. Seen in 3 runs now | P9, X6 | `packages/player/src/web/cdp.ts`, `match.ts`, extension `replay.ts` | Hours |
| 2 | **`finish` checks the work still happens:** every recorded write (type, paste, drop, upload, a send) is still in the workflow, inside a loop, or its removal was asked about. Removal stays allowed while editing; it's checked at the end | D6, D8, D9, B | `design/tools.ts` (`finish`) | Hours |
| 3 | **Tools that accept what the model sends:** `ask_user` with an unknown `id` but a `question` is its own question (A lost all 3). `edits` sent as a JSON string is parsed. `wrap_in_loop` / `wrap_in_branch` / `add_llm_step` allowed as ops inside `edit`. An inserted step with `channel` + `action` gets `type: "action"`. `save_as` on an inserted step becomes its output. A loop with no steps → *"use wrap_in_loop with the steps to repeat"* | D3, D5, D7 | `design/tools.ts`, `core/edit.ts` | Half a day |
| 4 | **The ladder never retargets a click whose target was a container** (text-only, no role) or a step that only read, and never onto a name that's only a substring of the recorded text | X1, X5 | `player/src/repair/ladder.ts` | Hours |
| 5 | **Fold reading and selecting clicks into what follows** (the copy, or nothing); drop clicks on containers that change nothing | R9, P3 | `recorder/src/normalise.ts` | Half a day |
| 6 | **Drop per-session ids from locators** (`:1g`, `19fml5:17`: Google's generated ids) | R10, P3 | extension `capture.ts`, `recorder/src/locator.ts` | Hours |
| 7 | **The page an event happened on:** the tab's current address at the time, not the content script's stale one | R1 | extension `background.ts` | Hours |
| 8 | **Don't record Shadow's own prompts** (`universalAccessAuthWarn`, System Settings opened by it) | R3 | daemon trace / Shadow.app | Hours |
| 9 | **Store an invalid call's input** in the transcript (A turns 5–7, B 14–15 are invisible) | D5 | `packages/agent/src/agent.ts` | Hours |
| 10 | **All recorded steps in the first message** (A lost steps 41–52) | D1 | `design/design.ts` (`taskOf`) | Hours |
| 11 | **A run that did nothing isn't "succeeded":** no write or action ran and there's no success check → "nothing done" | P7 | `player/src/run.ts` | Hours |
| 12 | **Enter that sends a chat message is outward** (it cleared the box, nothing navigated) → approval | R14, P8 | extension `capture.ts`, `core/guard.ts` | Hours |
| 13 | **A sheet's next empty row** (append, not `A1`) | D4 A | (open since report 1) | 1–2 days |

1–4 are what made both runs fail; each is small. Then record A again unchanged, and B for one report and two months, so a loop is shown twice.

---

## 7. What PR #13 fixed, as seen here

| Fix | Seen | |
|---|---|---|
| Real changes in the history | both: "removed s1…s20", "runs: manual → schedule…" | ✅ |
| Edits kept one by one | B turns 2, 5, 12: "1 of 2 kept", "1 of 3 kept" | ✅ |
| Tab switches recorded | A ×10, B ×2 | ✅ |
| Only the goal before recording | both forms | ✅ |
| May remove recorded steps | B removed all of them | ⚠️ needs fix 2 |
| Looks in the recording before asking | never reached: A's questions failed on `id` first | — |
| How often from what was said | A "every day" → daily schedule | ✅ |
| The screenshot tool's description | not used in either | ❌ (see report 2, D5: describe them automatically) |
| Stop a run; repair steps in the UI; copy and paste | not exercised in the files | — |

---

## 8. Where the evidence is

`~/Library/Application Support/Shadow/` (recordings are deleted 24 h after saving: A on Oct 20 at 11:34, B at 11:56).

| | A · KPI | B · Play Store |
|---|---|---|
| Recording | `recordings/14b6754f-353a-437e-8c30-6e3f65ddf635/` | `recordings/b89797ce-b2c1-4993-a0e7-72ec499bab7c/` |
| Design agent | `…/design.json` | `…/design.json` |
| Workflow | `skills/kpi-email-to-sheet/v1–v3.json` | `skills/get-playstore-stats-and-send-to-chat/v1.json` |
| Run | `runs/kpi-email-to-sheet-2026-10-19T06-05-17-049Z-6e2c.jsonl` + `.repair-1.json` | `runs/get-playstore-stats-and-send-to-chat-2026-10-19T06-28-26-106Z-9d4c.jsonl` |
