# Plans 1–3, checkpoints 1–6 and the step-4 and step-5 fixes, explained piece by piece

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
  - 7b build (since Oct 24 it starts with one call that plans every change);
  - 7c safe test run;
  - 7d questions;
  - 7e put your answers in;
  - 7f finish gate;
  - 7g final check (since Oct 24): a workflow that makes files runs once for real, then its files go to the Trash.
- ⑧ **Save.**
- ⑨ **Your review.**

---

## 1. The words, once

| Word | What it is | Where it lives | Stage | Example |
|---|---|---|---|---|
| Recording folder | All files of one recording; deleted 24 h after its workflow is saved | `~/Library/Application Support/Shadow/recordings/<id>/` | ②–⑦ | — |
| `trace.jsonl` | Every event, one per line: click, typing, copy, key, tab, file | recording folder | ② | `{"event":"click","url":"https://mail.google.com/…","target":{"role":"link","name":"Daily KPIs - w/c 19 Oct"},…}` |
| `print` event *(Oct 24)* | The page's own `beforeprint`, recorded when you print it (⌘P or File → Print), on any site, with no Accessibility needed | `trace.jsonl` | ② | `{"event":"print","title":"Battle of Schliengen - Wikipedia",…}` |
| `screen.jsonl`, `shots.jsonl` | The words read off each picture (masked), and a line per picture saying whether it was taken | recording folder | ②③ | `"outcome":"taken"` |
| `transcript.jsonl` | What you said, with times (masked) | recording folder | ③ | "I always take the newest one, and never one I already did." |
| Noise list | Events code left out, each with an id and a reason, so nothing is lost silently | inside `evidence.json` | ④ | `x1 clicked the drawn grid` |
| `file_appeared` *(Oct 24)* | A step for a file that appeared with nothing recorded making it. Code no longer blames it on the step before; the finish gate asks for a step that makes it | `evidence.json → steps` and `unmade` | ④ | "a file appeared: ~/Desktop/Reading/23 Oct - Thuggee.pdf (what made it wasn't recorded)" |
| **Plain list** | Code's first draft: one workflow step per real action, exactly as you did it (same page, same target, same values). No AI. It would replay only this one example | built in memory by `compile.ts` / `skeleton.ts`; kept in `design.json → plain` since Oct 23 (F16) | ⑤ | `s12 type "19 Oct" into A4` |
| `web.save_pdf` *(Oct 24)* | A workflow step that saves the open page as a PDF into a folder, under a name: Chrome prints it (`Page.printToPDF`) and the daemon writes the file. A print and its PDF become one | `packages/core/src/skill.ts`; run by `packages/player` | ⑤, and every run | `save_pdf ~/Desktop/Reading "{{today\|D MMM}} - {{page_title}}.pdf"` |
| **Proposal** | A change code has prepared, which the agent only says yes or no to | inside `evidence.json` | ⑥ | `p1 date: s12 types "19 Oct" → {{today\|D MMM}}` |
| `same_place` proposal *(Oct 24)* | "Click whatever is at the place this link was clicked", for a link that changes every day. Its change is ready | `evidence/proposals.ts` | ⑥ | D: click `#mp-tfa > p > b > a`, today's featured article |
| **`evidence.json`** | Everything code understood about the recording, masked: steps, noise, where values went, proposals, what you said, one timeline. All the design agent reads | recording folder; built by `packages/recorder/src/evidence/evidence.ts` | ⑥ | — |
| **Task model** | What the agent thinks the task is, written before it changes anything: outcome, how often, where each value comes from, your rules (quoted), unknowns | `design.json → task` | 7a | §3.1 (the real KPI run) |
| **Finish gate** | Code's checklist before a design is saved. Code, not the model, decides "done" | `packages/recorder/src/design/v2/gate.ts` | 7f | "rule 0 is neither built nor explained" |
| **"Can't run yet"** *(Oct 24)* | What a design says when the recording shows a file no step makes. The review shows why in place of Looks right, and Go live refuses it | `design.json → cantRun`; the review | 7f, ⑨ | "~/Desktop/Reading/23 Oct - Thuggee.pdf appeared in the recording, but no step makes a file in ~/Desktop/Reading" |
| **Safe test run** | The workflow tried in the automation window: it opens pages and reads; buttons, typing and sending are only found and highlighted | `packages/player/src/rehearse.ts`, `apps/daemon/src/rehearse.ts` | 7c | "step 4 ✓ found 'KPI Sheet'" |
| **Final check** *(Oct 24)* | The safe test run in "local mode", once the gate is passed: the files the workflow makes (a saved PDF, a copy, a move of one of those) are made for real, then put in the Trash. Nothing on a web page is done. Twice for a "skip" rule | the same files, plus `design/v2/orchestrator.ts` | 7g | D: it made "24 Oct - Battle of Schliengen (1).pdf", then trashed it |
| STUCK *(Oct 24)* | With no cap on calls, what ends a design that goes nowhere: 5 changes in a row refused or changing nothing. It then gets one fresh start that lists them | `design/v2/orchestrator.ts` | ⑦ | — |
| **Pick check** *(Oct 24)* | Code checking an AI step's pick of "the first N" against its data, when a run happens. A wrong pick is asked once more of the smart model; wrong again, the step fails | `pickProblem` in `packages/player/src/node/llm-step.ts` | every run (replay) | A: "Twelve years of distributed SQLite" picked again though already saved |
| Notices *(Oct 24)* | What the review says the recording missed: the microphone heard no words; Shadow.app or Accessibility was off; a file nothing made | `apps/daemon/src/record.ts` (`noticesOf`) | ⑨ | "The microphone was on, but no words came through" |
| **`design.json`** | The design agent's notebook for one recording. Fields:<br>- `task`: the task model;<br>- `done`;<br>- `decisions`;<br>- `notes`;<br>- `gaps`;<br>- `test`;<br>- `asked`, `answered`, `pending`, `skipped`;<br>- `system`: its instructions;<br>- `transcript`;<br>- `usage` | recording folder | end of ⑦ | — |
| Workflow | The saved result, a new version each time | `skills/<id>/v1.json`, `v2.json`… | ⑧ | — |
| **`review.json`** | What the review page shows: every change with its reason, "What you said → what was built", what wasn't tested, and whether you pressed Looks right | `skills/<id>/review.json` | ⑧⑨ | — |
| **Bench** | A testing tool, not a stage. It runs ④–⑧ on a test recording and scores the workflow against a list | `scripts/design-eval.ts`, `packages/recorder/src/eval/expect.ts` | — | §3.1 |
| **Test recording** (fixture) | A recording folder **written by hand** to look like a real one, kept in git | `fixtures/recordings/<name>/` | — | `kpi-email-to-sheet` |
| `expect.json` | A test recording's list of what a correct workflow must do next time, as checks code can run | in each test recording | — | `{"kind":"has_loop","why":"every new KPI email"}` |
| Ledger | Every real-model run: cost, and the total against the budget ($5; $10 since Oct 23) | `testing/design-eval-ledger.md` | — | about $6.6 of $10 by Oct 24 (§16) |
| Checkpoint | A stop after a plan, to try it live before the next plan starts | `testing/checkpoint-1.md` … `-6.md` | — | — |

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
| Oct 22 | Rushil's questions answered; a 5-step plan; these docs and [`record-examples.md`](../testing/record-examples.md) | — |
| Oct 23 | **Checkpoint 4**: five everyday tasks recorded on real sites, designed on the real model, run | §11 |
| Oct 23 | **Step 4**: every failure traced to its cause and fixed (F17–F61) | §12 |
| Oct 23 | **Checkpoint 5**: the same five tasks re-designed and re-recorded live | §13 |
| Oct 23 | PR #15 opened | — |
| Oct 23, evening | A re-run live at Rushil's ask: does its task, but "skip ones already saved" missed one | §14 |
| Oct 23, 23:42 | **Checkpoint 6**: Rushil records D himself, on his Mac; it fails | §14 |
| Oct 24 | **Step 5**, phases 0–4: the record tells the truth, the runner's new abilities, design agent v3, the run log and the review | §15 |
| Oct 24 | **Phase 5**: A–D re-recorded live and fixed until each did its task | §16 |
| Oct 24 | PR #17 opened (`feat/record-v3`, 36 commits) | — |
| waiting | **Checkpoint 3, steps 2–3** and **Phase 5's other half**: Rushil's own recordings on his Mac; the day-2 re-runs; the test plan's verdict table | not done |

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
   **Since Oct 23 there's an eighth, `runs`,** added to every run whatever the list says: it passes only when the
   step-runner can run every step (checkpoint 4 showed B and C passing every check and not running).
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
| R10 first draft | the first tool result, or the outline before `label_steps` | `design.json → plain`, the plain list it started from (kept since Oct 23, F16). `evidence.json → steps` has each step, and the review shows what changed from it |
| D1 what it was given | `design.json → prompt.system`, `prompt.task` | `evidence.json` (the input to 7a). `design.json → firstMessage` is the build agent's first message (since Oct 23); `design.json → system` holds the build instructions; the understand instructions are `UNDERSTAND` in `design/v2/prompt.ts` |
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

Written Oct 22; the marks are as of Oct 24.
- ~~**Design agent v2 on a real recording.**~~ Done: checkpoints 4 and 5 (§11, §13).
- ~~**The safe test run in Chrome.**~~ Done, live, in checkpoints 4 and 5: it found real faults.
- **A person answering the question batch:** partly. I answered D's, D2's and E's in checkpoint 4; you haven't yet.
- **The progress feed, the review page and Looks right in the app,** on a real recording: once, on your D (checkpoint
  6). It offered Looks right on a workflow that couldn't make the PDF (cause 9). Step 5's review (notices, "Can't run
  yet") has been seen only in screenshots on a scratch daemon.
- **Capture with your voice on a real task of yours:** tried once (your D): 0 words, because of the microphone (§14,
  cause 10). Not yet with words.
- **Mac-app capture after `pnpm setup:mac`:** not yet. Accessibility was off for your D.
- **A real ⌘P in Chrome** *(new)*: not yet. Phase 5's print-way runs fired the page's `beforeprint` themselves.

What's left of this list needs your recordings on your Mac: KPI, YC, Play Store with voice, and step 5's four (§16).

---

## 11. Checkpoint 4 (Oct 23): five everyday tasks on real sites

**What it was:** tasks A–E from [`record-examples.md`](../testing/record-examples.md), recorded by me on real public
sites in an isolated test browser:
- A, Hacker News's top 3 stories;
- B, YouTube's newest video;
- C, today's dollar-to-rupee rate;
- D, Wikipedia's featured article as a PDF;
- E, an Excalidraw note.

Each was designed on the real model at Stop and then started with **Run now**. No voice, so the goal carried the
rules.

**Result:** none of the five saved workflows did its task. Every cause was on the record side: a paste wired to the
wrong copy, the first page lost, a read the runner can't run, a renamed file followed by its old name, a broken draft
kept. They were numbered F17–F34.

**Where:** [`testing/checkpoint-4.md`](../testing/checkpoint-4.md); copies of each recording in
`~/shadow-tests/checkpoint-4/` (not in git).

---

## 12. Step 4 (Oct 23): the fixes, piece by piece

Every fix started as a failing test built from the real trace's shape, with the fewest lines and no per-app code.
The full list (cause, fix, commit, test for each F) is [`record-v2-deep-dive.md`](record-v2-deep-dive.md). The pieces:

### 12.1 Capture and the first draft (② ④ ⑤)
- **Before:** both fields of a note got the second copied value; a page opened in a second tab merged into the first
  tab's page; a rename was followed by its recorded name.
- **Built:**
  - each paste takes the copy made just before it;
  - a page opened in another tab is its own step;
  - a download adds "find the file it saved", which waits up to 60 s;
  - a rename's new name becomes a value later steps use;
  - a copied element keeps a selector on pages that nest tables.
- **Where:** `normalise.ts`, `skeleton.ts`, `evidence/tabs.ts`, `apps/daemon/src/fs-watch.ts`,
  `apps/extension/src/describe.ts`.
- **Used at:** ④ and ⑤.
- **Example:** live D: click Download, then "find the newest `.pdf` saved since the run started" (it waited for the
  file), then rename to `23 Oct - Thuggee.pdf`, then move into Reading.
- **Tested by:** unit tests, and live in checkpoint 5.

### 12.2 What the runner can run (⑦ 7b, 7f)
- **Before:** the agent's tools checked a step's shape, not whether the step-runner could run it. A read with no
  control, a control found only "near Indian Rupee", or `{{today}}` as an input default all got saved.
- **Built:** `stepProblems` and `runProblems` hold what the runner needs: each action's values, and a control it can
  find. `add` and `change` refuse a new step that fails it and say what's needed. The finish gate refuses a workflow
  with such a step, a stale check, or a step in the wrong tab.
- **Where:** `design/v2/gate.ts`, `design/v2/tools.ts`.
- **Used at:** 7b (each edit) and 7f (finish).
- **Example:** live C's first try read `{ role: "cell" }`, which matches every cell. Now it's refused: "a role alone
  matches every cell on the page".
- **Tested by:** unit tests, plus the bench's `runs` check.

### 12.3 Reading the page, and loops (⑦ 7b)
- **Before:** "read the page, let an AI step pick the newest" failed: a read needed a control, and a step using
  `{{story.title}}` couldn't be added before the loop that declares `story`.
- **Built:**
  - a read with no control reads the page's main part;
  - a loop can make new steps inside it;
  - looping over an AI step's answer makes it a list;
  - the model's ways of writing a type are taken.
- **Where:** `design/v2/tools.ts`.
- **Used at:** 7b.
- **Example:** live B: read the channel page, then an AI step picks the newest video's title and views, then type them.
  Live C: an AI step picks the rupee rate out of the whole table's text.
- **Tested by:** unit tests; live in checkpoint 5 (B and C did their task).

### 12.4 The finish gate, and never losing a recording (⑦ 7f, ⑧)
- **Before:**
  - a failed test counted as explained by any reason the agent had given;
  - a stopped design was kept even when it couldn't run;
  - after two refusals, a design was saved with its gaps, even with all your work removed.
- **Built:**
  - only reasons given after the test explain it;
  - a test that couldn't start is a problem;
  - frequency words in the goal require a schedule;
  - a "the newest / top 3" rule left unbuilt is turned back with how to build it;
  - a stopped design, or one let past the gate, keeps the recorded steps when it lost your work or can't run.
- **Where:** `design/v2/gate.ts`, `design/v2/orchestrator.ts`.
- **Used at:** 7f and ⑧.
- **Example:** live A's last try removed every save. It's now saved as the recorded steps, not as three page opens.
- **Tested by:** unit tests; live once (D's last try kept the recorded steps).

### 12.5 The agent sees more, and wastes less (⑦)
- **Before:** the agent resent a failing call up to 20 times, and the test run showed only that a check failed, not
  what an AI step had answered.
- **Built:**
  - a call sent again exactly as it failed is answered "you sent this before";
  - a change that changed nothing says so;
  - the test run shows each step's value;
  - the time of day is never asked (9:00);
  - a reply cut off at the token cap gets one more episode.
- **Where:** `design/v2/tools.ts`, `orchestrator.ts`, `prompt.ts`.
- **Used at:** 7b to 7d.
- **Example:** live D's AI step took the Main Page's image caption as the article's title. The test now shows that
  answer to the agent.
- **Tested by:** unit tests; the repeat answer was seen live.

---

## 13. Checkpoint 5 (Oct 23): the same five tasks, after the fixes

**What it was:** two ways.
1. Checkpoint 4's own recordings, designed again on the real model after each round of fixes (three rounds).
2. Each task recorded again live, designed at Stop, and started with Run now. What it saved was checked on the page or
   in the folder.

**Result:**

| Task | Live result |
|---|---|
| B (the newest video) | ✓ does its task end to end |
| C (today's rupee rate) | ✓ does its task end to end |
| A (top 3) | ✗ re-design builds the loop; the live design gave up (fixed since: the recorded steps are kept) |
| D (Wikipedia PDF) | ✗ the agent ran out of calls in 4 of 5 tries; stopped after its last try, as you asked |
| E (Excalidraw) | ✗ the canvas gap (F22): needs a connector or vision |

**Cost:** $2.93 for the whole checkpoint. The ledger stands at $4.34 of $5.

**Where:** [`testing/checkpoint-5.md`](../testing/checkpoint-5.md).

---

## 14. Checkpoint 6 (Oct 23, 23:42): D recorded by you, on your Mac

**What it was:** you recorded D yourself, the way you'd do it: your Chrome, your daemon (on `cce8f0d`), Screen and the
microphone on, Pictures off, Accessibility not allowed. Your goal: "Every day, save today's featured Wikipedia article
as a PDF into my Reading folder in desktop, named with today's date". You opened the Main Page, clicked the featured
article ("Thuggee"), printed it with Chrome's print dialog (Save as PDF), and in the save panel chose
`~/Desktop/Reading` and typed "23 Oct - Thuggee".

**Result:** the design used all 40 calls, and what it reached couldn't run, so the recorded steps were kept: open the
Main Page, open "Thuggee", find a PDF made since the run started. It ran by hand, and the review offered Looks right.
Run now failed at the find after 60 s: your PDF was there, but older than the run.

**The eleven causes, and where each stands after step 5:**

| # | Cause | Stage | Now |
|---|---|---|---|
| 1 | Capture sees only the web page: the print dialog and the save panel are outside it, and Shadow.app sees the panel only with Accessibility | ② | The page's `print` event is recorded (§15.1). Fixed (tests); a real ⌘P not yet tried |
| 2 | The PDF was blamed on clicking "Thuggee" 39 s earlier: since Oct 4, a new file went with the step before it, and step 4's F23 fix then made that a "find the file it saved" step | ④ | A file goes only with what made it (§15.1). Fixed (tests) |
| 3 | The evidence showed the click and dropped the file, so the agent guessed "YYYY-MM-DD.pdf" and asked 4 questions the recording answers | ⑥ | Every file fact is in the evidence (§15.1). Fixed (live) |
| 4 | No step could save a page as PDF | runner | `web.save_pdf` (§15.2). Fixed (live) |
| 5 | The agent reasoned like a script writer: Puppeteer, wkhtmltopdf; "Thuggee" as a value you type; `press Control+P` | ⑦ | The prompt says what steps can't do, and that `save_pdf` exists (§15.3). Fixed (live) |
| 6 | Its read named a tab that opens blank on first use. It got "" (counted as success), and the AI step answered `…/wiki/2026_in_railway_transportation` from nothing | runner, ⑦ | An empty read fails, an AI step with no input doesn't run, a tab no step opened is refused (§15.2). Fixed (tests) |
| 7 | `https://en.wikipedia.org` joined to a full address (`en.wikipedia.orghttps://…`), and the agent didn't act on what its test showed | ⑦ | Code checks what each test step got (§15.3). Fixed (tests); a later live D design still built one, and its final check caught it |
| 8 | 40 calls gone: one action per call, 6 calls trying `target: "None"`, changes that changed nothing | ⑦ | No cap, STUCK, a plan first, "None" reads the whole page (§15.3). **Partly:** after the plan, about one call per reply still |
| 9 | The kept steps couldn't make the PDF, yet Looks right was offered | ⑦ ⑨ | "Can't run yet", and Go live refuses (§15.3, §15.4). Fixed (tests) |
| 10 | 50.7 s of voice became 0 words, and nothing said so | ③ | Measured: the microphone (flat noise at −49 dB, its input level at 27%); the transcriber reads a spoken clip word for word. The review now says so (§15.4) |
| 11 | The run log was hard to read; "you said do it (its target was not outlined)" for a page open | UI | Grouped by step; that wording only where it fits (§15.4). Fixed (tests) |

**Were A–C really fixed?** Only for the one way each was recorded in checkpoints 4–5: by my script, in an isolated
browser, with scratch folders and no voice. D was always recorded through Wikipedia's "Download as PDF" link, never the
print dialog.

**A, re-run the same evening** (`cce8f0d`, at your ask): designed in 23 calls ($0.10). It read Hacker News and the
notes; one AI step picked the top 3 and another filtered out the saved ones; a loop typed and saved. Run now saved the
live top 3, but also "Local Wikipedia…" again: its Hacker News title ends "(edjefferson.com)", the saved one doesn't.
Nothing checked the AI step's answer.

**Where:** [`testing/checkpoint-6.md`](../testing/checkpoint-6.md); a copy of the recording in
`~/shadow-tests/checkpoint-6/D-print/` (not in git).

---

## 15. Step 5 (Oct 24): the plan and its phases, piece by piece

The plan (`~/.claude/plans/zippy-riding-lovelace.md`, not in git) was re-scoped by checkpoint 6. **Your rulings, 24 Oct:**
- **Self-test:** the agent may make changes that stay with you (files), and what its checks made is removed: files go
  to the Trash. Web saves can't be undone, so they are only outlined.
- **Runner code:** build it; Akshat reviews (listed for him in PR #17).
- **Proof:** both of us, many ways. Done means a Run now that does the task, checked on the page or in the folder, on
  two different days.
- **Budget:** no cap on calls, $0.25 per design ("let the budget be same"); $10 for all real-model runs.
- **From 23 Oct:** E (canvas) deferred; the F17–F61 patches stay as they are.

Every fix started as a failing test built from the real recording's shape, with tests, lint and typecheck green before
each commit (687 tests at the end).

### 15.0 Phase 0: the diagnosis
- **Built:** [`checkpoint-6.md`](../testing/checkpoint-6.md), read from the recording's own files; checkpoint 5's A
  re-run; the ledger row (`b4e2ff0`).

### 15.1 Phase 1: the record tells the truth (② ④ ⑤ ⑥)
- **Before:** capture didn't see the print dialog. A new file went with the step before it, however long after. The
  evidence then dropped it, so the agent never learned a PDF had appeared.
- **Built:**
  - the content script records the page's `beforeprint` as a `print` event;
  - a new file goes with the step before only when something explains it: a download of that path, a print (a PDF
    within 10 minutes), or a control that acts (within 15 s). Otherwise it is a `file_appeared` step. A print with no
    PDF after it is listed as noise;
  - a print and its PDF become one `web.save_pdf {dir, name}` step; a file nothing made gets no "find" step;
  - the evidence names every file a step made or that appeared, and each control's place;
  - a date in a saved file's name becomes `{{today|…}}`.
- **Where:** `apps/extension/src/capture.ts`, `packages/core/src/trace.ts`, `normalise.ts`, `skeleton.ts`,
  `evidence/timeline.ts`, `evidence/proposals.ts`.
- **Used at:** ② ④ ⑤ ⑥.
- **Example:** live D, the print way: the `print` and the PDF that appeared in Reading became one `save_pdf` step, its
  name proposed as `{{today|D MMM}} - …`.
- **Tested by:** unit tests, one from checkpoint 6's shape (a print, then a PDF 39 s later). Live only with a simulated
  print: the test browser fired `beforeprint` and wrote the PDF where the save panel would. A real ⌘P is your check.

### 15.2 Phase 2: the runner's new abilities (runner; Akshat reviews)
- **Before:** no step could save a page as PDF. A read that got "" counted as done, and an AI step with nothing to
  read answered anyway. A step could name a tab no step had opened, and act on a blank one. A find that skipped older
  files said only "no file matches".
- **Built:**
  - `web.save_pdf`: the extension prints the page (Chrome's `Page.printToPDF`) and the daemon writes the file, under a
    free name if that one is taken;
  - an empty whole-page read fails ("blank or unloaded page");
  - an AI step whose inputs are all empty doesn't run;
  - the gate refuses a step that names a tab no earlier step opened a page in;
  - a find names the older files it skipped; a page that won't open says the address it tried.
- **Where:** `packages/core/src/skill.ts`, `check.ts`; `packages/player/src/run.ts`, `node/fs-channel.ts`;
  `apps/extension`; `design/v2/gate.ts` (the tab rule).
- **Used at:** every run, the test run (7c) and the final check (7g).
- **Example:** before any design, a hand-made workflow clicked today's featured article by its place alone, read its
  heading, and saved "24 Oct - Thuggee.pdf".
- **Tested by:** unit tests; `save_pdf` live. Two Run nows of that workflow first failed because the test profile kept
  the old extension, and each started replay's paid repair, unannounced ($0.06).

### 15.3 Phase 3: design agent v3 (⑦)

`packages/recorder/src/design/v2` grew in place. Six pieces:

**a. No call cap; STUCK.**
- **Before:** 40 calls on one meter. In 17 of 18 saved designs every call carried one action, so A and D ran out.
- **Built:** no cap, and $0.25 stays. A design ends after 5 changes in a row that were refused or changed nothing
  (STUCK), then gets one fresh start that lists them. A failed reply (a 503) gets one more try in every episode.
- **Where:** `budget.ts`, `orchestrator.ts`. **Used at:** ⑦.
- **Example:** A's third design got stuck, started fresh, got stuck again, and kept the recorded steps.
- **Tested by:** unit tests; live. **Partly:** $0.25 still ended one D design, at 55 calls.

**b. Plan, then apply.**
- **Before:** one tool action per model call.
- **Built:** after 7a, one call writes every change as tool calls, in plain JSON, checked call by call (a malformed
  call costs only itself). Code makes them in order through the same tools and guardrails. The episode starts with
  "Your plan, applied": what each change did. Names the plan makes up for its own new steps find them. The agent
  loop's rules say "up to N tools a turn" (they said "exactly one" while running 8).
- **Where:** `orchestrator.ts`, `prompt.ts` (`PLAN`), `packages/agent/src/agent.ts`. **Used at:** 7b.
- **Example:** the D eval on a copy of your recording: 10 calls, $0.0333 (understand, a plan of 6, then 8 turns),
  where 23 Oct's ran out of 40.
- **Tested by:** unit tests; real model. **Partly:** after the plan, the episode still sent one call per reply (8
  turns, 8 calls), and A3's plan made no change.

**c. It knows its tools.**
- **Before:** it offered Puppeteer, guessed selectors, sent `target: "None"` 6 times, and `change` dropped `when`
  silently 5 times.
- **Built:**
  - the prompt says what steps can't do (browser menus, the print dialog, save panels) and that `save_pdf` exists;
  - a target can be `{ place: "s2" }` (whatever is at that place next time) or `{ css }`; words aren't a selector;
    "None" reads the whole page;
  - a tool names the fields it ignored; `change` sets the trigger and edits AI steps; "trigger" works as a step name;
    `add` takes AI steps and loops sent with loose fields;
  - an AI step picking "the top 3" with no order or measure is refused, with the words to use;
  - a date format core can't read lists its tokens (`{{today|D MMM}}` is "24 Oct");
  - questions about how to build it are never asked.
- **Where:** `prompt.ts`, `tools.ts`, `evidence/evidence.ts`. **Used at:** 7b, 7d.
- **Example:** live C's first design sent `{ place: "Indian Rupee" }`, which was taken as a selector and read
  nothing. Words aren't a selector now, and its next design did the task.
- **Tested by:** unit tests; live (C, D).

**d. Code checks what the test run got.**
- **Before:** your D's read got "" three times, counted as success, and its AI step made an article up from it.
- **Built:** shown to the agent and refused by the gate: a read or AI step that got nothing; two reads that got the
  same page; an address made of two; an AI answer used in an address but not in what the step read. Shown only: an AI
  answer not in what it read. A selector the run didn't find says what to do instead of guessing another. A click at
  a recorded place that only went to a page is followed, not outlined.
- **Where:** `gate.ts`, `orchestrator.ts`; `packages/player/src/rehearse.ts`. **Used at:** 7c, 7f.
- **Example:** one D design's test only outlined its click on the featured article's place, so its check saved "24
  Oct - Main Page.pdf". That click is now followed.
- **Tested by:** unit tests; the place click live.

**e. The honest end: "Can't run yet".**
- **Before:** the kept recording couldn't make the PDF, yet Looks right was offered.
- **Built:** the evidence lists files nothing recorded made. The gate refuses until a step makes a file in that folder
  (`save_pdf`, a move, a write). If none does, the design says "Can't run yet" with why; the review shows that in place
  of Looks right, and Go live refuses.
- **Where:** `gate.ts`, `orchestrator.ts`, `review.ts`; `apps/daemon/src/service.ts`. **Used at:** 7f, ⑧, ⑨.
- **Example:** your D as recorded: "~/Desktop/Reading/23 Oct - Thuggee.pdf appeared in the recording, but no step makes
  a file in ~/Desktop/Reading".
- **Tested by:** unit tests; screenshots on a scratch daemon.

**f. The final check (7g).**
- **Before:** the test run only outlines what changes anything, so nothing showed the workflow made the right file.
- **Built:** after the gate, a workflow that makes files runs once for real in the automation window. Only `save_pdf`,
  and copies, moves or renames of files this run made, are done; nothing on a web page. Every file it made goes to the
  Trash, and the review says which. A failure goes back to the agent once. A "skip / already / only new" rule runs it
  twice. It fails an empty file, and, on the recording's day, a file other than the recording's (" (1)" for a taken
  name is fine).
- **Where:** `packages/player/src/rehearse.ts` (local mode), `apps/daemon/src/rehearse.ts`, `orchestrator.ts`.
  **Used at:** 7g.
- **Example:** D's last design: it made "24 Oct - Battle of Schliengen (1).pdf", the recording's file, and trashed it.
  Another design's check caught "24 Oct - Main Page.pdf".
- **Tested by:** unit tests; live for D. Running twice only in tests: no task that makes files has a skip rule yet.

**What the plan said that the code doesn't do:**
- the final check types and clicks nothing on a page, so A's skip rule was proven by two Run nows and the pick check
  (§15.5), not by it;
- "the article's heading matches the AI's title": deferred; D's final design has no AI step;
- a $1 ceiling per design: you kept $0.25.

### 15.4 Phase 4: the run log and the review (⑨, the app)
- **Before:** a run's log lines ran together; a page-open step said "its target was not outlined"; nothing said the
  microphone heard nothing.
- **Built:**
  - the Run page groups the log by step (its id, intent and kind, with a line between steps); the walk-through says
    "nothing to outline" only for steps with nothing to outline;
  - the review opens with **notices**, then what the final check made;
  - "Can't run yet" in place of Looks right; Go live says why it waits; after an edit, the review asks you to check
    the edit makes the file.
- **Where:** `apps/ui/src/runlog.ts`, `screens/Run.tsx`, `screens/Workflow.tsx`, `review.ts`; `apps/daemon/src/record.ts`.
- **Used at:** ⑨, and each run's page.
- **Example:** "The microphone was on, but no words came through: nothing you said was used. Check System Settings →
  Sound → Input (the microphone you speak into, its level well up)".
- **Tested by:** unit tests; screenshots on a scratch daemon. Your app shows it after
  `corepack pnpm --filter @shadow/ui build` and a daemon restart.

### 15.5 What the proof runs added
Each live run in §16 found the next fault, fixed before the next run:
- **The pick check (runner).** A's runs said they succeeded while saving stories 7, 15 and 10, then 2, 3 and 4, then
  one already saved. Now an AI step gets each input by name, a list numbered; the design writes a pick in the
  recording's order; and code checks a "first N" pick (`pickProblem`): the list's order kept, nothing earlier left out
  unless it's in the rest of the data, and for "not already / skip / new", nothing already there. Wrong: asked once
  more of the smart model (about $0.003), told why. Wrong again: the step fails. It checks only "first N" picks.
- **AI steps, measured.** On A's real inputs, 3 tries each: "top 3" was wrong 3 of 3 on every model (dropped #1, or
  took the most points); "the first 3 in the list's order" was right 2 of 3 on the fast model and 3 of 3 on the smart
  one. Thinking was turned on (`43bde8e`), then off the same day (`e579bf9`): it ran out of tokens on a whole page, and
  the clear instruction was what fixed it.
- **Tabs given by code.** A's second design named tabs on two opens and left the steps after them without; the gate
  refused it twice. Code now gives those steps their tab after every change, works its tabs out again each time, and
  never changes one the agent named (A's fourth design: code moved the notes read to "HN" one call before the Notes
  tab was opened, and every story was "already saved").
- **Click the place, name the file from the heading.** Three D designs built the article's address with an AI step
  (one joined it to the site's twice). Now code proposes clicking what is at the featured article's place
  (`same_place`), and a file named with the day and the page's title, read from `h1`, both with the change ready.
  An AI answer used in an address but not in what the step read is refused.
- **Downloads.** Wikipedia's Download is a form, so it would have waited every morning for an OK. A form whose control
  says download, export, pdf or csv, and whose only effect was a file, needs none; a found download counts as a file
  the workflow makes, for the final check. Unit tests only (the test browser takes every download).

---

## 16. Phase 5 (Oct 24): the proof runs

**What it was:** each task recorded again live by me in the isolated test browser, designed on the real model at
Stop, then started with Run now. What it saved was checked on the page or in the folder. Each run is a row in the
ledger.

| Task | Live result, day 1 | Designs it took |
|---|---|---|
| A (Hacker News top 3 → notes, skip saved ones) | ✓ Run 1 saved the top 3 (OBS Studio, Kimi K3.1 Pro, Twelve years of distributed SQLite) with live points. Run 2 saved the next 3 (#4 Today we hacked, #5, #6), no duplicates, after the pick check and the smart retry. Points came out as "113 points" in run 1 and "867" in run 2: the AI's own format | five; the fifth, 17 calls, $0.085 |
| B (Google for Developers' newest video and views → notes) | ✓ "Design and replicate voices with Gemini 3.8 Flash TTS, 26K": the channel's newest. Its videos page shows "26K", rounded, where the recording copied the video page's exact count | two; the second, 30 calls, $0.11 |
| C (USD→INR, today's date → notes) | ✓ "USD to INR, 94.871354, 24 Oct, USD"; the page shows 94.871354 | two; the second, 27 calls, $0.12 |
| D, the print way | ✓ "24 Oct - Battle of Schliengen.pdf" (2.9 MB), today's featured article, in the recording's name format. Its final check made the recording's file and trashed it | six, each from a fresh recording, three right; the last, 5 calls, $0.018, from code's three proposals, with no AI step |
| D, the download way | not measurable here: the test browser (Playwright) takes every download into its own folder | one, 34 calls |
| E (canvas) | deferred | — |

**D's designs varied.** Of six designs of task D, each from a fresh print recording, three did the task (43 calls with an AI step; 7
calls; 5 calls). Three didn't: an address built with AI, which its final check caught; a wrong file, which its final
check caught before the fix episode got stuck; 55 calls, out of its $0.25. What settled it was moving the design into
code: with the date, the title and the place proposed with their changes ready, accepting code's proposals is the whole
workflow. That 5-call design was seen once.

**Also found:** the walk-through logs `highlighted: false` for every step answered from the inbox
(`packages/player/src/run.ts:329–333`). It's Akshat's; the UI works around it.

**Not done yet:**
- **Day 2.** Done means a Run now that does the task on two different days; the re-runs on new data (25 Oct) are next.
  The four workflows that passed are in `~/shadow-tests/checkpoint-6/kit/`.
- **Your four Mac recordings:** D through the real print dialog; D again while speaking, after raising the input
  level; D saved to Downloads, then moved into Reading in Finder; one of A, B or C with voice in your Chrome.

**Cost:** step 5's rows in the ledger add up to about $2.2. The whole ledger is about $6.6 of the $10 (every dollar
figure in it added up, the "est. under" caps included).

**Where:** [`testing/design-eval-ledger.md`](../testing/design-eval-ledger.md); copies in `~/shadow-tests/checkpoint-6/`
(not in git).
