# Record v2: what changed since the section study, section by section

**Why this file.** [`section-study.md`](section-study.md) listed what was broken in record and the design agent as of
`main` at `b602e73` (Oct 18). Since then, branch `feat/record-v2` has made 81 commits in three plans, and nobody can
see from the commits alone what each one fixed. This file takes the study's sections in its own order: the
fundamental issues (§0), Record (R1–R10) and the design agent (D1–D7). For each problem it says:
- what was there before;
- what changed, and in which commit;
- whether it is fixed, partly fixed, still open, or removed.

Replay and recovery (P, X) appear only where record needed them.

**Sources:**
- the spec: [`docs/superpowers/specs/2026-10-19-record-v2-design.md`](../docs/superpowers/specs/2026-10-19-record-v2-design.md);
- Plan 1 (bench, data bugs, capture): [`…plans/2026-10-19-record-v2.md`](../docs/superpowers/plans/2026-10-19-record-v2.md);
- Plan 2 (understanding in code, the evidence package): [`…plans/2026-10-20-record-v2-plan2.md`](../docs/superpowers/plans/2026-10-20-record-v2-plan2.md);
- Plan 3 (design agent v2, screens, review): [`…plans/2026-10-20-record-v2-plan3.md`](../docs/superpowers/plans/2026-10-20-record-v2-plan3.md);
- the live checks: [`testing/checkpoint-1.md`](../testing/checkpoint-1.md) (capture in a real Chrome, Sheets and
  Gmail), [`checkpoint-2.md`](../testing/checkpoint-2.md) (evidence from real recordings) and
  [`checkpoint-3.md`](../testing/checkpoint-3.md) (design agent v2 on the real model);
- after the plans: [`checkpoint-4.md`](../testing/checkpoint-4.md) (five tasks on real sites, Oct 23), the step-4 fixes
  in [`record-v2-deep-dive.md`](record-v2-deep-dive.md), and [`checkpoint-5.md`](../testing/checkpoint-5.md) (the
  same tasks again, live);
- step 5: [`checkpoint-6.md`](../testing/checkpoint-6.md) (Rushil's own D recording, Oct 23), the commits on
  `feat/record-v3` (PR #17), and the 24 Oct rows of [`design-eval-ledger.md`](../testing/design-eval-ledger.md) (every
  live run).

Code was first described as of `feat/record-v2` at `19cb94d` (Oct 20); PR #14 merged it on Oct 21. **Updated Oct 23 for
step 4** (`d519c90`, PR #15): what step 4 changed is in its own section below, before "Removed", and the failures list
says where each one stands. **Updated Oct 24 for step 5** (`76d44df`, PR #17, 36 commits): its own section follows step
4's, and the failures list says where step 5 left them.

**Status marks:**
- **fixed (live):** seen working in a real recording or real model run;
- **fixed (tests):** built and tested, not yet seen in a real recording;
- **partly:** some of the problem remains;
- **open:** not done;
- **removed:** the code is gone.

---

## 0. The fundamental issues

| # | Fundamental issue | Before | Now | Status |
|---|---|---|---|---|
| 1 | A step is remembered by things that don't come back | Selection clicks stored as container text; Google's per-session ids kept; no list position; no sheet cell | Capture records what does come back: selections as `select_text`, no Google ids, link addresses kept, list position, sheet cell, names for nameless links (R1) | **partly**: capture fixed (live). The replay matcher still doesn't use text, `near` or list position (P3, Akshat) |
| 2 | Generalising is left to one model | No code-side generalisation; one agent with brittle tools | Code finds patterns (proposals). Only today's date and open-directly come with the change prepared; a list item, a repeat, all files and a constant are notes the agent builds itself (`e1c45dd`). Agent v2 first writes what the task is (the task model), then builds with forgiving tools: it reads the page and lets an AI step pick, and loops over what that returns (D1–D3). Since step 5, code also proposes clicking what is at the place a link was clicked, and a file name with the day and the page's title, both with the change ready (`1c289db`, `aae2d53`) | **partly**. Live, Oct 23: B (the newest video) and C (today's rate) generalise and run; A's re-design builds the "top 3" loop; on longer tasks the model still gives up or runs out of calls (checkpoint 5). **Oct 24 (step 5), live, day 1:** A, B, C and D (print way) each do their task. D's designs varied: of six designs of task D, each from a fresh recording, three did the task |
| 3 | Nothing checks the result | `finish` took anything that parsed; a run that did nothing "succeeded" | Code's finish gate decides when a design is done (D6), plus a safe test run in the automation window, a review with "Looks right" before Go live, and "nothing to do" for an empty run (`0f8c516`). Since step 4 the gate also refuses steps the runner can't run, and a design that lost your work or can't run is never saved over the recording (`753b83b`, `e64161d`). Since step 5: a final check runs a workflow that makes files for real; a workflow that can't make the recorded file says "Can't run yet"; at run time code checks an AI step's "first N" pick (`5a55d94`, `5f74eb4`, `f2a5ca2`) | **fixed (live)** for what checkpoints 4–6 showed. Still the agent's word: which steps build a rule. Only "first N" picks are checked at run time |
| 4 | Replay has no timeouts and one tab | DevTools calls hung 35–50 s; multi-tab recordings flattened into one tab | Every DevTools call has a timeout (15 s, 30 s to navigate), and a hang counts as an environment problem (`b40ca77`). Steps can name their tab (`a73777e`) | Timeouts **fixed (tests)**. Tabs **partly**: a run that waits for approval closes its named tabs (open, Akshat) |
| 5 | What the agents did can't be reconstructed | No reasoning, no input for rejected calls | Replies keep the model's reasoning (`7703b73`); rejected calls keep their input; `design.json` keeps the whole prompt, the task model, every decision and change with its why, the test report, questions, gaps and the transcript (`702954a`, `92d6465`) | **fixed (live)**: read in checkpoint 3 |

---

# Record

## R1 · Web capture

| Problem (study) | Before | Now | Status |
|---|---|---|---|
| Selecting text before a copy became a click on a container | The container's whole text became an unreplayable target | Dragging or double-clicking to select is its own event (`select_text`). The browser's click after it isn't recorded, and the selection plus the copy become one "read" step (`01fa7cd`, `9b64352`) | **fixed (live)** |
| Link with no accessible name (`link:''`) | Empty name | A name is taken from the title, image alt text, a heading or text inside, or the address (`75884dc`) | **fixed (live)**: YC card |
| Google Sheets cell clicks had no target | Only the editor label afterwards | Every click, typing, paste and copy in a sheet carries its cell (`B3`), value and sheet tab, read from the Name Box. A copy's row comes from its cell (`54696a6`, `4ec5c1e`) | **fixed (live)** |
| Stale page address in single-page apps | The tab's first address | The page's own address at the moment of the event (`ad0dc07`) | **fixed (tests)**: Play Console not re-recorded |
| Repeated navigations on tab switches | Partly merged | Switches with nothing done between them are dropped and listed as noise (R9) | **fixed (live)** |
| *New:* what a click did | Not recorded | Watched for 700 ms, against the page's own churn: went somewhere, expanded, opened a menu, emptied a field, or nothing (`b6740ee`) | **fixed (live)**: Gmail churn reads "none" |
| *New:* keys | Only Enter and Escape | Shortcuts with ⌘/Ctrl/Alt, plus single keys (Gmail's `e`). Three keys within a second count as typing and none is kept; Google Docs and Sheets record no single keys (`6394b10`) | **fixed (live)** |
| *New:* a page's own Copy button | Lost | Caught by a small hook in the page (`ab77c72`) | **fixed (live)**: GitHub |
| *New:* ⌘-click and middle-click | Opening a new tab was lost | Marked as opening a new tab | **fixed (tests)** |
| *Found live:* Gmail's row under the pointer wasn't part of the list | — | Rows are compared by tag and role, not classes (`99a0bf7`) | **fixed (live)** |

## R2 · Tab capture

| Problem | Before | Now | Status |
|---|---|---|---|
| Switches not recorded | — | Fixed before this branch (PR #13) | fixed |
| Switching Chrome windows not recorded | Not a tab event | `window_focus` (`ad0dc07`) | **fixed (tests)** |
| A tab open before Record | Its address was unknown | Announced at first use with its address; each tab gets a name from its page ("KPI Sheet") (`a2c8081`) | **fixed (live)** |
| Replay reloaded a page on every switch | One tab | Steps may name a tab, and the automation window keeps one tab per name. Code doesn't put `tab` on recorded steps; the agent does | **partly**: needs Akshat's sign-off; tabs close during approval waits |

## R3 · Mac-app capture

| Problem | Before | Now | Status |
|---|---|---|---|
| Shadow's own permission prompt and System Settings recorded as steps | Recorded | Skipped. Shadow.app asks for Screen Recording when recording starts, if it isn't granted yet (`0c38bf6`) | **fixed (tests)**: needs your `pnpm setup:mac` to see live |
| Nameless Accessibility elements (Numbers) | Dropped | Unchanged. Picture captions describe them only when Pictures is on | **open** |

## R4 · File capture

| Problem | Before | Now | Status |
|---|---|---|---|
| Deletions weren't recorded | A vanished file was ignored | Finder's Move to Trash (menu or ⌘⌫) plus the file vanishing becomes a "move to the Trash" step, with approval (`0c38bf6`) | **fixed (tests)**: needs `setup:mac` |

## R5 · Screenshots: capture

| Problem | Before | Now | Status |
|---|---|---|---|
| A burst of events lost pictures | The newest replaced the waiting one | A queue keeps up to three; when it's full, the least telling is dropped. A new tab is pictured when it shows (`c820e9a`) | **fixed (live)** |
| Pictures lost silently | One log line | `shots.jsonl` says for every event whether its picture was taken, and why not. The Record screen warns before recording if pictures can't be read (`c820e9a`, `c9f6248`) | **fixed (live)** |

## R6 · Screenshots: reading and masking

| Problem | Before | Now | Status |
|---|---|---|---|
| Words cut to a few lines; the lower part of long pages lost | 2,000 characters, no positions | Each line keeps its box, up to 8,000 characters. Words "near the click" are chosen by position, not text match (`c9f6248`, `4357d2f`) | **fixed (live)** |
| Never words, with no Never field on the form | Only patterns masked | An optional "Private words" line under the goal (`c9f6248`) | **fixed (tests)** |
| Values the model reads not all masked | Screen words only | Evidence text, captions, every agent tool result and every message to the agent are masked (`2f562be`, `430d7a3`) | **fixed (tests)** |
| *New:* what appeared after a step | Not known | The lines that weren't in the picture before ("Message sent"). Only these can become checks (`4357d2f`) | **fixed (live)** |

## R7 · Narration: transcription

| Problem | Before | Now | Status |
|---|---|---|---|
| Stop was slow | Transcription waited for the pictures | Both run at the same time (`c9f6248`) | **fixed (tests)** |

## R8 · Narration: alignment with the steps

| Problem | Before | Now | Status |
|---|---|---|---|
| "said over steps 4–5" counted different step numbers than the draft the agent edits | Two numbering schemes | One timeline in the draft's own ids (s1, s2…): speech, steps, tabs and left-out steps in time order (`dfcf082`) | **fixed (live)** |
| Screen words landed on the wrong step | Matched by time with 1 s of grace | Matched by event id and the time the picture was taken (`e642724`) | **fixed (live)** |

## R9 · Normalise

| Problem | Before | Now | Status |
|---|---|---|---|
| Selection clicks before a copy kept as steps | Kept | Selection plus copy is one read step (`9b64352`) | **fixed (live)** |
| Noise kept: clicks that changed nothing, focus clicks, idle switches, clicks the page made | Kept, or dropped silently | Removed and *listed* with a reason, each with an id (x1, x2…), so the agent can put one back (`9b64352`, `8996923`) | **fixed (live)** |
| No "go to cell" in a sheet | Typing went to whichever cell was selected | The cell is now recorded on every step. *Replaying* a write to a cell, or to the next empty row, is still missing | **partly**: replay side open |
| Repetition not recognised | Five copy/paste pairs were five step groups | Code proposes a repeat ("s4–s7 happen 2 times: repeat them for each item") (`dfcf593`) | **fixed (tests)**: the agent still has to build the loop |
| The Drive detour kept | Kept | Code proposes "open this page directly" (`dfcf593`) | **fixed (tests)** |

## R10 · The first draft (code)

| Problem | Before | Now | Status |
|---|---|---|---|
| Text-only container targets | Many | Far fewer, since selections are no longer clicks. A remaining nameless click is marked "weak target" for the agent | **partly** |
| Per-session Google ids stored | Kept | Dropped; link addresses with ids kept, with a shape (`75884dc`) | **fixed (live)** |
| List position lost ("the top job") | Lost | Recorded, and code proposes "item 1 of the list" | **partly**: a replay locator can't use a list position yet (Akshat) |
| Typed dates stayed literal (`15 Oct`) | Literal | Code proposes `{{today\|D MMM}}`, with formats, `{{today-1}}` and `{{week_start}}` (`191716a`, `dfcf593`) | **fixed (live)**: KPI and Play Store used today's date in checkpoint 3 |
| Enter that sends a chat message wasn't outward | No approval | An Enter that empties a chat box needs approval, and so does ⌘/Ctrl+Enter or ⌘Return. Since `2b6b15d` this also covers an Enter or new line the agent adds (`6eb059e`, `2f562be`, `9ad36b0`) | **fixed (tests)** |
| *Found in exploration:* a design could save a recording as the next version of another workflow (H1) | The model's id was used | The daemon's id, always (`bb754f0`) | **fixed (tests)** |
| *Found in exploration:* answers about steps inside loops failed; questions had no context (H3, H5) | — | Fixed (`7462c47`) | **fixed (tests)** |

---

# The design agent

The old agent is **removed** and replaced by **design agent v2** (`packages/recorder/src/design/v2/`). After Stop it
runs in stages:
1. **Understand:** one model call reads the evidence and writes the task model: the outcome, how often it runs, where
   each value comes from, the rules you said, and what it can't tell.
2. **Build:** the agent changes the workflow with its tools, accepting code's proposals by id.
3. **Test:** a safe run in the automation window that only opens pages and reads.
4. **Ask:** one batch of questions, only what the evidence can't answer.
5. **Finish gate:** code decides whether it's done.

The whole design has one budget: $0.25 and 40 model calls, picture captions included. **Since step 5** there is no
cap on calls (the $0.25 stays), stage 2 starts with one call that plans every change, and a final check follows the
gate (see "Step 5" below).

## D1 · What it's given

| Problem | Before | Now | Status |
|---|---|---|---|
| Only 40 steps in the first message | Steps 41+ unseen | `evidence.json` holds every step, under 24k tokens, with details on request (`f88dd49`) | **fixed (live)** |
| 15–22k tokens re-sent every turn | Whole recording each turn | Sent once, in stage 1; later stages get the task model and the workflow outline | **fixed (live)**: real designs cost $0.012–0.124 (was $0.085–0.086) |
| No worked example | — | A short prompt with one worked example (KPI) (`d744b41`) | **partly**: the real KPI run didn't follow it |
| *New:* page and email text treated like instructions | Mixed in with everything else | Wrapped in `<untrusted_data>`, and any sending step still needs approval (`8996923`, `430d7a3`) | **fixed (tests)** |

## D2 · `label_steps`

| Problem | Before | Now | Status |
|---|---|---|---|
| The labelling stage itself | The agent's forced first move | **Removed.** Code names the steps; the agent renames with `change` | **removed** |
| Invented checks ("Job entry added to sheet", empty text, text on sheet cells) | Accepted | The gate refuses checks for text that never appeared, empty checks, text checks on drawn pages, and hidden values (`███`) (`b221880`) | **fixed (tests)** |
| Values left literal | Common | The task model says where each value comes from, and proposals prepare the change | **partly**: the real KPI run kept the email subject as a typed value |

## D3 · The tools

The old 13 tools are **removed**. The new set:

| Group | Tools |
|---|---|
| Proposals | `accept`, `reject` |
| Steps | `remove`, `restore`, `add`, `change`, `move` |
| Structure | `loop`, `branch`, `ai_step` |
| Start | `trigger`, `input` |
| Look and ask | `look`, `ask` |
| Finish | `test`, `done` |

The old names still answer, as aliases.

| Problem | Before | Now | Status |
|---|---|---|---|
| `ask_user` with its own `id`: every question lost | Questions dropped | `ask` takes only the question; code numbers it (`d9d2d18`) | **fixed (live)**: no invalid calls in checkpoint 3 |
| Edits sent as a JSON string | Invalid, repeated | Parsed | **fixed (live)** |
| `wrap_in_branch` as an edit op; steps missing type and channel | Invalid | A step is written by what it does (`{ do: "click" }`) and code fills in the rest; `edit` only says which tool to use | **fixed (live)** |
| An empty loop instead of `wrap_in_loop` | Inserted | `loop` needs the steps and says so | **fixed (tests)** |
| `save_as` ignored on inserted steps | Ignored | `add` accepts it | **fixed (tests)** |
| `describe_step_screenshot` never called | Unused | **Removed**: code captions every picture before the agent starts (`dca2d86`) | **fixed (live)**: checkpoint 2 |
| A new step reused a removed step's id | — | New ids never repeat a recorded one (`38e0180`) | **fixed (tests)** |
| *Found live (checkpoint 3, YC):* 20 of 40 calls refused: ids as one string `"s2, s3"`; a removal blocked by a later `{{var}}`; `add {do: "ai_step"}`; `output.type` as a string; `{{s6}}` (a step id) as a variable | — | — | **open**: F3 |

## D4 · The rules

`designViolations` is **removed**. In its place are guardrails (`rules.ts`) that refuse only what is harmful:
- turning an approval off, script steps, changing the goal or a Frequency the form set;
- opening a site the recording didn't visit;
- files, uploads or watched folders outside the folders the recording touched;
- a file path made from an AI answer or page text;
- a hidden value (`███`) copied back;
- anything matching Never.

Everything else is allowed and kept with its reason for the review.

| Problem | Before | Now | Status |
|---|---|---|---|
| The work could be removed (Play Store: all 20 steps) | Nothing stopped it | The gate wants every write you showed kept, repeated, or removed with a reason; never all of them. A draft that stopped early having lost work falls back to your recorded steps (`b221880`, `38e0180`, `fdaa488`) | **fixed (tests)** |
| "Targets only from the recording", "never invent a click" | Rules | **Removed**: the agent may add clicks. A new target stays "unverified" until the test run finds it | **removed** |
| A file path with a variable is checked only when designed, not at run time | — | — | **open**: run-time check in the player (Akshat) |

## D5 · Questions and the drill

| Problem | Before | Now | Status |
|---|---|---|---|
| Questions the recording already answered | Evidence check (PR #13) | Plus: code answers "which file / which row" from what you said (`aec37ed`) | **partly**: the file answer is wrong (F13) |
| Questions lost (the `id` misuse) | Lost | Fixed with the new tools | **fixed (live)** |
| Asked one by one, without context, every recording's questions shown | — | One batch on the Record screen, next to each step; only this recording's; Enter sends; "You decide" takes the default; at most 5, the rest take their defaults and the review lists them (`0a058fb`, `fdaa488`) | **fixed (tests)** |
| Code's questions dropped when a design stopped early | — | Kept for the drill (`fdaa488`) | **fixed (tests)** |
| The agent asks anyway after seeing the answer | — | Found live: KPI asked "should it run on its own?" after "every day" | **open**: F4 |
| No timeout on a question | Waits | Unchanged | **open** |

## D6 · Finish, honesty and the review

| Problem | Before | Now | Status |
|---|---|---|---|
| `finish` accepted a workflow that no longer does the task | Accepted | The **finish gate** (`gate.ts`) wants:<br>- every write kept;<br>- every rule you said built or explained;<br>- checks on text that really appeared;<br>- test failures explained;<br>- defaults for unattended runs;<br>- the frequency you said.<br>It refuses at most twice, then saves with the gaps listed (`b221880`) | **fixed (tests)** |
| Every stated rule unbuilt | Accepted | Every rule needs steps or a reason | **partly**: F2 |
| No test before saving | None | A **safe test run** (`d35b071`):<br>- it opens pages, reads, and follows only recorded links;<br>- it only outlines typing, sending and acting buttons;<br>- it says first what it will do ("opening 1 email will mark it as read");<br>- without Chrome it says "not run";<br>- it queues behind real runs | **fixed (live)**: ran live in checkpoints 4 and 5 and found real faults |
| Summaries describing changes never made | History fixed in PR #13 | The **review**, built by code (`e3dbfc3`):<br>- a badge per change with its reason;<br>- "What you said → what was built";<br>- what wasn't tested.<br>Go live, and schedules, wait for "Looks right" (`feec1cc`) | **fixed (tests)** |
| How often it runs, from "every day" | Worked (PR #13) | **Regressed, found live:** the model wrote "manual" while quoting "every day / every month", and the gate takes its word | **open**: F1 |

## D7 · Budget, cost and record-keeping

| Problem | Before | Now | Status |
|---|---|---|---|
| Reasoning not kept | Empty | Kept (`7703b73`) | **fixed (live)** |
| Rejected calls' input not kept | Lost | Kept (`702954a`) | **fixed (live)** |
| Vision calls not metered | Unmetered | Metered and cached by picture (`775ea37`); captions count on the design's budget | **fixed (tests)** |
| Near the $0.10 cap | 16 turns, $0.10 | $0.25 and 40 calls on one meter; real designs cost $0.012–0.124. Since step 5: $0.25 and no cap on calls (`39d66cd`) | **fixed (live)** |

---

## Step 4 (Oct 23): what changed after real-site testing

[Checkpoint 4](../testing/checkpoint-4.md) recorded five everyday tasks on real public sites, and none of the saved
workflows did its task. Every cause was on the record side. Each fix below started as a failing test from the real
trace's shape, with the fewest lines and no per-app code. The F-numbers, causes and tests are in
[`record-v2-deep-dive.md`](record-v2-deep-dive.md); [checkpoint 5](../testing/checkpoint-5.md) is the live re-test.

| Section | What changed | Commits | Status |
|---|---|---|---|
| R1 web capture | A copied element keeps a selector when the page nests tables (the selector path climbs past 6 levels) | `cf92fa2` | fixed (live): Hacker News stories found by their place |
| R2 tabs | A tab is named from the page it went to, not "about:blank" | `42f9a6a` | fixed (tests) |
| R4 file capture | A watched folder inside a hidden folder records (only names below it count) | `42f9a6a` | fixed (tests) |
| R9 normalise | A paste takes the copy made just before it (per field, F17); a page opened in another tab soon after is its own step (F18) | `42f9a6a` | fixed (live) |
| R10 first draft | A download adds "find the file it saved", which waits up to 60 s; a rename's new name is what later steps use (F23, F53) | `42f9a6a`, `f89a0e9` | fixed (live): live D downloaded, waited, renamed and moved |
| R10 proposals | A proposal with nothing prepared says "build it yourself, and how"; open directly warns it's only for a page that never changes | `e1c45dd` | fixed (tests) |
| D3 tools | A read with no control reads the whole page; steps the runner can't run are refused, with what's needed; a loop can hold new steps and makes an AI step's result a list; types and `do` written the model's way are taken; a call resent as it failed, or a change that changed nothing, is said so; `change { target: null }` reads the whole page; a page-open step says to add a click | `e1c45dd`, `1a3f17a`, `f8c4215`, `fa5bf58`, `306e724`, `4674a5c`, `edd1241` | fixed (live) for B and C; the rest fixed (tests) |
| D4 rules | Besides harm: a control the agent gives by role alone is refused; a schedule must be a fixed time | `306e724`, `1a3f17a` | fixed (tests) |
| D5 questions | The time of day is never asked (9:00); file options are matched by their words only (F13) | `7e59721`, `753b83b` | fixed (live) |
| D6 finish gate | A test failure is explained only by a reason given after that test; a test that couldn't start, stale checks, steps in the wrong tab, and steps the runner can't run are problems; frequency words require a schedule; a "the newest / top 3" rule left unbuilt is turned back | `753b83b`, `1a3f17a`, `45e0ebe`, `f89a0e9` | fixed (live) for B, C; rest fixed (tests) |
| D6 keeping | A stopped design, or one let past the gate after two refusals, keeps the recorded steps if it lost your work or can't run (F27, F61) | `753b83b`, `e64161d` | fixed (live) once (live D) |
| D6 test run | The agent sees what each step read and what each AI step answered; a file this run would download is only outlined | `389bf90`, `f89a0e9` | fixed (tests) |
| D6 review | The summary is labelled as the agent's words; unasked questions are listed | `753b83b` | fixed (tests) |
| D7 budget | A reply cut off at the token cap gets one more episode; `design.json` keeps the first message and the plain list | `f8c4215`, `753b83b` | fixed (tests) |
| bench | Every bench run says whether the workflow can run (`runs`); `uses_today` counts only the built-in date | `814bc5e` | fixed (live) |

## Step 5 (Oct 24): what changed after Rushil's own recording

On Oct 23 at 23:42 Rushil recorded D himself (save today's featured Wikipedia article as a PDF, through Chrome's print
dialog), and it failed. [Checkpoint 6](../testing/checkpoint-6.md) traced eleven causes. Step 5 worked through them in
phases 0–5, from his rulings (the phases and causes, piece by piece: [plans explained §14–16](record-v2-plans-explained.md)).
Each fix started as a failing test from the real recording's shape. Phase 5 then ran A–D live, in the isolated test
browser on the real model, and each run's fault was fixed before the next. Branch `feat/record-v3`, PR #17; 687 tests
green.

| Section | What changed | Commits | Status |
|---|---|---|---|
| R1 web capture | Printing the page is recorded: the page's `beforeprint` becomes a `print` event (②), for ⌘P or File → Print on any site, with no Accessibility needed | `b7738d3` | fixed (tests). Live only with a simulated print: the test browser fired `beforeprint` and wrote the PDF as the save panel would. A real ⌘P is Rushil's check |
| R7 voice | Rushil's 50.7 s of voice gave 0 words. Measured: the microphone (flat noise at −49 dB, input level 27%); the transcriber reads a spoken clip word for word. The review now says so (D6 review below) | `3b5a1d5` | measured: not a code fault |
| R9 normalise | A new file goes with the step before it only when something says that step made it: a download of that path; a print followed by a PDF within 10 minutes (one `save_pdf` step); a control that acts (Export, a Mac app's Save) within 15 s. Any other file is its own step, `file_appeared`, "a file nothing recorded made". A print with no PDF after it is listed as noise | `b7738d3` | fixed (tests); the print pairing live only as in R1 |
| ⑥ evidence | Every file a step made or that appeared is named; files nothing recorded made are listed; each control's place is shown (`#mp-tfa > p > b > a`) | `b7738d3`, `5f74eb4`, `39d66cd` | fixed (live): D's designs clicked by that place |
| R10 first draft | A print and its PDF become `web.save_pdf {dir, name}`. A file nothing made gets no "find" step: it's a gap. A date in a saved PDF's or renamed file's name becomes `{{today\|…}}`. A form whose control says download, export, pdf or csv, and whose only effect was a file, needs no OK (Wikipedia's Download would have waited every morning) | `b7738d3`, `8935f13`, `d49ac67`, `624f753` | `save_pdf` and the date fixed (live): D saved "24 Oct - Battle of Schliengen.pdf". The form rule fixed (tests): the test browser takes every download |
| R10 proposals | Two new ones, with the change ready: click what is at the place a link was clicked (`same_place`; not when the place names the item itself, as B's video title did); a file named with the day **and** the page's title, the title read each day from its heading (`h1`) | `1c289db`, `aae2d53` | fixed (live): D's last design accepted both, in 5 calls |
| D1 prompt | Says what steps can't do (browser menus, the print dialog, save panels), that `save_pdf` exists, and to click by place before letting an AI pick. The tab advice that left D on a blank tab is corrected | `39d66cd` | fixed (live) |
| D3 plan, then apply | One call plans every change as tool calls (plain JSON, checked call by call). Code makes them through the same tools and rules, and the build episode starts from what each did, to repair. A plan's own names for steps it adds ("after": "open_hn") find them | `c4cb871`, `8275620`, `57187e9`, `e579bf9` | partly. Live: D's 5-call design was a plan of code's proposals; A3's plan made no change. The episode after still sends about one call per reply (D eval: 8 turns, 8 calls) |
| D3 tools | A tool names the fields it ignored (`change` had dropped `when` unseen, 5 times). `change` sets the trigger and edits AI steps. "trigger" names the trigger in every tool. `add` takes AI steps and loops sent with loose fields. A target can be `{ place: "s2" }` (whatever is there next time) or `{ css }`; words sent as a place aren't a selector; target "None" reads the whole page. An AI step picking "the top 3" with no order or measure is refused, with the words to use. A date format core can't read lists its tokens | `39d66cd`, `2606a89`, `0504ac0`, `67c081f`, `e579bf9`, `57187e9`, `2e1cd16` | fixed (live) for C ("None", words as a place) and D (place); the rest fixed (tests) |
| R2 / D3 tabs | After every change, code gives a step with no tab the tab of the page opened before it; it works those out again each time and never changes a tab the agent named. A step may not name a tab no earlier step opened a page in (it would act on a blank tab) | `5a88c22`, `f471ffe`, `8935f13` | fixed (live): in A's fifth design the notes read got the saved stories (the pick check found one in it), so it read the notes tab. The blank-tab rule fixed (tests) |
| D5 questions | Questions about how to build it are never asked | `39d66cd` | fixed (tests) |
| D6 test run | Code checks every value the test run got and shows the agent what's wrong: the steps the gate refuses (below), an address made of two (with how to fix it), and an AI answer not in what it read (shown only, never refused). A selector the run didn't find says "read the page, let an AI step pick, click it by its name" instead of guessing another. A click at a recorded place that only went to a page is followed, not outlined | `c4cb871`, `8275620`, `f471ffe`, `1ee7913`, `c270ba7`, `c76eb5a` | the place click fixed (live): D's last design. The rest fixed (tests) |
| D6 finish gate | Refuses: a file the recording shows that no step makes (then **"Can't run yet"**: the review shows why instead of Looks right, and Go live refuses); a step that got nothing in the test; two reads of the same page; an AI answer used in an address that isn't in what it read ("click the link where it is") | `5f74eb4`, `c4cb871`, `f471ffe`, `624f753` | fixed (tests). Live, one D design still built the address with AI; its final check failed on it |
| D6 final check (new; end of ⑦, after the gate) | A workflow that makes a file runs once for real in the automation window. Only `save_pdf` and copies, moves or renames of files this run made are done; nothing on a web page. Every file it made goes to the Trash, and the review says which. A failure goes back to the agent once. A "skip / already / only new" rule runs it twice. It fails an empty file, and, on the recording's day, a file other than the recording's | `5a55d94`, `8275620`, `d49ac67`, `c270ba7` | fixed (live) for D: it made "24 Oct - Battle of Schliengen (1).pdf" and trashed it; on another design it caught "24 Oct - Main Page.pdf". Running twice fixed (tests): no file-making task with a skip rule has run |
| D6 review, run log | The review opens with notices: the microphone heard no words (and where to check); Shadow.app or Accessibility off, so what you did outside Chrome wasn't recorded; a file nothing made. Then what the final check made. The Run page groups its log by step; the walk-through says "nothing to outline" only for steps with nothing to outline | `ce23c92`, `975065e`, `3b5a1d5` | fixed (tests); seen in screenshots on a scratch daemon, not yet in Rushil's app |
| D7 budget | No cap on calls; $0.25 per design. A design ends after 5 changes in a row that were refused or changed nothing (STUCK), with one fresh start that lists them. A failed reply (a 503) gets one more try in every episode | `39d66cd`, `2606a89`, `1c289db` | partly. Live: no design ran out of calls; A's third design got stuck, started fresh once, got stuck again, and kept the recorded steps. But one D design still spent all $0.25, in 55 calls |
| runner (Akshat reviews) | `web.save_pdf` (Chrome's `Page.printToPDF`; the daemon writes the file, under a free name if taken). An empty whole-page read fails. An AI step whose inputs are all empty doesn't run. A find names the older files it ignored. A failed open names the address it tried. An AI step gets each input by its name, a list numbered | `b7738d3`, `8935f13`, `b09d15e` | `save_pdf` and named inputs fixed (live); the rest fixed (tests) |
| runner: AI steps | The design writes a pick in the recording's order ("the first 3 in the list's order"). Probe on A's real inputs, 3 tries each: "top 3" 0 of 3 on every model; "the first 3 in the list's order" 2 of 3 fast, 3 of 3 smart. Thinking was turned on, then off the same day (it ran out of tokens on a whole page) | `43bde8e`, `e579bf9` | measured (probe, $0.0089) |
| runner: the pick check | Code checks an AI step that picks "the first N" (`pickProblem`): the list's order kept; nothing earlier left out unless it's in the rest of the data; for "not already / skip / new", nothing picked that's already there. Wrong: asked once more of the smart model, told why. Wrong again: the step fails, so a run never saves a pick code knows is wrong | `f2a5ca2`, `3145779`, `b14b3b1` | fixed (live): A's second Run now saved the next 3, no duplicates. Other picks (B's newest video, C's rate) aren't checked |
| agent loop | Its rules say "up to N tools a turn"; they said "exactly one" while running 8 | `c4cb871` | fixed (tests) |

## Removed

| What | Why | Replaced by |
|---|---|---|
| `packages/recorder/src/design/design.ts`, `design/tools.ts`, `design/design.test.ts` | The old agent: labelling first, 13 brittle tools, `designViolations` | `design/v2/` |
| `design/changes.ts` | Moved, not removed | `design/v2/changes.ts` |
| `compile.ts`'s one-call model path, `systemPrompt`, the `Chat` type and 11 tests | Unused since PR #13 (one AI reads the recording); their code-only checks moved to code-only tests | Code-only compile, then design agent v2 |
| The labelling stage, `describe_step_screenshot`, the 40-step cut, "targets only from the recording" | See D1–D4 | Evidence, captions in code, guardrails |

These were approved with the spec. `labelDraft`, `labelRules` and `merge` in `compile.ts` are now unused but kept,
because removing them needs your OK.

## Failures to fix

One list of everything known to be broken or missing in record and the design agent, as of Oct 20. On Oct 20 Rushil
chose to list them rather than fix them; on Oct 23 (step 4) the record-side ones were worked on.

**Where they stand on Oct 23:**
- **F1** fixed (live): frequency words require a schedule (`753b83b`); B, C and D got schedules.
- **F2** partly: a "newest / top 3" rule left unbuilt is turned back with how to build it (`1a3f17a`), and A's
  re-design built the loop. KPI itself wasn't re-recorded.
- **F3** fixed: all five slips are forgiven (`e1c45dd`, `f8c4215`).
- **F4** partly: the time of day is never asked (`7e59721`); other re-asks with `confirm` still go through.
- **F5** open: nothing checks a write's page; the safe test run, now live, is what catches it.
- **F13** partly: options are matched by their words (`753b83b`); "all of them" isn't offered.
- **F6–F10** Akshat's. **F11, F12** open.
- Later failures, F17–F61, are in [`record-v2-deep-dive.md`](record-v2-deep-dive.md).

**Where they stand on Oct 24 (step 5).** Step 5's faults have no F-numbers: checkpoint 6's are its causes 1–11, and
the rest are named by commit above.
- **F2** partly: A's "skip ones already saved" holds live, because code checks the pick when the run happens
  (`3145779`, `b14b3b1`). The gate still doesn't check what a rule's steps do; KPI wasn't re-recorded.
- **F4** partly: questions about how to build it are never asked (`39d66cd`).
- **The deep dive's open A and D:** A does its task live (top 3, then the next 3). D, the print way, does too. Both on
  day 1 only. D's download way can't be measured in the test browser, which takes every download.
- **"Longer tasks run out of calls":** no cap now. What's left is variance: six designs of task D, each from a fresh recording, three
  right, from 5 calls to 55.
- **Open, new:**
  - Rushil's four Mac recordings (a real ⌘P, voice, a Finder move) and the day-2 re-runs;
  - AI answers other than "first N" picks aren't checked at run time;
  - the walk-through logs `highlighted: false` for every step answered from the inbox (`run.ts:329–333`, Akshat; the
    UI works around it).

**Columns:**
- **Seen in:** the run or review that showed it;
- **Why it happens:** the cause in the code, as far as known;
- **Fix (proposed):** not started;
- **Owner:** "record" means this branch's side; "Akshat" means replay.

### From the first real model runs (checkpoint 3, step 1)

| # | Failure | Seen in | Why it happens | Fix (proposed) | Owner |
|---|---|---|---|---|---|
| F1 | **Runs by hand although you said how often.** "Every day" (KPI) and "every month" (Play Store) gave a manual workflow | KPI ✗ trigger, Play Store ✗ trigger; YC listed it as a gap | Stage 1 wrote the cadence as "manual" while quoting the words. The finish gate checks the frequency only when the task model says it isn't manual, so it took the model's word | The gate finds frequency words in the goal and what was said ("every day", "monthly", "each morning"…) itself, and refuses to finish while the workflow only runs by hand | record (`gate.ts`) |
| F2 | **KPI: "always the newest one" not built.** No loop over new emails; the click on the one recorded email is claimed as building the rule | KPI ✗ has_loop | The model took the email subject to be a value you type, not "the newest in the list". The gate checks that the steps a rule names exist, not what they do. The old KPI fixture has no list positions, so code proposed no "item 1 of the list" to accept | Re-record KPI (list positions give the proposal). Maybe a gate check that a rule saying newest, top, every or all is built by a loop, an AI step or a list item | record |
| F3 | **YC: 20 of 40 calls refused.** It ran out of calls and kept what it reached | YC, 40/40 calls, $0.12 | Gaps in the tools' forgiveness:<br>a) ids sent as one string, `"s2, s3"`;<br>b) removing the copy step while a later step still pastes `{{copied_1}}` (refused 4×; the message doesn't say "change that step first");<br>c) `add { do: "ai_step" }` (refused 3×);<br>d) an AI step's output type sent as `"text"`;<br>e) `{{s6}}`, a step id, used as a variable | a) split the ids;<br>b) name the blocking step;<br>c) pass `do: "ai_step"` on to the `ai_step` tool;<br>d) accept a type written as a word;<br>e) read `{{s6}}` as that step's `save_as` | record (`tools.ts`) |
| F4 | **Asks what the recording already answered.** KPI asked "should it run on its own?" after "every day"; KPI and YC asked 3 questions each (too many) | KPI ✗ max_questions, YC ✗ max_questions | The agent re-asks with `confirm: true` after the evidence check showed it the answer | F1 removes the frequency one. Refuse `confirm` when the evidence quotes the answer, or count those against the 5 | record |
| F5 | **KPI: the step that opens the sheet was removed**, so the paste would run on the Gmail page | KPI's `design.json` (removed s10, "redundant sheet navigation") | The gate doesn't check what page a write runs on. The safe test run would catch it, but it can't run in the eval (no Chrome) | The safe test run on Rushil's Mac (checkpoint 3, step 2). Or a gate check that a write's page is still opened before it | record |

### From the Plan 3 review and the study (not seen in a real run yet)

| # | Failure | Why it happens | Fix (proposed) | Owner |
|---|---|---|---|---|
| F6 | A run that waits for approval resumes with blank named tabs; its next step fails into repair | The daemon sends "run ended" at the end of every leg, waits included, and the extension then closes the tabs it opened | The "run ended" message says when the run is only waiting; the extension keeps its tabs then | Akshat |
| F7 | A step without a tab runs in the window's first tab, while the test run highlights in the last tab used | `tab-map.ts`: no tab means the first tab | Agree the rule (inherit the previous step's tab, or the first tab), then highlight in the same tab | Akshat |
| F8 | Replay can't find a step by its list position, text or `near` | The matcher scores role and name, attributes and selectors only (study P3) | Use the recorded list position and `near` | Akshat |
| F9 | Can't write to a sheet cell or the next empty row | No replay action for it (study P4); the proposal is a note only | A "write to sheet" step; MCP or the Sheets API later | Akshat |
| F10 | A file path with a `{{variable}}` is checked only when designed | No run-time check in the player | Check the allowed folders before a file is opened (`fs-channel.ts`) | Akshat |
| F11 | Nameless Mac-app elements (Numbers cells) | No AX name (study R3) | Captions when Pictures is on; nothing else yet | record |
| F12 | A question can wait for ever | No timeout (study D5) | A timeout that takes the default | record |
| F13 | "You used X. Next time, which file?" is answered wrongly from what you said: "the newest" picks "ask me each time", and "all the reports" can't answer it. Your Play Store re-record (one report) will be asked it | `evidence/answers.ts` reads each option's stored value as well as its label, and the "ask me each time" value also holds `pick: "newest"`. No option says "all". Found Oct 20 while writing `section-study-record-v2.md` | Match on the labels only; offer "all files like X" as an option | record |

### Smaller items (Plan 3 review)

- **Removal reasons:** a removal's reason is optional, and a removal without one can't be explained afterwards.
- **Test run's AI calls:** they're counted on the daemon's meter, not the design's $0.25.
- **Checks:** may only use text seen while recording, not text the test run saw.
- **A second round of questions:** for unattended runs, after the batch.
- **Review page:**
  - it says "no automation window" when the design stopped before testing;
  - repeated lines share a key;
  - "How this was made" hides after Looks right.
- **`<untrusted_data>`:** page text isn't escaped inside it.
- **Relative input paths:** they skip the folder check.
- **Stage 1:** can make 4 model calls.
- **Progress lines:** each one resends the whole Record view.
- **The feed:** "Done" shows twice.

### Not failures: still to be checked live

- **Checkpoint 3, step 2:** Rushil records KPI, YC and Play Store on his Mac with v2 live. Every design spends up to
  $0.25 of his key, and the safe test run opens pages in the automation window.
- **After `pnpm setup:mac`:** Move to Trash, Shadow's prompts skipped, copy and paste from the app.
- **Akshat's sign-off:** `skill.ts` `tab`, the player's test run, dates and keys.
- **"Arilo Stats":** Rushil confirmed on Oct 23 it isn't a real Chat space.

## Conclusion

- **Recording is largely fixed, and checked live.** It now captures what it needs: what was selected, what each click
  did, list positions, sheet cells, tabs and every picture. Code turns that into an evidence package with the noise
  listed, not hidden.
- **Generalising and checking moved into code.** Code proposes the patterns (dates, list items, repeats), and code,
  not the model, decides when a workflow is done. The design agent was rebuilt around that.
- **The first real runs show it working on simple tasks only.** Timesheet and Play Store came out right; KPI and YC
  didn't, through:
  - the model's judgement (no loop for "the newest");
  - a trust gap in the gate (how often it runs);
  - tool syntax (YC).
- **What's left (Oct 20):**
  - those three fixes;
  - Rushil's live recordings;
  - the replay side (the matcher, writing to sheets, tabs during waits), which is Akshat's.
- **Oct 23, step 4:** the three fixes are in, and five real-site tasks were recorded, fixed at the root (F17–F61) and
  re-tested live. **Two of the five do their task end to end** (B, C). What's left is the design agent finishing longer
  tasks within its calls, AI-step answers nothing checks, and canvas apps
  ([checkpoint 5](../testing/checkpoint-5.md)).
- **Oct 24, step 5:** Rushil's own D recording failed in ways the scripted ones never showed: capture missed the print
  dialog, the PDF was blamed on the wrong step, and "Looks right" was offered on a workflow that couldn't make it
  ([checkpoint 6](../testing/checkpoint-6.md)). Step 5 made the record say what happened, gave the runner `save_pdf`,
  and gave the design agent a plan, no call cap, a final check, a pick check and an honest "Can't run yet". **In the
  test browser, A, B, C and D (print way) each do their task, on day 1.** What's left: Rushil's Mac recordings, day-2
  re-runs, the design agent's variance, and AI answers only some checks cover.
