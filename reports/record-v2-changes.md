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
  [`checkpoint-3.md`](../testing/checkpoint-3.md) (design agent v2 on the real model).

Code is as of `feat/record-v2` at `19cb94d` (Oct 20). The branch is not pushed or merged.

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
| 2 | Generalising is left to one model | No code-side generalisation; one agent with brittle tools | Code finds patterns and prepares the change (proposals: today's date, item k of a list, repeats, open directly, all files, constants). Agent v2 first writes what the task is (the task model), then accepts proposals by id, with forgiving tools (D1–D3) | **partly**: built. Real runs: timesheet and Play Store right; KPI built no loop; YC lost half its calls to tool syntax (checkpoint 3) |
| 3 | Nothing checks the result | `finish` took anything that parsed; a run that did nothing "succeeded" | Code's finish gate decides when a design is done (D6), plus a safe test run in the automation window, a review with "Looks right" before Go live, and "nothing to do" for an empty run (`0f8c516`) | **fixed (tests)**. Found live: the gate takes the model's word on how often it runs (D6) |
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
| Shadow's own permission prompt and System Settings recorded as steps | Recorded | Skipped; Screen Recording is asked before recording starts (`0c38bf6`) | **fixed (tests)**: needs your `pnpm setup:mac` to see live |
| Nameless Accessibility elements (Numbers) | Dropped | Unchanged. Picture captions describe them only when Pictures is on | **open** |

## R4 · File capture

| Problem | Before | Now | Status |
|---|---|---|---|
| Deletions weren't recorded | A vanished file was ignored | Finder's Move to Trash (menu or ⌘⌫) plus the file vanishing becomes a "move to the Trash" step, with approval (`0c38bf6`) | **fixed (tests)**: needs `setup:mac` |

## R5 · Screenshots: capture

| Problem | Before | Now | Status |
|---|---|---|---|
| A burst of events lost pictures | The newest replaced the waiting one | A queue keeps up to three, the most telling first; a new tab is pictured when it shows (`c820e9a`) | **fixed (live)** |
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

The whole design has one budget: $0.25 and 40 model calls, picture captions included.

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
| *Found live (checkpoint 3, YC):* 20 of 40 calls refused: ids as one string `"s2, s3"`; a removal blocked by a later `{{var}}`; `add {do: "ai_step"}`; `output.type` as a string; `{{s6}}` (a step id) as a variable | — | — | **open**: fixes proposed |

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
| Questions the recording already answered | Evidence check (PR #13) | Plus: code answers "which file / which row" from what you said (`aec37ed`) | **fixed (tests)** |
| Questions lost (the `id` misuse) | Lost | Fixed with the new tools | **fixed (live)** |
| Asked one by one, without context, every recording's questions shown | — | One batch on the Record screen, next to each step; only this recording's; Enter sends; "You decide" takes the default; at most 5, the rest take their defaults and the review lists them (`0a058fb`, `fdaa488`) | **fixed (tests)** |
| Code's questions dropped when a design stopped early | — | Kept for the drill (`fdaa488`) | **fixed (tests)** |
| The agent asks anyway after seeing the answer | — | Found live: KPI asked "should it run on its own?" after "every day" | **open** |
| No timeout on a question | Waits | Unchanged | **open** |

## D6 · Finish, honesty and the review

| Problem | Before | Now | Status |
|---|---|---|---|
| `finish` accepted a workflow that no longer does the task | Accepted | The **finish gate** (`gate.ts`) wants:<br>- every write kept;<br>- every rule you said built or explained;<br>- checks on text that really appeared;<br>- test failures explained;<br>- defaults for unattended runs;<br>- the frequency you said.<br>It refuses at most twice, then saves with the gaps listed (`b221880`) | **fixed (tests)** |
| Every stated rule unbuilt | Accepted | Every rule needs steps or a reason | **partly**: the gate checks that the named steps exist, not what they mean (real KPI run "built" "the newest one" with the recorded click) |
| No test before saving | None | A **safe test run** (`d35b071`):<br>- it opens pages, reads, and follows only recorded links;<br>- it only outlines typing, sending and acting buttons;<br>- it says first what it will do ("opening 1 email will mark it as read");<br>- without Chrome it says "not run";<br>- it queues behind real runs | **fixed (tests)**: not yet run live |
| Summaries describing changes never made | History fixed in PR #13 | The **review**, built by code (`e3dbfc3`):<br>- a badge per change with its reason;<br>- "What you said → what was built";<br>- what wasn't tested.<br>Go live, and schedules, wait for "Looks right" (`feec1cc`) | **fixed (tests)** |
| How often it runs, from "every day" | Worked (PR #13) | **Regressed, found live:** the model wrote "manual" while quoting "every day / every month", and the gate takes its word | **open**: fix proposed (the gate reads the frequency words itself) |

## D7 · Budget, cost and record-keeping

| Problem | Before | Now | Status |
|---|---|---|---|
| Reasoning not kept | Empty | Kept (`7703b73`) | **fixed (live)** |
| Rejected calls' input not kept | Lost | Kept (`702954a`) | **fixed (live)** |
| Vision calls not metered | Unmetered | Metered and cached by picture (`775ea37`); captions count on the design's budget | **fixed (tests)** |
| Near the $0.10 cap | 16 turns, $0.10 | $0.25 and 40 calls on one meter; real designs cost $0.012–0.124 | **fixed (live)** |

---

## Removed

| What | Why | Replaced by |
|---|---|---|
| `packages/recorder/src/design/design.ts`, `design/tools.ts`, `design/design.test.ts` | The old agent: labelling first, 13 brittle tools, `designViolations` | `design/v2/` |
| `design/changes.ts` | Moved, not removed | `design/v2/changes.ts` |
| `compile.ts`'s one-call model path, `systemPrompt`, the `Chat` type and 11 tests | Unused since PR #13 (one AI reads the recording); their code-only checks moved to code-only tests | Code-only compile, then design agent v2 |
| The labelling stage, `describe_step_screenshot`, the 40-step cut, "targets only from the recording" | See D1–D4 | Evidence, captions in code, guardrails |

These were approved with the spec. `labelDraft`, `labelRules` and `merge` in `compile.ts` are now unused but kept,
because removing them needs your OK.

## Still open, or planned

- **Checkpoint 3, step 2:** Rushil records KPI, YC and Play Store on his Mac; the safe test run is seen live.
- **From the first real runs:**
  - the gate should read the frequency words itself;
  - the tool forgiveness gaps in D3;
  - KPI's "the newest email" should become a loop. A new recording with list positions will show whether the agent
    builds it.
- **Replay (Akshat):**
  - the matcher using list position, text and `near`;
  - writing to a cell or the next empty row (then MCP);
  - named tabs closed during approval waits;
  - the run-time folder check;
  - sign-off on `skill.ts` `tab`, the player's test run, dates and keys.
- **Live checks after `pnpm setup:mac`:** Move to Trash, Shadow's prompts skipped, copy and paste from the app.
- **Ten smaller items** from the Plan 3 review:
  - a removal's reason is optional;
  - the test run's AI calls are on the daemon's meter;
  - checks may only use text seen while recording;
  - a second round of questions for unattended runs;
  - review wording;
  - `<untrusted_data>` isn't escaped;
  - relative input paths skip the folder check;
  - stage 1 can make 4 calls;
  - each progress line resends the whole view;
  - "Done" shows twice.

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
- **What's left:**
  - those three fixes;
  - Rushil's live recordings;
  - the replay side (the matcher, writing to sheets, tabs during waits), which is Akshat's.
