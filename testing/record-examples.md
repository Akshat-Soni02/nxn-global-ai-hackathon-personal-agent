# Record → workflow: twelve everyday tasks to test with

**What this is for.** Each task is something a real person does every day or week, on a different kind of app. You
record it once, and Shadow's record side (stages ①–⑨, see [diagram 16](../docs/guide/16-record-to-workflow.png))
should turn it into a workflow that does the task **next time, with next time's data**.

Each task lists what that correct workflow must do, in the same words as the bench's checks (`expect.json`, explained in
[`reports/record-v2-plans-explained.md` §3.1](../reports/record-v2-plans-explained.md#31-the-measuring-stick-task-1-the-bench)),
and which parts of record and the design agent it probes. Part numbers are the section study's, as in
[`reports/record-v2-whats-fixed.md`](../reports/record-v2-whats-fixed.md).

**Only record → workflow is tested here.** Replay, repair and recovery are out of scope for now. The broader exam from
Oct 17 (11 tests, including replay and repair, written before v2) is on the unmerged branch `test/real-world-e2e`, as
`testing/real-world-tests.md`. Two of these tasks come from it (K and L).

## Who records what

| | Tasks | How | Voice | Login | Sends anything? |
|---|---|---|---|---|---|
| **Claude, in step 3** | A–E | The isolated test browser (Chrome for Testing, a copy of the extension, a scratch daemon) on public sites. Where a task writes something down, it writes into a small local page, `http://localhost:5173/notes.html`, added in step 3 | **No.** The rules you would say go in the goal text instead. The results say so | none | no |
| **Rushil** | F–L | His Mac, his Chrome, Voice and Pictures on. Setup: [`checkpoint-3.md`, "Step 2"](checkpoint-3.md#step-2-rushils-recordings-to-do) | yes | his accounts | only to himself, and only where the task says so |

**For every recording:**
- the design runs at Stop on the real model: at most $0.25 each, logged in
  [`design-eval-ledger.md`](design-eval-ledger.md);
- the safe test run opens pages in the automation window;
- questions are answered as a person would, not with Enter every time;
- the results go into `testing/checkpoint-4.md`;
- copies of the recordings go in `~/shadow-tests/checkpoint-4/`, never in git, each with an `expect.json` written from
  the "A correct workflow" list below. After each round of fixes, `pnpm design:eval <copy>` checks the same recording
  again.

## At a glance

| # | Task | Kind of app | Who | What it mostly tests |
|---|---|---|---|---|
| **A** | Hacker News: save the top 3 stories each morning, skipping ones already saved | plain list page | Claude | a loop over "the top 3"; a "skip ones already done" rule; "every morning" → a schedule |
| **B** | YouTube: note the newest video from a channel | web components (shadow DOM) | Claude | capture inside web components; "the newest" = item 1 of a list |
| **C** | Today's USD→INR rate from a rates table into my expense note | a data table + a form with a dropdown | Claude | reading one cell of a table; today's date; a fixed choice in a dropdown |
| **D** | Wikipedia's featured article of the day, as a PDF, filed in my Reading folder | page → download → file move | Claude | file capture (download, rename, move); "today's" article |
| **E** | Excalidraw: a sticky with this week's date on my team board | a canvas app (no elements to click) | Claude | **known-gap probe**: what capture, evidence and the agent do with a drawn page |
| **F** | KPI emails → my KPI sheet (re-record) | Gmail + Google Sheets | Rushil | F1, F2, F4, F5 on a real recording, with list positions |
| **G** | The top YC job → my jobs sheet (re-record) | YC + Google Sheets | Rushil | F3, list item, opening a new tab |
| **H** | One Play Store report → our Chat space, monthly (re-record) | Play Console + Drive + Chat | Rushil | upload, Enter-that-sends, "all the reports" vs one (F13) |
| **I** | YouTube Studio: my latest video's views, into a note | signed-in web components, charts | Rushil | a real signed-in web-component app |
| **J** | Canva: change the date on my weekly post and download it | signed-in canvas app | Rushil | **known-gap probe**, signed in |
| **K** | Food and cab receipts in Gmail → my expenses form | Gmail + Google Forms | Rushil | Oct 17 exam test 1★: loop, AI step, a "skip if over ₹2,000" rule |
| **L** | Calendar → a "Prep:" reminder per meeting | Google Calendar + Reminders (Mac app) | Rushil | Oct 17 exam test 5: Mac-app capture |

**Step 3 runs A–E (Claude) and F–H (Rushil, Checkpoint 3 step 2).** I–L are for when Rushil has time; K and L also
test what the Oct 17 exam found.

---

## A · Hacker News: the top 3 stories into my reading list

- **Who:** anyone who keeps a reading list.
- **Where:** `https://news.ycombinator.com` → `http://localhost:5173/notes.html`. No login; nothing sent.
- **Goal to type:** "Every morning, save the top 3 Hacker News stories (title and points) to my reading list. Skip any
  story that is already on the list."
- **Do:**
  1. Record.
  2. Open Hacker News.
  3. For stories 1, 2 and 3:
     - select the title and copy it;
     - in the notes tab: Title ← paste;
     - back on HN, select the story's points ("343 points") and copy them (the link was planned, but Playwright can't
       use Chrome's right-click menu or address bar);
     - in notes: Value ← paste, Save.
  4. Stop.
- **A correct workflow next time:**
  - `trigger` schedule ("every morning");
  - `has_loop` over the stories;
  - `write_kept` web.type with `{{…}}`: the title and points come from the page, not today's text as recorded;
  - "skip any already on the list" built as a read of the list plus a branch or an AI step, or said "not built" with
    why (the gate wants one of the two);
  - `max_questions` 1 (perhaps how many);
  - `not_asked` "which site".
- **Probes:**
  - R1: list place;
  - R9: a repeat proposal for 3 identical rounds;
  - D2: values from the page;
  - D6: the rule built or explained;
  - F1, F2, F15: a "skip" rule that isn't enforced.

## B · YouTube: the newest video from a channel, into my notes

- **Who:** a creator watching a competitor, or a fan.
- **Where:** `https://www.youtube.com/@GoogleDevelopers/videos` → `notes.html`. No login; nothing sent.
- **Goal to type:** "Every Monday, note the newest video from the Google for Developers channel: its title and its view
  count."
- **Do:**
  1. Record.
  2. On the channel's Videos tab (open before Record, newest first), click the first video.
  3. On the video's page, select its title and copy it (a title inside a link can't be drag-selected).
  4. In notes: Title ← paste.
  5. Back on the video's page, select the views ("23K views") and copy them.
  6. In notes: Value ← paste, Save.
  7. Stop.
- **A correct workflow next time:**
  - `trigger` schedule ("every Monday");
  - the title and views are read from **item 1 of the grid**, not the recorded title;
  - `write_kept` web.type `{{…}}`;
  - `no_text_only_target`;
  - `max_questions` 0–1.
- **Probes:**
  - R1 under web components: does every click and selection get a role, a name and a list place, through YouTube's
    shadow DOM?
  - R6: what appeared;
  - R10: weak targets;
  - D2: list item.
- **Watch for:** a consent or "sign in" banner the first time; the recording should list a click on it as noise, or
  keep it.

## C · Today's USD→INR rate into my expense note

- **Who:** a freelancer billing in dollars; finance admin.
- **Where:** `https://www.x-rates.com/table/?from=USD&amount=1` → `notes.html`. No login; nothing sent.
- **Goal to type:** "Each working day, note today's US dollar to Indian rupee rate, with today's date, as currency USD."
- **Do:**
  1. Record.
  2. Open the rates table.
  3. Select the INR row's rate and copy it.
  4. In notes:
     - Title: type "USD to INR" (always the same);
     - Date: type today's date as you write it (e.g. "23 Oct");
     - Value ← paste;
     - Currency: choose **USD** in the dropdown;
     - Save.
  5. Stop.
- **A correct workflow next time:**
  - `trigger` schedule (weekdays);
  - `uses_today`: the typed "23 Oct" becomes `{{today|D MMM}}` (proposal "date");
  - the rate is read from **the INR row**, not the recorded number;
  - `write_kept` web.select "USD" (a constant: it stays fixed);
  - `not_asked` "currency";
  - `max_questions` 0.
- **Probes:**
  - R1: a table cell, which is real HTML, not a canvas;
  - R10: typed date → today; a fixed value stays fixed;
  - D2: values;
  - D5: no needless questions.

## D · Wikipedia's featured article, as a PDF in my Reading folder

- **Who:** a student or teacher.
- **Where:** `https://en.wikipedia.org/wiki/Main_Page` → the article → "Download as PDF" → the downloads folder → moved to
  `Reading/`. No login; nothing sent.
- **Goal to type:** "Every day, save today's featured Wikipedia article as a PDF into my Reading folder, named with
  today's date."
- **Do:**
  1. Record.
  2. Open the Main Page and click the featured article's title.
  3. Tools → Download as PDF → Download.
  4. Rename the file to "23 Oct - <title>.pdf" and move it into `Reading/` (in step 3: a scratch folder the daemon
     watches).
  5. Stop.
- **A correct workflow next time:**
  - `trigger` schedule ("every day");
  - the article is **"today's featured article"** (the first link in that box), not the recorded title;
  - the download kept;
  - the move kept, with a name built from `{{today…}}` and the title, not the recorded name;
  - `max_questions` 1 (which folder, if not recorded).
- **Probes:**
  - R4: download, rename and move recorded;
  - R2: the download page's tab;
  - R10: the date in a file name;
  - D4: a file write kept, and inside folders the recording touched;
  - F10 is replay's.

## E · Excalidraw: a sticky with this week's date (known-gap probe)

- **Who:** a team lead with a shared board.
- **Where:** `https://excalidraw.com`. No login; the drawing stays in the browser.
- **Goal to type:** "Every Friday, add a note 'Week of <date>' at the top left of my board."
- **Do:**
  1. Record.
  2. Open Excalidraw.
  3. Press `T` (the text tool), click near the top left of the canvas, type "Week of 23 Oct", then press Escape.
  4. Stop.
- **What should happen today (the gap):** the clicks land on a drawn canvas, with no element. They should be **listed
  as noise ("clicked a drawn area")**, not silently lost. The typing goes into Excalidraw's temporary text box (a real
  element), so it may be recorded. The design agent should either:
  - build "press T, click at …, type `Week of {{week_start|D MMM}}`" and **say plainly** that the click can't be found
    again; or
  - say the task can't be done reliably.

  It must not invent a check.
- **Probes:**
  - §0 #1: drawn pages;
  - R1: drawn clicks;
  - R9: noise listed;
  - D6: honesty about what can't be built.

  This is the evidence for step 4's "which apps work?".

---

## F · KPI emails → my KPI sheet (Rushil; checkpoint 3 step 2)

- **Where:** Gmail and the KPI Google Sheet, signed in.
- **Goal:** your own words, like the first KPI recording.
- **Say while doing it:** "every day", "always the newest one, never one already done".
- **Do:** as on Oct 19. Open the newest KPI email, copy the subject and numbers, paste into the next empty row, type
  today's date.
- **A correct workflow:** the bench's `kpi-email-to-sheet/expect.json`:
  - schedule;
  - `{{today}}`;
  - a loop over new emails;
  - pastes from `{{…}}`;
  - no text-only target;
  - at most 2 questions;
  - the next empty row (a known gap).
- **Probes:** F1, F2 (now with list positions, so code should propose "item 1 of the list"), F4, F5, and the safe test
  run on Gmail.

## G · The top YC job → my jobs sheet (Rushil)

- **Where:** `https://www.ycombinator.com/jobs` and your Ycomb jobs sheet.
- **Goal:** "Every morning, add the top YC job to my Ycomb jobs sheet, skipping companies already in it."
- **A correct workflow:** `yc-top-job/expect.json`:
  - schedule;
  - pasted values from `{{…}}`;
  - the job found as item 1, not by its text;
  - at most 2 questions;
  - the next empty row (known gap).
- **Probes:** F3 (tool slips), a link that opens a new tab, list item.

## H · One Play Store report → our Chat space, every month (Rushil)

- **Where:** Play Console, Drive and Google Chat.
- **Goal:** "Every month, post the latest Play Store stats report to our Chat space."
- **Do:** one report this time (not all of them).
- **A correct workflow:**
  - `playstore-to-chat/expect.json`: schedule, `{{today}}`, the upload kept, the send kept with approval;
  - **"which file?"** answered from what you said ("the latest" → the newest), which is F13;
  - at most 2 questions.
- **Probes:** F1, F13, Enter-that-sends needs your OK, upload folders.

## I · YouTube Studio: my latest video's views, into a note (Rushil, optional)

- **Where:** `https://studio.youtube.com` (signed in) → a Google Doc, Apple Notes, or `notes.html`.
- **Goal:** "Every Monday, note how many views my latest video got."
- **A correct workflow:**
  - schedule;
  - the newest video found as item 1 of the Content list, not by its title;
  - views read, not typed;
  - no invented checks on the chart.
- **Probes:** web components while signed in (Studio is heavier than YouTube); charts drawn as SVG or canvas; R1, R10.

## J · Canva: change the date on my weekly post and download it (Rushil, optional; known-gap probe)

- **Where:** `https://www.canva.com` (signed in), an existing design.
- **Goal:** "Every Friday, change the date on my weekly post to this week's and download it as PNG."
- **What should happen today:** like E, but signed in and with Canva's menus, which are real elements. The download
  should be recorded. Clicks on the design are drawn; text editing may or may not be.
- **Probes:** §0 #1, R1, R4 (the download), D6.

## K · Food and cab receipts in Gmail → my expenses form (Rushil, optional)

From the Oct 17 exam, test 1★ (the full steps are there).
- **A correct workflow:**
  - a loop over receipt emails;
  - merchant, amount and date from each email as `{{…}}`;
  - an AI step for the category;
  - a branch: skip if over ₹2,000;
  - Submit needs approval;
  - at most 1 question.
- **Probes:** F2, F15 (a "skip" rule), masking of your email address.

## L · Calendar → a "Prep:" reminder per meeting (Rushil, optional)

From the Oct 17 exam, test 5.
- **A correct workflow:** a loop over today's meetings, each adding a Reminder named from the meeting.
- **Probes:** R3 (Mac-app capture; needs `pnpm setup:mac`), mixing web and Mac steps.

---

## Results

A–E were run on Oct 23: see [`checkpoint-4.md`](checkpoint-4.md). None of the five saved workflows does its task when run;
F17–F34 are what broke. F–L are still to record. For each task the results give:
- the checks (✓ / ✗ / ⚠ known gap);
- the cost;
- the questions asked;
- what the safe test run found;
- what broke, at which stage (①–⑨), and which R/D section and F number it belongs to.
