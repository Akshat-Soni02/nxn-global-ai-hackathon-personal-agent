# 13 · Ten real-life tests, in order

> Run these **before** changing the architecture or the code. They are the baseline every later change is measured against. Written 7 Oct 2026, from [the research report](../../reports/LLM%20driven%20record%20and%20replay.md); none of them has been run yet.

**How to use this file:** run the tests top to bottom and fill in the results table at the end. If test 1 fails on your everyday Chrome, stop and fix that first.

**Two rounds:**
1. **Today, with no `.env` key.** This is the code-only baseline: typed text replays exactly as recorded.
2. **After the Nebius key is set.** Run `compile <session>` on the same recordings and replay again. The difference between the rounds shows what the model adds.

**What can change between runs today:**

| Mark | Changes how |
|---|---|
| **F** | a file, asked for before step 1 and checked |
| **D** | a sheet row, picked by today's date |
| **C** | a copied value, pasted again |
| **T** | typed text. It only changes once the model is set up. |
| **N** | nothing changes |

**Ids:** every recording gets its own id, such as `upload-invoice-k3f9q2`. `run` takes the full id, or its start when only one skill matches.

## Setup, once

1. `corepack enable pnpm && pnpm install && pnpm build && pnpm setup:native-host`
2. Load the extension, or reload it in `chrome://extensions`. In its **Details**, turn on **Allow access to file URLs**.
3. Run `pnpm fixtures`, which serves the test pages at `http://localhost:5173/`.
4. Run `pnpm seed:sandbox`.
5. Run `pnpm daemon` in a terminal you can see.
6. For test 4 only: `pnpm setup:mac`, then allow Task Player in Privacy & Security → Accessibility.

## The order at a glance

| # | Level | Field | Task | Channels | Varies |
|---|---|---|---|---|---|
| 1 | Easy | Corporate employee | Log this week's hours | web (local page) | T |
| 2 | Easy | Personal finances | File this month's bank statement | Finder | F |
| 3 | Easy | Small business | Upload this month's invoice to a portal | web (local page) | F |
| 4 | Easy, needs Accessibility | Writer / communications | Turn a snippet into plain text in TextEdit | Mac app | T |
| 5 | Easy–medium | Project manager | Move a finished card to Done | web drag | N |
| 6 | Easy–medium | Marketing / creator | Upload this week's video through "Select files" | web | F |
| 7 | Medium | Designer | Drag an exported image from Finder onto a drop zone | Finder → web | F |
| 8 | Medium | Finance / admin | Copy today's amount from a sheet into a form | sheet → web | D + C |
| 9 | Medium | Teacher / student | Save a Wikipedia article as PDF into a class folder | web + download + Finder | T + F |
| 10 | Medium | Developer / QA | File a labelled, assigned bug on GitHub | signed-in web | T |

---

## 1 · Easy · Corporate employee: weekly timesheet
**Goal:** every Friday, log the week's hours against a project.

**Record:**
1. Press Record.
2. Open `http://localhost:5173/timesheet.html`.
3. Project → **NX-101**.
4. Hours → **38**.
5. Click **Save draft** and see "Draft saved".
6. Press Stop and answer the questions.

**Replay:** reload the page, `run <id>`, then type `approve` at Save draft.

**Pass:** "Draft saved". The run log shows `select NX-101` and `type 38`.

**Exposes:** the first run on your everyday Chrome. Hours stay 38 until the model is on.

## 2 · Easy · Personal finances: file the bank statement
**Goal:** move the statement you downloaded into the finance folder, with a dated name.

**Before Record:**
- Create `~/TaskPlayerTest/Finance/Statements/`.
- Put a non-empty `statement-2026-09.pdf` in `~/Downloads`. The month must be in **digits**, because only digits become "any value" in the file-like-it rule.

**Record (in Finder):**
1. Drag the file into `Statements/`.
2. Rename it to `2026-09 statement.pdf`.
3. Press Stop. Keep "ask me each time".

**Replay:** put `statement-2026-10.pdf` in Downloads, then `run <id>` and press Enter.

**Pass:** the October file is moved and renamed. The new name is `2026-09 statement (1).pdf`, because names are kept and never overwritten.

**Negative tests:** each should stop before step 1.
- `run <id> ~/Desktop/photo.jpg` → "wrong kind of file".
- A 0-byte `empty.pdf` → "empty".

**Exposes:** the dated name only becomes "this month" with the model. A copy (Option-drag) records nothing.

## 3 · Easy · Small business: upload the invoice
**Goal:** send the monthly invoice through a vendor portal.

**Record:**
1. Have a non-empty `~/TaskPlayerTest/invoices/invoice-0923.pdf`.
2. Open `http://localhost:5173/upload.html`.
3. Click **Upload invoice** and pick the file.
4. Click **Submit** and see "Upload complete".
5. Press Stop.

**Replay:** create `invoice-1023.pdf`, then `run <id>`, press Enter, and type `approve` at Submit.

**Pass:** "invoice-1023.pdf" and "Upload complete" appear, with **no macOS Open dialog**.

**Negative test:** `run <id> ~/Desktop/photo.jpg` stops before step 1 with "this step takes .pdf files".

**Exposes:** the "Allow access to file URLs" toggle; if it's off, you get "Not allowed".

## 4 · Easy, needs Accessibility · Writer: plain text in TextEdit
**Goal:** strip formatting from a paragraph before pasting it into a newsletter.

**Record:**
1. Open a new **rich-text** TextEdit document.
2. Press Record.
3. Type `Weekly update: Team NX`.
4. Choose **Format → Make Plain Text**, and press OK if asked.
5. Press **Cmd+A**, then **Cmd+C**.
6. Press Stop.

**Replay:** open a fresh rich-text document, `run <id>`, then run `pbpaste` in Terminal.

**Pass:** every step shows ✓, and `pbpaste` prints the line.

**Exposes:**
- Mac-app replay across apps has never been tried for real.
- If the document is already plain, the menu item reads "Make Rich Text". The step then fails, and with no AI fallback the run stops.
- Don't touch Save.

## 5 · Easy–medium · Project manager: card to Done
**Goal:** after stand-up, move "Write report" to Done.

**Record:**
1. Open `http://localhost:5173/kanban.html`.
2. Drag **Write report** to **Done**, on the Sprint board.
3. Drag **Write report** to **Backlog done**, on the pointer board.
4. Press Stop.

**Replay:** `run <id>` on a freshly loaded page.

**Pass:** "Moved Write report to Done. Moved Write report to Backlog done."

**Exposes:** you can't pick a different card at replay. A real board with new card names each week needs the model.

## 6 · Easy–medium · Marketing: upload this week's video
**Goal:** upload the weekly clip through "Upload videos → Select files".

**Record:**
1. Have a small non-empty `clip-week40.mp4`.
2. Open `http://localhost:5173/upload-dialog.html`.
3. Click **Upload videos**, then **Select files**, and pick the clip.
4. Press Stop.

**Replay:** add `clip-week41.mp4`, then `run <id>` and press Enter.

**Pass:**
- "Uploading clip-week41.mp4";
- the skill has **one** upload step;
- no macOS dialog appears.

**Negative test:** give a `.pdf`. Expect "this step takes videos"; if it isn't refused, note that as a finding.

**Exposes:** the hidden-input pattern that real YouTube Studio uses.

## 7 · Medium · Designer: drop an export onto a client's library
**Goal:** drag the latest exported banner from Finder onto "Drop files here".

**Record:**
1. Put a PNG at `~/Desktop/tp-exports/banner-v3.png`. Keep it under the Desktop: the fallback search doesn't look in `~/TaskPlayerTest`.
2. Open `http://localhost:5173/upload-dropzone.html`.
3. Drag the PNG from Finder onto the drop zone.
4. Press Stop.

**Replay:** add `banner-v4.png`, then `run <id>` and press Enter.

**Pass:** "Received banner-v4.png (… bytes)". A `.pdf` is refused with "this step takes images".

**Exposes:** Spotlight finding the file on your disk, which hasn't been checked on a real disk yet.

## 8 · Medium · Finance / admin: today's amount into the expense form
**Goal:** each day, copy today's amount from the team sheet into the expense system.

**Record:**
1. Open `http://localhost:5173/spreadsheets/d/FAKE/edit`.
2. Click today's **Amount** cell (Globex, 1,234) and press **Cmd+C**.
3. Open `http://localhost:5173/paste-form.html` and click **Amount**.
4. Press **Cmd+V**, click **Save**, and see "Saved amount 1,234".
5. Press Stop. Accept "the row whose Date is that day's date".

**Replay:** `run <id>`, then type `approve` at Save.

**Pass:** "Saved amount 1,234", with 0 model calls in the run log.

**To prove the row is picked by date, not by position:**
1. Temporarily change today's amount in `fakeSheetCsv()` in `scripts/serve-fixtures.mjs`.
2. Replay. Expect the new value.
3. Undo the change.

**Exposes:**
- the date format (the sheet uses M/D/YYYY; check what `{{today}}` gives);
- weekends, when there's no row for today;
- the comma in 1,234.

## 9 · Medium · Teacher / student: Wikipedia PDF into the class folder
**Goal:** each week, save the reading as a PDF and file it.

**Before Record:**
- Create `~/TaskPlayerTest/Class/Week-41/`.
- Check that Wikipedia still offers **Tools → Download as PDF**.

**Record:**
1. Open `https://en.wikipedia.org`.
2. Search `Photosynthesis` and press Enter.
3. Choose **Tools → Download as PDF**, then **Download**.
4. In Finder, move `Photosynthesis.pdf` into `Week-41/`.
5. Press Stop.

**Replay:** `run <id>`.

**Expected to fail, in a known way:**
- You're asked for the file to move **before** step 1, before the PDF has been downloaded.
- `Photosynthesis.pdf` has no digits, so no file matches.
- Either the run stops after 3 tries, or you name another PDF and that one gets moved.
- Write down which happened.

**Exposes:**
- The download → move link isn't wired without the model.
- A link click replays as its recorded address, so a new topic would still download the old one.

## 10 · Medium · Developer / QA: file a bug on GitHub (real account)
**Goal:** report a bug with the team's title format, the `bug` label and yourself as assignee.

**Setup:**
- A **private sandbox repo** you own (e.g. `tp-sandbox`) with a `bug` label.
- Chrome already signed in to GitHub. **Never record a sign-in.**
- Replay only with `run <id>` in the daemon. `pnpm replay` uses a separate profile with no logins.

**Record:**
1. Open `https://github.com/<you>/tp-sandbox/issues/new`.
2. Type the title `Replay test: Save button misaligned on mobile` and a 3-line body.
3. Labels → tick **bug** → press Escape.
4. Assignees → **Assign yourself**.
5. Click **Create**.
6. Press Stop.

**Before the first replay:** open `skills/<id>/v1.json` and check that the Create step has `requires_approval: true`. "Create" isn't on the list of risky words, so if the step isn't gated, that's a **safety finding**.

**Pass:** a new issue with the label and assignee, and an approval prompt before Create.

**Exposes:**
- The check after Create holds the recorded issue number (`/issues/<n>`), so a correct run may still show ✗.
- GitHub's popovers.
- No AI fallback.

---

## Three probes for known gaps
These aren't real tasks. They each check that a known gap fails clearly. All three are on `the-internet.herokuapp.com`.

| Probe | Page | Expect |
|---|---|---|
| Passwords | `/login` (public test login `tomsmith` / `SuperSecretPassword!`) | The password becomes a secret input and isn't replayed |
| iframes | `/frames`, then `/tinymce` | Typing inside the iframe is not found |
| Hover | `/hovers` | A button that only shows on hover isn't recorded, so replay can't find it |

## Results (fill in)

| # | Round 1, no key: pass / fail, which step, error | Round 2, with key: pass / fail | Notes |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | | | |
| 9 | | | |
| 10 | | | |
| Probes | | | |

Run logs are in `~/Library/Application Support/TaskPlayer/runs/`, and the saved skills are in `skills/<id>/`.
