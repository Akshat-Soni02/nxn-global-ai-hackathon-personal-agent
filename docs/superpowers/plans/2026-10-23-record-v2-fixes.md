# Record → workflow fixes from checkpoint 4 (step 4 + fixes)

> For agentic workers: executed inline (superpowers:executing-plans), each fix test-first
> (superpowers:test-driven-development). Root causes come first (superpowers:systematic-debugging). Ledger:
> `.superpowers/sdd/2026-10-23-record-v2-fixes/progress.md`.

**Goal:** a recording becomes a workflow that is correct, and that the current step-runner can run. That means:
- the right values, wired to the right places;
- nothing literal that changes next time;
- no step the runner can't run.

Replay and repair stay untouched; their causes are listed for Akshat.

**Evidence:**
- [`testing/checkpoint-4.md`](../../../testing/checkpoint-4.md): 0 of 5 real workflows ran.
- The root causes are in [`reports/record-v2-deep-dive.md`](../../../reports/record-v2-deep-dive.md) (step 4).

**Rules:**
- Rushil's: fix from the existing code, with the fewest lines, and no per-app code.
- Each fix starts as a failing test on a synthetic trace or workflow.
- Commit per batch, only after the gate passes (`corepack pnpm -s test && corepack pnpm -s lint && corepack pnpm -s
  typecheck`), committed as ruseellkj. No push.
- Real-model spend is announced: about $1.5 for verification, against $3.60 left.

## Batch A · The raw material: normalise and the first draft

| # | Fix | Root cause (file) | Test |
|---|---|---|---|
| A1 | A paste takes the copy that was newest **when it was pasted** | `normalise.ts:330` ignores `paste`. `type` (sent when the field is left) takes `lastCopy` at its own time | copy c1, paste into Title, copy c2, Title's `type`, paste into Value, Value's `type` → Title gets c1, Value gets c2 |
| A2 | A navigation merges into the previous one only **in the same tab** | `normalise.ts` navigate case: merged within `FOLLOW_MS` with no tab check | tab 1 opens HN, then tab 2 opens notes 1.5 s later → two steps, HN first |
| A2b | A tab's name doesn't come from a blank page's title | `evidence/tabs.ts` `tab.title ??= e.title` at `tab_open` (here "about:blank") | `tab_open` (about:blank), then a navigation to HN → named from HN |
| A3 | Files are followed by variable, not by literal path:<br>- a rename gets an output;<br>- a download adds `fs.find {since_run_start}` with an output;<br>- later file steps use those | `skeleton.ts` rename branch: `files.set(to, literal)`. A click's `produces` isn't used | Download → rename → move: the move's `from` is the rename's variable; no "which file?" question |
| A4 | Files are ignored only by the folder names **below** the watched folder | `fs-watch.ts` `ignored(path)` tests every folder in the full path | Watched folder `/x/.hidden/w`, file `/x/.hidden/w/a.pdf` → kept |

## Batch B · The agent's tools build steps the runner can run

| # | Fix | Root cause | Test |
|---|---|---|---|
| B1 | A read with no target reads the page: target `{fallbacks:["main","body"]}`, and `all` is dropped | The player's `extract` needs a target (`executor.ts:246`); fallbacks are CSS selectors (`match.ts:149`) | `add {do:"extract"}` with no target → that target |
| B2 | `runProblems(step)`: a target the matcher can score (role, attrs or fallbacks), the arguments each action needs, and no `{{…}}` in an input's default. `add`, `change` and `input` refuse with guidance | `tools.ts` checks only the schema | `fs.find {folder, pattern}` refused, naming `dir` and `glob`; a target with only `near` refused; an input default `"{{today}}"` refused with "use {{today}} in the step" |
| B3 | `accept` on a proposal with no prepared change says so and says how to build it; the feed doesn't say "Using a pattern" | `proposals.ts`: `edits: []` but `runnable: true`; `prompt.ts` says proposals are prepared | Accepting a list-item proposal returns guidance; the draft is unchanged and no decision is recorded |
| B4 | "Open directly" says to accept it only if it's always the same page | `proposals.ts` open_directly | Its summary carries the warning |
| B5 | Forgiveness, part one:<br>- comma-separated ids are split;<br>- `add {do:"ai_step"}` goes to ai_step;<br>- `output.type` may be a word;<br>- `{{s6}}` is read as s6's output;<br>- `change` on "start" with when/schedule goes to trigger | F3 and F32: refusals and thrash in YC, C and D2 | One test per item |

## Batch C · The finish gate, and keeping a draft

| # | Fix | Root cause | Test |
|---|---|---|---|
| C1 | A failed test step is explained only by a reason given **after** that test | `gate.ts` uses `explained` = every reason the agent gave, set at `tools.ts:139` | Step added with a reason, then fails the test → gate problem |
| C2 | A test run that couldn't start (except "no Chrome") is a problem | `gate.ts` ignores `test.outcome` | outcome "not run: input x has no value" → problem |
| C3 | A url or file check holding a literal on a step whose arguments now use `{{…}}` is a problem | Checks of changed steps are never looked at again | navigate `/wiki/{{t}}` with check `/wiki/Thuggee` → problem |
| C4 | `runProblems` across the whole workflow, at finish | — | An unrunnable step → problem |
| C5 | "Kept what it reached" falls back to the plain list when the draft has run problems the plain list doesn't | `orchestrator.ts` `kept` checks only lost work | A kept draft with a target-less read → the plain list is saved |
| C6 | Frequency words in the goal or what was said require a schedule (F1) | The gate trusts the task model's `cadence.kind` | goal "Every day …", cadence manual, workflow manual → problem |

## Batch D · Questions, honesty, record-keeping

| # | Fix | Root cause | Test |
|---|---|---|---|
| D1 | A question counts as answered only if **2** content words match | `evidence.ts:237` `about()`: 1 word | "At what time on Monday?" vs "Every Monday …" → not answered |
| D2 | The agent's questions that were never asked (it stopped early) are listed in the review | `orchestrator.ts`: `pending` holds only code's questions | A kept design with queued questions → in `skipped` |
| D3 | The review's summary is code's description of the real changes; the agent's sentence is shown as its own | `review.ts:46` shows the agent's summary | A summary claiming a branch that doesn't exist isn't shown as fact |
| D4 | F13: the file question is answered from labels only; "all files like X" is an option | `evidence/answers.ts` reads option values; `skeleton.ts` `fileQuestion` | "the newest" → the newest option; "all the reports" → all |
| D5 | F16: `design.json` keeps the first message and the plain list | `orchestrator.ts` outcome; `record.ts` `keepDesign` | Outcome has both |

## Batch E · The bench

| # | Fix | Root cause | Test |
|---|---|---|---|
| E1 | `uses_today` matches `{{today` only as the built-in (`{{today}}`, `{{today|…}}`, `{{today-1}}`) | `expect.ts:43` substring | `{{today_date}}` doesn't count |
| E2 | Every bench run also checks `runProblems`, as a "runs" verdict | `expect.ts` checks shape only | An unrunnable workflow fails "runs" |

## Verification

1. **The gate, after each batch.**
2. **`pnpm design:eval <copy> --real`** on the checkpoint-4 recordings A, B, C, D2, E. There's no Chrome, so no test
   run. About $0.5, announced.
3. **A live re-record of A–E** in the test browser (E clicking the canvas, away from the panel), each saved workflow
   then run once. About $0.8 including repair, announced.
   - The test: every step up to the first approval runs, and the values in the notes page are right.
   - F6 (replay) still stops a run after an approval; that's recorded, not fixed.
4. **Results** go in `testing/checkpoint-5.md`.

## Not in this plan

These are listed in the deep dive:
- **Replay:** F6, F7, F8, F9, F10.
- **Run-side input asking:** F14.
- **Needs your Mac:** F11.
- **A design decision:** F15, "never" as a guard.
- **Extension list detection on tables and component grids:** F19. "Read the page and let an AI step pick the item"
  covers "top N" in general.
- **F12:** a question timeout.
