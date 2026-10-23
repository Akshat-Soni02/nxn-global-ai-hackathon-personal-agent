# Checkpoint 5: the five tasks again, after the fixes

**What this is.** The check for step 4 of the Oct 22 plan. [Checkpoint 4](checkpoint-4.md) recorded five everyday tasks
on real sites, and none of the five saved workflows did its task. Step 4 traced every failure to its cause and fixed
it ([the deep dive](../reports/record-v2-deep-dive.md)). This checkpoint asks one question of each task: **after the
fixes, does the saved workflow do the task when it runs?**

It was done two ways:
1. **Re-designs on the real model** (`pnpm design:eval <recording> --real`): checkpoint 4's own recordings, designed
   again after each round of fixes. Each round's failures, read in the agent's transcript, became the next round's
   fixes.
2. **Live re-records:** each task recorded again in the test browser, designed by the daemon at Stop as in the app, then
   started with **Run now**, and what it saved checked on the page or in the folder.

**When, and who:** Oct 23, by Claude.

**The setup:** as checkpoint 4 (an isolated Chrome for Testing, a scratch daemon, the real key, Screen on, no voice),
with two changes:
- the extension copy is 0.0.5, which has the selector fix found in step 4 (`cf92fa2`);
- the scratch daemon was restarted on each new commit before the live runs that followed it.

**Where the files are:** recordings and workflows from the re-designs are in temporary folders, named in
[`design-eval-ledger.md`](design-eval-ledger.md). The live recordings are in the scratch daemon's data folder (not in
git).

## The answer in one table

**Rules built** means every rule in the goal is built by steps that do it, as read in the saved workflow, not as the
agent claimed. **Output correct** means what the run saved was checked: the notes page's saved rows, or the file in the
folder.

| Task | Checkpoint 4 | Now: design | Rules built | Schedule | Run now | Output correct | Calls, cost |
|---|---|---|---|---|---|---|---|
| **A** Hacker News: top 3 → notes, skip ones already saved | didn't run | saved past the gate with every save removed (F61, now fixed) | ✗ neither rule | every day 9:00 | ran, did nothing | ✗ | 9, $0.04 |
| **B** YouTube: newest video's title and views → notes | didn't run | designed | ✓ read the channel page, an AI step picks the newest | Mondays 9:00 | **succeeded** | ✓ "Design and replicate voices with Gemini 3.8 Flash TTS", "23K" | 26, $0.07 |
| **C** USD→INR rate, today's date, USD → notes | didn't run | designed (second try) | ✓ read the page, an AI step picks the rupee rate; today's date; USD fixed | weekdays 9:00 | **succeeded** | ✓ "USD to INR", 94.907545, 23 Oct, USD | 16, $0.05 |
| **D** Wikipedia's featured article → PDF in Reading, named with the date | didn't run | last try: out of calls, so the recorded steps were kept | ✗ (the recording: always "Thuggee") | by hand | **succeeded** | ✗ saved "23 Oct - Thuggee (1).pdf" to Reading: today's article only by chance | 40, $0.16 |
| **E** Excalidraw: "Week of <date>" note | didn't run | designed; the safe test run passed | partly: the date is `{{today\|D MMM}}`, but "top left" isn't built (it types where the board was clicked) | Fridays 9:00 | failed at s4: where to type wasn't found | ✗ | 15, $0.04 |

**In short: two of the five now do their task end to end when run (B and C).** In checkpoint 4, none did.
- **A:** the re-design on round-3 code builds the right loop and can run. The live design gave up instead, and was saved past
  the finish gate with every save removed. That hole is now fixed (F61); A wasn't run live again.
- **D:** every piece works on its own: the download chain ran (live D, fifth and last tries), and the design was right once
  (sixth try). But in 4 of the 5 tries that reached a design, the agent ran out of calls, and the one finished design failed because the run's AI
  step took the Main Page's image caption as the title. Each try's cause is fixed (F51–F60), but D was stopped after
  its last try, as Rushil asked.
- **E** is the canvas gap (F22): capture puts the canvas click and the typing on the properties panel, so replay can't
  find where to type. It needs the connector or vision rung (deep dive §3), not a capture fix.

## The re-designs, round by round

Checkpoint 4's recordings, designed again on the real model after each round of fixes. **Checks** are the
recording's `expect.json`; the last one, **runs**, says whether the step-runner can run every step.

| Round (code) | A | B | C | D2 | E |
|---|---|---|---|---|---|
| 1 (`814bc5e`, batches A–E) | 1/6, out of calls ($0.18) | 5/5, but "the newest" not built ($0.04) | 6/7, asked 1 ($0.07) | 3/5, rename dropped ($0.13) | 3/5, cron `{{cron_expr}}` ($0.07) |
| 2 (`1a3f17a`) | 2/6, out of calls: 20 refusals building the loop ($0.19) | 4/5, 40 calls, asked 2 ($0.16) | **7/7**, 10 calls ($0.03) | 4/5, a reply cut off at the token cap ($0.15) | **5/5**, but an unasked "already there?" check ($0.06) |
| 3 (`f8c4215`, `fa5bf58`) | **5/6**: the loop is built; asked 2 ($0.08, 21 calls) | **5/5**, 20 calls ($0.07) | not re-run | **5/5**, 35 calls ($0.15) | not re-run |

Each round's failures and their fixes are rows F35–F48 in the deep dive; the live runs' are F49–F61.

## What the live runs found, and what was fixed

- **Live A (round-2 code):** the agent ran out of calls building the loop, as in the re-designs, and the plain list was
  kept. The plain list **ran** (the 0.0.5 selectors find each story by its place on the page), but it isn't the task:
  it runs by hand, always takes the same three places, and doesn't skip stories already saved. Fixed by round 3
  (F35–F44).
- **Live C, first try (`7e59721`):** the agent turned the rate's read into `{ role: "cell" }`, which matches every cell.
  The test run said "ambiguous target". Eight changes "to read the whole page" each said ok and changed nothing, and
  their reasons counted as explaining the failed test, so it was saved. Run now failed at that step, and replay's
  repair ran out of turns ($0.05). Fixed in `306e724` (F49, F50); the second try did the task.
- **Live D, first two tries:** Chrome for Testing crashed in its own main thread in the middle of the PDF download
  (`EXC_BAD_ACCESS` in the macOS crash report), twice, on the test profile that had run A–C. The half-made recordings
  were discarded. On a fresh test profile the same download worked. This was the test browser, not Shadow.
- **Live D, third to sixth tries:** each found a new cause, fixed before the next try (deep dive F51–F59).
  - kept a broken draft (a stale check, a read in the wrong tab);
  - "find the downloaded file" looked once, 1 ms after the click;
  - the agent spent 15 calls giving a page-open step a control it can't have;
  - the run's AI step picked the image caption, which the test run had shown only as "check failed".

  The fifth try showed the recording path works end to end: the download, a 60 s wait for the file, rename, move.
- **Live D, last try:** the agent removed and re-added the same whole-page read 10 times, because the outline showed it
  as `on element "?"`. Fixed (F60) but not run again: D stops here.
- **Live E:** with Pictures on, two captions timed out (90 s each) and compiling took over 10 minutes. My script stopped
  waiting at 10 minutes and ran D's workflow once by mistake (no AI steps, $0). E's own run failed at the canvas (F22).
  Replay's repair ran out of turns.
- **Live A, last try (`edd1241`):** the agent claimed the page couldn't be read, removed every save, and called done
  three times. The finish gate refused twice, then let it through with the gaps listed, and that path didn't protect
  the recorded steps. Fixed in `e64161d` (F61).

## What is still open

| What | Why it's still open | Owner |
|---|---|---|
| **D doesn't do its task** | The agent's calls and the run's AI step are the limit, not the recording. The tool gaps each try found are fixed; not re-tested, as asked | record (the design agent) |
| **A's live design gave up**; the re-design claims "skip ones already saved" is built when no step reads the list | The model's judgment. The finish gate checks that the steps a rule names exist, not that they do the rule. The F61 fix stops a gave-up design replacing the recording | record |
| **E: canvas apps** | The canvas click and typing are recorded on the panel on top (F22); replay can't find where to type | record: the connector or vision rung (deep dive §3) |
| AI steps on the run's fast model can pick the wrong thing (D: a caption for a title) | The design now sees what each AI step answered in its test (F59). Nothing at run time checks an answer is plausible | record (prompt) and replay |
| Picture captions time out at 90 s, so compiling with Pictures on can take over 10 minutes | Not looked into | record |
| In the test run, a step after a file this run would download says "has no value yet" | The runner fills `{{…}}` before deciding to skip a step (`run.ts:318`) | Akshat |
| Repair ran on every failing Run now ($0.05–0.08 each) | Replay | Akshat |
| F11, F12, F13b, F14, F15, F19, F29 | as in the deep dive §2 | as listed there |

## Cost

$2.93 in checkpoint 5 (every ledger row after checkpoint 4's $1.40):
- re-designs on the real model, rounds 1–3 (13 designs): $1.38;
- live designs (11): $1.31;
- picture captions and replay's repair on failing runs: $0.25. B's captions are an estimate (under $0.01), and D's
  repair is read from the daemon's daily total.

**The ledger total is $4.34 of the $5 Rushil allowed** ([`design-eval-ledger.md`](design-eval-ledger.md)). Nothing
more is spent.
