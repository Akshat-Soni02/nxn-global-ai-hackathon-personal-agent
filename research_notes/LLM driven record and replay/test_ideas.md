# 10 everyday tasks to test Task Player, ordered easy → medium

> Researched 7 Oct 2026. Product facts come from the repo as it is on `main` (957370e plus the uncommitted working tree). Links to `docs/` and `packages/` are relative to this file.
> Legend for **"what varies"**, by how the code makes it vary today (no `.env`, so no model at compile):
> - **F** = a file, asked before step 1 and checked;
> - **D** = a sheet row picked by date (`data.pick`, `{{today}}`);
> - **C** = a copied value (copy → `extract` → `type {{vars.x}}`);
> - **T** = typed text, which becomes an input **only with the Nebius compile**; without it, it replays exactly as recorded;
> - **N** = nothing varies.

## Q1. What repetitive computer tasks do people commonly automate, across fields?

### Takeaway
The same few chores lead every survey and vendor catalog:
- data entry (moving values from one place to another);
- email;
- filing documents and downloads into folders;
- compiling and exporting reports;
- invoices and expenses.

OpenAI's own Record & Replay examples are the same chores done in a browser plus Finder: file an expense, create an issue, publish a video, download a recurring report and file it.

### Cited Findings
**Surveys**
- **Automation Anywhere / OnePoll** (10,500 office workers, 11 countries, fall 2019).
  - The five most hated office tasks, in order: data entry, email management, document filing ("organizing files, spreadsheets, images, and PDFs"), report compilation, invoice management.
  - Workers spent more than 3 hours a day (over 40% of the workday) on manual, repetitive computer tasks, about 60 hours a month each. — [Automation Anywhere press release](http://www.automationanywhere.com/company/press-room/global-research-reveals-world-s-most-hated-office-tasks)
- **Zapier** (workers in businesses of up to 250 people).
  - Data entry ("simply moving information from one piece of software to another") is the #1 most dreaded task.
  - Dreaded tasks take an average of 17.3 hours a week.
  - 49% say these tasks take time away from strategic work. — [Zapier blog](https://zapier.com/blog/most-dreaded-tasks/)
- **Smartsheet**: over 40% of workers spend at least a quarter of their week on manual, repetitive tasks, and "email, data collection, and data entry" take the most time. What they want automated: data collection (55%), approvals (36%), updates (32%). — [Smartsheet](https://www.smartsheet.com/content-center/product-news/automation/workers-waste-quarter-work-week-manual-repetitive-tasks)

**OpenAI Record & Replay**
- Its documented example workflows: "file an expense", "book a parking space", "create a correctly configured issue", "publish a video", "download a recurring report". — [OpenAI Record & Replay docs](https://learn.chatgpt.com/docs/extend/record-and-replay.md)
- The Rundown's walkthrough: "Open Google Search Console. Go to the performance report. Select the reporting window. Apply a country filter. Export a CSV. Move the download into the right reporting folder. Rename the file with a clear convention." — [The Rundown guide](https://app.therundown.ai/guides/automate-any-manual-task-with-this-openai-feature)
- The same guide's suggested users and tasks:
  - users: marketers and SEO teams pulling recurring reports; "creators and operators who upload videos, organize files, rename exports, or move assets between a browser, Finder, and another app";
  - tasks: monthly analytics exports, YouTube upload checklists, file packaging, CRM cleanup, saving invoices into client folders, exporting monthly financial reports. — [The Rundown guide](https://app.therundown.ai/guides/automate-any-manual-task-with-this-openai-feature)

**Vendor catalogs**
- **UiPath**, by department:
  - Finance & Accounting: "Procure-to-pay", "Order-to-cash", "Invoice processing", reconciliation and month-end reporting;
  - HR: onboarding, recruiting, payroll;
  - QA: "Test automation". — [UiPath departments](https://www.uipath.com/solutions/department)
- **Power Automate** templates: one moves files from one SharePoint folder to another; another moves a new OneDrive file to a different folder after approval. *(Search result snippet; page not fetched.)* — [Power Automate template: move files](https://powerautomate.microsoft.com/en-US/templates/details/9386064b03f34c85ae11eb3ca9c34d3e/move-files-from-one-sharepoint-folder-to-another/); [template: on approval move file](https://powerautomate.microsoft.com/en-ca/templates/details/0a4ef4204fb911e78ced3beedb3cacd3/on-approval-move-a-new-onedrive-for-business-file-to-a-different-folder/)
- **Power Automate Desktop** has a "Rename file(s)" action, used for date and sequence naming. *(Search result snippet; page not fetched.)* — [Rename file(s) action](https://www.samurai-emblem.com/2023/05/14/power-automate-desktop-action-rename-file/)
- **Zapier**: Google Sheets and Gmail are among its top 10 apps. *(Search result snippet; page not fetched.)* — [Ashley Gross, top 10 Zapier apps](https://theashleygross.learnworlds.com/blog/top-10-zapier-apps)

### Inferences
- The tasks in this evidence fall into five families. Each of the 10 tests below belongs to at least one:
  - **form entry**: data entry;
  - **file filing**: move or rename;
  - **upload a document or media**: invoice, video, asset;
  - **copy a value from one system to another**: sheet → form;
  - **create a configured record**: issue, card.
- "Download a report, then file it" appears in both OpenAI sources. It is the most cited cross-channel task, so it must be one of the 10 (task 9).

### Gaps
- The Zapier and Smartsheet pages don't give sample sizes or survey dates.
- The Automation Anywhere survey is from 2019.
- The Tom's Guide article ("7 prompts to try") came back truncated, so its seven tasks aren't listed here.
- Some percentages appeared only in search snippets and not on any page I fetched, so they aren't cited:
  - "38% data entry / 34% document creation / 33% invoice management / 31% copying data";
  - a "51% of work hours" figure (Talker Research).
- I found no automation catalog specific to education or graphic design. Tasks 7 and 9 rest on the general "filing", "upload" and "download a report" evidence.
- Three sources (the Power Automate templates, the Rename file(s) action, Ashley Gross) were seen only as search snippets. They are tagged as such above and only add support; no task depends on them alone.

## Q2. Which of these can be done end to end without a password in the recording, without real payments, and safely?

### Takeaway
Most of them can, if they run on the local test pages, public sites, or the user's own sandbox in a Chrome that's already signed in, and stop at a draft, a private setting or an approval prompt.

What rules a task out today:
- a sign-in step inside the recording;
- anything in an iframe;
- a control that only appears on hover;
- writing into a canvas-drawn app (Sheets, Docs, Figma, Maps);
- needing the run to start on its own (no schedules or triggers yet).

### Cited Findings
**What the product does today**
- **Passwords are never recorded.** A password field becomes a secret input. Mac secure fields are never read. — [readme](../../readme.md); [guide 11](../../docs/guide/11-mac-apps.md)
- **Approval before risky steps.** A step that sends, pays, deletes or submits waits for `approve`.
  - Web: any form submit, or a button named submit / pay / send / delete / remove / post / publish / confirm / purchase / buy / order / transfer / sign (`RISKY`, [skeleton.ts:14](../../packages/recorder/src/skeleton.ts), `isRisky` at line 449).
  - Mac apps: Quit / Erase / Trash / Don't Save and the like.
  - "Create" is **not** in the list. — [guide 12 §6](../../docs/guide/12-how-it-works-simply.md); [guide 11](../../docs/guide/11-mac-apps.md)
- **Clicks in drawn apps are not replayed.** In canvas apps (Sheets, Figma, maps), a click with no element is flagged `drawn` and not replayed. A Google Sheet can only be **read**: on copy, its CSV export is used, fetched by the extension with your cookies. Checked on a fake sheet, not a real one. — [guide 10](../../docs/guide/10-merge-and-hot-edges.md)
- **A link click replays as its address.** "Open where it led rather than find the link again." — [skeleton.ts:149](../../packages/recorder/src/skeleton.ts)
- **Files.**
  - Copies are not replayed. Deletes and Trash are not replayed, on purpose. Folder creation isn't recorded.
  - A renamed file keeps its recorded new name. Task Player never overwrites, so the next run gives `… (1)`. — [guide 12 §3](../../docs/guide/12-how-it-works-simply.md); [guide 11 limits](../../docs/guide/11-mac-apps.md)
- **What starts a run.** Only a typed `run <id>`. Schedules and file triggers exist in the skill format but aren't built. The AI fallback isn't built either: on ✗ the run stops. — [guide 12 §6–7](../../docs/guide/12-how-it-works-simply.md)
- **Logged-in sites.** Web steps run in an automation window of *your* Chrome through the daemon. `pnpm replay` uses its own `dev-chrome` profile, so it has none of your cookies. — [readme](../../readme.md)
- **Uploads through the extension** fail with "Not allowed" unless the extension has "Allow access to file URLs" on. — [guide 10](../../docs/guide/10-merge-and-hot-edges.md)
- **Mac apps.** They need the Accessibility permission. Cross-app use is untested: real global monitors, keys and menu bars. So are Save/Open dialogs of sandboxed apps (TextEdit, Preview). — [guide 11](../../docs/guide/11-mac-apps.md)
- **the-internet.herokuapp.com**: uploads there are public, and the site stalls at times. — [skills/real/README.md](../../skills/real/README.md)

**Outside guidance**
- OpenAI's advice for recordings: "Use realistic inputs, but avoid secrets and sensitive data"; "Keep the demonstration short and complete"; "State your goal and any specific inputs that might vary… before you start recording". — [OpenAI Record & Replay docs](https://learn.chatgpt.com/docs/extend/record-and-replay.md)
- The Rundown: "Close private tabs, email, Slack, password managers, customer data… before you start recording." — [The Rundown guide](https://app.therundown.ai/guides/automate-any-manual-task-with-this-openai-feature)

### Inferences
**Safe without any account:**
- the local fixture pages: timesheet, upload, upload-dialog, upload-dropzone, kanban, paste-form, the fake sheet;
- Wikipedia;
- Finder inside `~/TaskPlayerTest`;
- TextEdit with no Save dialog.

**Real accounts. Run these only through `run <id>` in the daemon, and only on a sandbox:**
- **GitHub** (task 10): a private sandbox repo.
- **YouTube Studio** (the optional real variant of task 6): visibility Private; never press Publish.
- **Google Drive** (the optional variant of task 7): a private folder.
- **A real Google Sheet** (the optional variant of task 8): read-only.

Never record a sign-in step. Sign in beforehand in normal Chrome.

**Considered and dropped:**
- **Gmail drafts.** The To field turns addresses into chips, and the body is a contenteditable area. Typing into either is unverified.
- **Google's Campaign URL Builder** (a marketing UTM task). The page is rendered by script, so I couldn't confirm its form or its copy button. A copy button that writes with the clipboard API may never raise the page "copy" event the recorder listens for.

The safe tasks are the 10 below.

### Gaps
- The real YouTube Studio, Google Drive and Google Sheet paths are untested in this repo. Guide 10 lists "your real YouTube Studio and Google Sheet" as not verified.
- I didn't check whether YouTube Studio's upload dialog or GitHub's label menu use shadow DOM or portals in a way that changes matching.

## Q3. The 10 tests: difficulty, steps, what varies, what success looks like, what they exercise, what they may hit

### Takeaway
The 10 tests span 10 different fields. Together they cover every capability that exists today:
- navigate, click, type, select, Enter, Escape;
- upload three ways (file input, hidden input behind a dialog, drop zone);
- a drag inside a page;
- copy → paste;
- a sheet read with a date rule;
- `fs.move` and `fs.rename`;
- a download followed by a move;
- Mac-app steps;
- approval;
- refusing a wrong file.

**Easy**: one channel, 2–4 steps, a local page or Finder.
**Medium**: crosses channels, needs a real or logged-in site, or relies on a copied or dated value.

Task 9 and task 10 are each likely to expose one specific known gap. That is deliberate, and it is written down for each.

### Cited Findings
- Code facts behind the risk notes:
  - **Download then move (task 9).** A downloaded file is only linked to its click for the model (`produced`, [compile.ts:235](../../packages/recorder/src/compile.ts)). The code-only skeleton turns a move into a file input chosen *before step 1*: the newest file like it in the folder it came from ([skeleton.ts:291–316](../../packages/recorder/src/skeleton.ts); [guide 12 §6](../../docs/guide/12-how-it-works-simply.md)). The hand-written `download-and-file` skill gets around this with `fs.find … since_run_start` ([skills/real/README.md](../../skills/real/README.md)).
  - **Drags (task 5).** Both ends of a drag are copied from the recording, and "the model can't change them". — [guide 10](../../docs/guide/10-merge-and-hot-edges.md)
  - **Finding a dropped file (task 7).** If Spotlight finds nothing, the walk searches only Downloads, Desktop, Documents, Movies, Pictures, iCloud and Google Drive. — [guide 12 §3](../../docs/guide/12-how-it-works-simply.md)
  - **"A file like the one you recorded with" (tasks 2, 3, 6, 7, 9).** It's the recorded name with only its **digits** turned into wildcards, extension kept: `invoice-0923.pdf` → `invoice-*.pdf`. A name with no digits stays exact. — `globFor`, [normalise.ts:388–394](../../packages/recorder/src/normalise.ts)
- The fixtures used, with what each page shows when it works:

| Fixture | What it holds | What it shows on success |
|---|---|---|
| `timesheet.html` | Project select (NX-101 / NX-202), number field "Hours" | "Draft saved" |
| `paste-form.html` | text field "Amount" | "Saved amount …" |
| `upload.html` | `accept="application/pdf"`; Submit is a plain button | "Upload complete" |
| `upload-dialog.html` | hidden input with no `accept` | "Uploading <name>" |
| `upload-dropzone.html` | no file input at all | "Received <name> (<bytes> bytes)" |
| `kanban.html` | an HTML5 board and a pointer-event board | "Moved Write report to …" |
| fake sheet | Date, Client, Amount. Rows: yesterday Acme "1,180", **today Globex "1,234"**, tomorrow Initech 990 | — |

Sources: [fixtures/pages](../../fixtures/pages); [serve-fixtures.mjs:10–24](../../scripts/serve-fixtures.mjs).

### Inferences

#### Overview

| # | Level | Field / persona | Real-life task | Channels | Varies | Account |
|---|---|---|---|---|---|---|
| 1 | Easy | Corporate / consulting employee | Log this week's hours on a project | web (local) | T (hours) | none |
| 2 | Easy | Individual / household finances | File this month's bank statement PDF | fs (Finder) | F | none |
| 3 | Easy | Small business owner / accounts payable | Upload this month's invoice to a vendor portal | web (local) | F | none |
| 4 | Easy | Communications / writer | Make a text plain in TextEdit and copy it for a newsletter | ax (TextEdit) | T | none (needs Accessibility) |
| 5 | Easy–medium | Project manager / scrum lead | Move a finished card to Done | web drag (local) | N | none |
| 6 | Easy–medium | Marketing / content creator | Upload this week's product video through "Select files" | web (local) | F | none (real Studio variant: Private) |
| 7 | Medium | Graphic designer | Hand over an exported image by dragging it from Finder to a media library | Finder → web | F | none (Drive variant: private folder) |
| 8 | Medium | Finance / admin assistant | Enter today's amount from the team sheet into the expense form | sheet → web | D + C | none (real Sheet variant: read-only) |
| 9 | Medium | Teacher / student | Save a Wikipedia article as PDF into this week's class folder | public web + download + fs | T + F | none (public site) |
| 10 | Medium | Software developer / QA | File a labelled, assigned bug issue on GitHub | logged-in web | T | **real GitHub: private sandbox repo** |

Fields covered: corporate, personal, small business, communications, project management, marketing/creator, design, finance/admin, education, tech. **10 distinct, against a minimum of 7.**

**Setup once:**
1. `corepack enable pnpm && pnpm install && pnpm build && pnpm setup:native-host`.
2. Load the extension. In its Details, turn on **Allow access to file URLs**.
3. Run `pnpm fixtures`, then `pnpm seed:sandbox`.
4. Run `pnpm daemon` in a visible terminal. For task 4, also run `pnpm setup:mac` and allow Accessibility.

---

#### 1 · Easy · Corporate employee: weekly timesheet
**Real-life goal:** every Friday, log the week's hours against a project code.
Evidence: data entry is the most hated task (AA/OnePoll; Zapier); UiPath lists payroll under HR.

**Why easy:** one page and three steps (select, type, save). It is already proven once, in Chrome for Testing (16/16), so it doubles as the smoke test on your real Chrome.

**Record:**
1. Press Record.
2. Open `http://localhost:5173/timesheet.html`.
3. Project → **NX-101**.
4. Hours → **38**.
5. Click **Save draft** and see "Draft saved".
6. Press Stop and answer the questions.

**Varies (T):** hours and project.
- Without `.env`, they replay as 38 and NX-101.
- With the Nebius compile, 38 should become an input with default 38. This is guide 12's "38 hours: the same every week, or ask?".

**Replay:** reload the page, then `run <id>`, then `approve` at Save draft. **Expect:** "Draft saved" on screen; the run log shows `select {option: "NX-101"}` and `type {text: "38", clear: true}`.

**Exercises:** navigate, select, type into a number field (role `spinbutton`), the approval gate on a form submit.

**May hit:** first run on stable Chrome rather than Chrome for Testing; hours stay fixed without the model.

---

#### 2 · Easy · Individual: file this month's bank statement
**Real-life goal:** move the statement PDF you just downloaded into the finance folder and give it a dated name.
Evidence: "document filing" is #3 in AA/OnePoll; Power Automate's move and rename templates; the Rundown's "Move the download into the right reporting folder. Rename the file."

**Why easy:** files only, two steps, no browser.

**Before Record** (folder creation isn't recorded):
- Create `~/TaskPlayerTest/Finance/Statements/`.
- Put a non-empty `statement-2026-09.pdf` in `~/Downloads`. The month **must be in digits**: the "file like it" pattern turns only digits into wildcards (`globFor`, [normalise.ts:388–394](../../packages/recorder/src/normalise.ts)). A name like `statement-sept.pdf` would never match `statement-oct.pdf`.

**Record** (in Finder):
1. Drag `statement-2026-09.pdf` into `~/TaskPlayerTest/Finance/Statements/`.
2. Rename it to `2026-09 statement.pdf`.
3. Press Stop. For "which file next time?", keep "ask each time".

**Varies (F):** the statement. The suggestion is the newest `statement-*-*.pdf` in Downloads. Checks: the file exists, isn't empty, and is a `.pdf`.

**Replay:** add `statement-2026-10.pdf` to Downloads, then `run <id>` and press Enter. **Expect:**
- the October file is moved, then renamed;
- the result is `2026-09 statement (1).pdf`, because the recorded name is kept and never overwritten.

**Optional extra probe:** repeat with files named `statement-sept.pdf` and `statement-oct.pdf`. Expect **no** suggestion, which demonstrates the digits-only rule.

**Negative tests:** each should be refused before any step runs.
- `run <id> ~/Desktop/photo.jpg` should be refused as the wrong kind of file.
- A 0-byte `empty.pdf` should be refused as empty.

**Exercises:** `fs.move`, `fs.rename` following the moved file (`{{inputs.x.name}}`), the newest-like-it file input, all file checks.

**May hit:**
- The dated name needs the model.
- Option-dragging (a copy) records nothing.
- Trash isn't replayed.
- There's no "every month" schedule; you type `run`.

---

#### 3 · Easy · Small business owner: upload this month's invoice to a vendor portal
**Real-life goal:** send the monthly invoice PDF through a client or vendor portal.
Evidence: "invoice management" in AA/OnePoll; UiPath's "Invoice processing" and "Procure-to-pay"; OpenAI's "file an expense".

**Why easy:** one page, a plain file input, one Submit.

**Record:**
1. Have a non-empty `~/TaskPlayerTest/invoices/invoice-0923.pdf`.
2. Open `http://localhost:5173/upload.html`.
3. Click **Upload invoice** and pick the file in the macOS dialog.
4. Click **Submit** and see "Upload complete".
5. Press Stop.

**Varies (F):** the invoice. The rule `accept: application/pdf` is taken from the page.

**Replay:** create `invoice-1023.pdf`, then `run <id>`, press Enter, then `approve` at Submit ("Submit" is in `RISKY`). **Expect:**
- the page shows `invoice-1023.pdf` and "Upload complete";
- **no macOS Open dialog** appears (the file goes in through `DOM.setFileInputFiles`).

**Negative test:** `run <id> ~/Desktop/photo.jpg` should stop before step 1, saying the step takes PDFs.

**Exercises:** upload into a file input, the page's own `accept` rule, the file question at run time, the live `accept` re-check at upload, approval.

**May hit:**
- "Not allowed" if the file-URL toggle is off.
- No size limit is known; set `max_mb` yourself to test it.

**Optional real-site variant:** `the-internet.herokuapp.com/upload`. Uploads there are **public**, so use only the seeded `taskplayer-test-*.txt`. The site stalls at times.

---

#### 4 · Easy (needs Accessibility) · Communications / writer: plain-text a snippet in TextEdit
**Real-life goal:** strip formatting from a paragraph before pasting it into a newsletter or CMS.

**Why easy:** one app and four steps. It mirrors guide 11's "two-minute check". It is the only test of the `ax` channel.

**Record:**
1. Open TextEdit with a new **rich-text** document.
2. Press Record.
3. Type `Weekly update: Team NX`.
4. Choose **Format → Make Plain Text**, and press OK if a confirmation sheet appears.
5. Press **Cmd+A**, then **Cmd+C**.
6. Press Stop.

**Varies (T):** the text, which is fixed without the model. A paste (Cmd+V) would not be kept: the skill would ask what goes there.

**Replay:**
1. Open a fresh rich-text document (File → New).
2. `run <id>`.
3. Then `pbpaste` in Terminal.

**Expect:**
- ✓ for the `ax.open`, `ax.set_value`, `ax.menu ["Format", "Make Plain Text"]` and `ax.key` steps;
- `pbpaste` prints the line;
- the document is plain text.

**Exercises:** recording and replaying a Mac app through Accessibility, menu walking by title, shortcuts.

**May hit:**
- Cross-app Accessibility is **unverified** (global monitors, a real menu bar, keys).
- After a rebuild the permission must be turned off and on again.
- If the document is already plain, the item reads "Make Rich Text". The step then fails ✗ and the run stops (no AI fallback).
- Never touch Save: Save dialogs are untested.

---

#### 5 · Easy–medium · Project manager: move a finished card to Done
**Real-life goal:** after stand-up, move "Write report" from To do to Done.
Evidence: Smartsheet, where 32% want "updates" automated.

**Why easy–medium:** a single page, but a drag uses a different replay method on each board: HTML5 drag events on one, a trusted press, moves and release on the other.

**Record:**
1. Open `http://localhost:5173/kanban.html`.
2. Drag **Write report** from To do to **Done** (Sprint board).
3. Drag **Write report** from Backlog to do to **Backlog done** (the pointer board).
4. Press Stop.

**Varies (N):** both ends of each drag are fixed.

**Replay:** `run <id>` on a fresh page. **Expect:** the status line reads "Moved Write report to Done. Moved Write report to Backlog done."

**Exercises:** `drag {to}` in both modes.

**May hit:**
- You can't choose a different card at replay, so a real board (Trello, Jira, GitHub Projects) with new card names each week would need the model.
- Real boards also need a login (daemon only).
- Drag libraries with animation or auto-scroll aren't covered by this page.

---

#### 6 · Easy–medium · Marketing / content creator: upload this week's product video
**Real-life goal:** upload the weekly product clip through a studio's "Upload videos → Select files" dialog.
Evidence: OpenAI's "publish a video"; the Rundown's "YouTube upload checklists".

**Why easy–medium:** one page, but the file input is hidden and opened by script, so the clicks must turn into a single `upload` and never open the macOS dialog on replay.

**Record:**
1. Have a small non-empty `clip-week40.mp4`.
2. Open `http://localhost:5173/upload-dialog.html`.
3. Click **Upload videos**, then **Select files**, and pick the clip.
4. See "Uploading clip-week40.mp4".
5. Press Stop.

**Varies (F):** the clip. The page has no `accept`, so the kind you recorded with (a video) sets the rule.

**Replay:** add `clip-week41.mp4`, then `run <id>` and press Enter. **Expect:**
- "Uploading clip-week41.mp4";
- the skill shows **one** upload step and not a "Select files" click;
- no macOS dialog appears.

**Negative test:** give a `.pdf`. Expect a kind refusal, if the video kind maps to `video/*`; otherwise record the actual behaviour as a finding.

**Exercises:** the hidden-input pattern (guide 10's "YouTube pattern").

**May hit:** a video's size limit is unknown; set `max_mb`.

**Optional real variant (real account): YouTube Studio**
- Set visibility to **Private**. Stop before Publish ("publish" is gated anyway).
- Controls that only appear on hover aren't recorded: a row's Options and a preview's Play button.
- A title or description you type stays fixed (T).
- Untested here.

---

#### 7 · Medium · Graphic designer: hand over an exported asset to a client's media library
**Real-life goal:** drag the latest exported banner from Finder onto the client's "drop files here" area.
Evidence: the Rundown's "packaging a client deliverable" and "move assets between a browser, Finder, and another app".

**Why medium:** it crosses apps. The page learns only the file's name, size and date. The daemon has to find the file with Spotlight, and replay has to drop it with no file input on the page.

**Record:**
1. Put a PNG at `~/Desktop/tp-exports/banner-v3.png`. It sits under Desktop so that the fallback walk can find it too: `~/TaskPlayerTest` is **not** in that walk.
2. Open `http://localhost:5173/upload-dropzone.html`.
3. Drag the PNG from a Finder window onto **Drop files here** and see "Received banner-v3.png (… bytes)".
4. Press Stop. The suggested folder should be `~/Desktop/tp-exports`.

**Varies (F):** the newest image like it there (kind: images).

**Replay:** add `banner-v4.png`, then `run <id>` and press Enter. **Expect:** "Received banner-v4.png (<its size> bytes)". The file goes in through `Input.dispatchDragEvent`.

**Negative test:** give a `.pdf`. Expect "this step takes images".

**Exercises:** the drop edge, Spotlight `locate-file` (name, then size, then nearest date), and the drop upload.

**May hit:**
- Spotlight finding files on your disk is unverified.
- A file too new to be indexed falls back to the walk.
- Two files with the same name and size are told apart by date.

**Optional real variant (real account): Google Drive**
- Use a private folder.
- Replay prefers a file input if Drive has one, so the drop path may not be the one exercised.
- Canva and Figma are canvas apps, so clicks there aren't replayed. Use them read-only.

---

#### 8 · Medium · Finance / admin assistant: today's amount from the team sheet into the expense form
**Real-life goal:** each day, copy today's invoice amount from a shared Google Sheet into the expense system.
Evidence: data entry is #1 in AA/OnePoll and Zapier; Sheets is a top Zapier app; OpenAI's "file an expense".

**Why medium:**
- It spans two systems.
- The sheet is drawn on a canvas, so the cell click is flagged `drawn` and isn't replayed.
- The value has to come from the sheet's CSV export plus a date rule, then be pasted.

**Record:**
1. Open `http://localhost:5173/spreadsheets/d/FAKE/edit`.
2. Click today's **Amount** cell (Globex, 1,234) and press **Cmd+C**.
3. Open `http://localhost:5173/paste-form.html` and click **Amount**.
4. Press **Cmd+V**, then click **Save** and see "Saved amount 1,234".
5. Press Stop. Accept "the row whose Date is that day's date".

**Varies:**
- **D**: the row, chosen by `data.pick where Date = {{today}}`;
- **C**: the pasted value, which becomes `type {{vars.x}}`. Pasted text is never stored.

**Replay:** `run <id>`, then `approve` at Save. **Expect:**
- "Saved amount 1,234";
- 0 model calls in the run log.

**To prove the rule follows the date, not the position:** the fixture always puts today in row 2. So, before replaying, temporarily change today's amount or the row order in `fakeSheetCsv()` (`scripts/serve-fixtures.mjs:18`), and revert afterwards. Expect the new value.

**Exercises:** `extract {source: google_sheet}` through the extension's background fetch, `data.pick`, copy → `extract` + `save_as` → paste, approval on a form submit.

**May hit:**
- The date format: the fixture uses M/D/YYYY. Check what `{{today}}` renders to.
- No row for today (a weekend sheet) has undefined behaviour.
- The comma in "1,234".

**Optional real variant (real account):** your own Google Sheet in a signed-in Chrome, via `run <id>` only, read-only. The export redirect and cookies are unverified.

---

#### 9 · Medium · Teacher / student: save a Wikipedia article as PDF into this week's class folder
**Real-life goal:** each week, save the reading for the next topic as a PDF and file it.
Evidence: the same shape as OpenAI's "download a recurring report" and the Rundown's "export → move the download → rename".

**Why medium:**
- A real public site.
- Three channels in one skill: web, the download, Finder.
- A menu link.

**Before Record:** create `~/TaskPlayerTest/Class/Week-41/`.

**Record:**
1. Open `https://en.wikipedia.org`.
2. Type `Photosynthesis` in Search and press **Enter**.
3. Open **Tools → Download as PDF**, then press **Download** on the next page.
4. Wait until `Photosynthesis.pdf` is in Downloads.
5. In Finder, move it into `Week-41/`.
6. Press Stop.

Check first that Wikipedia still offers "Download as PDF"; this research didn't re-verify it.

**Varies:**
- **T**: the topic. It is fixed without the model.
- **F**: the file to move.

**Replay:** `run <id>`. **What this is designed to show:**
- **Before step 1, you're asked for the file to move.** It's a file input settled before anything runs, so you're asked for the PDF before it has been downloaded.
- **The question will most likely find nothing.** `Photosynthesis.pdf` has no digits, so the "file like it" pattern is the exact name `Photosynthesis.pdf` in `~/Downloads` (`globFor`). The recording already moved that file out of Downloads.
- **So one of two things happens, both before any step runs:**
  - **(a)** No suggestion: you're asked up to 3 times, then the run stops.
  - **(b)** You give some other existing PDF: that file gets moved, and the PDF downloaded this run stays in Downloads.
- Record which one you see. Either way, the download → move chain isn't wired without the model.
- **The fix:** a recorded `fs.find … since_run_start` built from the download's `produces` link. Today only the model sees that link.
- **To see the web half on its own:** answer with a throwaway PDF. The web steps should still pass: type, Enter, a navigate to the recorded `Special:DownloadAsPdf…` address, then a click on Download.
- Also expected: with a model-varied topic, the "Download as PDF" link would still open the *recorded* topic's address, because a link click replays as its address.

**Exercises:** search and Enter on a real site, link-as-address, a download linked to its click, `fs.move` after a download.

**May hit:**
- the download→move chain (above);
- link-as-address;
- the Tools menu may be a checkbox-style toggle and may record as a tick;
- Wikipedia's page layout may change, and there's no AI fallback.

---

#### 10 · Medium · Software developer / QA: file a correctly configured bug issue
**Real-life goal:** report a bug with the team's title format, body template, the `bug` label and yourself as assignee.
Evidence: OpenAI's "create a correctly configured issue"; UiPath's "Test automation" (QA).

**Why medium:** a real, signed-in React app with popover menus, a markdown editor and focus traps, and a gate before something is created for real.

**Setup (real account):**
- A **private sandbox repo you own** (for example `tp-sandbox`) with a `bug` label.
- Chrome already signed in to GitHub. Never record the sign-in or 2FA.
- Replay **only** with `run <id>` in the daemon. `pnpm replay` has no cookies.

**Record:**
1. Open `https://github.com/<you>/tp-sandbox/issues/new`.
2. Title: `Replay test: Save button misaligned on mobile`.
3. Body: a three-line "Steps / Expected / Actual" template.
4. Labels → tick **bug** → press **Escape**.
5. Assignees → **Assign yourself**.
6. Click **Create**. Press Stop.

**Varies (T):** the title and body. Without the model each run files an identical issue, which is acceptable in a sandbox.

**Replay:** `run <id>`. **Expect:**
- a new `/issues/<n>` page with the `bug` label and you as assignee;
- the approval prompt **before** Create.

**Check before the first replay:** that the Create step has `requires_approval: true` in `skills/<id>/v1.json`.
- "Create" isn't in `RISKY`; the step is gated only if GitHub sends it as a form submit.
- If it isn't gated, that's a **safety finding**: add "create" to `RISKY`, or edit the skill.

**Exercises:** a logged-in automation window, typing into textarea and markdown fields, a checkbox menu in a popover, Escape, approval.

**May hit:**
- GitHub's dynamic IDs and portals.
- The URL check after Create may hold the recorded issue number, unless `pagePath`'s `CHANGES_EACH_VISIT` rule cuts it, so a correct run could be marked ✗.
- A GitHub redesign means a ✗ and a stop (no AI fallback).

---

#### Coverage check

| Capability | Tasks |
|---|---|
| navigate / click | 1, 3, 5–10 |
| type | 1, 9, 10 |
| select | 1 |
| Enter / Escape | 9 / 10 |
| upload through a file input | 3 |
| upload through a hidden input behind a dialog | 6 |
| upload through a drop zone | 7 |
| drag inside a page | 5 |
| copy → paste | 8 |
| sheet CSV read + `data.pick` | 8 |
| `fs.move` | 2, 9 |
| `fs.rename` | 2 |
| download then move | 9 |
| Mac app (`ax`) | 4 |
| approval gate | 1, 3, 8, 10 |
| wrong-file refusal | 2, 3, 6, 7 |
| link replayed as an address | 9 |

**Known gaps that no task covers.** Each can be probed on the-internet.herokuapp.com, outside the 10:
- **Passwords:** `/login` should produce a secret input that isn't replayed.
- **iframes:** `/frames`, `/tinymce`.
- **Hover:** `/hovers`.

### Gaps
- Not verified in this research, so check before recording:
  - Wikipedia's "Download as PDF" path;
  - GitHub's current new-issue form (labels popover, Create button type);
  - which `{{today}}` format `data.pick` compares against the fake sheet's M/D/YYYY dates.
- The education and design tasks (7, 9) rest on general filing, upload and report evidence, not on field-specific surveys.
- Task 4 (TextEdit) is chosen for safe `ax` coverage, following guide 11. I found no automation catalog naming "make plain text" as a common task.
- Task 9's two outcomes are inferred from code (`skeleton.ts`, `normalise.ts`, guide 12 §6), not from a run. I didn't trace what the run-time question shows when no file matches at all.
- Task 5's success text was checked against the lane `aria-label`s: "To do", "Done", "Backlog to do", "Backlog done".
