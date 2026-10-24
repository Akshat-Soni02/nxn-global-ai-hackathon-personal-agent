# Checkpoint 6: task D recorded by Rushil, on his own Mac

**What this is.** Rushil recorded task D himself, the way he'd normally do it. It failed badly. This file is the
diagnosis, read from the recording's own files. It is the starting point of step 5
(`~/.claude/plans/zippy-riding-lovelace.md`).

**When, and who:** 23 Oct, 23:42, by Rushil. His Chrome, his launchd daemon (restarted onto `cce8f0d` at 23:26), Screen
on, microphone on, Pictures off, Accessibility not allowed.

**The goal he typed:** "Every day, save today's featured Wikipedia article as a PDF into my Reading folder in desktop,
named with today's date".

**What he did:**
1. Opened the Main Page and clicked the featured article ("Thuggee").
2. Printed the page with Chrome's print dialog: Save as PDF.
3. In the save panel, chose `~/Desktop/Reading` and typed "23 Oct - Thuggee".

**Where the files are:** a copy is in `~/shadow-tests/checkpoint-6/D-print/` (the recording, the saved workflow, its two
runs). Not in git.

## What came out

- **The design:** all 40 calls used. It stopped while putting answers in. What it reached couldn't run, so the recorded
  steps were kept (`main-page-nxsctb` v1):
  1. open the Main Page;
  2. open "Thuggee";
  3. find a PDF made since the run started in `~/Desktop/Reading`.
- **It runs by hand,** although he said "Every day".
- **The review offered "Looks right".**
- **Run now and the walk-through** both failed at s3 after 60 s: "no file matches *.pdf in ~/Desktop/Reading". His PDF
  is there, but it is older than the run.

## Why: eleven causes, from the recording's files

| # | What happened | Cause | Stage | Where |
|---|---|---|---|---|
| 1 | Nothing was recorded between 00:04 and 00:43 | Capture sees only the web page. Chrome's print dialog and the macOS save panel are outside it; Shadow.app sees the panel only with Accessibility | ② | `trace.jsonl`: click, navigate, then `fs_create` at 00:43 |
| 2 | The PDF was blamed on clicking "Thuggee" | A new file is attached to the previous step as if that step downloaded it, however long after | ④ | `normalise.ts:431-433` |
| 3 | The agent never learned a PDF appeared, where, or its name | The evidence shows the click and drops the file: "2 steps, 0 left out". The agent guessed "YYYY-MM-DD.pdf" and asked 4 questions the recording answers | ⑥ | `evidence.json` |
| 4 | No step can save a page as PDF | The browser can (`Page.printToPDF`, any site); Shadow names it only in a timeout list | runner | `player/src/web/cdp.ts:65` |
| 5 | The agent reasoned like a script writer | It offered Puppeteer, wkhtmltopdf and pandoc; called "Thuggee" a value you type; wrote "manual" for "Every day"; added `press Control+P` | ⑦ | `design.json → task`, its calls |
| 6 | The AI step answered `…/wiki/2026_in_railway_transportation` | Its read had a tab name that opens a new blank tab on first use, while s1 ran in the first tab. The read got "" (counted as success), and the AI step answered from nothing | runner, ⑦ | `tab-map.ts:1-3`; the 3 test runs: `s4 ok ""` |
| 7 | `https://en.wikipedia.org` + a full URL → `en.wikipedia.orghttps://…` | The agent didn't act on what its test showed (an empty read, a wrong article, a broken address) | ⑦ | its test report |
| 8 | 40 calls gone | One action per call; 6 calls trying to drop a check with `target: "None"`; no-op changes; the budget ran out while putting answers in | ⑦ | `design.json → transcript` |
| 9 | The kept steps can't make the PDF, yet "Looks right" was offered | Keeping the recording is safe only when it captured everything | ⑦ ⑨ | `orchestrator.ts` `kept`, `skeleton.ts:92-106` |
| 10 | 50.7 s of voice became 0 words, and nothing said so | Transcription returned nothing | ③ | daemon log: "narration: 0 piece(s) of text" |
| 11 | The run log is hard to read; "you said do it (its target was not outlined)" | No separators; a page-open step has nothing to outline | UI | `apps/ui/src/screens/Run.tsx:159` |

**The folder watcher worked:** it saw the PDF appear. Code then misread that fact (2) and hid it (3).

## Were A–C really fixed?

Only for the one way each was recorded in checkpoints 4–5:
- by Claude's script, in an isolated browser, with scratch folders and no voice;
- D through Wikipedia's "Download as PDF" link, never the print dialog.

Each fix matched the trace that failed. Cause 2 is one of those fixes misfiring on another way of doing the task.

## What step 5 does about it

The plan, with Rushil's rulings of 24 Oct, has five parts:
1. **The record tells the truth:** a `print` event from the page, files attached only to what made them, and every file
   fact in the evidence.
2. **The runner gets general abilities:** save a page as PDF; an empty read fails; an AI step with no input doesn't
   run; tab names must exist. Akshat reviews these.
3. **Design agent v3:**
   - it plans before applying;
   - it knows its tools;
   - code checks every test value;
   - it verifies with real local runs, including running twice for "skip" rules;
   - no call cap;
   - it ends honestly.
4. **The run log and the review are readable.**
5. **Proof:** each task recorded several ways, by Claude and by Rushil, and counted only when Run now does the task on
   two different days.
