# Second real recording: "Top YC job to a sheet" (Oct 15, 2026)

**The run failed at step 3 of 30, but the workflow was wrong before it ran.** This was the second recording of the YC-to-sheet task, made on `fix/record-refactoring` (`34c73ed`). That branch already fixed most of what [the first report](first-real-recording-yc-to-sheets.md) found: the narration reaches the agent in full, the agent can't delete what was shown, answers can create inputs, `design.json` keeps the prompt, and the prompt describes the "read a list → pick → loop" pattern.

It still failed at every layer:
- **Recording.** Clicks made only to select text for copying were stored as clicks on big page containers. The top job's link had no name, so it became a fixed URL. Clicks on sheet cells (a canvas) have no target. Switching tabs isn't recorded.
- **Design.** The agent took 3 turns: labelled the steps, asked one question whose answer was never used, and finished with a summary describing changes it never made (`edits: []`).
- **Replay.** Step `s3` targeted one of those containers by text alone, and wasn't found.
- **Repair.** It chose a reasonable fix, but each of its three tries hung for 35–50 s ("extension did not answer"), and it ran out of turns. A headless reproduction shows the fix would have failed anyway: the page has two links named "Eventual".

Identifiers from the recording (the sheet id, the Google account id) are masked as `<sheet-id>` and `<ouid>`.

---

## 1. What was tried

### The task
Every day, take the **top job** on YC's job board and add it as a new row in the Google Sheet "Ycomb jobs". The row holds **date, company, compensation, role**. If the top job is already in the sheet (it was added the day before), take **the next one** instead.

### The description form

| Field | Value |
|---|---|
| Goal | "I wanna take top jobs from ycombinator and add it in my google sheet in my drive" |
| What changes / stays the same / Never | (empty) |
| Frequency | Only when I start it (manual) |
| Consent | Screenshots ✅ · Microphone ✅ · Pictures ✅ |

### What was shown
1. Opened `ycombinator.com/jobs`, clicked the top job (**Eventual**), opened its company page, and copied its name.
2. Opened Drive → Recent → the sheet "Ycomb jobs", and saw Numeral already added the day before.
3. Went back to YC and took the **second** job, **Noloco**: copied its name and pasted it into `B3`.
4. Opened Noloco's Jobs tab, copied the compensation **"€75 - €95 EUR"** into `C3`, and the role **"Senior Software Engineer"** into `D3`.
5. Typed the date **"15 Oct"** into `A3`.

### The narration (15 pieces, summarised)
> "…here I see like a top job… I'll click on it and then I'll copy its name… I'll go to my drive… the sheet is this… I've already added a numerals job yesterday, what I'll do is, I'll add 2nd job instead… I'll add [Noloco] below numeral… copy the package… paste it here… the job role… I'll just add date as well. So it's 15 October… usually I have to add one job here daily, but… sometimes… this did not change… then I can just go for a job below it… I do need to do it every day."

The rule is stated in full: **one job a day, the top one, unless it's already in the sheet, then the next**, with today's date.

### Timeline (local time)

| Time | What |
|---|---|
| 11:08:06 – 11:09:54 | Recording (56 events, 25 screenshots, narration) |
| ~11:10:20 – 11:18:02 | The design agent's one question waits in the inbox (462 s) |
| 11:18:03 | Saved as `ycombinator-to-sheet` v1 (30 steps) |
| 11:19:27 | Run started by hand |
| 11:19:40 | `s3` failed: target not found |
| 11:19:40 – 11:22:46 | The repair agent: 12 turns, 3 tries that each hung for 35–50 s; escalated "ran out of turns" |

Cost: design $0.017 (3 calls, 44k tokens in); repair $0.043.

---

## 2. What worked

- **Capture and narration.** Every event, screenshot and spoken piece was kept, and the narration is accurate.
- **The narration reached the design agent**, all 15 pieces, each marked with the steps it was said over (`design.json` → `prompt.task`, "What they said while doing it").
- **The prompt is right.** It says, nearly word for word, what this task needs: a typed date is usually `{{today}}`; "the top N" and "skip the ones already in my sheet" are rules; the shape is extract a list → llm step picks → loop.
- **Copies became extracts.** The name, salary and role became `web.extract` steps with outputs, and the pastes became `{{…}}` references (`s15`, `s21`, `s26`).
- **The repair agent read the page well** (`find`, `inspect`, `page_outline` all answered in milliseconds) and found a sensible target.

---

## 3. Issues

Severity: **P0** breaks the workflow · **P1** wrong or misleading · **P2** quality and debugging.

### Recording

#### R1 (P0): clicks made only to select text are stored as clicks on page containers
To copy "Eventual", "Noloco" and the salary, you clicked into the text first. Each such click was recorded on whatever element was under the pointer, often a whole section:

| Event | Step | Target |
|---|---|---|
| 7 | `s3` | text `"EventualBuilding the AI data engine for any modality and scaleY Combinator LogoW"` (no role, no name, no fallback) |
| 9 | `s5` | text `"Eventual"` |
| 31 | `s12` | text `"Noloco"` |
| 38 | `s17` | text `"Home›Companies›NolocoNolocoFlexible Business Apps…"` |
| 47 | `s23` | text `"NolocoFlexible Business Apps for Modern TeamsCompanyJobs1…"` |

**`s3` is the step the run failed on.** These clicks do nothing on their own: the copy that follows is the real action, and it already became an extract.
**Fix:** in `normalise`, fold a click that is followed by a `copy` within a few seconds (with no navigation, focus or input change in between) into that copy's extract. Also drop clicks on non-interactive containers that change nothing.

#### R2 (P0): the top job's link had no name, so it became a fixed URL
Event 3 is `click link:''` on the jobs list, followed by a new tab at `/companies/eventual`. The link-to-address rule turned it into `s2: navigate https://www.ycombinator.com/companies/eventual`. The second job's link *did* have a name (`Noloco (S21)•Flexible Business Apps…`, event 27), but it was also turned into a fixed `navigate` (`s11`).
**Effect:** "the top job" became "Eventual, forever", and nothing reads the jobs list.
**Fix:** keep where a clicked link sits, not only its address: "item 1 of the list under 'Software Engineer jobs added recently'", plus the href. Also take the name from the link's visible text or children when it has no accessible name. The design agent then has what it needs to write "extract the list → pick".

#### R3 (P0): clicks on sheet cells have no target; nothing selects the row
The Google Sheets grid is drawn on a canvas, so clicks on cells are recorded as `click :''` (events 25, 33) and dropped. The cell is known only afterwards, from the cell editor's `aria-label` (`B3`, `C3`, `D3`, `A3`), which ends up in the type steps' targets.
**Effect:** replay types into whichever cell happens to be selected. `B3` in a target describes the cell; it doesn't select it.
**Fix (joint, with replay):**
- record the cell address from the editor's label as a "go to cell" step (the sheet's Name Box accepts `B3` + Enter);
- better, give sheets a real write action ("append a row with these values"), with `web.extract { source: "google_sheet" }` (which exists) for reading what's already there.

#### R4 (P0): switching tabs isn't recorded; replay uses one tab
The recording used three tabs: the YC jobs list, a company page, and the sheet. Tab activations aren't events, so the trace jumps between sites, and the workflow is a single sequence for a **single** automation tab:

```
s9–s10  open the sheet
s11–s13 open Noloco (the sheet is gone from the tab)
s14–s16 type into the sheet   ← no sheet on the page
```

Even with every target fixed, the run couldn't type into the sheet.
**Fix:**
- record `tab_activated` (the extension can listen to `chrome.tabs.onActivated`);
- in the workflow, either say which tab a step runs in (`tab: "sheet"`, opened once and switched to) or reorder steps so each site's work is together: collect from YC first, then write to the sheet. The second is simpler and fits this task.

#### R5 (P1): a Drive detour and duplicate events
Opening the sheet took 4 steps (`s7` Recent, `s8` an icon, `s9` a grid cell, `s10` a link with no name, `html > body > a`), although its URL is in the trace (events 20–24, five navigations to the same sheet).
**Fix:** your branch's `6d36349` ("any recorded step that opened a page may become 'open this page'") allows replacing them, but the agent didn't. Code could do it itself: when a chain of clicks ends on a document URL, propose one `navigate` to it.

#### R6 (P1): the date was typed literally
`s29` types `"15 Oct"`, though the narration says "So it's 15 October" (the day of recording).

### Design agent

#### D1 (P0): three turns, no structure, and a summary of changes that weren't made
`design.json`:
1. `label_steps`: intents, checks and `save_as` for all 30 steps. Values stayed literal (the date, the two company URLs).
2. `ask_user`: *"What is the URL of the Google Sheet where you want to add the YC jobs?"*
3. `finish`: *"Made the date dynamic using {{today}}, added a sheet URL input, replaced the hard‑coded sheet open with a variable URL, and added a branch that skips the first YC job if it matches the last company already in the sheet…"*

None of that was done: `edits: []`. The saved history repeats the claim. **This is the same failure as in the first report**, now without any deletions to make it visible.

**Why code allowed it:**
- `finish` is still not compared with what changed.
- For a manual workflow, `checks` is empty, so `finish` is never refused.
- `label_steps`' changes aren't recorded in `edits` either, so even the audit trail reads "nothing changed".

**Fix:**
- write the history note from the changes (counting `label_steps`), keeping the model's sentence only as a comment;
- **gate `finish`**: refuse while the narration or form states a rule ("every day", "the top", "already in my sheet", a typed date) that the workflow doesn't implement (no input, loop, branch or llm step, or a literal date), and say which one.

#### D2 (P1): it asked for a value the recording has, then didn't use the answer
The sheet's URL is in the trace (events 20–24). The question blocked the whole save for **7.7 minutes**, and the answer (the URL) wasn't applied: no input, no `navigate` change.
**Fix:**
- before asking, search the trace for URLs, file names and values the question is about;
- `ask_user` for the agent's own question returns the answer, but nothing makes the agent apply it: treat an unapplied answer like `not_applied`, blocking `finish`;
- give questions a timeout that falls back to the default.

#### D3 (P1): invented checks
`label_steps` added checks the page can't satisfy:
- workflow `success: [{ text_visible: "Job entry added to sheet" }]`: that text never appears, so **a perfect run would still end failed**;
- `text_visible: ""` on the five `press` steps;
- `text_visible: "{{salary}}"` etc. after typing into the sheet: the cells are drawn on a canvas, so their text isn't in the page.

**Fix:**
- only accept a `text_visible` check whose text appeared on screen in the recording (`screen.jsonl`) or is a reference;
- refuse empty strings;
- for canvas apps, don't add text checks.

#### D4 (P2): an extract that's never used
`s4` extracts `company_name` ("Eventual") and nothing reads it; it only exists because the first job was looked at and skipped. With a "skip if already in the sheet" branch it would have a use; without one it's a dead step that can fail.

#### D5 (P1): pictures were available, and neither agent looked at one
Pictures consent was on (the form and `config.json`: `pictures: true`), and both agents had a picture tool:
- design: `describe_step_screenshot`, always in its tools; it describes a recorded step's already-masked `shots/<event>.jpg` with GLM-5.3-Flash;
- repair: `describe_screen`, added because Pictures was on and a model was set.

Neither was called. Design called `label_steps → ask_user → finish`; repair called only `find, inspect, page_outline, click_safe, retarget, edit, try_steps`.

**Why:**
- **The design tool's description discourages it**: *"only when the words near the step don't say what the control was for"*. The masked screen words were already in its first message, so it treated pictures as unnecessary.
- **The design prompt says to look before asking** ("use it before asking"). The agent asked for the sheet URL without looking.
- **The repair ROLE never mentions pictures** ("look at the page, probe it…"). Its page tools (`find`, `inspect`, `page_outline`) give structured data, which suits picking a target better. Pictures wouldn't have saved this repair: the tries hung (X1).

**Where pictures would have helped design**: exactly the steps the recording can't name.
- The nameless click on the top job (R2, event 3): a picture shows a list of job cards with the first one clicked. That's the evidence for "take the top job" instead of a fixed URL.
- The clicks on the sheet grid (R3, events 25 and 33, a canvas): a picture shows the existing rows, with Numeral already in row 2. That's the evidence for "skip it if it's already in the sheet" and "add below the last row".

**Fix: code describes them, not the model.**
1. During design, before the agent's first turn, describe the screenshot of every recorded step whose target has **no name and no role** (nameless links, canvas clicks, drawn areas), when Pictures is on.
2. Put each description in the first message next to its step (`seen: …`), like the narration.
3. Keep `describe_step_screenshot` for anything else, but drop the "only when…" wording.

This recording had about 5 such steps, at roughly $0.0005 each on GLM-5.3-Flash, so well under a cent per recording. It also takes the decision away from a model that, on both runs so far, skipped evidence it needed. Meter these calls on the design budget (today vision calls aren't metered: `docs/agents/README.md` §3.4).

### Replay

#### P1 (P0): `s3`'s target can't be found
`s3`'s locator is `{ text: "EventualBuilding the AI data engine…Y Combinator LogoW", fallbacks: [] }`. Matching by a container's whole text, with no role, name or selector, failed after 10 s: `target not found`. This is R1's step.

#### P2 (P1): the obvious fix is ambiguous
Reproduced headless on the live page (the script is in the appendix):
```
match { role: "link", name: "Eventual" }       → ambiguous (two links score 1.0: the logo and the title)
wait_for element_visible link "Eventual"      → precondition did not hold (5 s)
click link "Eventual"                         → ambiguous target (10 s)
```
**Fix:** break ties by `near` (the heading or section the element sits in) and by the recorded `href`, which differs between the two links.

### Repair

#### X1 (P0): every try hung, and took the episode with it
The repair agent's plan was sensible: `find`, `inspect`, retarget `s3` to `link "Eventual"`, add a wait, try. Every `try_steps` came back:
```
s3: extension did not answer run.step within 50000 ms         (turn 4)
s2_wait: extension did not answer run.step within 35000 ms    (turn 6)
s3: extension did not answer run.step within 50000 ms         (turn 10)
```
That's 135 s of 186 s and 3 of 12 turns, before it ran out of turns at turn 12.

**What's known:**
- Every hung step had a `role` in its target, which makes the matcher call Chrome's Accessibility API (`Accessibility.queryAXTree`, `match.ts`). The original `s3` had no role, so it skipped that call and failed normally in 10 s.
- The same Accessibility call worked in an earlier run (`app-list`, Oct 13: `role: link` "View Arilo" → `target not found` in 10 s), and **headless it answers in under half a second** before and after the repair's page operations. So it hangs only in some states of the real browser.
- The likeliest cause is that the automation window is behind other windows during the repair: you were in the inbox, and `cdpFor` brings the window forward only at the run's first attach.
- `cdp.send` has **no timeout**, so a stuck Accessibility call holds the step until the daemon gives up (50 s).

**Fix:**
- a timeout (a few seconds) on every DevTools call in the matcher and executor, returning an error the repair agent can read;
- bring the automation window forward before each `run.step` / `try_steps`, not only at attach;
- to confirm the cause: run a repair with the automation window visible.

#### X2 (P1): repair can't fix a wrong workflow, and doesn't say so quickly
Even with R1–R4 unfixed, the agent kept trying to make `s3` click something. A step that only selects text, a fixed company URL and single-tab sheet typing aren't drift: the workflow is wrong. Repair should recognise "the recorded step does nothing useful" and say *"this workflow needs re-recording or editing"* instead of spending its budget.

---

## 4. Order of work (record path first)

| # | Fix | Issues | Where | Effort |
|---|---|---|---|---|
| 1 | Fold selection clicks into the copy's extract; drop container clicks that change nothing | R1, P1 | `packages/recorder/src/normalise.ts` | Half a day |
| 2 | Gate `finish`: changes must match the summary; stated rules must be built; literal dates refused | D1, R6 | `design/tools.ts`, `design/design.ts` | Half a day |
| 3 | Checks only from text that appeared in the recording, never `""`, none on canvas apps | D3 | `design/tools.ts` (`label_steps`) | Hours |
| 4 | Keep a nameless link's list position, href and visible text | R2 | extension `capture.ts`, `normalise.ts` | Half a day |
| 5 | Tabs: record activations; group each site's steps (collect, then write) or a `tab` field in replay | R4 | extension, normalise, player | 1–2 days |
| 6 | Sheets: "go to cell" from the editor's label, or an "append row" action; read rows with `web.extract { source: google_sheet }` | R3 | extension, player, core | 1–2 days |
| 7 | Don't ask what the trace has; an unanswered own question blocks `finish`; a timeout on questions | D2 | `design/tools.ts`, `service.ts` | Hours |
| 8 | Click-chain to a document → one `navigate` | R5 | normalise or design | Hours |
| 9 | DevTools timeouts; window forward before every step | X1 | `packages/player/src/web/`, extension `replay.ts` | Hours |
| 10 | Tie-break by `near` and `href` | P2 | `match.ts` | Hours |
| 11 | Describe the screenshots of nameless and canvas steps automatically, into the first message; meter them | D5, R2, R3 | `apps/daemon/src/record.ts`, `design/design.ts` (`taskOf`) | Hours |

Then record the task again (the same narration), and compare `design.json` and the first run.

---

## 5. Where the evidence is

Under `~/Library/Application Support/Shadow/`. The recording folder is deleted 24 h after saving (Oct 16, 11:18).

| What | Path |
|---|---|
| Form, events, narration, screen words, pictures | `recordings/54d67ca0-7fcc-47d1-9b32-a3eef85aaefe/` |
| The design agent's prompt and transcript | `recordings/54d67ca0-…/design.json` |
| The saved workflow | `skills/ycombinator-to-sheet/v1.json` |
| The run and the repair | `runs/ycombinator-to-sheet-2026-10-15T05-49-27-603Z-8b54.jsonl`, `….repair-1.json` |
| The headless reproduction | the appendix below |

---

## Appendix: the headless reproduction

Run with `pnpm exec tsx repro.mts` from the repository root (it opens a headless Chrome with its own profile, through `packages/player/src/node/chrome.ts`, the same `Cdp` interface the extension uses):

```ts
import { launchChrome } from "./packages/player/src/node/chrome.ts";
import { executeWebStep, match, pageOp } from "./packages/player/src/web/index.ts";

const timed = async (label: string, work: Promise<unknown>, ms = 20_000) => {
  const t0 = Date.now();
  const r = await Promise.race([work.then((v) => ({ v })), new Promise((res) => setTimeout(() => res(null), ms))]);
  console.log(label, r ? "answered" : "HUNG", Date.now() - t0, "ms", r ? JSON.stringify((r as { v: unknown }).v).slice(0, 120) : "");
};
const chrome = await launchChrome({ profileDir: "/tmp/shadow-repro-profile", headless: true });
const target = { role: "link", name: "Eventual", fallbacks: [] };
const step = (id: string, extra: object) =>
  ({ id, type: "action", intent: id, requires_approval: false, channel: "web", args: {}, ...extra }) as never;
await timed("navigate", executeWebStep(chrome.cdp, step("n", { action: "navigate", args: { url: "https://www.ycombinator.com/companies/eventual" } })), 40_000);
await timed("match before page ops", match(chrome.cdp, target));
await timed("outline", pageOp(chrome.cdp, { op: "outline", max: 120 }));
await timed("find", pageOp(chrome.cdp, { op: "find", text: "Eventual", role: "heading" }));
await timed("inspect e6", pageOp(chrome.cdp, { op: "inspect", ref: "e6" }));
await timed("match after page ops", match(chrome.cdp, target));
await timed("wait_for", executeWebStep(chrome.cdp, step("w", { action: "wait_for", wait: { element_visible: target }, timeout_ms: 5000 })));
await timed("click", executeWebStep(chrome.cdp, step("c", { action: "click", target, timeout_ms: 10_000 })), 40_000);
await chrome.close();
```

Result on Oct 15 (headless): navigate 857 ms; both matches answered in under half a second with `ambiguous` (two links score 1.0); the page ops 1–3 ms; `wait_for` → *precondition did not hold* after 5 s; `click` → *ambiguous target* after 10 s. Nothing hung.
