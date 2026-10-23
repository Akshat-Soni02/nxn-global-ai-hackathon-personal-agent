# What's fixed in record → workflow, in plain words

**For:** Akshat (and anyone who wasn't in the Record v2 work).
**What it covers:** the part of Shadow that turns a recording into a saved workflow. Replay and repair appear only where
record needed them.
**Numbering:** the same as [`section-study.md`](section-study.md), which listed what was broken on Oct 18:
- the 5 fundamental issues (§0);
- Record R1–R10;
- the design agent D1–D7.

The design-agent tables also give the matching section of
[`test-plan-record-replay.md`](test-plan-record-replay.md), which numbers its design-agent checks D1–D10.
**The detailed version, with commits:** [`record-v2-changes.md`](record-v2-changes.md). **How each piece works now:**
[`section-study-record-v2.md`](section-study-record-v2.md).

## The short version

- **Recording (capture) is largely fixed,** and it was seen working in real Chrome recordings.
- **Code now does the first understanding:**
  - noise is listed, not hidden;
  - one timeline of what you did and said;
  - ready-made proposals ("type today's date", "item 1 of the list").
- **The design agent was rebuilt.** It now writes down what the task is before changing anything, it has tools that
  forgive mistakes, and code (not the model) decides when it's done.
- **The design agent was first tried on 4 hand-written test recordings** (Oct 20): the timesheet one passed every
  check; Play Store missed one (how often it runs); KPI and YC missed several (F1–F5).
- **On Oct 23 it ran on 5 real recordings** (public sites, recorded by Claude, no voice; checkpoint 4). The safe test
  run ran live and found real faults, **but none of the five saved workflows did its task when run** (F17–F34).

## How to read the tables

**The stages a recording goes through**, numbered as in [diagram 16](../docs/guide/16-record-to-workflow.png):
- ① **Describe:** you type the goal.
- ② **Capture:** what you do is recorded.
- ③ **Stop:** the pictures are processed, and your voice becomes text.
- ④ **Normalise:** events become steps; the noise is listed.
- ⑤ **First draft:** the *plain list*, one step per real action, exactly as you did it.
- ⑥ **Evidence:** `evidence.json`, everything code understood.
- ⑦ **Design agent:** understand → build → safe test run → questions → finish gate.
- ⑧ **Save.**
- ⑨ **Your review.**

**Status:**
- **Done (live):** seen working in a real recording or a real-model run.
- **Done (tests):** built and passing automated tests, but not yet seen in a real recording.
- **Partly:** some of the problem is left.
- **Open:** not done.
- **Removed:** the old piece is gone.

**How we know:**
- **live capture:** checkpoint 1. Short recordings made by Claude in a real Chrome, on public sites and a test sheet
  and Gmail.
- **real evidence:** checkpoint 2. Those recordings turned into `evidence.json`.
- **real model:** checkpoint 3. The design agent on the real model, on the 4 hand-written test recordings.
- **unit tests:** automated tests.
- **not yet.**

---

## §0 · The five fundamental issues

| # | The problem, in one line | Example from the reports | What it does now | Status | How we know |
|---|---|---|---|---|---|
| 1 | A step was remembered by things that don't come back | Selecting a company name stored the whole block's text, `"EventualBuilding the AI data engine…"`, as the click target; Google's per-session ids (`19fml5:17`) were kept | Capture keeps what does come back:<br>- selecting text is its own event;<br>- Google ids are dropped;<br>- each link keeps its address;<br>- a list item keeps its place ("item 1 of 20");<br>- a sheet click keeps its cell (`B3`) | **Partly.** Capture is fixed. Replay can't yet *use* list place or text to find a step (Akshat, F8) | live capture |
| 2 | Turning "what I did" into "what I meant" was left to one model | Typed "15 Oct" stayed "15 Oct"; "the top job" stayed one fixed address | Code finds the patterns first and prepares the change (proposals). The agent writes a **task model** (what the task is) and then accepts or rejects the proposals | **Partly.** On the real model, timesheet passed every check; Play Store missed how often it runs (F1); KPI built no loop and YC lost half its calls (F2, F3) | real model |
| 3 | Nothing checked that the result does the task | Play Store: the old agent deleted all 20 steps and "finished"; a run that did nothing said "succeeded" | **Finish gate** (code) before saving. **Safe test run** in the automation window. **Review page** with "Looks right" before Go live. An empty run says "nothing to do" | **Done (tests).** The test run has never run live. The gate trusts the model on how often it runs (F1) | unit tests; real model |
| 4 | Replay had no timeouts and only one tab | Chrome calls hung 35–50 s; a 3-tab recording was squashed into one tab | Every Chrome call times out (15 s; 30 s to open a page). A step can name its tab ("KPI Sheet") | Timeouts **Done (tests).** Tabs **Partly**: tabs close while a run waits for your OK (F6, Akshat) | unit tests |
| 5 | You couldn't see what the agent did | No reasoning kept; refused calls lost | `design.json` keeps:<br>- the task model;<br>- every decision and change with its reason;<br>- the test report and the questions;<br>- the model's reasoning;<br>- refused calls | **Done (live),** with one gap: it doesn't keep the agent's first message, stage 1's reasoning, or the plain list (F16) | real model |

---

## Record

### R1 · Web capture (what the extension records in Chrome)

| The problem | Example | Now | Status | How we know |
|---|---|---|---|---|
| Selecting text before a copy became a click on a big block of text | YC: the company name's block | Selecting is its own event; selecting plus copying becomes one "read" step | **Done (live)** | live capture |
| A link with no name | The top YC job card saved as `link:''` | Named from its title, image text, heading or address | **Done (live)** | live capture (YC) |
| Sheet cells had no target | A click in Google Sheets saved only "the editor" | Every click, typing, paste and copy in a sheet keeps its cell, value and sheet tab | **Done (live)** | live capture (test sheet) |
| An old page address in one-page apps | Play Console steps all kept the first address | The address at the moment of each event | **Done (tests)** | unit tests |
| *New:* what a click did | Not recorded | Watched for 0.7 s: went somewhere / opened a menu / emptied a field / nothing | **Done (live)** | live capture (Gmail) |
| *New:* shortcuts | Only Enter and Escape | ⌘/Ctrl/Alt shortcuts and Gmail's single keys (`e`). Fast typing is never kept as keys (not a keylogger) | **Done (live)** | live capture |
| *New:* a page's own Copy button | Lost | Caught | **Done (live)** | live capture (GitHub) |

### R2 · Tab capture

| The problem | Now | Status | How we know |
|---|---|---|---|
| Switching Chrome windows wasn't recorded | Recorded | **Done (tests)** | unit tests |
| A tab opened before Record had no address | Announced when first used; every tab gets a name from its page ("KPI Sheet") | **Done (live)** | live capture |
| Replay reloaded a page on every switch | Steps can name a tab; the automation window keeps one tab per name | **Partly:** Akshat's sign-off; tabs close during approval waits (F6) | unit tests |

### R3 · Mac-app capture (Shadow.app)

| The problem | Now | Status | How we know |
|---|---|---|---|
| Shadow's own permission prompt was recorded as steps | Skipped; Shadow asks for Screen Recording before recording starts | **Done (tests)** | needs `pnpm setup:mac` to see live |
| Mac-app elements with no name (Numbers cells) | Unchanged; picture captions describe them when Pictures is on | **Open** (F11) | not yet |

### R4 · File capture (folder watcher)

| The problem | Now | Status | How we know |
|---|---|---|---|
| Deleting a file wasn't recorded | Finder's Move to Trash becomes a step, with approval | **Done (tests)** | needs `pnpm setup:mac` |

### R5 · Pictures: taking them

| The problem | Now | Status | How we know |
|---|---|---|---|
| Fast clicks lost pictures | A queue of 3; the least useful is dropped when full | **Done (live)** | live capture |
| Lost pictures were silent | `shots.jsonl` says for every event whether its picture was taken and why not; the Record screen warns first | **Done (live)** | live capture |

### R6 · Pictures: reading the words, hiding private ones

| The problem | Now | Status | How we know |
|---|---|---|---|
| Words cut at 2,000 characters | 8,000, each line with its place; "words near the click" picked by place | **Done (live)** | live capture |
| No way to hide names or codes | An optional "Private words" line under the goal | **Done (tests)** | unit tests |
| Not everything the model read was masked | Everything is masked: evidence, captions, every tool result and every message | **Done (tests)** | unit tests |
| *New:* what appeared after a step | The lines new on screen after it ("Message sent"). Only these may become checks | **Done (live)** | live capture |

### R7 · Voice → text

| The problem | Now | Status | How we know |
|---|---|---|---|
| Stop was slow (it waited for the pictures) | Both run at the same time | **Done (tests)** | unit tests |

### R8 · Lining up what you said with the steps

| The problem | Now | Status | How we know |
|---|---|---|---|
| "Said over steps 4–5" used different numbers from the draft | One timeline in the draft's own ids (s1, s2…) | **Done (live)** | real evidence |
| Screen words landed on the wrong step | Matched by event and by when the picture was taken | **Done (live)** | real evidence |

### R9 · Normalise (events → steps)

| The problem | Example | Now | Status | How we know |
|---|---|---|---|---|
| Selection clicks kept as steps | YC; KPI's s5 | Selecting plus copying is one read step | **Done (live)** | real evidence |
| Noise kept, or dropped silently | 14 identical page loads | Removed **and listed** with a reason (x1, x2…); the agent can put one back | **Done (live)** | real evidence |
| Repeats not spotted | 5 copy/paste pairs = 5 groups | Code proposes "repeat these for each" | **Done (tests)**; the agent still has to build the loop (F2) | unit tests |
| The Drive detour kept | KPI opened the sheet through Drive | Code proposes "open the sheet directly" | **Done (tests)** | unit tests |
| No "go to cell" when writing to a sheet | — | Capture now keeps the cell; replay can't write to a cell yet | **Partly** (F9, Akshat) | — |

### R10 · The first draft (code)

| The problem | Example | Now | Status | How we know |
|---|---|---|---|---|
| Steps found only by their text | Container clicks | Far fewer; any left is marked "weak target" for the agent | **Partly** | real evidence |
| Google's per-session ids stored | `19fml5:17` | Dropped | **Done (live)** | live capture |
| "The top job" lost its place | Fixed address `/companies/eventual` | Place recorded; code proposes "item 1 of the list" | **Partly:** replay can't use the place yet (F8) | real evidence |
| Typed dates stayed as typed | "15 Oct" | Code proposes `{{today\|D MMM}}` | **Done (live)** | real model (KPI, Play Store) |
| An Enter that sends a chat message needed no OK | Play Store's Chat message | Needs your OK, also when the agent adds it | **Done (tests)** | unit tests |
| A recording could be saved as a new version of another workflow | — | The daemon's id always wins | **Done (tests)** | unit tests |

---

## The design agent

**The old agent is gone.** Design agent v2 runs after Stop, in stages, on one budget ($0.25 and 40 model calls):
1. **understand:** writes the task model;
2. **build:** with tools;
3. **safe test run;**
4. **one batch of questions;**
5. **put your answers in;**
6. **finish gate.**

### D1 · What it's given (test plan D1, D10)

| The problem | Now | Status | How we know |
|---|---|---|---|
| It saw only the first 40 steps | `evidence.json` holds every step, under 24k tokens | **Done (live)** | real model |
| The whole recording was re-sent every turn | Sent once, at "understand"; later turns get the task model and a short outline | **Done (live):** usually $0.012–$0.037 a design (was about $0.085); YC's $0.124 was the run that used all 40 calls (F3) | real model |
| No worked example | One (KPI) in a much shorter prompt | **Partly:** the real KPI run didn't follow it | real model |
| Page and email text could act like instructions | Wrapped as "untrusted data"; any sending step still needs your OK | **Done (tests)** | unit tests |

### D2 · `label_steps`, the old first move (test plan D2)

| The problem | Now | Status | How we know |
|---|---|---|---|
| It had to label every step before understanding the task | **Removed.** Code names the steps; the agent writes the task model first | **Removed** | — |
| Invented checks ("Job entry added to sheet") | The gate refuses checks for text that never appeared, empty checks, checks on drawn pages, and hidden values | **Done (tests)** | unit tests |
| Values left as recorded | The task model says where each value comes from next time; proposals prepare the change | **Partly:** KPI kept the email subject as a typed value | real model |

### D3 · The tools (test plan D3)

| The problem | Now | Status | How we know |
|---|---|---|---|
| A question with its own `id` was lost (all 3 KPI questions) | `ask` takes only the question | **Done (live)** | real model |
| Changes sent as text; steps missing their type | Read anyway; a step is written by what it does | **Done (live)** | real model |
| An empty loop | `loop` needs the steps | **Done (tests)** | unit tests |
| The picture tool was never used | Removed: code captions every picture first | **Done (live)** | real evidence |
| *New:* YC, 20 of 40 calls refused for small syntax slips | — | **Open** (F3) | real model |

### D4 · The rules (test plan D8)

| The problem | Now | Status | How we know |
|---|---|---|---|
| The work could be removed (Play Store: all 20 steps) | The gate wants every write you showed kept, repeated, or removed with a reason, never all of them | **Done (tests)** | unit tests |
| "Never add a click" made fixing impossible | Removed. Only harmful things are refused (turning an approval off, sites you didn't visit, folders you didn't touch) | **Removed** | — |
| *New:* a spoken "never do X" isn't enforced | Only quoted as a rule (F15) | **Open** | code read |

### D5 · Questions (test plan D7)

| The problem | Now | Status | How we know |
|---|---|---|---|
| Asking what the recording already answered | Code answers "which file / which row" from what you said | **Partly:** the file answer can be wrong (F13); the agent still re-asks (F4) | real model |
| Asked one by one, every recording's questions shown | One batch on the Record screen, next to each step; Enter sends; "You decide" takes the default; at most 5 | **Done (tests)** | unit tests |
| A question can wait for ever | Unchanged | **Open** (F12) | — |

### D6 · Finishing honestly, and the review (test plan D4, D6, D9)

| The problem | Now | Status | How we know |
|---|---|---|---|
| "Finished" with a workflow that no longer does the task | The finish gate wants:<br>- your work kept;<br>- every rule you said built or explained;<br>- real checks;<br>- test failures explained;<br>- defaults for unattended runs;<br>- the frequency you said.<br>Refused twice at most, then saved with the gaps listed | **Done (tests)** | unit tests |
| Rules you said, never built | Each rule needs steps or a reason | **Partly:** KPI's "newest" was claimed built by one fixed click (F2) | real model |
| Nothing tried the workflow | Safe test run: opens pages and reads; only points at buttons, typing and sending | **Done (tests):** never run live | unit tests |
| Summaries described changes never made | A review page built by code from the real changes; Go live waits for "Looks right" | **Done (tests)** | unit tests |
| "Every day" → a schedule | Regressed: the model wrote "manual" while quoting "every day" | **Open** (F1) | real model |

### D7 · Budget and record-keeping (test plan D5, D10)

| The problem | Now | Status | How we know |
|---|---|---|---|
| No reasoning kept | Kept for every build turn | **Done (live)** | real model |
| Refused calls lost | Kept | **Done (live)** | real model |
| Picture reading not counted | Counted and cached; on the design's budget | **Done (tests)** | unit tests |
| Close to the $0.10 limit | $0.25 and 40 calls on one meter | **Partly:** YC still hit the 40-call cap (F3) | real model |

---

## What's still broken (F1–F34)

**Seen on the real model** (checkpoint 3):

| # | In plain words | Owner |
|---|---|---|
| F1 | You said "every day" or "every month", and it still runs only when started by hand | record |
| F2 | KPI: "always the newest email" wasn't built as a loop; one fixed click was called the rule | record |
| F3 | YC: half its 40 model calls were refused for small tool slips, so it ran out | record |
| F4 | It asks things the recording already answers (KPI: "should it run on its own?" after "every day") | record |
| F5 | KPI: it removed the step that opens the sheet, so the paste would land in Gmail | record |

**Found by reading the code or reviewing it:**

| # | In plain words | Owner |
|---|---|---|
| F6 | A run waiting for your OK loses its named tabs | Akshat |
| F7 | A step with no tab runs in the first tab, but the test run highlights in the last one | Akshat |
| F8 | Replay can't find a step by its list place or text | Akshat |
| F9 | Replay can't write into a sheet cell or the next empty row | Akshat |
| F10 | A file path with a `{{variable}}` is only checked when designed, not when run | Akshat |
| F11 | Numbers cells (Mac elements with no name) | record |
| F12 | A question can wait for ever | record |
| F13 | "You used X. Next time, which file?": "the newest" picks the wrong option; "all of them" isn't offered | record |
| F14 | *(new, Oct 22)* **Run now** in the app never asks which file: it takes the newest even after "ask me each time", and stops if a value has no default. Only the terminal's `run` asks | to decide (run side) |
| F15 | *(new, Oct 22)* The **Never** list is empty for a new recording, so a spoken "never do X" is only a quoted rule, not a guard | record |
| F16 | *(new, Oct 22)* `design.json` doesn't keep the agent's first message, stage 1's reasoning, or the plain list it started from | record |

**Found in checkpoint 4** (Oct 23: five everyday tasks on real sites, designed on the real model, then run; details in
[`testing/checkpoint-4.md`](../testing/checkpoint-4.md)). **None of the five saved workflows did its task when run.**

| # | In plain words | Owner |
|---|---|---|
| F17 | A paste gets the copy made *before the field was left*, not before the paste: two fields both got the second copy | record |
| F18 | The first page opened in a tab that was open before Record isn't a step | record |
| F19 | List places are wrong on tables (a story's title and points counted as two items) and missed on YouTube's grid | record |
| F20 | Accepting a "list item", "repeat", "all files" or "constant" proposal changes nothing, though the agent is told it does | record |
| F21 | "Open directly" offers to hard-code the example ("this video") when the task says "the newest" | record |
| F22 | Canvas apps: typing into a temporary text box isn't recorded; the canvas click is dropped | record |
| F23 | A downloaded file isn't linked to the rename and move after it; the move keeps the recorded name | record |
| F24 | A watched folder inside a hidden folder records nothing | record |
| F25 | The workflow can't read a page's text (no target), so "read the page, let AI pick" fails | to decide (player) |
| F26 | The finish gate lets broken workflows through (a reason given when adding a step counts as explaining its test failure; a test that never started counts; stale checks; rule→step mapping not checked) | record |
| F27 | "Kept what it reached" can save a draft that can't run, worse than the recording | record |
| F28 | The agent's tools accept steps the player can't run (wrong arguments, no target, `{{today}}` as an input) | record |
| F29 | "The recording already answers this" is wrong both ways: real questions dropped, answered ones asked | record |
| F30 | The agent's questions are lost when the design stops early | record |
| F31 | The review shows the agent's words unchecked ("as per user preference" when nobody was asked) | record |
| F32 | The agent burns its 40 calls on one step (13 changes to one step; 9 tries at setting the schedule) | record |
| F33 | The safe test run: a step failed only inside it (unexplained); it can't start when an input needs a file the run downloads; it leaves tabs open | record |
| F34 | The bench's checks pass workflows that can't run | record |

## Not checked live yet

- The safe test run, the review page and the progress feed, on a real recording.
- Move to Trash, Shadow's own prompts skipped, and copy and paste from the app. These need `pnpm setup:mac`.
- Your sign-off on: `skill.ts` `tab`, the player's test-run mode, dates and keys.
