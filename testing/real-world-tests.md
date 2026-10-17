# Real-world tests

> Written 17 Oct 2026, on `main` at `eae9d40` (PR #11 merged). These are tasks a real person would hand to Shadow, run
> end to end on the **real model**: record → questions → workflow → edit → walk through → run → approvals → schedule
> → repair. Each test says what to type, do and say, and **what should happen at every stage**. You fill in what
> actually happened.
>
> Tests 1–10 are new. Test 11 is the YC task that was already recorded twice, re-run to see what has been fixed
> since.
>
> What comes next: the flaws found here go into [flaws.md](flaws.md), next to this one, sorted by the section codes below,
> then they get fixed, then ten more tests are run.
>
> The earlier lists are kept as they are: [docs/examples.md](../docs/examples.md) (15 workflows from the design
> stage) and [docs/guide/15-test-ideas.md](../docs/guide/15-test-ideas.md) (Oct 7, command-line era).

## Before you start

**Once**

1. `pnpm setup:mac`, for the new pill (it shows only while recording). Then System Settings → Privacy & Security →
   Accessibility: turn Shadow **off and on**. That second part matters only for tests **2, 5, 7 and 10**, the ones that
   use Mac apps (Notes, Reminders, Preview). Tests 1, 3, 4, 6, 8, 9 and 11 don't use Accessibility: Chrome is recorded
   by the extension, and Finder by a file watcher (test 4 asks once for access to Desktop, Documents and Downloads
   instead).
2. Allow **Screen Recording** and **Microphone** for Shadow (needed for the screen-words and voice switches).
3. Shadow → Settings shows **Connected to Nemotron**, and Chrome shows as connected.
4. The daemon is the launchd one. This branch has the same code as `main`, so it needs no restart.

**For each test**

- Prepare the test data it lists. Use only test data: emails to yourself, test Forms and Sheets, a test repo, files
  in test folders.
- **Keep the evidence.** A recording's folder is deleted **24 hours** after the workflow is saved. Either tell me
  within 24 hours, or copy it:
  `cp -R ~/Library/"Application Support"/Shadow/recordings/<session> ~/Desktop/shadow-evidence/`
  (the newest folder in `recordings/` is the one you just made). With the workflow's name I can read `design.json`,
  `screen.jsonl`, `skills/<id>/vN.json` and `runs/*.jsonl` myself.
- **How to report:** row by row, e.g. *"Test 3: 3.1–3.4 ✓, 3.5 ✗ it labelled every issue 'bug', 3.6 not reached"*.
  Free text is fine; the row numbers are what matter.

**What it costs** (your Token Factory key): the design agent stops at $0.10 a recording (a real one cost $0.02);
repair stops at $0.25 a run; AI steps make at most 3 calls a run. All eleven tests: about $1–3.

## How to read a test

**Section codes.** Every row has one. They become the chapters of the flaws file.

| Code | Section | Code | Section |
|---|---|---|---|
| **R** | Record: the pill, capture, voice, screen words, pictures | **P** | Run: replaying the steps |
| **D** | Design agent: turning the recording into a workflow | **I** | Inbox and approvals |
| **Q** | Questions after Stop | **T** | Triggers: schedules, folders, Go live, auto-pause |
| **E** | Editor | **X** | Repair: when a step breaks |
| **W** | Walk through | **M** | Memory: answers remembered |

**Marks**

- ★ = a test with everything in it. Tests 1 and 2.
- **⚠ not built yet** = what *should* happen, but the code can't do it today. Expected to fail. Still tell me what you
  saw: it goes into the flaws file like everything else.
- **Must NOT** = something that should not happen (a repeated question, an invented step).

**Words used below**

| Word | What it is |
|---|---|
| Goal box | The Record screen: "What should Shadow learn?", the Frequency chip, three switches, and "Never do without asking" |
| Screen words | Switch "Read the words on my screen": a picture after your actions, read on your Mac, private bits masked as ███. Only the words go to the model |
| Pictures | Switch "Let the model see masked pictures": the design agent may send a masked picture to the vision model (`describe_step_screenshot`), and repair may too (`describe_screen`) |
| Voice | Switch "Hear my voice": your narration, turned into text on your Mac after Stop |
| Said only | A rule you speak but never show. It can become a **skip** (a branch around steps you did show) or an **AI step**. It can't become a new click or send step, because the design agent may only add steps that read |
| AI step | A step where the model reads text and answers (a category, a summary, a number). Text only, at most 3 calls a run |
| Inputs | Values a run needs. **Run now** sends none, so each input needs a default, or the run stops with "input … has no value" |

## Coverage

| Thing tested | 1★ | 2★ | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Chrome | ✓ | | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mac apps (Notes, Reminders, Preview) | | ✓ | | | ✓ | | ✓ | | | ✓ | |
| Files (Finder) | | ✓ | | ✓ | | | | | | | |
| Voice while doing | ✓ | ✓ | ✓ | | ✓ | | ✓ | | ✓ | | ✓ |
| Said only (rule or step never shown) | ✓ | | ✓ | | ✓ | ✓ | | ✓ | | | |
| Silent | | | | ✓ | | | | | | ✓ | |
| Vision while designing (`describe_step_screenshot`) | | | | | | ✓ | | | ✓ | | ✓ |
| Vision while repairing (`describe_screen`) | ✓ | | | | | | | | | | |
| Masking | ✓ | | ✓ | | | | | | | | |
| Loop ("for each") | ✓ | | ✓ | ✓ | ✓ | | | | ✓ | | |
| Branch ("if") | ✓ | ✓ | ✓ | | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| AI step | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | | | ✓ |
| Questions, your own answer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Approval in the inbox | ✓ | | ✓ | ✓ | | ✓ | | ✓ | | | |
| Edit → Save as v2 | ✓ | | ✓ | ✓ | ✓ | ✓ | | | ✓ | | ✓ |
| Walk through | ✓ | ✓ | | | ✓ | | | | | | ✓ |
| Schedule / Go live | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| Folder trigger | | ✓ | | | | | | | | | |
| Auto-pause after 3 failures | | | | | | ✓ | | | | | |
| Repair (a page or app changed) | ✓ | ✓ | ✓ | | | | | | | | ✓ |
| "Shadow needs you" card: by hand / try again | | ✓ | | | | | | | | ✓ | |
| Record again | | | | ✓ | | ✓ | | | | | |
| Memory (no question asked twice) | | | | ✓ | | | | | | | |

---

## 1 ★ Food and cab receipts in Gmail → Expenses form → archive

> Someone who claims food and cab expenses every Monday. Everything on the web: a loop, an AI step, a skip rule you
> only say, approval, edit, walk through, repair, and a schedule.

**Prepare (5 min)**

- A Google Form **"Expenses (test)"** with four questions: **Date** (Date), **Merchant** (Short answer), **Amount**
  (Short answer), **Category** (Dropdown: Food, Travel, Other). Open its fill-in link (Send → link) in a tab.
- Send yourself 4 emails from Gmail:

  | Subject | Body |
  |---|---|
  | Your Swiggy order receipt | Order from Behrouz Biryani. Total ₹432. 13 Oct 2026 |
  | Your Uber trip receipt | Trip to the airport. Total ₹612. 14 Oct 2026 |
  | Your Zomato order receipt | Order from Truffles. Total ₹389. 15 Oct 2026 |
  | Your Uber trip receipt | Trip to Mumbai. Total ₹2,840. 16 Oct 2026 |

  The first two are used while recording; the last two are left for Run now. Before each later run, send yourself one
  more receipt like these.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every Monday, put last week's food and cab receipt emails into my Expenses form, then archive each email |
| Frequency | Every week on… Monday at 09:00 |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | On |
| Never do without asking | delete |

**Do and say** (Gmail and the Form open in two tabs)

1. In Gmail, search `receipt`, press Enter. Say: *"I do this for every receipt email from last week."*
2. Open **Your Swiggy order receipt**. Select "₹432" and press ⌘C.
3. Go to the Form tab. Date: 13 Oct. Merchant: type `Swiggy`. Amount: paste. Category: **Food**.
   Say: *"Swiggy and Zomato are Food, Uber is Travel."*
4. Press **Submit**, then **Submit another response**.
5. Back in Gmail, press **Archive** on the email.
6. Do 2–5 again for **Your Uber trip receipt** (₹612, Category **Travel**).
7. Say: *"If it's over 2,000 rupees, skip it, I'll do those myself."* (said only)
8. Press **Stop** on the pill.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 1.1 | R | After Record, the pill appears **already red and counting**. There is no grey pill before Record | |
| 1.2 | R | After Stop, the pill stays while Shadow works, then hides. Within about 2 min the workflow is under **Workflows** (or a question is in the **Inbox**) | |
| 1.3 | R | In `screen.jsonl`, your email address shows as ███ | |
| 1.4 | Q | At most one question, e.g. which emails count as receipts. Every question card has **Or write your own answer** | |
| 1.5 | Q | **Must NOT** ask: which Form (its address is in the recording), the category rule (you said it), how often (Frequency is set), or what to do over ₹2,000 (you said it) | |
| 1.6 | D | **Inputs:** none without a default. Run now must not stop with "input … has no value" | |
| 1.7 | D | **Tree:** Every Monday 09:00 → Gmail search for receipts → read the list of receipt emails → **for each**: open → read merchant, amount, date → **AI step** picks Food / Travel / Other → **if** amount over 2,000 → skip, **else** fill the Form → Submit (🔒 approval, because it submits) → Archive | |
| 1.8 | D | Merchant, Amount and Date come from each email as `{{…}}` references, not the literal "Swiggy", "₹432" or "13 Oct" | |
| 1.9 | D | `design.json`: the summary only describes changes that are really in the edits (the first two real tests claimed edits that were never made) | |
| 1.10 | W | **Walk through** (send yourself one extra receipt first: **Do it** acts for real, and Do it on Submit counts as approval): each target gets a blue outline. Reading steps show **Next**, acting steps show **Do it**. **Skip** and **Stop** work | |
| 1.11 | P | **Run now:** a separate Chrome window opens and runs the steps. The Zomato email goes into the Form (Food, 389) and is archived. The ₹2,840 Uber email is skipped and stays in the inbox. Check Form → Responses | |
| 1.12 | P | ⚠ not built yet: switching between the Gmail tab and the Form tab isn't recorded, so the replay may type into the wrong page. Tell me where it went wrong | |
| 1.13 | I | **Submit** waits in the Inbox as "Approve: …", with a notification "Waiting for your approval". **Approve** goes on; **Deny** ends the run as denied | |
| 1.14 | E | **Edit** → pick the Submit step → untick **Wait for my approval** → **Save as v2**. Versions shows v2 made by you | |
| 1.15 | X | **Drift:** in the Form editor, rename "Amount" → "Total amount (₹)". Send yourself a new receipt, then Run now. The Amount step fails, repair starts, the Run page shows a **Repairs** section, and the Inbox gets a **Repaired** card (**Looks right** / **Roll back**) with v3 made by repair. If its try reaches a step that still needs approval, it ends as a recovery card instead: say which | |
| 1.16 | X | With pictures on, the repair transcript (`runs/<run>.repair-1.json`) may show `describe_screen`. Tell me if it does | |
| 1.17 | X | **Roll back** (on the card, or Versions → Roll back → confirm) makes v4, equal to v2. Rename the question back to "Amount" afterwards | |
| 1.18 | T | **Schedule:** Frequency → Change → **Custom schedule (cron)** → a time 2 min from now (e.g. `42 15 * * *` for 15:42) → Save → **Go live**. Within a minute after that time, Runs shows a run "by schedule". Then set it back to Monday 09:00 | |
| 1.19 | P | **Runs page:** each run shows its status, version, trigger, cost, and a "repaired" chip on the repaired run | |

---

## 2 ★ Invoice and receipt PDFs in Downloads → renamed, filed, logged in Notes, a Reminder to pay

> A freelancer whose invoices and receipts land in Downloads. Everything on the Mac: a folder trigger, files,
> Preview, Notes, Reminders, an AI step, a branch made from two different paths you showed, and the "do it by hand"
> path.

**Prepare (10 min)**

- Folders `~/Documents/Invoices 2026` and `~/Documents/Receipts 2026`.
- In Notes, a note whose first line is **Invoices 2026**.
- Make four small PDFs in TextEdit (type the line, then File → Export as PDF):
  - `Invoice-Acme-88231.pdf` ("INVOICE · Acme Supplies · No. 88231 · Amount due ₹12,400 · Due 31 Oct 2026")
  - `Receipt-Uber-1123.pdf` ("RECEIPT · Uber · Trip 1123 · Paid ₹612")
  - `Invoice-Globex-4410.pdf` and `Receipt-Ola-2207.pdf`, the same kind of thing. **Keep these two on the Desktop**:
    they are for after Go live.
- Put the first two in `~/Downloads` **before** pressing Record.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | When a PDF lands in Downloads, rename it 'YYYY-MM Vendor.pdf' and file it: invoices to Invoices 2026, receipts to Receipts 2026; log invoices in my note and remind me to pay |
| Frequency | When a file appears in a folder… Folder `~/Downloads`, Files like `*.pdf` |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | Off |
| Never do without asking | (empty) |

**Do and say**

1. In Finder, open `Invoice-Acme-88231.pdf` (it opens in Preview). Look at it. Say: *"The vendor is in the file
   name."*
2. Close Preview. In Finder, rename it to `2026-10 Acme.pdf`, then drag it into `Documents/Invoices 2026`.
3. In Notes, open **Invoices 2026**, click at the end, and type a new line: `17 Oct · Acme · 2026-10 Acme.pdf`.
4. In Reminders, add **Pay Acme invoice**.
5. In Finder, rename `Receipt-Uber-1123.pdf` to `2026-10 Uber.pdf` and drag it into `Documents/Receipts 2026`.
   Say: *"Receipts don't need a note or a reminder."*
6. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 2.1 | R | The pill appears already red after Record, and hides after the workflow is saved | |
| 2.2 | R | The renames and moves are in the recording (from the file watcher; Finder clicks are never recorded). Opening Preview, typing in Notes and adding the Reminder are recorded through Accessibility | |
| 2.3 | Q | **Must NOT** ask "which file?" (the trigger's file is the input) or "where do the files arrive?" (the Frequency says Downloads). One question at most, e.g. how to tell an invoice from a receipt | |
| 2.4 | D | **Inputs:** the file comes from the trigger. **Go live** is not refused | |
| 2.5 | D | **Tree:** when a PDF appears in Downloads → **AI step** reads vendor and kind from the file name → **if** invoice: rename to "{{month}} {{vendor}}.pdf" → move to Invoices 2026 → Notes line → Reminder "Pay {{vendor}} invoice"; **else**: rename → move to Receipts 2026 | |
| 2.6 | D | The new names are built with `{{…}}`, not the literal "2026-10 Acme.pdf". The two different paths you showed became one if/else | |
| 2.7 | P | **Run now** on a folder workflow: it should ask for or pick a file. ⚠ not built yet: Run now sends no inputs, so it may stop with "input … has no value". Tell me the message | |
| 2.8 | W | **Walk through:** file steps show **Do it**, and Do it really renames and moves the file. On Mac steps, Notes or Reminders comes to the front and its window flashes. (It may hit the same missing-file problem as 2.7) | |
| 2.9 | T | **Go live**, then drag `Invoice-Globex-4410.pdf` from the Desktop into Downloads. Within about 30 s a run "file appeared" starts: `2026-10 Globex.pdf` in Invoices 2026, a Notes line, a Reminder "Pay Globex invoice" | |
| 2.10 | T | **Must NOT** start a second run on the renamed file. If the rename happens inside Downloads before the move, `2026-10 Globex.pdf` is a new PDF there, so the workflow could trigger itself. Runs should show **one** "file appeared" run per PDF you dropped | |
| 2.11 | T | Drag `Receipt-Ola-2207.pdf` into Downloads: it's renamed and filed in Receipts 2026, with no Note and no Reminder | |
| 2.12 | P | The Notes line is **added under** the old ones. ⚠ not built yet: Notes typing is recorded as the note's whole final text, so replay may overwrite the note with what you typed while recording | |
| 2.13 | P | ⚠ not built yet: the amount inside the PDF isn't read (nothing reads a PDF or picture while running). Only the file name is used | |
| 2.14 | X | **Drift:** rename the note's first line to "Invoices 2026 (old)", then drop another invoice PDF into Downloads. The Notes step fails. The Inbox shows "Shadow needs you" with **Try the step again** / **I did it by hand: go on** / **Stop the run**. Add the line by hand, then press **I did it by hand: go on**: the run goes on to the Reminder | |
| 2.15 | P | **Runs page:** the runs show "file appeared" | |

---

## 3 GitHub: label each new issue, then email me a digest

> A maintainer who triages a repo every morning. Tests a loop, an AI decision that has to change which label is
> clicked, the skip rule, an approval on Send, masking, an edit, drift, and the 3-AI-calls limit.

**Prepare (5 min)**

- A test repo, e.g. `shadow-test`, with GitHub's default labels (bug, enhancement, question).
- Issues:
  - unlabeled: **Login button does nothing on Safari**, **Add dark mode**, **How do I export my data?**,
    **Page is slow on mobile**;
  - one already labelled bug: **Typo in README**.
- Gmail open in another tab.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every weekday morning, label my repo's new issues and email me a list of them |
| Frequency | Weekdays at… 09:30 |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | Off |
| Never do without asking | send |

**Do and say**

1. Open the repo's Issues. Say: *"Every morning I label the new issues, only the ones with no label yet."*
2. Open **Login button does nothing on Safari** → Labels (the gear on the right) → **bug** → click away to close.
   Say: *"Something broken is a bug."*
3. Back to Issues → open **Add dark mode** → Labels → **enhancement**. Say: *"Something new is an enhancement, a
   how-do-I is a question."*
4. In Gmail: Compose → To: your own address → Subject `New issues today` → Body
   `Login button does nothing on Safari: bug. Add dark mode: enhancement.` → **Send**.
   Say: *"Then I mail myself the list."*
5. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 3.1 | R | The pill appears already red, and hides after saving | |
| 3.2 | R | In `screen.jsonl`, your email address (Gmail's To field, your account) shows as ███ | |
| 3.3 | Q | **Must NOT** ask which repo, which labels exist, or who the digest goes to: all of it is in the recording | |
| 3.4 | D | **Inputs:** none without a default | |
| 3.5 | D | **Tree:** Weekdays 09:30 → open the issues → read the issues **with no label** → **for each**: open → **AI step** picks bug / enhancement / question → Labels → pick that label → then Gmail: compose to you, subject with `{{today}}`, body built from this run's issues → **Send** (🔒 approval: "send" is a Never word) | |
| 3.6 | D | ⚠ not built yet: the label click is fixed to the label you clicked, so the AI's choice can't change it. Each issue may get the same label. Tell me which label each issue got | |
| 3.7 | D | The email body isn't your typed text replayed word for word | |
| 3.8 | P | **Run now:** the 2 unlabeled issues left (export data, slow on mobile) get labels. **Typo in README** is untouched | |
| 3.9 | I | **Send** waits in the Inbox ("Waiting for your approval"). **Approve** → the email arrives with this run's issues | |
| 3.10 | E | **Edit** → the Send step → untick **Wait for my approval** → **Save as v2** (it only mails you) | |
| 3.11 | X | **Drift:** in the repo, rename the two labels you clicked: **bug → defect** and **enhancement → feature**. Create **App crashes when I press Save**, then Run now. The label pick fails, and the Inbox gets a **Repaired** card or a recovery card. Say which, and what label it used | |
| 3.12 | P | **3-call limit:** create 4 new unlabeled issues, then Run now. The 4th AI call fails (the limit is 3 a run). Tell me the exact error | |
| 3.13 | T | Set back to Weekdays 09:30 and **Go live**. The next weekday, a run "by schedule" | |
| 3.14 | P | **Runs page:** status, version, cost | |

---

## 4 Tidy Downloads every Friday (Finder only, silent)

> Anyone whose Downloads gets messy. Tests file moves with no voice and no screen words, a question answered in
> your own words, a Trash step, removing a step, and whether a second recording asks the same question again.

**Prepare (3 min)**

- In `~/Downloads`: 3 screenshots (⌘⇧3 three times, then move them from the Desktop), 2 PDFs, and 1 `.dmg` (any old
  installer).
- Folders `~/Pictures/Screenshots` and `~/Documents/PDFs`.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every Friday evening, move screenshots to Pictures/Screenshots, PDFs to Documents/PDFs, and delete old installers |
| Frequency | Every week on… Friday at 17:00 |
| Read the words on my screen | Off |
| Hear my voice | Off |
| Let the model see masked pictures | Off |
| Never do without asking | delete files |

**Do** (silent)

1. Open Downloads in Finder and sort by Kind.
2. Select the 3 screenshots and drag them into `Pictures/Screenshots`.
3. Select the 2 PDFs and drag them into `Documents/PDFs`.
4. Drag the `.dmg` to the Trash.
5. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 4.1 | R | The pill appears already red, and hides after saving | |
| 4.2 | R | The 5 moves are recorded. ⚠ not built yet: the move to the Trash isn't recorded (deletes and the hidden Trash folder are skipped). Tell me whether any Trash step appears | |
| 4.3 | Q | A question about **what counts as old**, with options and **Or write your own answer**. Write: `older than 30 days` | |
| 4.4 | D | **Inputs:** none without a default | |
| 4.5 | D | **Tree:** Friday 17:00 → find `Screenshot*.png` in Downloads → **for each**: move to Pictures/Screenshots → find `*.pdf` → **for each**: move to Documents/PDFs → find `*.dmg` older than 30 days → **for each**: move to Trash (🔒 approval) | |
| 4.6 | D | It finds files by pattern. It doesn't replay moves of the exact files you moved: those are gone next week | |
| 4.7 | E | **Edit** → the PDF loop → **Remove** → **Save as v2** | |
| 4.8 | P | Make 2 new screenshots and drop a PDF in Downloads, then **Run now**. The screenshots are moved; the PDF stays (v2 removed that step) | |
| 4.9 | I | If there's a Trash step, it waits in the Inbox for approval | |
| 4.10 | M | Put new screenshots, a PDF and a `.dmg` in Downloads (the first recording moved them out). Then **Record again** (from the workflow page): the goal, Frequency and Never are already filled in. Do the same thing. **Must NOT** ask "what counts as old?" again. ⚠ The answer is saved, but reusing it depends on the agent looking it up: tell me if it asked | |
| 4.11 | T | **Go live**. The workflow page says when it runs next. To see it start now, set a custom cron 2 min ahead, as in 1.18 | |

---

## 5 Morning plan: Google Calendar → a "Prep:" reminder per meeting

> Someone who preps for each meeting. Tests reading a list on the web, a loop made from two meetings you showed, an
> exception you say, typing into Reminders, walk through in a Mac app, and reordering steps.
>
> Google Calendar on the web, not Calendar.app: Shadow can't read text from a Mac app while running.

**Prepare (3 min)**

- In Google Calendar, today: **Acme sync** 11:00, **Lunch** 13:00, **Design review** 16:00.
- In Reminders, a list **Today**.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every weekday morning, add a 'Prep:' reminder for each of today's meetings |
| Frequency | Weekdays at… 08:30 |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | Off |
| Never do without asking | (empty) |

**Do and say**

1. Open calendar.google.com in Day view. Say: *"Every morning I add a prep reminder for each meeting today, every
   meeting except Lunch and Focus time."*
2. Click **Acme sync** to see it, then close it.
3. In Reminders, list **Today**: ⌘N, type `Prep: Acme sync`, Return.
4. Back in the calendar, click **Design review**. Then in Reminders: `Prep: Design review`.
5. Say: *"Lunch I skip."* Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 5.1 | R | The pill appears already red, and hides after saving | |
| 5.2 | Q | **Must NOT** ask which calendar, which list, or which meetings to skip (you said it) | |
| 5.3 | D | **Inputs:** none without a default | |
| 5.4 | D | **Tree:** Weekdays 08:30 → open Calendar (day view) → read today's events → **for each**: **if** not Lunch / Focus time (a branch or an AI step) → Reminders: new reminder "Prep: {{event}}" | |
| 5.5 | D | The reminder text uses `{{…}}`, not the literal "Prep: Acme sync" twice | |
| 5.6 | W | **Walk through:** calendar steps are outlined in Chrome; on Reminders steps the Reminders window comes forward and flashes | |
| 5.7 | E | **Edit:** move a step up or down; change one step's **What it is for**; **Save as v2**. The tree shows the new order and wording | |
| 5.8 | P | Delete the reminders made while recording and walking through, then **Run now**: "Prep: Acme sync" and "Prep: Design review" are created, nothing for Lunch | |
| 5.9 | P | ⚠ If the calendar's events can't be read as a list (the day view is a grid), say what the read step returned | |
| 5.10 | T | **Go live**. Tomorrow at 08:30, a run "by schedule" | |

---

## 6 Google Maps commute → email me only if it's slow

> A commuter who leaves early on bad days. Tests a step you only *say*, vision on a map, a branch that usually does
> nothing, Record again, editing a condition, and auto-pause after 3 failures.

**Prepare (1 min)**

- Two places, e.g. **Shivajinagar, Pune** → **Hinjewadi Phase 1, Pune**.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | On weekdays, check the drive from home to office and email me if it's slow |
| Frequency | Weekdays at… 08:00 |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | On |
| Never do without asking | (empty) |

**Do and say**

1. Open google.com/maps → Directions → type both places → pick the car.
2. Look at the fastest time. Say: *"If it's over 45 minutes, email me so I leave early. Otherwise do nothing."*
3. Stop. **Don't** open Gmail.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 6.1 | R | The pill appears already red, and hides after saving | |
| 6.2 | D | **Vision:** the map is drawn on a canvas, so `design.json` should show a `describe_step_screenshot` call. Run `grep -c describe_step_screenshot design.json` and tell me the count | |
| 6.3 | D | **Tree:** Weekdays 08:00 → open the directions → read the travel time → **if** over 45 min → … | |
| 6.4 | D | The email step was never shown, so it can't be built. The agent must **say so plainly** (in its summary or a question like "show me the email once"). **Must NOT** claim it added an email | |
| 6.5 | Q / D | **Inputs:** the two places are fixed values or inputs **with** defaults. No question about them | |
| 6.6 | P | **Run now:** it reads the time, and if under 45 min nothing else happens. The run ends succeeded | |
| 6.7 | R | **Record again:** the goal, Frequency and Never are already filled in. This time also open Gmail → compose to yourself `Leave early: traffic is bad` → **Send**. Result: v2, with "Recorded again" in Versions | |
| 6.8 | D | **v2 tree:** the email steps sit inside the "over 45" branch, and Send needs approval | |
| 6.9 | E | **Edit** → the if step → Condition → change 45 to 30 → Apply → **Save as v3** | |
| 6.10 | T | **Auto-pause:** Frequency → Custom schedule (cron) `*/2 * * * *` → Save → **Go live**. In `chrome://extensions`, turn Shadow's extension **off**. After about 7 min there are 3 failed runs "by schedule", then an Inbox card "Paused …" with **Resume** / **Keep it paused**. Turn the extension back on → **Resume**. Then set Weekdays 08:00 | |
| 6.11 | P | **Runs page:** the 3 failed runs show a reason you can understand | |

---

## 7 Newsletter → a 3-line summary in Notes

> A reader who keeps notes on one newsletter. Tests choosing an email by its **sender** (not its place in the list),
> a copy that becomes "read this text", an AI summary, and writing into Notes.

**Prepare (3 min)**

- A newsletter you get (TLDR, Substack, anything). If none, send yourself 2 emails from the same address with a long
  body (subjects `Weekly digest #41`, `Weekly digest #42`). Then send one unrelated email, so the newest digest is
  **not** at the top of the inbox.
- In Notes, a note **Reading**.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every Monday, summarise the newest issue of my newsletter into my Reading note |
| Frequency | Every week on… Monday at 08:00 |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | Off |
| Never do without asking | (empty) |

**Do and say**

1. In Gmail, open the newest email from that sender (it's not the top email). Say: *"Always the newest one from this
   sender, not the top of my inbox."*
2. Select the main text and press ⌘C.
3. In Notes, open **Reading**, click at the end, and type a 3-line summary in your own words under today's date.
   Say: *"I write a 3-line summary under today's date."*
4. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 7.1 | R | The pill appears already red, and hides after saving | |
| 7.2 | R | The copy is recorded (its text, up to 2,000 characters) | |
| 7.3 | Q | **Must NOT** ask which email or which sender (you said it) | |
| 7.4 | D | **Inputs:** none without a default | |
| 7.5 | D | **Tree:** Monday 08:00 → Gmail: find the newest email **from that sender** (a search or filter, not "the 2nd email in the list") → read its text → **AI step**: 3-line summary → Notes: add "{{today}}: {{summary}}" to Reading | |
| 7.6 | D | The summary you typed is not replayed word for word; it becomes the AI step's output | |
| 7.7 | P | Send yourself a new digest email, then **Run now**: Reading gets a summary of the **new** email | |
| 7.8 | P | ⚠ not built yet: Notes typing is recorded as the whole note's final text, so replay may replace the note with what you typed while recording | |
| 7.9 | T | **Go live**. Next Monday 08:00, a run "by schedule" | |
| 7.10 | P | **Runs page:** the cost of one AI call | |

---

## 8 Weekly timesheet: Google Calendar → Google Form

> A consultant who bills two clients. Tests numbers typed **from your head**: the hours were added up by eye and
> never copied. The rule for counting is only said. Plus an approval on Submit.

**Prepare (5 min)**

- In Google Calendar this week: **Acme workshop** Mon 10:00–13:00 (3 h), **Globex call** Tue 15:00–16:00 (1 h),
  **Acme review** Thu 14:00–16:00 (2 h), **Team standup** every day 09:30 (internal).
- A Google Form **"Timesheet (test)"**: **Week starting** (Date), **Hours for Acme** (Short answer),
  **Hours for Globex** (Short answer).

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every Friday, fill my timesheet with this week's client hours |
| Frequency | Every week on… Friday at 17:00 |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | Off |
| Never do without asking | (empty) |

**Do and say**

1. Open calendar.google.com in Week view and look at the week. Don't copy anything.
   Say: *"I count only meetings with Acme or Globex in the title; internal ones don't count."* (said only)
2. Open the Form. Week starting: this Monday. Hours for Acme: `5`. Hours for Globex: `1`.
3. **Submit**. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 8.1 | R | The pill appears already red, and hides after saving | |
| 8.2 | Q | You said the rule, so there's no question about where 5 and 1 came from. (Without the spoken rule, a question about where the numbers came from **should** appear) | |
| 8.3 | D | **Tree:** Friday 17:00 → open the calendar week → read the week's events → **AI step**: hours per client (Acme, Globex), only titles with those names → Form: Week starting, Hours for Acme `{{…}}`, Hours for Globex `{{…}}` → **Submit** (🔒 approval) | |
| 8.4 | D | 5 and 1 are **not** typed as literals | |
| 8.5 | D | ⚠ "This Monday" needs date arithmetic, but only `{{today}}` exists. Tell me whether Week starting became a fixed date, `{{today}}`, or something else | |
| 8.6 | D | **Inputs:** none without a default | |
| 8.7 | I | **Run now:** Submit waits in the Inbox. **Approve** → a response in the Form's Responses with Acme 5, Globex 1 | |
| 8.8 | T | **Go live**. Friday 17:00, a run "by schedule" | |
| 8.9 | P | **Runs page:** status and cost | |

---

## 9 Google Maps: top co-working spaces → my Leads sheet

> Someone building a lead list. Tests reading a results list, a loop made from two places you showed, "top 5"
> said aloud, skipping places already in the sheet, vision on a canvas, and writing into a Sheet.

**Prepare (3 min)**

- A Google Sheet **"Leads (test)"**: row 1 is `Name | Rating | Address`. In row 2, put one place that shows near the
  top when you search Maps for co-working spaces in Pune (to test skipping).

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Add the top 5 co-working spaces in Pune from Google Maps to my Leads sheet, skipping ones already there |
| Frequency | Only when I start it |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | On |
| Never do without asking | (empty) |

**Do and say**

1. google.com/maps → search `co-working spaces in Pune` → Enter. Say: *"I add the top 5 from this list, skipping any
   already in my sheet."*
2. Click the 1st result that's not already in the sheet. Copy its name → go to the Sheet tab → click A3 → paste.
   Copy its rating → B3. Copy its address → C3.
3. The same for the next result → row 4. Say: *"And so on, top 5."*
4. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 9.1 | R | The pill appears already red, and hides after saving | |
| 9.2 | D | **Vision:** the map pins and the Sheet's cells are drawn on a canvas, so `design.json` should show `describe_step_screenshot`. Tell me the `grep -c` count | |
| 9.3 | Q | **Must NOT** ask which sheet, or how many (you said 5) | |
| 9.4 | D | **Inputs:** none without a default; the 5 is a default or a fixed limit | |
| 9.5 | D | **Tree:** search Maps → read the results list (limit 5) → read the Sheet's rows (its CSV export) → **for each** place: **if** already in the sheet → skip, **else** open → read name, rating, address → write a row | |
| 9.6 | D | **No AI step per place.** 5 places would go over the 3-calls limit; if it adds one, the run fails on the 4th place. That's a design flaw | |
| 9.7 | E | **Edit** → the list step → Values → limit 5 → 3 → Apply → **Save as v2** | |
| 9.8 | P | **Run now:** ⚠ not built yet: writing into the Sheet is expected to fail (the cells are a canvas and there's no "add a row" action). Tell me what it typed, and where | |
| 9.9 | P | **Runs page:** the step it stopped at, and the error | |

---

## 10 GitHub issues assigned to me → a line in my Weekly note, a Reminder if more than 3

> A developer's Monday check. Silent, so the rule comes only from the goal box. Tests reading a count, a branch,
> Notes and Reminders, and a **sign-in wall** you get past by hand.

**Prepare (2 min)**

- Assign 4 of test 3's issues to yourself.
- In Notes, a note **Weekly**.

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every Monday, write how many GitHub issues are assigned to me in my Weekly note, and remind me to clear them if there are more than 3 |
| Frequency | Every week on… Monday at 10:00 |
| Read the words on my screen | On |
| Hear my voice | Off |
| Let the model see masked pictures | Off |
| Never do without asking | (empty) |

**Do** (silent)

1. Open github.com/issues/assigned and look at the count (4 Open).
2. In Notes → **Weekly** → add a line `17 Oct: 4 assigned`.
3. There are more than 3, so in Reminders add **Clear my GitHub issues**.
4. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 10.1 | R | The pill appears already red, and hides after saving | |
| 10.2 | Q | **Must NOT** ask about the "more than 3" rule (it's in the goal) | |
| 10.3 | D | **Tree:** Monday 10:00 → open issues assigned to me → read the count → Notes line "{{today}}: {{count}} assigned" → **if** count over 3 → Reminder | |
| 10.4 | D | "4" and "17 Oct" are not literals | |
| 10.5 | D | **Inputs:** none without a default | |
| 10.6 | P | Delete the Reminder you made, then **Run now**: a Notes line and a new Reminder | |
| 10.7 | P | ⚠ not built yet: the Notes line may replace the note instead of being added (see 2.12) | |
| 10.8 | I / X | **Sign-in wall:** sign out of GitHub in Chrome, then Run now. The run stops on the login page, with a notification "Shadow needs you" and an Inbox card **Try the step again** / **I did it by hand: go on** / **Stop the run**. Sign in inside the automation window, then press **Try the step again**: the count is read and the run finishes. (Not "I did it by hand: go on": that skips the reading step, so the count would be empty) | |
| 10.9 | P | Unassign 2 issues (count 2), then Run now: a Notes line, **no** Reminder | |
| 10.10 | P | **Runs page:** the run cost (about $0 if there's no AI step) | |

---

## 11 Top YC job → my Ycomb jobs sheet (the task recorded twice before)

> Someone tracking startup jobs, one a day. Recorded twice already, on 14 and 15 Oct. Both failed at every stage:
> see [the first report](../reports/first-real-recording-yc-to-sheets.md) and Akshat's second report
> (`reports/second-recording-yc-to-sheet.md` on his branch `fix/quick-fixes-before-recording`). The bracketed IDs
> below (R1, D1, …) are that report's.
>
> This re-run shows what `main` fixes now. Akshat's branch, with tab switches and an honest "what changed" summary,
> isn't merged, so those rows are still expected to fail. Chrome only: no Accessibility needed.

**Prepare (3 min)**

- A Google Sheet **"Ycomb jobs"**: row 1 is `Date | Company | Compensation | Role`. Row 2 holds the job that is at
  the **top** of ycombinator.com/jobs right now (yesterday's entry), so the rule "already there → take the next one"
  is tested.
- Keep the sheet open in a tab, or bookmarked. Don't open it through Drive's Recent list: that detour became 4
  useless steps last time (R5).

**Goal box**

| Field | Value |
|---|---|
| What should Shadow learn? | Every day, add the top job from YC's job board to my Ycomb jobs sheet (date, company, compensation, role); if it's already there, take the next one |
| Frequency | Every day at… 10:00 |
| Read the words on my screen | On |
| Hear my voice | On |
| Let the model see masked pictures | On |
| Never do without asking | (empty) |

**Do and say**

1. Open ycombinator.com/jobs. Say: *"Every day I add the top job here to my sheet."*
2. Go to the sheet tab and look at row 2. Say: *"The top one is already in my sheet from yesterday, so I take the next
   one instead."*
3. Back on YC, click the **2nd** job → its company page → **Jobs**. Copy the company name → sheet B3 → paste. Copy the
   compensation → C3. Copy the role → D3.
4. Type today's date in A3. Say: *"And today's date."*
5. Stop.

**Should happen**

| # | Code | Should happen | What happened |
|---|---|---|---|
| 11.1 | R | The pill appears already red, and hides after saving | |
| 11.2 | R | Clicks you made only to select text before copying are part of the copy, not separate clicks on big page areas. ⚠ Not fixed on `main` (R1): last time this was the step the run failed on | |
| 11.3 | R | The job link keeps its place ("the 2nd job in the list"), not just that company's fixed address. ⚠ Not fixed on `main` (R2) | |
| 11.4 | R | Switching between the YC tab and the sheet tab is recorded. ⚠ Not on `main` (R4; built on Akshat's unmerged branch) | |
| 11.5 | Q | **Must NOT** ask for the sheet's address: it's in the recording (D2). Any question has **Or write your own answer**, and its answer is actually used | |
| 11.6 | D | **Inputs:** none without a default | |
| 11.7 | D | **Tree:** Every day 10:00 → open YC jobs → read the list of jobs → read the sheet's rows (its CSV export) → **AI step** or **branch**: the first job whose company isn't in the sheet yet → open it → read company, compensation, role → add a row: Date `{{today}}`, Company, Compensation, Role | |
| 11.8 | D | The date is `{{today}}`, not "15 Oct" or today's literal date (R6) | |
| 11.9 | D | `design.json`: the summary describes only changes that are in the edits. **Must NOT** claim "made the date dynamic" or "added a skip branch" when it didn't (D1: happened both times) | |
| 11.10 | D | Checks use only text that really appeared on screen: no `text_visible: ""`, no checks on sheet cells (they're a canvas), and no workflow success text that never shows (D3) | |
| 11.11 | D | No read step whose result nothing uses (D4) | |
| 11.12 | D | **Vision:** the sheet is a canvas, so `design.json` may show `describe_step_screenshot`. Tell me the `grep -c` count | |
| 11.13 | E | **Edit:** remove any leftover click that only led to the sheet, keeping one "open the sheet" step → **Save as v2** | |
| 11.14 | W | **Walk through:** the YC job link is outlined on the right element. There are two links with the company's name (logo and title), so watch for "ambiguous" (P2) | |
| 11.15 | P | **Run now:** ⚠ writing into the sheet is expected to fail ([K1](flaws.md#k1-shadow-cant-write-into-a-google-sheet)). Tell me the step it stops at and its error | |
| 11.16 | X | If a step breaks, repair's tries **don't** hang for 35–50 s with "extension did not answer" (X1). If the workflow itself is wrong (not the page), repair should say quickly that it needs re-recording or editing, not use up its turns (X2) | |
| 11.17 | T | Set Every day 10:00 and **Go live**: the next day, a run "by schedule" | |
| 11.18 | P | **Runs page:** the design and repair cost. Last time: design $0.017 (3 calls), repair $0.043 | |

---

## Appendix: the sure way to see "Repaired → Roll back"

A change on a real site may end in a recovery card instead of a repair: for example when the fix's try reaches a
step that needs approval. These local pages always give repair something it can fix:

1. In a terminal, run `pnpm fixtures`. It serves `http://localhost:5173`.
2. Record (goal: *"Export the invoice list"*, Frequency: Only when I start it): open
   `http://localhost:5173/drift/base.html`, type `INV-1042` in Invoice number, press **Export CSV**, Stop.
3. **Edit** → the first step → Values → change the address to `…/drift/menu.html` (on that copy, Export CSV has moved
   into a "More actions" menu) → **Save as v2**.
4. **Run now.** The export step fails, repair runs, and the Inbox gets **Repaired** (**Looks right** / **Roll back**)
   with v3. **Roll back** makes v4, equal to v2.
5. Optional: a second recording that only types `INV-1042` on `base.html`. Point its first step at
   `…/drift/banner.html` (a cookie banner covers the page; that copy has no Export button, which is why it needs its
   own recording), then Run now.

| # | Code | Should happen | What happened |
|---|---|---|---|
| A.1 | X | `menu.html`: repair adds a click on "More actions" and points Export at the menu item → Repaired | |
| A.2 | X | **Roll back** → v4 equal to v2 | |
| A.3 | X | Optional, `banner.html`: repair adds an "Accept all" click before typing → Repaired | |
