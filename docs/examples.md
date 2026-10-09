# Real-world workflows

Fifteen tasks people do at work, described **the way a person actually does them**: what they see, click, select, copy and type, not how a program would do it. They are the test cases for Task Player and the basis of the **task coverage** metric in the [readme](../readme.md#success-metric-task-coverage).

The point of writing them this way: nobody searches Gmail with `from:reports@ newer_than:7d`. They open the inbox, spot the email, and click it. Turning that click into "the newest email from that sender" is Task Player's job, so it must not be written into the test.

Each workflow lists:

- **Who / when**: the role, and what makes them start.
- **Systems**: what they touch.
- **What they do**: in order, as a recording would see it, detours included.
- **What they know but never show**: the rules in their head that explain each choice.
- **Next time**: what will be different on the next run.
- **What the recording must work out**: the actual test. What has to be inferred from one recording (and drill answers) for the next run to be right.
- **Today**: the score from a recording, and in brackets the score if someone hand-wrote the skill instead (see [scoring](#scoring)).

Scores are **estimated by reading the code** (Oct 6, 2026), not measured. No workflow has been recorded with a real person yet. The code scored here is the earlier flat-skill flow; since Oct 8 the design ([design.md](design.md)) adds a description form, voice narration, an editable workflow tree with loops, branches and LLM steps, and self-correction. Those target most of the patterns below, so these scores are the baseline to beat.

---

## 1. Weekly KPI email → Google Sheet

- **Who / when:** ops analyst, Monday morning, when they notice the weekly metrics email has come in.
- **Systems:** Gmail and Google Sheets in Chrome, usually as two tabs that are already open.
- **What they do:**
    1. Switch to the Gmail tab and glance down the inbox.
    2. Click the email from "Reporting Bot" titled "Weekly metrics – w/c 28 Sep".
    3. Scroll to the table in the body; drag-select the revenue figure; ⌘C.
    4. Switch to the "KPI 2026" tab, scroll down to the first empty row, click the cell under *Revenue*; ⌘V.
    5. Back to Gmail; copy signups; back to the sheet; paste under *Signups*. The same for churn.
    6. Type `28/09/2026` into the *Week* cell from memory; fix a pasted cell's formatting.
- **What they know but never show:** which email (by sender and subject, never stated); that the row is "the next empty one" or "this week's"; which number goes in which column (they match labels by eye); the week date.
- **Next time:** a new email, new numbers, the next row, next Monday's date.
- **What the recording must work out:**
    - Choose the email by sender and subject, not by its position in the list.
    - Find each number by its label in the email, not by where it was on screen.
    - Turn the typed date into "this Monday".
    - Paste into the next empty row, matched by column header.
- **Today:** 0 (hand-written: 0). Copying from an email is recorded, but nothing writes into a chosen Sheets cell on replay, and a typed date replays as the same literal date.

## 2. Vendor invoices from email → accounting

- **Who / when:** accounts payable clerk, a few times a day, when unread invoice emails pile up.
- **Systems:** Gmail, Finder, Xero (web).
- **What they do:**
    1. Click the first unread email with a paperclip.
    2. Open the PDF in Gmail's preview, read the amount and due date, and download it.
    3. In Finder, rename `INV_88231.pdf` to `Acme-88231-2026-10-01.pdf` and drag it into `Invoices/2026-10`.
    4. In Xero, choose New bill; type the vendor (pick from the suggestions), the invoice number, the amount and the due date, all read off the PDF; drag the PDF in; Save.
    5. Back in Gmail, apply the "Processed" label.
    6. Repeat for the next email, sometimes skipping one (a reminder for an invoice already paid).
- **What they know but never show:** which emails count as invoices; the naming pattern; why some are skipped; that the folder follows the month.
- **Next time:** zero to twenty emails, different vendors and layouts.
- **What the recording must work out:**
    - Repeated actions mean "for each new invoice email".
    - Typed values were read from the PDF.
    - The file name is built from vendor, number and date.
    - The skip rule, which has to be asked as a drill question.
- **Today:** 0 (hand-written: 0). No loops, and nothing reads a PDF.

## 3. Expense receipts → expense report

- **Who / when:** any employee, back from a trip; the report goes in at month end.
- **Systems:** Photos AirDropped from an iPhone (`IMG_4411.HEIC` in Downloads), Expensify (web).
- **What they do:**
    1. Open Expensify; click New expense; drag a photo from Downloads.
    2. Glance at the photo; type the merchant, date and amount; choose "Meals" from the category list.
    3. Repeat for each photo, occasionally rotating one or deleting a duplicate.
    4. On the last day of the month, open the report and click Submit.
- **What they know but never show:** reading the receipt; the category judgement; which photos are receipts and not holiday pictures.
- **Next time:** different photos, amounts and currencies.
- **What the recording must work out:**
    - Typed values come from the image.
    - The category is a judgement call.
    - "For each new receipt photo".
    - Submission waits for month end.
- **Today:** 0 (hand-written: 0). No loops, and nothing reads images.

## 4. Daily standup update

- **Who / when:** software engineer, around 9:45, just before the standup call.
- **Systems:** Jira (web), Slack (web).
- **What they do:**
    1. Open the Jira board and scan their own cards in "In progress" and "Done".
    2. Switch to Slack, open `#team-standup`, and type from memory: "Y: finished PAY-231 retry logic, reviewed PAY-240. T: start PAY-245. B: none".
    3. Press Enter.
- **What they know but never show:** which cards are theirs and moved since yesterday; what they plan today; that Monday's "yesterday" is Friday.
- **Next time:** different cards, a different plan.
- **What the recording must work out:** the message was typed, not copied, so the recording does not show where it came from. It has to link the typed ticket keys to the cards on the board, and turn "today's plan" into a question for the user.
- **Today:** 0 (hand-written: 0.5). A recording replays yesterday's message word for word. A hand-written skill could collect the cards and ask for the plan.

## 5. New applicant triage

- **Who / when:** recruiter, after lunch.
- **Systems:** Greenhouse (web), Google Sheets, Gmail.
- **What they do:**
    1. Open the "Backend Engineer" job; the new applicants are shown in bold.
    2. Click the first one; copy the name, email and LinkedIn URL into a new row of the "Hiring pipeline" sheet; type the years of experience after skimming the CV.
    3. In Gmail, use the "Thanks for applying" template, replace `[Name]`, and send.
    4. Repeat; skip someone obviously unqualified (that one gets a rejection later).
- **What they know but never show:** "new" means since the last time they checked; the experience figure comes from the CV; the skip rule.
- **Next time:** zero to thirty different people.
- **What the recording must work out:**
    - A loop over the new applicants.
    - Remember what the last run already handled.
    - Append to the sheet.
    - Read experience from the CV.
    - The skip rule, asked as a drill question.
- **Today:** 0 (hand-written: 0). No loops, no memory between runs, no sheet writes.

## 6. Monthly bank statement download

- **Who / when:** small-business owner, early each month.
- **Systems:** bank site (web), phone for the one-time code, Finder.
- **What they do:**
    1. Click the bank's bookmark; Chrome's password manager fills in the login; click Log in.
    2. Type the six-digit code from their phone.
    3. Statements, then choose "September 2026" in the dropdown, then Download PDF.
    4. In Finder, rename `statement_0923.pdf` to `Bank-2026-09.pdf` and drag it into `Statements/2026`.
- **What they know but never show:** "last month"; the naming pattern; that the year folder changes in January.
- **Next time:** October, a new code, possibly a session that is still logged in.
- **What the recording must work out:**
    - "September 2026" means last month.
    - The file name and the folder follow from that.
    - The autofilled login comes from the password manager (or the Keychain).
    - The code needs a pause for the user.
- **Today:** 0 (hand-written: 0.5). The recording replays September and its literal file name; autofill and the code are untested.

## 7. Support ticket triage

- **Who / when:** support lead, every half hour or so.
- **Systems:** Zendesk (web).
- **What they do:**
    1. Open the "New" view; open the top ticket.
    2. Read it; set the type to "Billing", the priority to "High" and the group to "Payments"; apply the "Refund policy" macro; Submit as Open.
    3. Next ticket: a bug report, so different fields and no macro.
    4. Continue until the view is empty.
- **What they know but never show:** how they tell billing from bug from how-to; what makes something urgent; when a macro fits.
- **Next time:** every ticket is different.
- **What the recording must work out:**
    - A loop.
    - The fields depend on what each ticket says.
    - Each choice is a judgement that needs examples, and is checked before anything is sent.
- **Today:** 0 (hand-written: 0). No loops, and no step does one thing or another depending on a value.

## 8. Publish a YouTube video from the content calendar

- **Who / when:** creator, when an edit finishes exporting.
- **Systems:** Finder, Google Sheets (content calendar), YouTube Studio (web).
- **What they do:**
    1. In Studio, choose Create, then Upload videos; drag `ep42_final_v3.mp4` from the Exports folder onto the dialog.
    2. Switch to the calendar tab; find today's row; copy the title; paste it into Studio; copy and paste the description.
    3. Drag the thumbnail `ep42_thumb.png` from Finder.
    4. Click "No, it's not made for kids"; Next, Next, Next; Public (sometimes Schedule, picking a date in the calendar widget); Publish.
- **What they know but never show:** that the video is the newest export; that today's calendar row matches it; that the thumbnail goes with it.
- **Next time:** a new file, a new row; sometimes scheduled.
- **What the recording must work out:**
    - The dragged file means the newest export.
    - The copy came from the row dated today.
    - The thumbnail pairs with the video.
    - Publish needs the user's approval.
- **Today:** 0.5 (hand-written: 0.5). Copying from a sheet already compiles into "the row whose date is today", and dropped files are traced back to Finder. Missing: starting when the export lands; a scheduled date replays as a literal; Studio is untested. Also, `data.pick` reads `3/10/2026` as both March 10 and October 3, so a calendar with both dates matches two rows and `pick: "first"` returns March. The sheet's date format should be remembered from the recording.

## 9. Weekly timesheet

- **Who / when:** consultant, Friday afternoon.
- **Systems:** Google Calendar (web), Harvest (web).
- **What they do:**
    1. Look at the week in Calendar and add up client hours in their head.
    2. In Harvest, open the week; type `6.5` under Acme for Monday, `2` under Globex, and so on.
    3. Click Submit week.
- **What they know but never show:** which events count; mental arithmetic; that internal meetings do not count.
- **Next time:** different hours and clients.
- **What the recording must work out:** the typed numbers were added up from the calendar. That never appears in the recording, so it has to be asked.
- **Today:** 0 (hand-written: 0). No loops, and the source of the hours is invisible.

## 10. Weekly dashboard report by email

- **Who / when:** analyst, Monday morning.
- **Systems:** Looker Studio (web), Gmail.
- **What they do:**
    1. Open the dashboard; set the date range by clicking Sep 28 and Oct 4 in the picker.
    2. Export to PDF.
    3. In Gmail, compose: type three stakeholders (picking each from the suggestions), the subject "Weekly report – w/c 28 Sep", and three numbers read off the dashboard in a short paragraph; drag the PDF in; Send.
- **What they know but never show:** "last week"; who receives it; which numbers matter; how they summarise.
- **Next time:** new dates and numbers.
- **What the recording must work out:**
    - The picked dates mean last week.
    - The subject's date follows from that.
    - The typed numbers came from the dashboard; the summary has to be generated.
    - Sending needs approval.
- **Today:** 0 (hand-written: 0.5). A recording replays the same dates and the same sentence.

## 11. Meeting recording → shared drive → Slack

- **Who / when:** product manager, after a recorded call.
- **Systems:** Finder (Zoom puts the file in `~/Documents/Zoom/...`), Google Drive (web), Slack (web).
- **What they do:**
    1. Drag the `.mp4` from the Zoom folder into the Drive "Recordings" folder.
    2. Right-click, Share, set "Anyone in the organisation", Copy link.
    3. In Slack, find the thread about the meeting; type "Recording:"; ⌘V; Enter.
- **What they know but never show:** which meeting; which thread.
- **Next time:** a new file, a new thread.
- **What the recording must work out:**
    - The newest file in the Zoom folder.
    - The pasted link came from Drive's "Copy link", which writes to the clipboard and never appears on the page.
    - Which thread, asked as a drill question.
- **Today:** 0 (hand-written: 0). The recording sees a paste, but no step reads the clipboard.

## 12. Excel rows → government or vendor portal

- **Who / when:** finance assistant, monthly, a long session.
- **Systems:** Excel (Mac app), portal (web).
- **What they do:**
    1. Click a cell in Excel; copy the party name; paste it into the portal; go back and copy the invoice number. The same for date, amount and tax.
    2. Solve the captcha; Submit; copy the acknowledgement number; paste it into the row's last column in Excel.
    3. Move to the next row; repeat 60 times, with breaks.
- **What they know but never show:** row order; skipping rows already filed (those with an acknowledgement number).
- **Next time:** a new workbook.
- **What the recording must work out:**
    - A loop over rows, copying between a Mac app and the browser.
    - The skip rule.
    - The captcha needs the user.
- **Today:** 0 (hand-written: 0). No loops; Excel's grid can neither be read nor written reliably.

## 13. Downloads folder clean-up (Mac only)

- **Who / when:** anyone, when the Downloads folder gets messy.
- **Systems:** Finder.
- **What they do:**
    1. Open Downloads; sort by Kind.
    2. Select all the screenshots and drag them into `Pictures/Screenshots`.
    3. Select a few PDFs and drag them into `Documents/PDFs`; leave one they are still reading.
    4. Select the old `.dmg` files and press ⌘⌫ to move them to the Trash.
- **What they know but never show:** the rule for each kind of file; "old"; why one PDF stays.
- **Next time:** different files.
- **What the recording must work out:**
    - The moved files share a pattern (screenshots, PDFs, installers).
    - "Old" needs a threshold, asked as a drill question.
    - The exception is a judgement.
    - Deleting must go to the Trash.
- **Today:** 0 (hand-written: 0.5). The recording sees individual files moved; Finder moves now ask for a file at run time, which is not unattended. There is no age filter and no Trash step.

## 14. Competitor price watch

- **Who / when:** pricing manager, first thing in the morning.
- **Systems:** competitor sites (web), a Google Sheet log, Slack.
- **What they do:**
    1. Open five bookmarked product pages; read each price; type it into today's column of the price sheet.
    2. If one is much lower than yesterday, post in `#pricing`: "Globex dropped the X200 to $189".
- **What they know but never show:** what counts as "much lower"; comparing with yesterday by eye.
- **Next time:** new prices; usually no alert.
- **What the recording must work out:**
    - The typed prices came from the pages.
    - The alert depends on a comparison.
    - Most runs do not alert.
- **Today:** 0 (hand-written: 0.5). A recording types yesterday's prices and always alerts.

## 15. Order fulfilment: shop → shipping labels

- **Who / when:** e-commerce operations, morning and afternoon.
- **Systems:** Shopify admin (web), ShipStation (web), the printer.
- **What they do:**
    1. Orders; click the "Unfulfilled" tab; select all; Export; "Selected orders, CSV for Excel"; Export.
    2. In ShipStation, Import orders; drag in the downloaded `orders_export (3).csv`; check the column mapping; Import.
    3. Select all, Create labels, then Print; ⌘P in the PDF; Print.
- **What they know but never show:** that the CSV is the one just downloaded; that the mapping is always the same.
- **Next time:** different orders and a differently numbered file.
- **What the recording must work out:**
    - The dropped CSV is the newest download.
    - Printing goes through the macOS print dialog.
- **Today:** 0.5 (hand-written: 0.5). The clicks, the download and the re-upload of the newest file are covered. The print dialog and the trigger are not.

---

## What makes real behaviour hard

What a recording has to understand:

| Pattern in real behaviour | Example | Workflows |
| --- | --- | --- |
| **Choosing by sight**: "that email", "the bold ones", "the first empty row" | clicks the email near the top | 1, 2, 5, 7, 12, 13 |
| **Literal values that should change**: dates, months, picked days | picks "September 2026" | 1, 6, 8, 10, 14 |
| **Typed from the head or another screen**: no copy, so the source is invisible | the standup message; timesheet hours | 4, 9, 10, 14 |
| **Repetition that means "for each"** | the same steps per invoice or applicant | 2, 3, 5, 7, 12 |
| **Judgement calls** | category, urgency, skip this one | 3, 5, 7, 13 |
| **Conditions**: do something only sometimes | alert only if the price dropped | 2, 7, 14 |
| **Clipboard and cross-app copying** | Drive's "Copy link"; Excel → portal | 1, 11, 12 |
| **Things the browser or Mac does for them** | password autofill, print dialog, one-time code | 6, 12, 15 |
| **Starting by noticing**: the email arrived, the export finished | "when I see the email" | 14 of 15 |

What replay is missing on top of that (the [design doc](design.md) has the details): triggers, loops, branching, date arithmetic, sheet writes, clipboard steps, Keychain secrets, the Trash, printing, and reading PDFs and images.

## Scoring

The test for each workflow: **a person who normally does the task fills in the description form, then does the task their usual way while Task Player records (narrating if they want), with no instructions on how. They answer the drill and may edit the tree. Then the next real occurrence runs by itself.**

- **1, done:** the description, recording and drill answers (plus any edits the user makes in the tree) become a workflow that runs unattended from its trigger and gets the right result on three real occurrences in a row.
- **0.5, partly:** right result when started by hand, possibly with the user doing one step (an approval, a code) or answering one question.
- **0, not yet:** a core step fails, or a run produces a wrong result (for example a literal date replayed).

The bracketed **hand-written** score asks the same question of a skill written by a developer. The gap between the two numbers is what understanding a recording still has to learn. Record how many tree edits the user needed, too: fewer edits means better understanding.

| # | Workflow | From a recording | Hand-written | Main blocker |
| --- | --- | --- | --- | --- |
| 1 | KPI email → Sheet | 0 | 0 | sheet writes; choosing the email |
| 2 | Invoices → accounting | 0 | 0 | for each; reading PDFs |
| 3 | Receipts → expenses | 0 | 0 | for each; reading images |
| 4 | Daily standup | 0 | 0.5 | text typed from the head |
| 5 | Applicant triage | 0 | 0 | for each; memory between runs |
| 6 | Bank statement | 0 | 0.5 | literal month |
| 7 | Ticket triage | 0 | 0 | for each; judgement |
| 8 | YouTube publish | 0.5 | 0.5 | trigger; scheduled date |
| 9 | Timesheet | 0 | 0 | invisible source; for each |
| 10 | Dashboard report | 0 | 0.5 | literal dates and text |
| 11 | Recording → Drive → Slack | 0 | 0 | clipboard |
| 12 | Excel → portal | 0 | 0 | for each; Excel |
| 13 | Downloads clean-up | 0 | 0.5 | file patterns; Trash |
| 14 | Price watch | 0 | 0.5 | typed values; condition |
| 15 | Order fulfilment | 0.5 | 0.5 | print dialog; trigger |
| | **Coverage** | **1 / 15 = 7%** | **3.5 / 15 = 23%** | |
