# Test plan: record and replay, section by section

**Goal:** find out *which part* of record and replay breaks, not only *that* a workflow failed. Record and replay are split below into self-contained sections, each with its input, its output (a file you can open), and what "working" means. Then come **8 test recordings**, each designed to exercise a few sections with a **known right answer**, so a wrong result points at one section.

Do the tests in order. **T1–T5 use the repo's local test pages** (`fixtures/pages`, served on `http://localhost:5173`), where the pages never change and the expected output is known exactly. **T6–T8 use real sites.**

Time: about 75 minutes for all eight, of which about 30 minutes is recording.

---

## Part 1: the sections

### Record

| # | Section | Input → output | Where to look | Working means |
|---|---|---|---|---|
| **R1** | **Web capture** (extension) | your clicks, typing, copy, paste, navigation in Chrome → events | `recordings/<id>/trace.jsonl` | one event per action; targets have role and name; typed values right; nothing from the automation tab |
| **R2** | **Tab capture** | switching, opening, closing tabs → events | `trace.jsonl` (`tab_open`, `tab_close`, *no* `tab_activated` today) | every switch recorded, so the order of sites is reconstructable |
| **R3** | **Mac-app capture** (Shadow.app, Accessibility) | clicks, typing, menus in a Mac app → events | `trace.jsonl` (`app_*`) | as R1, with AX role and title |
| **R4** | **File capture** (folder watcher) | file moves, renames, downloads → events | `trace.jsonl` (`fs_*`) | each move with from and to |
| **R5** | **Screenshots: capture** | an event → a picture | `shots/<event>.jpg` | one per click, type, copy, navigate…; none while a password field has focus |
| **R6** | **Screenshots: OCR + masking** | picture → words read, private ones masked, black boxes painted | `screen.jsonl`, `shots/*.jpg` (open them) | emails, phones, cards, IBANs, keys and Never words are `███` in the text **and** black in the picture; nothing else is hidden |
| **R7** | **Narration: transcription** | your voice → text | `transcript.jsonl` | the words you said, in order, with times |
| **R8** | **Narration: masking + alignment** | text → masked text attached to steps | `design.json` → `prompt.task` ("What they said…", step ranges) | private words masked; each sentence attached to the steps you were doing when you said it |
| **R9** | **Normalise** | events → steps by meaning | `design.json` → `prompt.task` ("The recording…") | one step per real action; selection clicks folded into their copy; repeated navigations merged |
| **R10** | **First draft (code)** | steps → workflow skeleton: targets, locators, values | `design.json` → `transcript[0]` (`label_steps` result) | every target has role + name (or attrs/fallbacks); no container-text targets |
| **R11** | **Design agent: understanding** | form + narration + recording → inputs, loops, branches, llm steps, `{{today}}` | `skills/<id>/v1.json` | every rule you stated is in the workflow; no literal value that should change |
| **R12** | **Design agent: questions** | what's unclear → inbox questions; answers → workflow | inbox; `design.json` (`ask_user`) | no question the form or narration answers; every answer visible in v1 |
| **R13** | **Design agent: honesty and checks** | `finish` summary, checks | `design.json` (`summary`, `edits`), v1 `check`/`success` | the summary matches the edits; checks are things that can be true |
| **R14** | **Save** | approvals, history | `v1.json` | approval on outward steps and on Never matches |

### Replay

| # | Section | What it does | Where to look | Working means |
|---|---|---|---|---|
| **P1** | **Start** | inputs filled, automation window opened | `runs/<run>.jsonl` (`run.start`) | inputs present; window in front |
| **P2** | **Navigation and tabs** | `navigate`, staying on the right page or tab | run log, the automation window | each step runs on the page it was recorded on |
| **P3** | **Finding targets** | matching a locator on the page | run log (`target not found`, `ambiguous`, `matchScore`) | found in < 2 s; never ambiguous when the recording was clear |
| **P4** | **Actions** | click, type, select, press, copy/extract, paste | the page after the run | the page ends up as it did when you recorded |
| **P5** | **Variables and data** | `{{…}}`, `{{today}}`, `data.pick`, llm steps | run log (`vars`), the page | values come from this run, not the recording |
| **P6** | **Control flow** | loops, branches | run log (`loop.item`, `branch`) | the right number of items; the right arm |
| **P7** | **Checks, waits, success** | per-step `check`, the workflow's `success` | run log (`failedCheck`), `run.end` | checks pass when the step worked, fail when it didn't |
| **P8** | **Approvals** | outward steps wait for you | inbox | Send, Submit, Delete wait; nothing else does |
| **P9** | **Classify** | the failure type | run log `repair` event (`class`) | the right class for the cause |
| **P10** | **Cheap ladder** | wait longer, fuzzy match | run log (`by: ladder`) | a renamed button fixed with no model call |
| **P11** | **Repair agent** | look, probe, edit, try, commit | `runs/<run>.repair-N.json` | a small fix, tried with evidence, committed as v2 |
| **P12** | **Pictures for agents** | `describe_step_screenshot`, `describe_screen` | transcripts (`call` events) | used when a step has no name |

---

## Part 2: before you start (once)

1. On your working branch, rebuild what you changed and start clean:
   ```sh
   pnpm install && pnpm build && pnpm setup:mac
   pnpm fixtures          # in its own terminal: serves the test pages on http://localhost:5173
   pnpm daemon            # in its own terminal
   ```
2. `chrome://extensions` → Shadow → **Reload**. Then System Settings → Privacy & Security: toggle Shadow **off and on** for Accessibility, Screen Recording and Microphone (the rebuild changed its signature).
3. Check: open `http://localhost:5173/timesheet.html` in Chrome; you should see "Weekly timesheet".
4. For every test:
   - **Narration on, Screenshots on, Pictures on** in the form.
   - **Read the narration lines exactly as written.** That's how R7 and R8 are measured (the transcript is compared word for word).
   - **Answer questions by typing the answer given** in the test, or press Enter for the default if none is given.
   - **Don't edit the workflow** unless the test says so: the point is to see what record produced.
5. After each test (recordings are deleted 24 h after saving), keep a copy:
   ```sh
   mkdir -p ~/shadow-tests && cp -R ~/Library/Application\ Support/Shadow/{recordings,skills,runs} ~/Library/Logs/Shadow ~/shadow-tests/
   ```
   and write two lines in `~/shadow-tests/notes.md`: the test number, and anything you saw that the files won't show (a question that seemed odd, the window going blank, how long saving took).

These copies hold masked screenshots and your voice. They stay on your Mac; share only what you choose.

---

## Part 3: the tests

### T1 · Baseline: one form, nothing clever (≈ 5 min)
**Covers:** R1, R5, R7, R9, R10, R13, R14 · P1, P3, P4, P7. **Purpose:** if this fails, the problem is in the core, not in understanding.

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
**Covers:** R1, R3, R5, R6, R8 (masking), R14 · P8. **Purpose:** find out whether private text is hidden in the pictures, the screen words, the narration and the trace.

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
**Covers:** R1, R2, R9, R10, R11 (`{{today}}` rule), R12 · P2, P3, P5. **Purpose:** the case the real YC test hit: a canvas grid, two tabs, and "today" instead of a fixed row.

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
**Covers:** R2, R9, R11 (loop from "for every row"), R12, R13 · P5, P6. **Purpose:** whether "do this for each" becomes a loop. The rows are local and always three (yesterday, today, tomorrow), so the right answer is known.

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
**Covers:** P3, P9, P10, P11, P12 and the hang (X1 in the second report). **Purpose:** every failure type against a known page, and whether repair hangs **only when its window is hidden**.

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
| c | `…/drift/menu.html` | **behind** (click into another app as soon as it starts) | the same as b. If b works and c hangs ("extension did not answer"), the hidden-window cause of X1 is confirmed |
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
**Covers:** R4, R9, R11 (a pattern from moved files) · P4, P5. **Purpose:** the file side, untested so far.

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

## Part 4: what you send me afterwards

1. `~/shadow-tests/` (or just tell me it's there: I'll read it on your Mac).
2. `notes.md`.
3. Which branch and commit the daemon ran (`git log -1 --oneline` in your checkout).

From that I'll write one table: every section in Part 1 × every test, each cell **works / breaks / not exercised**, with the file and line that shows it. Then a list of fixes per broken section.

| Section | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 |
|---|---|---|---|---|---|---|---|---|
| R1 web capture | ● | ● | ● | ● | ● | ● | | |
| R2 tabs | | | ● | ● | | ● | | |
| R3 Mac app | | ● | | | | | | |
| R4 files | | | | | | | ● | |
| R5 screenshots | ● | ● | ● | ● | ● | ● | | |
| R6 OCR + masking | | ● | ● | | | ● | | |
| R7 transcription | ● | ● | ● | ● | ● | ● | ● | |
| R8 narration masking + alignment | | ● | ● | ● | | ● | | |
| R9 normalise | ● | ● | ● | ● | ● | ● | ● | |
| R10 first draft / locators | ● | | ● | ● | ● | ● | | |
| R11 understanding | | | ● | ● | | ● | ● | |
| R12 questions | ● | | ● | ● | | ● | ● | |
| R13 honesty, checks | ● | | ● | ● | | ● | ● | |
| R14 approvals | ● | ● | | | | | | |
| P1 start | ● | | ● | ● | ● | ● | ● | ● |
| P2 navigation, tabs | | | ● | ● | ● | ● | | |
| P3 finding targets | ● | | ● | ● | ● | ● | | ● |
| P4 actions | ● | | ● | ● | ● | ● | ● | ● |
| P5 variables, today | | | ● | | | ● | ● | |
| P6 loops, branches | | | | ● | | ● | | |
| P7 checks, success | ● | | ● | ● | ● | ● | | |
| P8 approvals | | ● | | | | | | |
| P9 classify | | | | | ● | ● | | |
| P10 ladder | | | | | ● | | | |
| P11 repair agent | | | | | ● | ● | | |
| P12 pictures for agents | | | ● | | ● | ● | | |
