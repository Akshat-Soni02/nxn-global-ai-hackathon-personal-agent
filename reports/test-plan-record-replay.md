# Record and replay, section by section: the analysis framework

**Goal:** when a workflow fails, say *which part* broke and why, not only *that* it failed. Record and replay are split below into self-contained sections, each with its input, the file that shows its output, what "working" means, and what to look at. **The two agents get the most detail** (§3 and §4): every tool, what the agent understood, how it reasoned, what it changed, what it asked, and whether its account of itself is true.

How it's used: you record workflows from your own work (§1). I then go through every recording and run with this framework and fill in one verdict per section (§6), with the line in the file that proves it.

Code references are to `fix/record-refactoring` (`34c73ed`, Oct 15).

---

## 1. Recording your own workflows: what I need

Anything from your real work is fine. Variety helps: a web-only task, one that crosses tabs or sites, one with a Mac app or files, one with a rule ("only if", "every", "the newest").

**For each recording:**
1. **Fill the form honestly**: the goal, what changes, what stays the same, Never. It's the ground truth for "did it understand".
2. **Screenshots, Narration and Pictures on.**
3. **Say the rules out loud** while you work, the ones in your head: "I always take the newest", "skip it if it's already there", "the date is today". These are what the design agent should turn into inputs, loops and branches.
4. **Answer its questions as you naturally would.** Don't edit the workflow before the first run: I need to see what record produced on its own.
5. **Run it once by hand**, ideally on the next real occurrence (new data), with the automation window **left in front**. If a repair starts, leave it alone until it ends.
6. **Write a short note** in `~/shadow-tests/notes.md`:
   ```
   ## <short name>, <date time>
   What I did: <one line>
   What a correct workflow does next time: <the rule, in your words, e.g. "takes the top job not already in the sheet, adds it below the last row, today's date">
   What I noticed: <odd questions, long waits, blank window, anything the files won't show>
   ```
   The second line is the most important one: it's the yardstick for the agent sections.
7. **Copy the data** before the 24-hour deletion:
   ```sh
   mkdir -p ~/shadow-tests && cp -R ~/Library/Application\ Support/Shadow/{recordings,skills,runs} ~/Library/Logs/Shadow ~/shadow-tests/
   ```

Setup once per session: build what you changed (`pnpm build && pnpm setup:mac`), reload the extension in `chrome://extensions`, toggle Shadow off and on in Privacy & Security (Accessibility, Screen Recording, Microphone) after a rebuild, then `pnpm daemon`.

---

## 2. Record: capture and preparation (no model)

| # | Section | Input → output | Where to look | Working means |
|---|---|---|---|---|
| **R1** | **Web capture** (extension) | clicks, typing, copy, paste, navigation in Chrome → events | `recordings/<id>/trace.jsonl` | one event per action; targets with role and name; typed and copied values right; nothing from the automation tab |
| **R2** | **Tab capture** | opening, closing, switching tabs → events | `trace.jsonl` (`tab_open`, `tab_close`; switches aren't recorded today) | the order of sites can be rebuilt |
| **R3** | **Mac-app capture** (Shadow.app, Accessibility) | clicks, typing, menus → events | `trace.jsonl` (`app_*`) | as R1, with AX role and title |
| **R4** | **File capture** (folder watcher) | moves, renames, downloads → events | `trace.jsonl` (`fs_*`) | each move with from and to |
| **R5** | **Screenshots: capture** | an event → a picture | `shots/<event>.jpg` | one per meaningful event; none while a password field has focus |
| **R6** | **Screenshots: OCR + masking** | picture → words read, private ones masked, black boxes | `screen.jsonl`, the `.jpg` files | emails, phones, cards, IBANs, keys and Never words are `███` and black; nothing else hidden; the words *around the step* kept (`d5156be`) |
| **R7** | **Narration: transcription** | voice → timed text | `transcript.jsonl` | the words said, in order |
| **R8** | **Narration: masking + alignment** | text → masked text, marked against steps | `design.json` → `prompt.task` ("What they said…", step ranges) | private words masked; each sentence marked against the steps it was said over (`76e9d40`) |
| **R9** | **Normalise** | events → steps by meaning | `design.json` → `prompt.task` ("The recording…") | one step per real action; selection clicks folded into their copy; repeats merged; a click that opened a page knows its URL (`6d36349`) |
| **R10** | **First draft (code skeleton)** | steps → plain list with targets, locators, recorded values | `design.json` → the first tool result, or the `workflow` outline before `label_steps` | every target has role + name, or attrs/fallbacks; no container-text targets; values as recorded |

---

## 3. The design agent, in depth

What it is: Nemotron 3 Super in the shared loop, given the description, the narration, the recording and the plain list; it labels the steps, then reshapes them; ends with `finish`. Budget 16 turns, $0.10, no live actions, no time limit. Full reference: `docs/agents/design-agent.md` (written against `main`; the branch adds `label_steps`, `describe_step_screenshot`, the narration block and new rules).

### D1 · What it was given
*Source:* `design.json` → `prompt.system`, `prompt.task`.

| Check | Working means |
|---|---|
| Description | the form's fields, as typed |
| Narration block | every transcript piece present, masked, with sensible step ranges |
| Recording view | every step, or a note of how many were cut; screen words near each step relevant to what was done, not page chrome |
| Plain list | matches R10 |
| Open questions | none that the form or narration already answers |
| Size | prompt tokens (from `usage`) vs what was useful; anything sent every turn that isn't needed |

### D2 · `label_steps`, the first move
*Source:* the first `call` / `result` in the transcript; `v1.json`.

| Check | Working means |
|---|---|
| Intents | say what each step *achieves* ("Copy the company name"), not how |
| Inputs | every value the form or narration says changes is an input, or comes from an earlier step's output; typed dates → `{{today}}` |
| `save_as` / outputs | each copy → an output; each paste uses it (`{{…}}`) |
| Checks | only things that can be true after the step: text that appeared in the recording, a URL that matches. No `""`, no invented text, no text checks on canvas apps |
| `success` | a real end state, or none |
| Approvals | added on outward steps; none removed |
| Questions it created | each needed; each with a path that can be applied |
| Note | its changes are **not** in `edits` (they replace the baseline), so judge them by diffing the plain list against v1 |

### D3 · Each tool: called? right input? result used?
*Source:* `design.json` → `transcript` (`call`, `result`, `invalid`, `refused`). One row per tool per recording:

| Tool | Kind | What to judge |
|---|---|---|
| `label_steps` | edit | D2 |
| `read_description` | look | needed? (the description is already in the first message) |
| `read_recording` | look | called when the recording was cut or a step needed full screen words? |
| `workflow` | look | used to check its own changes? |
| `describe_step_screenshot` | look | called for steps with no name or role (nameless links, canvas clicks)? Did the description change what it did? |
| `recall` | look | called before asking about lasting facts (which sheet, where files land)? |
| `edit` | edit | operations valid; size within the cap; refusals understood; no repeated identical failures |
| `wrap_in_loop` | edit | used when "every / each / top N" was said or two items were shown; the right steps inside; `over` a real list |
| `wrap_in_branch` | edit | used for "only if / unless / if already"; the condition testable at run time |
| `add_llm_step` | edit | used for picking, judging, reading; inputs are real variables; output type fits its use |
| `validate` | look | called; acted on what it said |
| `ask_user` | look | D7 |
| `finish` | finish | D9 |

For each call: the input (valid, sensible), the result (`ok`, `problems`, `refused`, `not_applied`), and **what the agent did next** (fixed it, retried the same, gave up, ignored it).

### D4 · Understanding: rules stated vs rules built
*Source:* the form, the narration, your note's "what a correct workflow does next time", `v1.json`. One row per rule:

| Rule (from form / narration / your note) | Where it's stated | Built as | Verdict |
|---|---|---|---|
| e.g. "the top job" | narration, steps 1–5 | fixed URL `/companies/eventual` | missed |
| e.g. "skip if already in the sheet" | narration, step 10 | — | missed |
| e.g. "today's date" | narration, step 30 | literal `15 Oct` | missed |

Plus: literal values left that should change (dates, names, IDs, URLs that encode the example); values turned into inputs that should have stayed fixed.

### D5 · Reasoning: how it got there
*Source:* the transcript order, `reply` events (`thought`, cost, ms).

| Check | Working means |
|---|---|
| Plan | it looks before it edits; the order of calls makes sense for the task |
| Reasoning visible | `thought` text present (today usually empty: the reasoning isn't kept) |
| Turns | spent on progress, not on invalid calls, repeats or questions it could answer itself |
| Reaction to refusals and errors | changes approach; doesn't retry the same thing or quietly drop the goal |
| Stopping | stops when the work is done, not when it runs out of ideas; not at turn 3 with rules unbuilt |

### D6 · Changes produced
*Source:* the plain list (R10) vs `v1.json`, step by step.

| Check | Working means |
|---|---|
| Steps kept | every write the user showed (type, paste, upload) still happens |
| Steps removed | only noise (selection clicks, duplicates, detours) |
| Steps added | reads only (extract, find, navigate to a visited page) and llm steps |
| Structure | loops, branches as D4 requires |
| Values | `{{…}}` in place of recorded examples where they change |
| Targets | unchanged (the rules forbid changing them); still findable (P3) |
| Size | the smallest change that does the job |

### D7 · Questions
*Source:* `ask_user` calls, the inbox (`shadow.db`), `v1.json`.

| Check | Working means |
|---|---|
| Needed | the form, narration and trace don't already answer it |
| Clear | options and a default; names the step |
| Waited | how long it blocked the save |
| Applied | the answer is visible in v1 (an input, a value, a branch) |
| Remembered | lasting facts go to memory (`remember`) |
| After the agent | the leftover drill questions: needed? applied? |

### D8 · Rules and refusals (guardrails)
*Source:* `refused` / `ok:false` results; `designViolations` on the branch.

For each refusal: **right** (it stopped something harmful or wrong) or **over-strict** (it blocked the right change: e.g. opening a page reached by a click, turning a click into a navigate). And the reverse: anything wrong that **no rule stopped** (deleting work, invented checks, unbuilt rules at `finish`).

### D9 · Honesty and finish
*Source:* `design.json` → `summary`, `edits`, the v1 diff (D6).

| Check | Working means |
|---|---|
| Summary vs changes | every claim in the summary is visible in v1; nothing important missing from it |
| `finish` accepted | only when the stated rules are built and the checks are real |
| History note | v1's history says what really happened |

### D10 · Cost, time, budget
*Source:* `design.json` → `usage`, `turns`; timestamps.

Turns used of 16, dollars of $0.10, input tokens per turn (how much is the repeated first message), wall time (agent vs waiting for answers), vision calls (not metered today).

---

## 4. The repair agent, in depth

What it is: after a step fails every attempt, code classifies the failure, a cheap ladder tries without a model, then Nemotron 3 Super gets the failure report and tools on the live page. Budget 12 turns, ≤ $0.10, 20 live actions per episode; 2 episodes and $0.25 per run leg. Full reference: `docs/agents/repair-agent.md`.

### X1 · Was repair the right response?
*Source:* the run log (`step.result`, `run.end`, `repair` event), the failed step in `v1.json`.

| Check | Working means |
|---|---|
| The failure's real cause | drift (the site changed) vs a wrong workflow (record's fault) vs environment (login, window) vs transient |
| Classification | `class` in the `repair` event matches the real cause |
| Ladder | tried when it applies (drift: wait longer, fuzzy match); its result |

If the real cause is a wrong workflow, the repair agent can't be judged on fixing it: judge whether it **said so quickly** instead of spending its budget.

### X2 · What it was given
*Source:* the `failure_report` result in `repair-N.json`.

The failed step as run, the error, the match score, the page's URL/title/status/dialogs, controls named like the target, the page outline, the last run events, site notes, the workflow. Was the information it needed there? Was it accurate (the page it describes is the page the run was on)?

### X3 · Each tool: called? right input? result used?
*Source:* `repair-N.json` → `transcript`. One row per tool:

| Tool | Kind | What to judge |
|---|---|---|
| `failure_report` | look | re-read when needed |
| `page_outline`, `find`, `inspect` | look | found the right element; read results correctly (refs, scores) |
| `workflow` | look | checked its edits |
| `wait` | look | used for slow pages, not as a reflex |
| `click_safe`, `press`, `scroll`, `go_back`, `navigate` | probe | safe, purposeful; refusals understood |
| `retarget` | edit | the new target is the right control and **unique** (not ambiguous) |
| `edit` | edit | small, valid, within the rules |
| `try_steps` | try | started at the failed step; enough steps for evidence; result read correctly |
| `describe_screen` | look | used when the outline can't answer (canvas, images, a blank window) |
| `recall`, `note` | look / remember | site notes read and written when useful |
| `resolve`, `commit`, `escalate` | finish | X7 |

### X4 · Diagnosis and reasoning
*Source:* the transcript order, `thought`.

Did it identify the cause early? Did each look narrow it down? Did it change course after a failed try, or repeat the same try? Did it notice when the workflow, not the page, was wrong?

### X5 · Changes produced
*Source:* `edits` in the episode; v2 if committed (`skills/<id>/v2.json`, history `by: debug`).

Smallest change; step ids kept; the user's values (args) untouched; no new outward steps; the retargeted control is unique and correct.

### X6 · Tries and evidence
*Source:* `try_steps` results.

Each try: from which step, how many, outcome, evidence or none, time taken. A hang ("extension did not answer"), with whether the automation window was in front (your note).

### X7 · Outcome
*Source:* the `repair` event, the episode's `end`, the run's final status, the inbox item.

| Outcome | Right when |
|---|---|
| commit | a tried fix with evidence; v2 is right on the next run too |
| resolve | the cause really wasn't drift; the class and reason are right |
| escalate | no safe fix exists; the message tells you what to do |
| out of budget / error | never "right": where did the turns or time go |

### X8 · Guard and rules
For each refusal (`refused` events): right, or over-strict (e.g. "not a site this workflow uses (none)"). Anything unsafe that got through.

### X9 · Cost, time, budget
Turns of 12, dollars, live actions of 20, wall time, time lost to hangs; whether a second leg after a wait got a fresh budget.

---

## 5. Replay (no model)

| # | Section | What it does | Where to look | Working means |
|---|---|---|---|---|
| **P1** | **Start** | inputs filled, automation window | `runs/<run>.jsonl` (`run.start`) | inputs present; window in front |
| **P2** | **Navigation and tabs** | `navigate`; staying on the right page | run log, the window | each step runs on the page it was recorded on |
| **P3** | **Finding targets** | matching a locator | run log (`target not found`, `ambiguous`, `matchScore`) | found quickly; not ambiguous when the recording was clear |
| **P4** | **Actions** | click, type, select, press, extract, paste | the page after the run | the page ends as recorded |
| **P5** | **Variables and data** | `{{…}}`, `{{today}}`, `data.pick`, llm steps | run log | values from this run, not the recording |
| **P6** | **Control flow** | loops, branches | run log (`loop.item`, `branch`) | the right items and arm |
| **P7** | **Checks, waits, success** | per-step `check`, workflow `success` | run log (`failedCheck`), `run.end` | pass when the step worked, fail when it didn't |
| **P8** | **Approvals** | outward steps wait | inbox | Send, Submit, Delete wait; nothing else |
| **P9** | **DevTools calls** | each call to Chrome answers or times out | run log errors ("did not answer") | no hangs |

---

## 6. What I produce from your recordings

For each recording, and then across all of them:

1. **The verdict table**: every section above × every recording, each cell **works / partly / breaks / not exercised**, with the file and line that shows it.
2. **For the agents**, the per-tool tables (D3, X3), the rules table (D4) and the diff (D6) filled in.
3. **Root causes** grouped by where to fix them: capture code, normalise, the first draft, an agent's prompt, an agent's tool or rule, replay code, the extension.
4. **The fix list**, ordered by how many recordings each fix would rescue.

---

## Appendix: eight scripted tests (optional)

Controlled cases with a known right answer, for when a section needs isolating. Setup for them: `pnpm fixtures` (serves `fixtures/pages` on `http://localhost:5173`) next to `pnpm daemon`.

### T1 · Baseline: one form, nothing clever (≈ 5 min)
**Covers:** R1, R5, R7, R9, R10, D9, D2 · P1, P3, P4, P7. **Purpose:** if this fails, the problem is in the core, not in understanding.

**Form:** Goal `Log my hours on the timesheet` · What changes `the hours` · Stays the same `the project NX-202` · Never (empty) · Frequency: only when I start it.

**Do:**
1. Open a new tab: `http://localhost:5173/timesheet.html`.
2. Project → choose **NX-202**.
3. Click Hours, type **7.5**.
4. Click **Save draft**.
5. Stop.

**Say** (one line per action, while doing it):
- "I open the timesheet."
- "The project is always NX-202."
- "The hours change every week, this week it's seven and a half."
- "Then I save the draft."

**Questions:** if asked for hours, answer `7.5`.

**Replay:** Run it once from the workflow page.

**Right answer:** v1 has navigate → select `NX-202` → type into Hours (an input `hours` with default 7.5, or a literal 7.5) → click "Save draft". No question about the project. The run succeeds and the page shows the saved draft.

---

### T2 · Masking: secrets on screen and in what you type (≈ 8 min)
**Covers:** R1, R3, R5, R6, R8 (masking), D2 · P8. **Purpose:** find out whether private text is hidden in the pictures, the screen words, the narration and the trace.

**Before recording:** open **TextEdit**, new document, paste these lines and leave it open (don't save):
```
Contact: jane.doe@example.com
Phone: +1 415 555 0132
Card: 4242 4242 4242 4242
IBAN: DE89 3704 0044 0532 0130 00
API key: sk-test-51Hxyzabcdefghijklmnop
Project codename: Pineapple
Invoice total: 1,250 EUR
```

**Form:** Goal `Copy the invoice total into the expense form` · Never `Pineapple` · Frequency: only when I start it.

**Do:**
1. In TextEdit, double-click **1,250** and press ⌘C.
2. In Chrome, open `http://localhost:5173/paste-form.html`, click Amount, press ⌘V.
3. Click **Save**.
4. Open `http://localhost:5173/drift/logged-out.html`. Email: type `jane.doe@example.com`. Password: type `hunter2-test`. **Don't** click Sign in.
5. Stop.

**Say:**
- "The invoice total is in this document, I copy it."
- "My email is jane dot doe at example dot com and the code name is Pineapple."
- "I paste the total into the expense form and save."

**Replay:** don't run it (step 4 isn't part of the task). Only the recording is tested.

**Right answer:**
- In `screen.jsonl` and the TextEdit and Chrome shots: the email, phone, card, IBAN, key and **Pineapple** are `███` and blacked out. "1,250 EUR" and "Invoice total" are **not**.
- **No screenshot** was taken while the password field had focus. In `trace.jsonl`, the password is never stored (the event says secret).
- In `transcript.jsonl` / `design.json`: the spoken email and "Pineapple" are masked.
- The TextEdit actions are `app_*` events (R3).

---

### T3 · Copy from today's row in a canvas sheet, across two tabs (≈ 8 min)
**Covers:** R1, R2, R9, R10, D4 (`{{today}}` rule), D7 · P2, P3, P5. **Purpose:** the case the real YC test hit: a canvas grid, two tabs, and "today" instead of a fixed row.

**Form:** Goal `Put today's invoice amount into the expense form` · What changes `the amount, it's the row with today's date` · Frequency: only when I start it.

**Do:**
1. Tab A: `http://localhost:5173/spreadsheets/d/FAKE/edit.html` (three rows: yesterday, today, tomorrow).
2. Click the **Amount** cell of **today's** row (the middle row, `1,234`), press ⌘C.
3. Open tab B: `http://localhost:5173/paste-form.html`. Click Amount, ⌘V. Click **Save**.
4. Switch back to tab A (click its tab), then back to tab B (no action, just switching).
5. Stop.

**Say:**
- "This sheet has one row per day."
- "I always take the amount from today's row."
- "I paste it into the expense form and save."

**Replay:** run it **today**, and if you can, **again tomorrow** (the rows move by a day; the right value moves with them).

**Right answer:**
- The copy becomes a read of today's row: `data.pick where Date = {{today}}`, or an extract plus an llm step. Not "cell B3".
- Tab switching in step 4 shows in the trace (today it won't: R2).
- Replay pastes **today's** amount, both days.

---

### T4 · For each row: a loop from two shown items (≈ 8 min)
**Covers:** R2, R9, D4 (loop from "for every row"), D7, D9 · P5, P6. **Purpose:** whether "do this for each" becomes a loop. The rows are local and always three (yesterday, today, tomorrow), so the right answer is known.

**Form:** Goal `Enter every invoice amount from the sheet into the expense form` · What changes `the amounts, the number of rows` · Frequency: only when I start it.

**Do:**
1. Tab A: `http://localhost:5173/spreadsheets/d/FAKE/edit.html`.
2. Click the Amount cell of the **first** data row, ⌘C. Tab B: `http://localhost:5173/paste-form.html`, click Amount, ⌘V, **Save**.
3. Tab A: click the Amount cell of the **second** row, ⌘C. Tab B: reload, click Amount, ⌘V, **Save**.
4. Stop (don't do the third row).

**Say:**
- "For every row in this sheet I enter the amount into the expense form."
- "Here's the first one, and the second one; I do the same for all the rows."

**Replay:** run it.

**Right answer:**
- v1 reads the rows (`web.extract { source: "google_sheet" }` or an extract of the column), then a **loop** whose body is paste + Save, with `{{row.Amount}}` in place of `1,180` / `1,234`. Not two fixed copies.
- The run saves **three** times (all rows, not the two shown).
- The `finish` summary matches the edits in `design.json`.

### T5 · Repair on controlled drift (≈ 12 min)
**Covers:** P3, P9, X1, X3–X7 (incl. `describe_screen`), and the repair hang (issue X1 in the second report). **Purpose:** every failure type against a known page, and whether repair hangs **only when its window is hidden**.

**Form:** Goal `Look up an invoice and export the list` · Frequency: only when I start it.

**Do (record once):**
1. `http://localhost:5173/drift/base.html`.
2. Click Invoice number, type `INV-1001`.
3. Click **Export CSV**.
4. Stop.

**Say:** "I type the invoice number and export the list."

**Replay, five runs.** Before each run, open the workflow → Edit → step 1 (open the page) → change the URL, save. Before runs c and d, roll back to v1 first (Versions → v1 → roll back), so each run starts from the recorded workflow.

| Run | URL | Keep the automation window… | Right answer |
|---|---|---|---|
| a | `…/drift/base.html` | in front | succeeds, no repair (baseline) |
| b | `…/drift/menu.html` | **in front** (don't touch anything) | Export CSV moved into "More actions": repair opens the menu and retargets Export; tried with evidence; saved as v2 |
| c | `…/drift/menu.html` | **behind** (click into another app as soon as it starts) | the same as b. If b works and c hangs ("extension did not answer"), the hidden-window cause of the repair hang (second report, X1) is confirmed |
| d | `…/drift/banner.html` | in front | a cookie banner covers the page: repair adds "Accept all" before the blocked step (v2). This page has **no Export CSV**, so the next failure should be **escalated** honestly ("Export isn't on this page"), not patched with a made-up click |
| e | `…/drift/logged-out.html` | in front | a sign-in page: classified **environment** ("log in"), no repair, no model call |

Note in `notes.md` for each run: the result, and whether the window was in front.

---|---|---|---|
| a | `…/drift/base.html` | in front | succeeds, no repair (baseline) |
| b | `…/drift/menu.html` | **in front** (don't touch anything) | repair opens "More actions" and retargets Export; tried; v2 |
| c | `…/drift/menu.html` (from v1 again: Versions → roll back) | **behind** (click into another app as soon as it starts) | same as b. If b works and c hangs ("extension did not answer"), X1 is confirmed |
| d | `…/drift/banner.html` | in front | repair adds "Accept all" before the blocked step |
| e | `…/drift/logged-out.html` | in front | classified **environment** ("log in"), no repair, no model call |

Note in `notes.md` for each run: the result, and whether the window was in front.

---

### T6 · Real site, real sheet: YC top job, one item, scripted (≈ 10 min)
**Covers:** everything, on the real case, with fixed words so it compares with the first two runs.

**Form:** Goal `Add today's top YC job to my jobs sheet` · What changes `the job, the date` · Stays the same `the sheet "Ycomb jobs", the columns Date, Company, Compensation, Role` · Frequency: only when I start it.

**Do:**
1. Open the sheet **first**, by its URL (tab A), and click the first empty cell in column A.
2. Tab B: `https://www.ycombinator.com/jobs`. Click the **top** job; on the company page, **double-click** the company name, ⌘C.
3. Tab A: paste into column B of that row. Type today's date in column A.
4. Tab B: open the company's Jobs tab, copy the compensation of the first role, paste in column C; copy the role title, paste in column D.
5. Stop.

**Say:**
- "Every day I add the top job from YC to this sheet, in the first empty row."
- "If the top company is already in the sheet, I take the next one instead."
- "Column A is today's date, B the company, C the compensation, D the role."

**Replay:** the next day (a new top job), with the automation window in front.

**Right answer:** see the second report's R1–R6 and D1–D5. This run shows which of them your fixes closed.

---

### T7 · Files in Finder (≈ 6 min)
**Covers:** R4, R9, D4 (a pattern from moved files) · P4, P5. **Purpose:** the file side, untested so far.

**Before:** in Terminal:
```sh
mkdir -p ~/ShadowTest/inbox ~/ShadowTest/pdfs && cd ~/ShadowTest/inbox && touch a.pdf b.pdf notes.txt
```

**Form:** Goal `File the PDFs from inbox into pdfs` · What changes `which PDFs arrive` · Frequency: **when a file appears in a folder** → `~/ShadowTest/inbox`.

**Do:** in Finder, open `~/ShadowTest/inbox`, select `a.pdf` and `b.pdf`, drag them into `~/ShadowTest/pdfs`. Leave `notes.txt`. Stop.

**Say:** "Every PDF that lands in inbox goes to pdfs. Other files stay."

**Replay:** make it **live**, then `touch ~/ShadowTest/inbox/c.pdf ~/ShadowTest/inbox/d.txt`.

**Right answer:** a folder trigger on `inbox`, `*.pdf`; `c.pdf` moves on its own, `d.txt` stays.

---

### T8 · Walk through (≈ 3 min)
**Covers:** P3, P4 with you watching each step.

Open **T1**'s workflow → **Walk through**. At each step check that the outlined element is the right one, then press **Do it** (or **Next** for reads).

**Right answer:** every step outlines the control you used, in order.

---

