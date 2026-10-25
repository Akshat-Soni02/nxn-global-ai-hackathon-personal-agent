# Plan, Oct 25: agents that are free to do the job (design v3, repair v2)

> Written after `oct25-yc-jobs-to-sheet.md`. The recording and the understanding worked; the build, the finish check
> and the repair didn't, and a policy (text masking) hid the one value the task needed. This plan changes how the
> agents are set up rather than patching one more case. Owners: **R** = Rushil (record, design agent), **A** = Akshat
> (replay, repair, connectors, service); since the evening of Oct 25 Akshat builds all of it, Rushil reviews. Status marks: ☐ planned · ◐ doing · ☑ done.

## 0. The diagnosis in one paragraph

Shadow grew **rules-first**: every failure seen in a checkpoint became a rule, a refusal or a cap: mask anything that
looks like a key, refuse edits that look risky, cap tokens, cap turns, cap questions, save with gaps after two
refusals. Each rule was reasonable alone. Together they leave the agent boxed in and blind: it can't see the sheet's
id, it can't spend tokens thinking, the build step dies quietly, and the system **reports success anyway**. The fix
is to flip the default: **the agent sees everything (except what the user marked secret), has room to think, chooses
from a full set of tools, asks the user when it is unsure, and the system is honest when it fails.** Safety stays
where it protects the user (approvals on anything that sends, writes, pays or deletes), not where it protects the
system from the agent.

## 1. Answers to the questions behind this plan

**Why didn't the agent ask for the sheet's id in the drill?** Three reasons, all ours:
1. Its build step failed (out of tokens), so it never reached the point where it decides what to ask.
2. It didn't need to *ask* the id: the sheet's address was kept by code under the page name "docs.google.com". But it
   only saw `spreadsheets/d/███`, and nothing told it the Drive clicks were just the way to reach that page.
3. Its instructions say "how to build it is never a question": it has no habit of asking for a value it could use to
   do the job better, and no way to propose "connect Sheets and I'll write the rows directly" as a question.

**How did a check save a failed design?** `gate.ts` refuses `done` up to `MAX_DONE_REFUSALS = 2`, then saves "with
gaps the review lists". The only fallback to the plain recording (`worse()`) is for a design that **lost** work or has
steps that **can't run**. A design that built *nothing* passes as "designed", and its summary (the agent's own words)
describes steps that don't exist. A check meant to keep the agent from looping became a stamp of approval.

**Is masking the problem?** In this run, directly: it hid the sheet's id (a long id looks like an API key). More
widely, it hides emails the task is about, ids the agent needs to open things, and values it should compare. Nebius
runs with Zero Data Retention; the user chose to show the task. Masking text costs more than it protects.

## 2. Principles for the next version

1. **See everything the user showed.** No pattern masking of text. Only what the user marked private (the Private
   words field) and password / secret fields (never recorded at all) stay hidden. Pictures stay blacked out where
   private words or secret fields are (the user asked to keep that).
2. **Room to think.** Every agent call gets enough tokens to reason and answer; a reply cut off is retried with
   thinking off, never silently dropped.
3. **Fail loudly.** A design that didn't build its rules is "kept", with the reason in plain words on the Record
   screen. A summary never names a step that doesn't exist.
4. **Ask, don't refuse.** A guardrail that today refuses an edit becomes a question to the user when the edit might
   be what they want (an outward step, a new site, an app step). Refusals stay only for what is never OK.
5. **The right model for the job.** The big model thinks (understand, plan, diagnose a failure); small, mechanical
   work (fixing a tool call's arguments, labelling steps, writing a caption, choosing tools from a list) goes to the
   fast model.
6. **Tools over clicks when the user allows it.** Wherever the recording works inside an app that has a connector,
   the agent proposes using it, in the drill, with the connect button; the user decides.
7. **Measure every change** on the same recordings (§6) before it ships.

## 3. Changes

### 3.1 Policies and rules (first: they block everything else)

| # | Change | Where | Who | Status |
|---|---|---|---|---|
| P1 | **Text masking off** by default: evidence, timeline, tool results, page names, captions' questions, narration, memory. Kept: the user's **Private words** (typed on the form) and secret/password fields (never recorded). A setting "Hide emails and ids from the AI" (off) for those who want the old behaviour | `mask.ts` callers (13 files), `recording-store.ts`, Settings | R + A | ☐ |
| P2 | Pictures: unchanged, blacked out where private words or secret fields are | `screen.ts` | — | ☑ |
| P3 | **Rules audit**: every refusal in `rules.ts`, `gate.ts`, `core/guard.ts` sorted into *never* (keep as refusal: turning approval off, removing a question the user answered, scripts from repair), *ask the user* (becomes a drill question: new site, outward step, app step, removing recorded work), or *drop* (paternal: "the recording already answers this" heuristics, "a step can't be removed"). One table in `docs/agents/rules.md`, reviewed by both | `rules.ts`, `gate.ts`, `guard.ts` | R + A | ☐ |
| P4 | **The finish check is honest**: after its refusals it no longer saves "designed". If rules aren't built by real steps, or nothing beyond proposals and the schedule changed, the result is **kept** (the recording), the Record screen says "The design didn't finish: <what's missing>. You can edit it, or record again", and the review lists the agent's claims it couldn't back | `gate.ts`, `orchestrator.ts`, Record screen | R | ☐ |
| P5 | Question budget: from "5, then defaults" to "as many as the design needs, grouped on one screen"; "how to build it" questions allowed when the answer is the user's (which sheet, which tab, use the app or click) | `questions.ts`, prompt | R | ☐ |

### 3.2 The design agent: one designer that edits the workflow like a file, and a critic

*Revised the same day: six roles would lose context at every hand-off, and today's failures weren't from too few
agents. Two model-driven parts, both seeing the full context; the rest is code.*

**The designer** (smart model, one conversation from start to finish): understand → ask (app offers, ids, the user's
decisions) → write the workflow → fix what the checks say → test → done. Nothing is summarised away between stages.

**The critic** (smart model, one short call): the task model, the finished workflow and the test report in; specific
gaps out ("rule 1 isn't built by any step", "s2–s5 only reach the sheet: open it directly", "use the Sheets app
here"). The designer gets them back, at most twice. Replaces "refuse done twice, then save".

**The small model** only for mechanical side jobs: captions, choosing ~8 relevant app tools from a long list, fixing a
malformed tool call. Never for a judgment.

**The workflow is a file** (as an agentic IDE edits code):

| Tool | Does |
|---|---|
| `read_workflow` | the workflow as JSON, formatted the same way every time (one key per line), whole or one step by id |
| `write_workflow` | replace the whole workflow: the plan, or a big restructure |
| `edit_workflow` | exact text replacements on that JSON (`old` → `new`, each must match exactly once), several per call, all or nothing; a miss shows the nearest real text |
| `look`, `test`, `ask`, `done` | evidence, the safe test run, questions (any time, including app offers), finishing |

Every write is checked before it is kept: the schema, the variable check (`check.ts`), the safety rules, and whether
the player can run each step. A failed check changes nothing and returns exact problems ("s7: {{job.title}} is used
outside the loop that declares job"). Approval on anything that sends, writes or pays is added by code and can't be
taken off. Short forms the model may write, expanded by code on save: `"page": "s9"` (the real address),
`"target": {"like": "s14"}` (a recorded control), `"target": {"place": "s7"}` (whatever is in that spot today),
`"<id:s9>"` (a document's id), `"do": "click"` instead of channel and action.

| # | Change | Where | Who | Status |
|---|---|---|---|---|
| D1 | Room to think: big budgets for the designer and plan; a cut-off reply asked again with thinking off, then said | `orchestrator.ts`, `catalog.ts`, `packages/agent` | A | ☐ |
| D2 | **Reach vs work**: code proposes opening the page directly for a chain of steps that only reach a page later steps work on, across tabs too; the prompt says a file opened from Recent or search is one fixed file | `evidence/proposals.ts`, `prompt.ts` | A | ☐ |
| D3 | Ask any time, including ids and app offers; app offers before building (exists) | `orchestrator.ts`, `questions.ts`, prompt | A | ☐ |
| D4 | **read / write / edit_workflow** replace the ~16 edit verbs for the designer (the verbs stay for tests and old transcripts) | new `design/v2/file.ts` | A | ☐ |
| D6 | The critic replaces "refuse done twice, then save" | new `design/v2/critic.ts`, `gate.ts` | A | ☐ |
| D7 | Prompts rewritten: shorter, the goal first, examples with app steps and "open it directly", no lists of don'ts code enforces | `prompt.ts` | A (R reviews) | ☐ |
| D8 | App tools shortlist: ~8 per app, by the recorded work (writes → append / update; reads → get), the rest by `look` | `connectors.ts` | A | ☐ |
| D9 | Connectors offered only for real work in the app (typing, pasting, copying, reading), never for navigation clicks | `connectors.ts` | A | ☐ |

### 3.3 The repair agent: from "fix a locator" to "get the run done"

Today it gets 12 turns and $0.10, may retarget and edit within strict limits, can't add app steps, has no memory of
what it already tried in the episode, and doesn't see the recording. Proposed powers, each with the user in the loop
where it changes what the workflow does:

| # | Power | Today | Proposed |
|---|---|---|---|
| X1 | See the page | outline, find, inspect, screenshot (Pictures on) | same, plus **the recording's evidence for this step** (what it looked like, the caption, what was said) |
| X2 | Skip a reach step | no | yes: "a later step opens this page by its address" (rung of the ladder, no model) |
| X3 | Change steps | retarget, limited edits | add, remove, reorder and change steps, with a why; anything outward or new **asks first** (inbox) instead of being refused |
| X4 | Use an app | no | propose an app step for the failing part ("Sheets' grid can't be typed into: write with GOOGLESHEETS_…"): an inbox question with the Connect button; on yes, edits and retries |
| X5 | Remember | none within an episode | a repeat guard (same call twice → told so) and site notes across runs (exists) |
| X6 | Budget | 12 turns, $0.10 | 20 turns, $0.20, the fast model for probing (find, outline, inspect), the smart one for deciding |
| X7 | Outcome | resolve / commit / escalate | the same, and escalate always says in plain words what it tried and what the user can do |

Where: `packages/player/src/repair/*`, `core/guard.ts` (the guard follows P3's table). Owner: A.

### 3.4 Replay and connectors (small, mine)

| # | Change | Status |
|---|---|---|
| C1 | Drive / Sheets / Docs pages: the player opens a document by its id when a step clicks it in a file list (fallback before repair) | ☐ |
| C2 | Writing into Sheets' grid by replay (F9) stays unsupported: the design uses the app step, or asks to connect | ☐ |
| C3 | Captions: no 400 cap, three at a time | ☑ `6435651` |

## 4. Order of work

1. **P1, P4, D1, D9** (a day): masking off, an honest finish, room to think, the Drive offer fixed. The YC task
   re-recorded should at least fail honestly, or work.
2. **D2, D3, D8, X2** (a day): reach vs work, ask before building with app offers, the tool shortlist, skipping reach
   steps in replay. Expected: the YC task designs as "read jobs → AI picks 5 → read sheet → AI keeps new → append".
3. **D4, D6, D7, P3, P5**: the workflow as a file, the critic, the prompts, the rules table and the questions.
4. **X1, X3–X7**: the repair agent's new powers.
5. After each step: §6.

*Oct 25, evening: Akshat has the whole codebase for this (record side included); Rushil reviews the design agent's
prompt and tools after.*

## 5. What it costs

Design today: ~$0.12 for this task (33 caption calls, ~10 big-model calls). Writing the workflow in one go instead of
one change per turn needs fewer big-model calls; the critic adds one or two short ones: about the same or less.
Repair: up to $0.20 per episode (from $0.10). Text masking off: no cost; a trust question, answered by Zero Data
Retention and the user's own Private words.

## 6. How we'll know it works

The same recordings, designed and run after every change, scored the same way:

| Task | Pass means |
|---|---|
| YC jobs → sheet (this one, re-recorded) | 5 new jobs appended by an app step, no Drive steps, no duplicates on a second run |
| A–E from checkpoints 5–6 (HN top 3, YouTube newest, rupee rate, Wikipedia PDF, canvas) | as in checkpoint 6, day 1 and day 2 |
| A forced failure (a renamed button) | repaired without the user, or one clear question |

Reported per task: designed / kept (and why), calls, cost, run result. A change that makes any task worse doesn't
ship.
