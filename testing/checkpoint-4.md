# Checkpoint 4: five everyday tasks, recorded on real sites, designed on the real model

**What this is.** Step 3 of the Oct 22 plan. Tasks A–E from [`record-examples.md`](record-examples.md) were each:
1. recorded on a real public website;
2. turned into a workflow by design agent v2 on the real model, at Stop, as in the app;
3. tried in the safe test run, live;
4. **started once with Run now,** to see if the saved workflow does the task.

**When, and who:** Oct 23, recorded by Claude.

**The setup:**
- an isolated test browser: Chrome for Testing, a copy of the extension (0.0.4), and a scratch daemon with its own data
  folder;
- the real key from `.env`;
- Screen on for every task, Pictures on for B and E;
- **no voice**, so every rule was in the typed goal.

**Where the files are:** copies of every recording and saved workflow, each with an `expect.json`, are in
`~/shadow-tests/checkpoint-4/<task>/` (not in git).

**Cost:** $0.77 in all:
- six designs, $0.62;
- replay's repair agent on three failing runs, $0.15.

The ledger is at $1.40 of $5.

## The answer in one table

| Task | Design ended | Bench checks | Safe test run | Run now: does the task get done? | Cost, calls |
|---|---|---|---|---|---|
| **A** Hacker News: top 3 stories → notes | designed | 3/5 | failed at step 1, 3 times (unexplained, F33) | **No:** fails at step 2 (the title is looked for on the notes page) | $0.053, 14 |
| **B** YouTube: newest video → notes | designed | 4/4 | caught a real fault (s9), but it was saved anyway | **No:** s9 can't read the page; after repair and approval, Save isn't found (F6) | $0.122, 38 |
| **C** USD→INR rate → notes | **kept** (out of calls) | 6/6 | caught a real fault (s9) | **No:** fails at s10 (can't read the page) | $0.151, 40 |
| **D** Wikipedia PDF → Reading folder | designed | 1/4 | ran 2 steps | not run (replaced by D2) | $0.095, 30 |
| **D2** same, file moves captured | **kept** (out of calls) | 3/4 | couldn't start (an input) | **No:** fails before step 1 (a file it would only download later) | $0.141, 40 |
| **E** Excalidraw: "Week of <date>" note | designed | 3/4 | couldn't start (an input) | **No:** fails before step 1 (today's date given as text) | $0.060, 23 |

**In short: none of the five saved workflows does its task when run.**

**The bench's checks can't tell:**
- B and C pass every check, yet neither runs.
- `uses_today` is ticked for D and D2 only because an input is named `today_date` (F34).

**D's rename and move were missed by my setup, not by Shadow:** its watch folder was inside `~/.claude`, and Shadow ignores
files under any hidden folder (F24). D2 repeats D with the folder in `~/shadow-tests`.

## What worked

- **Capture on real sites:**
  - selections, copies and pastes;
  - clicks and what they did;
  - tabs opened before Record, named from their pages ("Google for Developers", "My notes");
  - the download;
  - the rename and the move (D2);
  - pictures, and captions in B and E.
- **The task model** got how often it runs right in 5 of 6 designs. "Every morning", "every Monday", "each working day",
  "every day" (D2) and "every Friday" all became schedules. **D is the exception (F1):** the same goal as D2 got
  "manual", so the model isn't consistent.
- **The task model's values** were right in C: "USD to INR" and USD stay fixed, and "23 Oct" became
  `{{today|D MMM}}`.
- **The agent's general idea is the right one for any website:** open the page, read its text, and let an AI step pick
  the value (B, C, D2). It fails only because the step that reads the page can't run (F25).
- **The safe test run ran live for the first time** and found real faults: B's and C's page-reading steps. It just
  didn't stop them from being saved (F26).
- **The question batch, with real answers** (D, D2, E): every answer arrived, "You decide" took the default, and a typed
  answer of my own was accepted.
- **Masking and untrusted-text marks** were in place. A design cost $0.05–0.15.

## What broke

New failures are numbered from F17. They are added to the F1–F16 list in
[`reports/record-v2-whats-fixed.md`](../reports/record-v2-whats-fixed.md). The stage numbers ①–⑨ follow
[diagram 16](../docs/guide/16-record-to-workflow.png), and the sections follow
[`section-study.md`](../reports/section-study.md).

### Capture and the first draft (② ④ ⑤)

| # | What happened | Seen in | Stage · section | Why (cause in code) | Owner |
|---|---|---|---|---|---|
| F17 | **Pastes got the wrong copied value.** Both Title and Value were filled with the points, not title then points | A, every round | ④ R9 | A paste happens at 6.9 s, between copy 1 (4.6 s) and copy 2 (9.1 s). But the field's `type` event comes when the field loses focus (10.8 s), and the source is picked by that later time, so it's the newest copy. The paste event's own time, or matching the pasted text to a copied text, would get it right | record (`normalise.ts`, `evidence/flow.ts`) |
| F18 | **The first page opened wasn't a step.** The blank tab → Hacker News became "open before Record", so the workflow's step 1 opens the notes page instead, and the tab is called "about:blank" | A | ⑤ R2 | A tab that existed before Record is announced at its first use, and its first navigation is taken as that announcement | record (`normalise.ts` `addStartingPage`, `evidence/tabs.ts`) |
| F19 | **List places are wrong on table and component layouts:**<br>- Hacker News counts each table row, so a story's title and points are items 1 and 2, and the repeat proposal pairs them ("s2–s2 happen 2 times") instead of the 3 rounds;<br>- YouTube's video grid isn't seen as a list at all;<br>- false lists and repeats: the video title as "item 4 of 7 in main"; "Thuggee" + "Download as PDF" as a repeat | A, B, D | ⑥ R1 R9 | A list item is one row or child of the container. There's no notion of a "record" spanning several rows, and none of a grid built from custom elements | record (`apps/extension/src/describe.ts`, `evidence/proposals.ts`) |
| F22 | **Canvas apps: the task is invisible.** Typing into Excalidraw's temporary text box wasn't recorded, because the box is removed on Escape before the typing is saved. The click on the canvas was put on a toolbar container and dropped as "changed nothing" | E | ② R1 | Typing is saved when a field commits (change or blur). Fast keys are never kept as keys (on purpose, so Shadow isn't a keylogger) | record (`apps/extension/src/capture.ts`) |
| F23 | **Files aren't linked from step to step.** The rename asks "You used Thuggee.pdf. Next time, which file?", with no option for "the file this workflow just downloaded". The move after the rename keeps the recorded name, "23 Oct - Thuggee.pdf", so it fails the next day | D2 | ④⑤ R4 R9 | `normalise.ts` already records which file a click produced (`produces`), but nothing uses it. A file step's `from` isn't tied to the step before it | record (`skeleton.ts`, `evidence/flow.ts`) |
| F24 | **A watched folder inside a hidden folder records nothing.** Every file under `~/.claude/…` was ignored | D | ② R4 | `fs-watch.ts` `ignored()` tests every folder in the full path, the watched folder's own parents included | record (`apps/daemon/src/fs-watch.ts`) |
| — | Wikipedia's Tools menu click was recorded as "changed nothing" | D | ② R1 | The effect watcher misses menus opened through a hidden checkbox | record (minor) |

### Proposals (⑥)

| # | What happened | Seen in | Stage · section | Why | Owner |
|---|---|---|---|---|---|
| F20 | **Accepting most proposals changes nothing.** The agent accepted four "item k of the list" proposals and believed it now picks by position; step s2 is still found by its text | A | ⑥ ⑦ D2 | Four kinds of proposal carry no prepared change (`edits: []`) but are marked runnable: list item, repeat, all files and constant. The prompt tells the agent proposals are "prepared and checked" | record (`evidence/proposals.ts` lines 191–196, 241–246, 297–298, 321–322; `design/v2/prompt.ts`) |
| F21 | **"Open directly" would hard-code the example.** For "the newest video" and "today's featured article" it offered to open this video's or article's page directly. B accepted it, then reversed it | B, D, D2 | ⑥ D2 | The guard against this works only when the click has a list place, which F19 misses | record (`evidence/proposals.ts`) |

### The design agent (⑦)

| # | What happened | Seen in | Stage · section | Why | Owner |
|---|---|---|---|---|---|
| F25 | **It can't read a page's text.** "Read the page, let an AI step pick the value" fails with "extract needs a target", and a target found by its nearby label ("next to Indian Rupee") is never found | B, C, D (3 of 5) | ⑦ 7b D3; replay P3 | The player's `extract` needs a target, and the matcher doesn't use text or `near` (F8). This one gap stops the agent's most general plan, the one that would work on any site | **to decide:** player (Akshat), but record depends on it |
| F26 | **The finish gate lets broken workflows through:**<br>a) a failed test step counts as explained if the agent gave any reason for it, even the reason it gave when it *added* the step (B);<br>b) a test run that never started is accepted (D, D2, E);<br>c) checks on changed steps aren't looked at again (D2: still expects `/wiki/Thuggee`);<br>d) "rule → steps" is checked only for the steps existing, so the review showed "save into my Reading folder → (the existence check)" (D);<br>e) every rule can be "not built", with any reason (A) | A, B, D, D2, E | ⑦ 7f D6 | `gate.ts`: `explained` is every reason the agent gave; `test.outcome` "not run" isn't a problem; url and file checks aren't judged | record (`design/v2/gate.ts`) |
| F27 | **"Kept what it reached" can save something worse than the recording.** C kept a draft with a value no step produces (`{{indian_rate}}`) and two read steps that can't run; the plain recorded steps would have worked | C, D2 | ⑦ ⑧ D6 | The kept path checks only that your work wasn't lost, not that the draft can run | record (`design/v2/orchestrator.ts` `kept`) |
| F28 | **Its tools accept steps the player can't run:**<br>- a read with no target;<br>- `fs.find` with `{folder, pattern}`, where the player reads `{dir, glob}`;<br>- an input whose default is `"{{today}}"`;<br>- four times, an input for today's date instead of `{{today}}` in the text | B, C, D, D2, E | ⑦ 7b D3 | `tools.ts` checks the step's schema, not what the player needs from each action | record (`design/v2/tools.ts`) |
| F29 | **The "the recording already answers this" check is wrong both ways:**<br>- **too loose:** "At what time on Monday?" was judged answered by "Every Monday", so nothing was asked, and its other open questions vanished without being listed (B);<br>- **too strict:** it asked for the folder and date format the recording shows (D2), and asked two implementation details ("API, HTML or RSS?", "rename before or after download?") (D) | B, D, D2 | ⑦ 7d D5 | `evidenceView.about()` matches shared words | record (`evidence/evidence.ts`, `design/v2/orchestrator.ts`) |
| F30 | **Its own questions are lost when the design stops early** ("At what time each working day?", queued twice, never asked) | C | ⑦ 7d D5 | `pending` holds only code's questions | record (`design/v2/orchestrator.ts`) |
| F31 | **Its words in the review aren't true:**<br>- "as per user preference" (B: nobody was asked);<br>- "awaiting user confirmation" (C: none comes);<br>- a summary describing a "branch" that doesn't exist (D) | B, C, D | ⑨ D6 | The review shows the agent's reasons and summary as written | record (`design/v2/review.ts`) |
| F32 | **It burns its calls on one thing:**<br>- C changed the same read step 13 times;<br>- D2 tried to set the schedule with `change` 9 times before using `trigger`;<br>- B used 38 of 40 calls, sending 382k input tokens, because the whole conversation is sent again each call.<br>(F3, half of YC's calls refused, is the same family) | B, C, D2 | ⑦ D3 D7 | Tool syntax gaps; no "you already tried this" | record (`design/v2/tools.ts`, `packages/agent`) |
| F1 | "Every day" written as "manual" again, while D2 got the same goal right | D | ⑦ 7a | as before | record |

### The safe test run (7c)

| # | What happened | Seen in | Why | Owner |
|---|---|---|---|---|
| F33 | a) **A's step 1** (open the notes page and check its address) failed 3 times, 11.5 s each, only inside the design's test run. The same step passes in a normal run (0.6 s) and in a walk-through (0.3 s). **Not explained yet.**<br>b) **It can't start** when an input needs a file the workflow itself downloads (D2).<br>c) **It leaves its tabs open** (B, D) | A, B, D, D2 | a) unknown; b) inputs are filled before step 1; c) the tab clean-up | record (`apps/daemon/src/rehearse.ts`, `packages/player/src/rehearse.ts`) |

### The bench (Plan 1's measuring stick)

| # | What happened | Why | Owner |
|---|---|---|---|
| F34 | **Passing the checks doesn't mean the workflow works:** B 4/4 and C 6/6, neither runs. `uses_today` matches any input named `today…` | The checks look at the workflow's shape. None asks whether every `{{value}}` is produced before it's used, whether each step has what the player needs, or whether the inputs can be filled | record (`packages/recorder/src/eval/expect.ts`) |

### Replay, seen while running (Akshat's side; listed, not touched)

- **F6 seen live:** B's run waited for approval at Save and then couldn't find the Save button.
- **F8 seen live:** C's "next to Indian Rupee" target was never found.
- **Repair** ran on all three failing runs. It used the real model ($0.15), and on B it changed the workflow to v2
  without being asked to.

## How it was run, and its limits

- **Real input:** Playwright drives the test browser with real mouse and keyboard events, and Shadow records them as
  it would yours. Copy and paste use the Mac's clipboard.
- **Two changes to the planned steps,** because Playwright can't use Chrome's right-click menu or the address bar:
  - A copies each story's title and points instead of its link;
  - B opens the newest video and copies from its page.

  [`record-examples.md`](record-examples.md) is updated to match.
- **No voice anywhere.** Rules said aloud and their alignment to steps (R7, R8) aren't tested here; F–H (your
  recordings) cover them.
- **Questions were answered as a person would** (D, D2, E). A, B and C asked nothing.
- **D was recorded twice** because of the setup problem (F24); both are counted.
- **Not covered:** signed-in apps, Mac apps (Shadow.app wasn't running), the review page in the window. Those are F–L.

## Next

- **Step 4, the deep dive:** these findings and a read of the code go into `reports/record-v2-deep-dive.md`, which
  also answers "which kinds of app work, and does it need MCP?". F19, F22 and F25 are the main evidence.
- **Your recordings F–H** (KPI, YC, Play Store, with voice) add the narration path and Checkpoint 3 step 2.
