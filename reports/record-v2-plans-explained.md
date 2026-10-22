# Plans 1–3 and checkpoints 1–3, explained piece by piece

**Why this file.** Record v2 was built in three plans, each followed by a live check (a *checkpoint*). The summaries so
far said things like "a new way to score designs" or "rules stated vs rules built" without saying what they are, where
they live, or who uses them. This file does that for every piece. Each piece gets:
- **Before:** what there was.
- **Built:** what was made.
- **Where:** the file.
- **Used at:** the stage of a recording that uses it.
- **Example:** a real one.
- **Tested by:** unit tests, a live recording, or the real model.
- **Test plan:** the question in [`test-plan-record-replay.md`](test-plan-record-replay.md) it answers.

**What's fixed, section by section:** [`record-v2-whats-fixed.md`](record-v2-whats-fixed.md). **Every commit:**
[`record-v2-changes.md`](record-v2-changes.md). **The decisions:** the spec,
[`2026-10-19-record-v2-design.md`](../docs/superpowers/specs/2026-10-19-record-v2-design.md).

**The stages of a recording** (the numbers used below; see [diagram 16](../docs/guide/16-record-to-workflow.png)):
- ① **Describe:** you type the goal.
- ② **Capture:** what you do is recorded.
- ③ **Stop:** the pictures are processed, and your voice becomes text.
- ④ **Normalise:** events become steps; the noise is listed.
- ⑤ **First draft:** the *plain list*.
- ⑥ **Evidence:** `evidence.json`.
- ⑦ **Design agent:**
  - 7a understand;
  - 7b build;
  - 7c safe test run;
  - 7d questions;
  - 7e put your answers in;
  - 7f finish gate.
- ⑧ **Save.**
- ⑨ **Your review.**

---

## 1. The words, once

| Word | What it is | Where it lives | Stage | Example |
|---|---|---|---|---|
| Recording folder | All files of one recording; deleted 24 h after its workflow is saved | `~/Library/Application Support/Shadow/recordings/<id>/` | ②–⑦ | — |
| `trace.jsonl` | Every event, one per line: click, typing, copy, key, tab, file | recording folder | ② | `{"event":"click","url":"https://mail.google.com/…","target":{"role":"link","name":"Daily KPIs - w/c 19 Oct"},…}` |
| `screen.jsonl`, `shots.jsonl` | The words read off each picture (masked), and a line per picture saying whether it was taken | recording folder | ②③ | `"outcome":"taken"` |
| `transcript.jsonl` | What you said, with times (masked) | recording folder | ③ | "I always take the newest one, and never one I already did." |
| Noise list | Events code left out, each with an id and a reason, so nothing is lost silently | inside `evidence.json` | ④ | `x1 clicked the drawn grid` |
| **Plain list** | Code's first draft: one workflow step per real action, exactly as you did it (same page, same target, same values). No AI. It would replay only this one example | built in memory by `compile.ts` / `skeleton.ts`; not saved as its own file (F16) | ⑤ | `s12 type "19 Oct" into A4` |
| **Proposal** | A change code has prepared, which the agent only says yes or no to | inside `evidence.json` | ⑥ | `p1 date: s12 types "19 Oct" → {{today\|D MMM}}` |
| **`evidence.json`** | Everything code understood about the recording, masked: steps, noise, where values went, proposals, what you said, one timeline. All the design agent reads | recording folder; built by `packages/recorder/src/evidence/evidence.ts` | ⑥ | — |
| **Task model** | What the agent thinks the task is, written before it changes anything: outcome, how often, where each value comes from, your rules (quoted), unknowns | `design.json → task` | 7a | §3.1 (the real KPI run) |
| **Finish gate** | Code's checklist before a design is saved. Code, not the model, decides "done" | `packages/recorder/src/design/v2/gate.ts` | 7f | "rule 0 is neither built nor explained" |
| **Safe test run** | The workflow tried in the automation window: it opens pages and reads; buttons, typing and sending are only found and highlighted | `packages/player/src/rehearse.ts`, `apps/daemon/src/rehearse.ts` | 7c | "step 4 ✓ found 'KPI Sheet'" |
| **`design.json`** | The design agent's notebook for one recording. Fields:<br>- `task`: the task model;<br>- `done`;<br>- `decisions`;<br>- `notes`;<br>- `gaps`;<br>- `test`;<br>- `asked`, `answered`, `pending`, `skipped`;<br>- `system`: its instructions;<br>- `transcript`;<br>- `usage` | recording folder | end of ⑦ | — |
| Workflow | The saved result, a new version each time | `skills/<id>/v1.json`, `v2.json`… | ⑧ | — |
| **`review.json`** | What the review page shows: every change with its reason, "What you said → what was built", what wasn't tested, and whether you pressed Looks right | `skills/<id>/review.json` | ⑧⑨ | — |
| **Bench** | A testing tool, not a stage. It runs ④–⑧ on a test recording and scores the workflow against a list | `scripts/design-eval.ts`, `packages/recorder/src/eval/expect.ts` | — | §3.1 |
| **Test recording** (fixture) | A recording folder **written by hand** to look like a real one, kept in git | `fixtures/recordings/<name>/` | — | `kpi-email-to-sheet` |
| `expect.json` | A test recording's list of what a correct workflow must do next time, as checks code can run | in each test recording | — | `{"kind":"has_loop","why":"every new KPI email"}` |
| Ledger | Every real-model run: cost, and the total against the $5 | `testing/design-eval-ledger.md` | — | $0.63 of $5 so far |
| Checkpoint | A stop after a plan, to try it live before the next plan starts | `testing/checkpoint-1.md` … `-3.md` | — | — |

---

## 2. The order things happened

| When | What | Result |
|---|---|---|
| Oct 18 | [`section-study.md`](section-study.md): how each part was built, and what broke in 3 real recordings | 5 fundamental issues; problems listed per section |
| Oct 19 | The spec: the decisions, phase by phase | approved |
| Oct 19 | **Plan 1** (20 tasks): the bench, 4 data bugs, record-keeping, timeouts, then capture | §3 |
| Oct 20 | **Checkpoint 1**: capture tried live | §4 |
| Oct 20 | **Plan 2** (15 tasks): code understands the recording, ending in `evidence.json` | §5 |
| Oct 20 | **Checkpoint 2**: evidence built from the checkpoint 1 recordings | §6 |
| Oct 20 | **Plan 3** (14 tasks): design agent v2, the progress feed, the review | §7 |
| Oct 20 | **Checkpoint 3, step 1**: design agent v2 on the real model, on the 4 test recordings | §8 |
| Oct 21 | PR #14 merged into `main` by Akshat | — |
| waiting | **Checkpoint 3, steps 2–3**: Rushil's own recordings; the test plan's verdict table | not done |

---

## 3. Plan 1 (Oct 19): a measuring stick first, then capture

### 3.1 The measuring stick (Task 1, "the bench")

**Before.** The only way to know whether a design was right was for someone (me) to read the saved workflow
(`v1.json`) by eye after a real recording and write a report. That's what
[`oct19-two-recordings.md`](oct19-two-recordings.md) is. Nothing could be re-checked after a code change without
recording again.

**Built.** A way to check designs again and again, with no recording and no person:
1. **Test recordings** in `fixtures/recordings/`. These are recording folders I wrote by hand, modelled on your real
   recordings (`trace.jsonl`, `description.json`, `transcript.jsonl`, `screen.jsonl`). There are four:

   | Test recording | Modelled on | Events |
   |---|---|---|
   | `kpi-email-to-sheet` | your Oct 19 KPI recording | 17 |
   | `timesheet` | a local timesheet page | 4 |
   | `yc-top-job` | added in Plan 3; your YC recordings | 11 |
   | `playstore-to-chat` | added in Plan 3; your Oct 19 Play Store recording | 6 |

2. **`expect.json` in each:** what a correct workflow must do next time, written as checks code can run. There are 7
   kinds (`packages/recorder/src/eval/expect.ts`):

   | Check | Passes when | Example (why) |
   |---|---|---|
   | `trigger` | it runs the way you said: by hand, on a schedule, or when a file appears | schedule ("every day") |
   | `uses_today` | some step uses `{{today}}` | "the typed 19 Oct is the day it runs" |
   | `has_loop` | there is a loop (optionally over a named list) | "every new KPI email, not this one" |
   | `write_kept` | a write you showed (typing, choosing, uploading, pressing Send) is still there | "the reports are uploaded" |
   | `no_text_only_target` | no step is found only by its text | "the header click can't be found again" |
   | `max_questions` | at most n questions asked | 2: "which sheet and columns are recorded" |
   | `not_asked` | no question matched a pattern | "which file": they said "all the reports" |

   A check marked `expectedToFail` is a known gap (writing to the next empty row isn't built), so it shows ⚠, not ✗.
3. **`pnpm design:eval <folder>`** (`scripts/design-eval.ts`) does what Stop does on that folder: evidence → design
   agent → saved workflow. It then prints ✓/✗ for each check, and `design.json` and the workflow land in a scratch
   folder.
   - **With the fake model** (free, in every `pnpm test`): it shows what code alone builds.
   - **With `--real`:** it costs money and is logged in the ledger.

**Who uses it, where:** it's not part of Shadow's own flow. It's how we measure the design agent (stage ⑦) after every
change. In Plan 3 it ran with a scripted "correct agent", to prove a correct design passes and bad moves are caught.

**"Rules stated vs rules built"** is the test plan's question D4: take every rule you stated, and look at what the
workflow built for it. The bench automates part of this for the 4 test recordings (`has_loop`, `trigger`,
`uses_today`). Inside Shadow, the same idea is the task model's `rules` plus the finish gate. The real KPI run shows it
plainly:

| Rule you stated | Where | What the real run built (Oct 20) | Verdict |
|---|---|---|---|
| "Every day I get these KPI emails…" | narration | Cadence "manual", while quoting that exact sentence | missed (F1) |
| "I always take the newest one, and never one I already did." | narration | "Built" by the recorded click on one email (s2, s3, s5); no loop, no "already done" filter | missed (F2) |

**Test plan:** D4, and the D6/D9 checks, made repeatable.

### 3.2 Four data bugs, record-keeping, timeouts (Tasks 2–8)

| Task | Before | Built | Where | Used at | Tested by |
|---|---|---|---|---|---|
| 2 | The model's own id was used, and once saved a new recording as the next version of *another* workflow | The daemon's id always wins | `apps/daemon/src/record.ts` | ⑧ | unit tests |
| 3 | An answer to a question about a step inside a loop failed; questions came without their step | Answers reach nested steps; each question carries its step | `packages/recorder/src/drill.ts` | 7d, ⑧ | unit tests |
| 4 | The model's reasoning text was thrown away | Kept on every reply | `packages/llm/src/client.ts`, `packages/agent/src/agent.ts` | ⑦ | real model (in `design.json`) |
| 5 | One tool call per turn; a refused call's input was lost | Several calls per turn; refused and invalid calls are kept with their input | `packages/agent/src/agent.ts` | ⑦ | real model |
| 6 | Picture reading wasn't counted in the cost | Counted, and cached per picture | `packages/llm/src/vision.ts`, `apps/daemon/src/describe.ts` | ⑥ | unit tests |
| 7 | A Chrome call could hang for 35–50 s | A timeout on every call (15 s; 30 s to open a page) | `packages/player/src/web/cdp.ts` | 7c (and replay) | unit tests |
| 8 | A run that did nothing said "succeeded" | It says "nothing to do" | `packages/player/src/run.ts` | 7c (and replay) | unit tests |

**Test plan:** D5 (reasoning visible), D10 (cost), P7/P9 (replay).

### 3.3 Capture (Tasks 9–19, all at stage ②)

| Task | Before | Built | Where | Example | Tested by | Test plan |
|---|---|---|---|---|---|---|
| 9 | — | Room in the trace for the new facts below | `packages/core/src/trace.ts` | — | unit tests | — |
| 10 | Google's per-session ids kept; nameless links; no list place | Ids dropped; addresses kept; names from title, image text or heading; the place in a list | `apps/extension/src/describe.ts` | YC card `link:''` → named; "item 1 of 20" | live (YC) | R1, R10 |
| 11 | Selecting text before a copy = a click on the whole block | `select_text` is its own event; the copy knows its element | `apps/extension/src/capture.ts` | YC company name | live | R1 |
| 12 | Nothing said what a click did | Watched 0.7 s: went somewhere / opened / emptied / nothing, ignoring the page's own constant changes | `apps/extension/src/effect.ts` | Gmail header click reads "nothing" | live (Gmail) | R1, R9 |
| 13 | Only Enter and Escape kept | Shortcuts with ⌘/Ctrl/Alt, Gmail's single keys; 3 keys within 1 s count as typing, so no keylogging | `apps/extension/src/keys.ts` | Gmail `e` | live | R1 |
| 14 | A sheet click had no target (Sheets draws its grid on a canvas) | The cell, value and sheet tab, read from the Name Box. **This is a Sheets-only adapter** | `apps/extension/src/adapters/google-sheets.ts` | `C3 "1,234"` | live (test sheet) | R1 |
| 15 | A page's own Copy button was lost | Caught by a small hook in the page | `apps/extension/src/clipboard-hook.ts` | GitHub clone URL | live | R1 |
| 16 | One-page apps kept their first address; a tab opened before Record was unknown | The address per event; tabs named from their pages; window switches | `apps/extension/src/tab-registry.ts`, `background.ts` | "KPI Sheet" | live | R2 |
| 17 | Fast clicks lost pictures, silently | A queue of 3; `shots.jsonl` says why any picture is missing | `apps/extension/src/shot-queue.ts` | `"outcome":"taken"` | live | R5 |
| 18 | Screen words cut at 2,000 characters; no way to hide names | 8,000 with positions; a warning before recording; "Private words"; a faster Stop | `apps/daemon/src/screen.ts`, `apps/ui/src/screens/Record.tsx`, `apps/daemon/src/voice.ts` | — | live; tests | R6, R7 |
| 19 | Shadow's own prompts recorded; deletions not | Prompts skipped; Move to Trash recorded, with approval | `apps/mac/Sources/Recorder.swift`, `apps/daemon/src/fs-watch.ts` | — | tests (needs `setup:mac`) | R3, R4 |

---

## 4. Checkpoint 1 (Oct 20): capture, live

**What it was:** short recordings in a real Chrome, then reading the files they wrote. **I made them, not you:**
- **Part 1:** a separate test browser driven by Playwright, on public pages: Wikipedia, YC jobs, GitHub, a public
  sample sheet.
- **Part 2:** your Chrome through Claude in Chrome: a test sheet made for this, and Gmail.
- **Not covered:** no voice, and no real task of yours.

**Broken, and fixed the same day:**
- Gmail's row under the pointer wasn't seen as part of the inbox list.
- A "Saved" message read as "nothing changed".
- Plain paragraphs were treated as a list.
- A control borrowed a far-away name ("Table").
- GitHub's own clicks were recorded as yours.
- A page check written as a pattern broke replay.

**Handed on to Plan 2:** a click that opens a new tab had no picture; Back was recorded as a typed address.

**Where:** [`testing/checkpoint-1.md`](../testing/checkpoint-1.md); copies in `~/shadow-tests/checkpoint-1/`.

---

## 5. Plan 2 (Oct 20): code understands the recording (stages ④⑤⑥)

| Task | Before | Built | Where | Example | Tested by | Test plan |
|---|---|---|---|---|---|---|
| 1 | — | The agreement between code and agent: TaskModel, DoneReport, Proposal, EvidenceView, TestReport | `packages/recorder/src/design/v2/contracts.ts` | — | unit tests | — |
| 2 | Typed dates stayed as typed | Date templates the player fills in | `packages/core/src/dates.ts` | `{{today\|D MMM}}` → "22 Oct"; `{{today-1}}`; `{{week_start}}` | live (KPI, Play Store) | R10, D2 |
| 3 | Replay couldn't press ⌘-shortcuts | `press {key, modifiers}` | `packages/player/src/web/keys.ts` | ⌘Enter | unit tests | P4 |
| 4 | Steps lost what capture saw; an Enter that sends needed no OK | Steps keep cell, list place and effect; keys become presses; an Enter that sends needs your OK | `packages/recorder/src/normalise.ts` | Chat's Enter | unit tests | R9, R10 |
| 5 | Noise kept or silently dropped | Removed **and listed** (x1…); select + copy = one read | `normalise.ts` | 14 page loads → listed | live | R9 |
| 6 | No idea what a step was for | Each step classed: go / read / act / reveal | `packages/recorder/src/evidence/classes.ts` | `s5 read: copy …` | live | R9 |
| 7 | Tabs had no names | Named from their pages | `evidence/tabs.ts` | "KPI Sheet" | live | R2 |
| 8 | Screen words not tied to steps | Words near the click; what appeared after it | `evidence/screens.ts` | "Message sent" | live | R6 |
| 9 | Nothing linked a copy to its paste | Where each value went | `evidence/flow.ts` | copied in s5 → pasted in s12 | unit tests | R9 |
| 10 | Generalising left to the model | **Proposals** with the change prepared | `evidence/proposals.ts` | p1 date; p2 item 1 of the list; repeat; open directly; all files | live (date); tests (others) | D2, D4 |
| 11 | Two numberings for "said over steps 4–5" | One timeline in the draft's ids | `evidence/timeline.ts` | `00:13 said: "I always take…"` | live | R8 |
| 12 | Questions the recording answered were still asked | Code answers "which file / which row" from what you said | `evidence/answers.ts` | — (F13 lives here) | unit tests | D7 |
| 13 | The agent never used its picture tool | Code captions every picture first (Pictures on), cached | `evidence/captions.ts` | — | live (5 pictures) | R6, D3 |
| 14 | The agent saw only 40 steps, re-sent every turn | **`evidence.json`**, under 24k tokens, sent once; written at Stop; `pnpm evidence <folder>` builds it by hand | `evidence/evidence.ts`, `apps/daemon/src/evidence.ts`, `scripts/evidence.ts` | — | live | D1, D10 |

---

## 6. Checkpoint 2 (Oct 20): the evidence, from real recordings

**What it was:** `pnpm evidence` (no model) on the 6 checkpoint 1 recordings and the 2 test recordings, plus one live
caption run (5 pictures, $0.07). Each was checked for:
- the timeline;
- the step classes;
- the noise list;
- the proposals;
- the size.

**Broken, and fixed:**
- "Open directly" offered to drop the click on the email, which would lose which email.
- Gmail's header blocks were proposed as a list.
- Two key presses were proposed as a repeat.
- Screen words landed on the wrong step.
- A caption guessed "nothing was saved".

**Still open:** KPI's two copy/paste rounds aren't spotted as a repeat (they differ by one step), which is part of F2.
**Where:** [`testing/checkpoint-2.md`](../testing/checkpoint-2.md).

---

## 7. Plan 3 (Oct 20): design agent v2 and the screens (stages ⑦⑧⑨)

| Task | Before | Built | Where | Used at | Tested by | Test plan |
|---|---|---|---|---|---|---|
| 1 | 2 test recordings | YC top job, Play Store → Chat (written by hand) | `fixtures/recordings/` | bench | — | — |
| 2 | — | The agent's view of the evidence: left-out ids, page text marked untrusted, real page addresses, what each click did | `evidence/evidence.ts`, `evidence/pages.ts` | 7a, 7b | unit tests | D1 |
| 3 | Rules that tied its hands ("never add a click") | **Guardrails:** refuse only harm (approval off, scripts, unvisited sites, untouched folders, hidden values); everything else is noted with its reason | `design/v2/rules.ts`, `design/v2/places.ts` | 7b | unit tests | D8 |
| 4 | `finish` took anything that parsed | **Finish gate** | `design/v2/gate.ts` | 7f | unit tests | D4, D9 |
| 5 | 13 brittle tools; questions lost to `id` | 16 forgiving tools (accept, reject, remove, restore, add, change, move, loop, branch, ai_step, trigger, input, look, ask, test, done) | `design/v2/tools.ts` | 7b | real model | D3 |
| 6 | Nothing tried the workflow | **Safe test run** (allow-list: open, switch tabs, recorded links, read, find files, ≤3 AI calls; the rest only highlighted) | `packages/player/src/rehearse.ts`, `apps/daemon/src/rehearse.ts` | 7c | unit tests only | D9 |
| 7 | One tab | A step can name its tab | `packages/core/src/skill.ts` (`tab`), `apps/extension/src/tab-map.ts` | 7b, replay | unit tests | R2, P2 |
| 8 | `label_steps` first | **Understand:** one call writes the **task model**; the prompt rewritten to about 60 lines with one worked example | `design/v2/understand.ts`, `design/v2/prompt.ts` | 7a | real model | D2, D4, D5 |
| 9 | One loop of 16 turns, $0.10 | **The orchestrator:** stages on one budget ($0.25, 40 calls); one question batch; a recording is never lost (it keeps the last good draft, else the plain list) | `design/v2/orchestrator.ts`, `questions.ts` | ⑦ | real model | D7, D10 |
| 10 | The old agent | v2 wired in at Stop; the old agent removed | `apps/daemon/src/record.ts` | ⑦⑧ | unit tests | — |
| 11 | No progress shown; every open question shown | Progress feed in plain words; only this recording's questions; Enter sends | `design/v2/progress.ts`, `apps/ui/src/screens/Record.tsx`, `apps/ui/src/questions.ts` | ⑦ | unit tests | D7 |
| 12 | A summary that could describe changes never made | **Review:** each change with its reason, "What you said → what was built", what wasn't tested; Go live waits for **Looks right** | `design/v2/review.ts`, `apps/daemon/src/review-store.ts`, `apps/ui/src/review.ts` | ⑧⑨ | unit tests | D6, D9 |
| 13 | — | The bench with a scripted correct agent: all 4 pass; deleting everything, an invented check and an empty loop are caught | `design/v2/bench.test.ts` | bench | unit tests | D4, D9 |
| 14 | — | Checkpoint 3 | below | — | — | — |

After Task 13, a whole-branch review found 4 serious bugs, all fixed:
- the stylesheet was emptied;
- some messages to the agent weren't masked;
- a sending step the agent added got no approval;
- upload and watch folders weren't checked.

---

## 8. Checkpoint 3, step 1 (Oct 20): design agent v2 on the real model

**What it was:** `pnpm design:eval <folder> --real` on the 4 **test** recordings.
- No Chrome, so no safe test run.
- Every question was answered with Enter (the default).
- Total $0.20.

| Test recording | Checks passed | Cost | What went wrong |
|---|---|---|---|
| timesheet | 5 of 5 | $0.023 | nothing |
| playstore-to-chat | 5 of 6 | $0.012 | runs by hand though "every month" was said (F1) |
| yc-top-job | 3 of 5 | $0.124 | 20 of 40 calls refused for tool syntax (F3); asked 3 |
| kpi-email-to-sheet | 3 of 7 | $0.037 | no loop for "the newest" (F2); by hand (F1); asked what was answered (F4); removed the step that opens the sheet (F5) |

**Not fixed and not re-run:** you chose to list these instead (F1–F5).
**Where:** [`testing/checkpoint-3.md`](../testing/checkpoint-3.md); the ledger.

---

## 9. Where to look now (the test plan's pointers, updated)

The test plan was written on Oct 15 for the **old** agent, and some of its "where to look" pointers no longer exist.
Use this table with it.

| Test plan section | It says look at | In v2, look at |
|---|---|---|
| R8 narration | `design.json → prompt.task` ("What they said…") | `evidence.json → said` and `timeline` (each line with the step ids it was said over) |
| R9 normalise | `design.json → prompt.task` ("The recording…") | `evidence.json → steps` (each with its class) and `noise` |
| R10 first draft | the first tool result, or the outline before `label_steps` | not saved as a file (F16). `evidence.json → steps` has each step, and the review shows what changed from it |
| D1 what it was given | `design.json → prompt.system`, `prompt.task` | `evidence.json` (the input to 7a). `design.json → system` holds the build instructions; the understand instructions are `UNDERSTAND` in `design/v2/prompt.ts` |
| D2 `label_steps` | its first call | gone. `design.json → task`, the task model (careful: in v2 `task` means the task model, not the prompt) |
| D3 tools | each call | `design.json → transcript`: `call`, `result`, `refused`, `invalid` events |
| D4 rules stated vs built | the form, the narration, `v1.json` | `design.json → task.rules` against `done.rules`; the review's "What you said → what was built" |
| D5 reasoning | `reply` events | `design.json → transcript`, `reply` events: `thought` and `reasoning` |
| D6 changes | plain list vs `v1.json` | `design.json → notes` (each change with its why); `review.json` |
| D7 questions | `ask_user` calls | `design.json → asked`, `skipped`, `pending` |
| D8 guardrails | refusals | `design.json → transcript`, `refused` events |
| D9 honesty, finish | `finish` | `design.json → done`, `gaps`, `test` |
| D10 cost | usage | `design.json → usage`; the ledger |

---

## 10. Never tested yet

- **Design agent v2 on a real recording:** every real-model run so far used the 4 hand-written ones.
- **The safe test run in Chrome.**
- **A person answering the question batch:** Enter was used every time.
- **The progress feed, the review page and Looks right in the app,** on a real recording.
- **Capture with your voice on a real task of yours.** Checkpoint 1 had no voice.
- **Mac-app capture after `pnpm setup:mac`:** Move to Trash, prompts skipped.

The next step does these: 5 recordings made by me on public sites, plus KPI, YC and Play Store recorded by you with
voice. The results go in `testing/checkpoint-4.md`.
