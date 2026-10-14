# First real recording: "YC jobs to a sheet" (Oct 14, 2026)

**The record side captured everything, but the design agent threw most of it away.** This was the first recording made with the real model (Nemotron 3 Super), with screenshots and narration both working. Capture was good:

- 65 events
- 29 screenshots, each with clean masked text
- 14 pieces of narration that explain the task well

Then, while trying a large edit, the design agent **deleted 30 of the 35 recorded steps** (`s1`–`s30`). It also asked three questions, two of which the description form had already answered, and **none of the three answers was applied**. It then finished with a summary saying it had done the opposite. The saved workflow is the five leftover steps `s31`–`s35`, which is why it "starts at s31". The first run failed on its first step, on a blank page. The repair agent worked out why ("the YC page isn't open") but was **not allowed to open YC**, because after the deletions the workflow uses no sites.

Most of this is code, not the model. One rule is missing: a recorded step can be deleted without any check. Several rules are too strict: which sites a workflow may open, a click can't become "open this URL", and an edit is capped at 30 operations. Two smaller bugs: drill answers can't create inputs, and questions duplicate the form. The model did its part badly too: it never built the loop or the "skip ones already in the sheet" check that the narration described.

Identifiers from the recording (the sheet id, the Google account id) are masked below as `<sheet-id>` and `<ouid>`.

---

## 1. What was tried

### The task
Every day, take the newest jobs from Y Combinator's job board and add them to a Google Sheet, **about 5 a day, skipping companies already in the sheet**. If fewer than 5 are new, add however many there are. For each job, the row holds the **date, company name, compensation and role**, and only remote, new-grad roles are taken.

### The description form (as filled in)

| Field | Value |
|---|---|
| Goal | "On daily basis i have to take companies from ycombinator and add that into my sheets" |
| What changes | "Usually the companies i am picking up from ycomb. i don't take those which i already took plus i only take around 5 daily" |
| What stays the same | "The sheet where i put the data" · "the format in which i add the data" · "the quantitiy is always 5" |
| Never | (empty) |
| Frequency | Only when I start it (manual) |
| Consent | Screenshots ✅ · Microphone ✅ · Pictures ✅ |

### What was shown (one company, as a demonstration)
1. Opened `ycombinator.com/jobs` and looked at "jobs added recently".
2. Clicked the top company, **Numeral (W23)**, which opened its company page in a new tab, and copied the name "Numeral".
3. Opened a new tab, went to **Google Drive → Recent**, and opened the sheet **"Ycomb jobs"**.
4. Pasted the company name, typed the date "14 Oct", and pressed Enter.
5. Back on the Numeral page, copied the compensation **"$55K - $65K"** for the *Data Analyst* role (remote, new grads OK) and pasted it into the sheet (`C2`).
6. Copied the role title **"Data Analyst"** and pasted it into the sheet.
7. Said that this should be done for 5 companies a day.

### The narration (transcribed on the Mac; 14 pieces, summarised)
> "…take Y Combinator jobs and then add it into my sheet… I take like top 5 latest ones, and I try to avoid taking those which are already in my sheet… if I don't have 5 new ones [I] can take 3 only… let me go to drive… There is a sheet, which is this… company name second, but [first] should be date… 3rd… the compensation… I want to take around remote ones, and new grad only… 3rd one should be… the [role]… I did this for only one, but that's how this should be done for like 5 daily."

The narration states the loop (top 5), the filter (remote, new grad), the dedupe (skip companies already in the sheet), the fallback (fewer than 5 is fine) and the column order (date, company, compensation, role). **Everything the workflow needed was said.**

### Timeline (local time)

| Time | What |
|---|---|
| 11:40:37 | Recording started (form sent; narration starts) |
| 11:43:10 | Stop |
| 11:44:26 – 11:45:07 | Three drill questions in the inbox, answered `A,B,C,D`, `5`, `Yes` |
| 11:45:35 | Saved as `yc-to-sheets-cj18ni` v1 |
| 11:46:56 | Run started by hand |
| 11:47:06 | `s31` failed: target not found (after 10 s) |
| 11:47:49 | The repair agent resolved it as "environment: open YC first" |
| 11:48:44 | Run cancelled |

Cost: the design agent spent **$0.044** (8 turns, 131k tokens in, 5k out, Nemotron 3 Super) and the repair agent **$0.0085**. The first-draft compile call isn't logged separately.

---

## 2. What worked

- **Capture.** 65 events in Chrome across three tabs, with copy and paste values ("Numeral", "$55K - $65K", "Data Analyst").
- **Screenshots** (after the `--capabilities` fix, branch `worktree-fix-shadow-capabilities`): 29 pictures, blacked out in place, and 29 lines in `screen.jsonl`. The text read from them is clean, e.g. *"Jobs at Numeral · Software Engineer (Product) · HQ / New York… $180K - $300K · Data Analyst · HQ / Remote (US) • $55K - $65K • Any (New G…"*.
- **Narration.** `transcript.jsonl` has 14 timed pieces of accurate text, masked.
- **The design agent received both.** `recordingView` attaches each note to the step it was said or seen over (`said: …`, `on screen: …`) in the agent's first message (`packages/recorder/src/design/design.ts`, `taskOf`). The message isn't saved, so this can't be confirmed from `design.json` (see issue 10).
- **The repair agent's diagnosis** was right, and it asked to see the screen before deciding.
- **Cost** is small: the whole recording-to-workflow step cost about 4 cents.

---

## 3. Issues

Severity: **P0** breaks the workflow · **P1** wrong or misleading result · **P2** quality and debugging. Owner follows the build order in `docs/design.md`: Record (Rushil) or Replay (Akshat).

### Issue 1 (P0): the design agent deleted 30 of 35 recorded steps, and nothing stopped it
**What happened** (`recordings/<session>/design.json`):
- Turn 6: an `edit` call was refused: *"edits: Too big: expected array to have <=30 items"*. The attempted edits aren't saved (see issue 10).
- Turn 7: it re-sent the **first 30 operations only**, which were all `remove` (`s1` … `s30`). Its replacement steps were presumably in the part that got cut off.
- The edit was accepted, with `still_to_fix: []`.
- Turn 8: `finish` with the summary *"Added trigger inputs for number of companies, skip existing, auto date, column mapping, and open YC each run…"*, none of which happened.

**Why it was possible:**
- `designViolations` (`packages/recorder/src/design/tools.ts` ≈ L150–215) checks *new* steps, *changed* targets, and kinds of action, but **never removed steps**. Deleting every action the user showed is legal.
- `edit` caps a call at 30 operations (`tools.ts` L410), with no way to apply a large rewrite in several calls atomically. A model that hits the cap re-sends the first 30 operations, which here were the deletions.
- `validate` / `still_to_fix` only reports what *blocks* a run, so five leftover steps count as "fine".
- The `finish` summary is free text and never compared with `session.edits`, so it can claim anything.

**Fix ideas (Record):**
1. **Removing recorded steps:**
   - Refuse any removal that leaves the workflow without its recorded effect: the steps that write, i.e. every `type`, `paste` or upload into another site.
   - Or allow removals only of steps the code marks as noise (issue 6).
   - At the least, cap removals at, say, 30% of recorded actions and ask the user beyond that.
2. Make `edit` all-or-nothing **per call** (already true) but **raise the cap or add `replace_range`**, so a restructure doesn't need 30+ individual operations.
3. Write the history summary from the edits (code), and keep the model's sentence only as a note.
4. Add a design-time check: "the draft still reaches every site and writes every value the recording did".

### Issue 2 (P1): the workflow "starts at s31"
This follows from issue 1. Step ids are kept on purpose ("Keep step ids" in the agent's instructions), so after `s1`–`s30` are removed the first step is `s31`. The ids are fine; the missing steps are the problem.

### Issue 3 (P1): the drill asked what the form already said
The three questions came from the **first-draft compile** (one Nemotron call), as "open questions", and the design agent then asked them:

| Question | Already known from |
|---|---|
| "How many companies should be added each run?" | Form, *stays the same*: "the quantity is always 5"; narration: "top 5" |
| "Should the skill automatically skip companies already listed in the sheet?" | Form, *changes*: "i don't take those which i already took"; narration: "avoid taking those which are already in my sheet" |
| "Which columns should receive the company name, salary range, job title, and date? (e.g., A,B,C,D)" | Narration: date first, company second, compensation third, role fourth. The question even lists them in a different order, so the answer `A,B,C,D` maps company→A, which **contradicts** the narration |

Two more ("auto date", "open YC each run") were queued, but the agent finished before asking them.

**Why:** `compile.ts` filters out only questions whose `appliesTo` points at a form path (`description.*`, `when`). It can't tell that "how many" or "skip existing" is answered by the form's *text*. The compile prompt has the form, but doesn't tell the model that anything the form or narration states must not be asked.

**Fix ideas (Record):**
- In both the compile prompt and the design prompt: *"Never ask what the description or the narration already says; turn it into an input with that default instead."*
- Before asking, have the design agent quote the line of the form or transcript that leaves the question open. If it can't, it doesn't ask.
- Build the column question from what the recording shows (which cell got which value).

### Issue 4 (P0): drill answers were never applied
Every `ask_user` result carries `not_applied`:
```
steps.0.inputs.number: Invalid input: expected object, received number
steps.0.inputs.skip_existing: Invalid input: expected object, received boolean
steps.0.inputs.name_column: Invalid input: expected object, received string  (…and 3 more)
```
**Why:**
- The first-draft questions point at **new trigger inputs** (`steps.0.inputs.<name>`).
- `applyAnswer` (`packages/recorder/src/drill.ts` L47–) writes the raw answer there.
- An input must be a typed object (`{ type, default, … }`), so the skill no longer parses and the answer is dropped.
- The agent sees `not_applied` and moves on.
- The user is asked, answers, and gets nothing for it. This breaks the design rule that "nothing is asked twice".

**Fix ideas (Record):** when `appliesTo` names an input that doesn't exist yet, create it as `{ type: <inferred from the answer>, default: <answer> }`. Also surface `not_applied` to the agent as an error it must deal with before `finish`.

### Issue 5 (P1): the Drive detour can't be skipped, though the sheet's URL was recorded
The recording has the sheet's exact address (`docs.google.com/spreadsheets/d/<sheet-id>/edit…`, events 22–26). A person would expect "open the sheet" to be one step, not Drive → Recent → click a grid cell → click a link.

**Why it can't be done today:**
- The first draft kept those as **clicks** (`s8` navigate to Drive, `s9`–`s11` clicks). The link rule from commit `81248c5` only turns a click into "open this address" when it's a link to its own address. Here the click was on a Drive grid cell, which opened the sheet in a new tab.
- The design agent may add a `navigate` only to a site a recorded **navigate step** already opened (`designViolations`, `sites` from `visited`). `docs.google.com` was never a navigate step, only a page a click led to.
- A recorded step "keeps its kind of action", so `s11` can't become a navigate.

**Fix ideas (Record):**
- In `normalise`, when a click is followed within ~2 s by a navigation to a new, stable URL (a doc, a sheet, a record page), record the step as **open that URL**, keeping the click as a fallback.
- Count **every URL the recording navigated to**, from the trace and not just the navigate steps, as a visited site for the design rules (and the repair rules, issue 8).
- Teach the design agent the pattern: "a chain of clicks that only finds a document → open the document".

### Issue 6 (P2): the recording carries a lot of noise
- **14 identical `navigate` events** to the Numeral page in 20 s (trace 38–51), from switching between tabs. The draft kept five of them (`s20`–`s24`).
- **Clicks on whole sections** ("Software Engineer jobs added recentlyDesign & UI/UXProductRecruiting…", "Home›Companies›NumeralNumeral…"): targets that are page containers, matched only by `div:nth-of-type` fallbacks, so they will fail or hit the wrong thing at replay. `s31`, the step the run failed on, is one of these.
- **Double clicks recorded as two clicks** (`s2`/`s3`, `s5`/`s7`) and a "Click the link" on a link with no name (`s11`).
- Sheet cells were reached through the **Name Box** combobox (`A2`, `C2`) and the internal editor (`#waffle-rich-text-editor`).

**Fix ideas (Record):**
- Collapse repeated navigations to the same URL with no action in between, and drop navigations caused by switching tabs (use the transition plus `tabs.onActivated`).
- Drop clicks on non-interactive containers that change nothing (no navigation, no focus change, no DOM change).
- Merge double clicks.

### Issue 7 (P0): the workflow has none of the structure the narration asked for
Even without issue 1, the first draft replayed literally:
- **No loop:** one company, not "the top 5".
- **No dedupe:** nothing reads the sheet to skip companies already in it.
- **No filter:** "remote, new grad" isn't checked.
- **A fixed date:** "14 Oct" is literal text (should be the run date).
- **Fixed cells:** values go to `A2` and `C2`, so every day would **overwrite row 2** instead of adding a row.
- **No approval** on writing to the sheet. That's allowed today: typing isn't counted as "outward", so `requires_approval` stays false.

The design agent has tools for most of this: `web.extract` the job list, an `llm` step to pick the top N new remote/new-grad jobs against the sheet's existing names, `wrap_in_loop`, and an input for the date. It used **none** of them, spending its 8 turns on questions and the failed edit. Parts are also **missing from the product**:
- "Append a row to a sheet" has no action (already listed as missing: *Sheet writes and clipboard steps*, `docs/questions.md` §P).
- Reading what's already in the sheet needs a read of a page the recording only typed into.

**Fix ideas:**
- **Record:** a worked example in the design prompt that matches this shape exactly (extract list → llm picks N new → loop → write row).
- **Record:** a check that refuses `finish` while a literal date or a recorded example value is still typed somewhere.
- **Joint:** a `sheet.append_row` (or "type into the next empty row") action.
- **Joint:** treat writing to another site's document as needing approval until the user turns it off.

### Issue 8 (P1): the repair agent couldn't open the site the workflow is for
**What happened** (`runs/yc-to-sheets-…-f427.repair-1.json`):
- The repair agent read the failure, called `navigate("https://www.ycombinator.com/companies")`, and was refused: *"www.ycombinator.com is not a site this workflow uses (none)"*.
- It looked at the screen: a blank, black window.
- It resolved as *environment: "The user needs to navigate to https://www.ycombinator.com/companies before running the workflow."*

**Why:** `repairGuard` (`packages/player/src/repair/tools.ts` L291–299) builds the allowed sites from the **navigate steps of the version that failed**. After issue 1, that version has none. YC is in the recording, the narration and the step intents, but not in any navigate step.

**Fix ideas (Replay):**
- Allowed sites = navigate steps of **every version** of the workflow, plus the recording's visited URLs (from v1 or the trace), plus the host of every page a step's check expects.
- Also allow repair to **insert a `navigate` before the first step** when the run starts on a blank page and the target site is known. This is a safe, read-only fix.

### Issue 9 (P1): a run starts on a blank automation window, and nothing checks the first page
Replay runs in a separate Chrome window that starts empty. The saved workflow starts with a click (`s31`), so it can't succeed. Nothing at save time or go-live time says *"this workflow never opens a page"*.

**Fix idea (Replay):** a `check.ts` rule: a workflow whose first web step isn't a `navigate` (and has no "start on page" setting) is not runnable. Show it on the workflow page and refuse to go live.

### Issue 10 (P2): the agents' transcripts are too thin to debug
- **`thought` is empty** in every turn (both agents). Nemotron's reasoning isn't kept, so *why* it removed 30 steps is unknown.
- **The first message isn't saved** in `design.json`, so it can't be confirmed what recording, narration and screen text the agent actually saw (`taskOf`, `recordingView`).
- **A refused tool call's input isn't saved** (turn 6 records only the error), so the intended edit is lost.
- The repair transcript cuts off the failure report; fine for size, but the page outline is useful.

**Fix ideas (Both, `packages/agent`):**
- Keep the reasoning text when the API returns it (`reasoning_content`).
- Save the system and task messages once per episode.
- Save the input on `invalid` and `refused` events.

### Issue 11 (P2): the recording window only shows the agent the first 40 steps
`taskOf` sends `recordingView(session, 1, 40)` and says "… and N more steps". This recording fit, but a 5-company demonstration would be about 150 steps, and the narration about the loop would land beyond step 40. The agent then has to call `read_recording` itself, and it never did here. **Fix idea (Record):** always send every step's notes (said and on screen) in the first message, even when the steps themselves are shortened.

---

## 4. Are the agents too restricted?

**In some places yes; in one important place they're not restricted enough.**

| Rule | Where | Verdict |
|---|---|---|
| New steps may only read (`fs.find`, `fs.read`, `data.pick`, `web.extract`, `web.wait_for`, navigate to a visited site) | design `designViolations` | **Right.** It keeps "never add an action the user didn't show" |
| Targets come only from the recording | design | **Right** for clicks and typing |
| A recorded step keeps its kind of action | design | **Too strict** for click → navigate when the click only opened a document (issue 5) |
| Navigate only to origins of recorded *navigate steps* | design | **Too strict**: should be every URL the recording visited (issue 5) |
| ≤ 30 operations per `edit` | design | **Too strict and dangerous**: it caused the truncation in issue 1 |
| Removing recorded steps | design | **Not restricted at all**: the cause of issue 1 |
| `finish` summary is free text | design | **Not checked**: claimed edits that never happened |
| Navigate only to hosts of the failing version's navigate steps | repair `repairGuard` | **Too strict** after a bad design (issue 8) |
| Outward clicks (send, submit, pay, delete) need approval; repair can't add them | both | **Right** |
| Typing into another site's document counts as not outward | `isOutward` | **Too loose** for "write to my sheet" (issue 7) |

The model also under-used what it *was* allowed to do. It had loops, llm steps, `web.extract`, inputs and 16 turns, and built nothing. Before switching the design agent to a cheaper model, fix the rules above and try this recording again: in its current state, the code limits the result more than the model does.

---

## 5. Suggested order of work

| # | Fix | Issue | Owner | Effort |
|---|---|---|---|---|
| 1 | Refuse removing recorded steps that write; cap removals; ask beyond | 1 | Record | Hours |
| 2 | Answers create missing inputs; `not_applied` blocks `finish` | 4 | Record | Hours |
| 3 | Don't ask what the form or narration says (prompt plus code check) | 3 | Record | Hours |
| 4 | Visited sites = every URL in the recording (design and repair) | 5, 8 | Both | Hours |
| 5 | "Not runnable: never opens a page" check; repair may add a first navigate | 9, 8 | Replay | Half a day |
| 6 | Click that opened a document → "open URL" in `normalise` | 5 | Record | Half a day |
| 7 | Noise: collapse tab-switch navigations, container clicks, double clicks | 6 | Record | Half a day |
| 8 | Raise the edit cap or add `replace_range`; history summary from edits | 1 | Record | Hours |
| 9 | Keep reasoning, task message, and refused inputs in transcripts | 10 | Both | Hours |
| 10 | Every step's notes in the first message | 11 | Record | Hours |
| 11 | `sheet.append_row`, approval for writes to another site's document, worked example in the prompt | 7 | Joint | 1–2 days |

Then record this task again (the same form, two companies shown) and compare `design.json`.

---

## 6. Where the evidence is

All on the Mac that recorded it, under `~/Library/Application Support/Shadow/`. The recording folder is deleted 24 h after saving, so copy it out first if it's needed after Oct 15, 11:45.

| What | Path |
|---|---|
| Form, events, narration, screen text, pictures | `recordings/2d06fd5f-12f8-4c29-9579-b80de04a9c01/` (`description.json`, `trace.jsonl`, `transcript.jsonl`, `screen.jsonl`, `shots/`) |
| The design agent's transcript | `recordings/2d06fd5f-…/design.json` |
| The saved workflow | `skills/yc-to-sheets-cj18ni/v1.json` |
| The run and the repair | `runs/yc-to-sheets-cj18ni-2026-10-14T06-16-56-501Z-f427.jsonl`, `….repair-1.json` |
| Drill questions and answers | `shadow.db`, table `inbox` |

Code referred to: `packages/recorder/src/design/design.ts` (`ROLE`, `taskOf`), `packages/recorder/src/design/tools.ts` (`designViolations`, `recordingView`, the `edit` tool), `packages/recorder/src/drill.ts` (`applyAnswer`), `packages/recorder/src/compile.ts` (question filter, compile prompt), `packages/player/src/repair/tools.ts` (`repairGuard`), `packages/core/src/guard.ts` (`isOutward`).
