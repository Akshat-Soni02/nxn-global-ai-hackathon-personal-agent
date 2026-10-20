# Checkpoint 2: the real recordings through the evidence

Plan 2 turns a stopped recording into `evidence.json` (`docs/superpowers/plans/2026-10-20-record-v2-plan2.md`). This
checks it on the six real recordings of Checkpoint 1 and the two fixtures, with `pnpm evidence <folder>` (no model),
plus one live run with the Pictures switch on for captions. Run on 20 Oct.

Four recordings were made before Checkpoint 1's capture fixes (A', C, D, your-chrome B). Their traces keep the old
capture's gaps: cell lists, no `synthetic`, no list place on the Gmail row. The evidence can only be as good as the
trace, and the table says so where it matters.

## Results

| Recording | Steps (by class) | Left out | Proposals | Tokens |
|---|---|---|---|---|
| A' Wikipedia → form | 9 (go 5, read 1, act 3) | 7: the unused double-click selection, 5 idle tab switches, a blank-area click | list item: row 3 of 191 | ~970 |
| C YC jobs | 5 (go 4, read 1) | 2 idle tab switches | list item ×2: cards 1 and 2 of 20 | ~560 |
| D GitHub | 8 (go 4, reveal 2, act 2) | 0 | list item: pinned issue 1 of 3 | ~880 |
| F sample sheet | 3 (go 1, read 2) | 0 | none | ~230 |
| your-chrome A sheet + form | 9 (go 3, act 5, read 1) | 4: two drawn clicks, a drawn re-click, the "New expense" heading click | date `{{today\|D MMM}}` for "20 Oct"; next empty row A4 (can't run yet) | ~500 |
| your-chrome B Gmail | 5 (go 3, read 1, act 1) | 1: the header click | none | ~250 |
| KPI fixture (old format) | 12 (go 6, reveal 1, read 2, act 3) | 2 drawn clicks | date `{{today\|D MMM}}` for "19 Oct" | ~550 |
| timesheet fixture | 4 (go 1, act 3) | 0 | none | ~200 |

All are far under the 24k cap, at level 0 (nothing cut).

## Against what each recording must show

| Recording | Must show | Result |
|---|---|---|
| A' | the double-click left out with its selection, or merged into a read | ✓ `(left out) selected "fluctuations"` |
| | the copy a `read` with its list place | ✓ "item 3 of 191" (Germany's row) |
| | the table link `go` | ✓ |
| | Save `act` with "Saved amount" appeared | ✓ after the fix: it was on the typing step (pictures were ordered by event time, not taken time) |
| | idle tab switches left out | ✓ 5 |
| C | the top job `go`, "item 1 of 20", list item proposal | ✓ |
| | the title copy on the job tab a `read` | ✓ |
| | tabs named | ✓ "Y Combinator"; the job tab is "ycombinator.com" (a new tab has no title in the trace) |
| D | Code `reveal` | ✓ |
| | Escape a press | n/a: recorded before Escape was captured |
| | `g`, `i` presses; the page's click on Issues left out | ✓ presses; the page's click is kept, because it was recorded before `synthetic` existed |
| F | two cell copies `read`, with B8 and A12 | ✓ |
| your-chrome A | "20 Oct" date proposal | ✓ `{{today\|D MMM}}`, its change ready |
| | next empty row A4 | ✓ not runnable |
| | the heading click left out | ✓ |
| | Save `act` | ✓ |
| your-chrome B | the row `go`, list item proposal | `go` ✓; no list place, because it was recorded before 99a0bf7 (Gmail's hover class). Checked live after the fix: row 3 of 50 |
| | header click left out | ✓ |
| | subject copy `read`; `j` a press | ✓ |
| KPI | builds; a date proposal; no click left out for lack of an effect | ✓ |
| Captions, live | a caption on steps with a picture | ✓ 5 of 5 (one cut short, "This is a"). After the fix the question says the picture is from just before the step: live, Save's caption had guessed "nothing was saved" |

## Fixed here

Commit e642724, each change test first:
- **Pictures:**
  - ordered by when they were taken (`takenAt`), not by their event;
  - Shadow's own Stop pill ("• Stop • 1:00") is never something that appeared;
  - a step's own first picture is its "before" when nothing was pictured earlier.
- **Open directly:** needs a known destination, and never swallows a pick from a list. It had offered to replace
  "open the inbox, click the email" with "open the inbox", and to open GitHub issue 334285 directly.
- **No one-step repeats** of two keys or two typings.
- **List items:** proposed only for content lists. Gmail's 4 header blocks and GitHub's nav tabs are not lists.
- **Small fixes:** a key pressed on the page names no target (it showed the page's script text); a drawn click names
  its cell.

Commit 9ed8752: a caption describes what was acted on, not a guessed outcome.

## Notes

**For Plan 3:**
- A copy step's "appeared" can include lines that only came into view by scrolling. They were on the page all along,
  so they are harmless as check text, but they make the evidence longer.
- The KPI pattern (open email → copy → sheet → paste, twice) is not found as a repeat: the groups differ by one step.
  The agent sees both groups in the timeline.

**For Akshat:**
- `packages/llm/src/vision.ts` asks for at most 400 tokens. One live caption came back as "This is a", probably a
  reasoning model that spent the budget before answering.

**Spend:** $0.074 (5 captions plus the design run on Stop). The ledger total is $0.43 of $5.
