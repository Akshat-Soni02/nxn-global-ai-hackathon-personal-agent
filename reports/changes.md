# Changes: where the whole product stands (27 Oct 2026)

Written 27 Oct 2026 from the code on `main` (`85d5ebd`: PR #25, the blocks revamp, reached `main` through PR #26).
It covers all four parts the product revolves around: **recording**, the **design agent**, **replay** and the **repair
agent**, plus connected apps and the window. It started as a table for PR #25 and is now the one place that says what is
done, what is half done, what is not started, what is broken, and what can go wrong while a workflow runs.

## 0. How to read it

| Word | Means |
|---|---|
| **Done** | built, tested, and checked against the code on 27 Oct |
| **Partly** | some of it is built; the row says which part is missing |
| **Not started** | no code yet; §3 and §4 say what it is, why it is needed, and why it isn't built |
| **Bug** | the code does the wrong thing today (§5). Small, medium or big: *big* = a run does the wrong thing and says ok, loses data, or can't recover; *medium* = a run fails or misleads, but visibly; *small* = wording, an edge, a cosmetic slip |
| **Fix (A)** | a fix in Akshat's area (replay, repair, connectors, the service); the PR lists those files for his review |

Every row carries `file:line` from `main`, so you can open it. `reports/plan-oct26-workflow-revamp.md` is the truth for
the revamp's 37 items (R1–R7); the older reports are reconciled in §7. Phase 2 of this audit (the fixes) tags each
fix with the id used here (A1, B3, C5…); when one lands, its row here changes in the same commit.

**Score of the revamp, from its plan file:** 37 items. **22 done, 10 partly done, 5 not started.**

**The idea of the revamp in one line:** a recording used to show as 33 cards, one per browser event. Now code groups
the steps into about 10 named **blocks** (a block is a named folder of steps), and the editor, the design agent, the run
page and repair all understand blocks.

---

## 1. Done (22 items)

| Plan id | What | In plain words | Main files |
|---|---|---|---|
| R1.1 | Blocks exist | New step kind `group`: a named folder of steps, one level only (no block inside a block) | `packages/core/src/skill.ts` |
| R1.2 | A block has no variables of its own | What its steps save is visible after it | `packages/core/src/check.ts`, `vars.ts` |
| R1.3 | Edit blocks | `wrap` (steps into a block, a loop or an if), `unwrap`, rename, insert, move, remove | `packages/core/src/edit.ts` |
| R1.4 | The guard treats a block as a container | Removing a block is judged step by step | `packages/core/src/guard.ts` |
| R1.5 | The runner understands blocks | A block's steps run in place with their own ids, so pause, resume and repair work as before | `packages/player/src/run.ts` |
| R1.7 | Tests for the above | Schema, edits, a failure inside a block and resume | each package |
| R2.1 | Code groups a recording | One block per thing done on a page: "Open …", "Copy … from …", "Fill in …". The YC recording went from 33 cards to 10 | `packages/recorder/src/blocks.ts` |
| R2.2 | Code names the blocks | By the page's title or site, never a URL or a document id | `blocks.ts`, `evidence/pages.ts` |
| R2.3 | Saved with blocks | At save, so even a design that did nothing reads well | `apps/daemon/src/record.ts` |
| R2.4 | Measured offline | 33 steps → 10 nodes, all named | `scripts/design-eval.ts` |
| R2.5 | "Tidy up" for old workflows | A button that groups a workflow saved before blocks and gives it a short name, as a draft you can save or undo | `apps/daemon/src/service.ts` (`tidyDraft`), `apps/ui/src/screens/Workflow.tsx` |
| R3.1 | Clean cards | Icon, plain title, one quiet line; no ids, channel names or addresses | `apps/ui/src/WorkflowTree.tsx`, `packages/core/src/names.ts` |
| R3.2 | A block is one node | Its steps open in the side panel | `WorkflowTree.tsx` |
| R3.3 | Side panel | Details (plain words) and Debug (ids, targets, values) | `apps/ui/src/NodePanel.tsx` |
| R3.4 | Addresses as site + page title | "Google Sheets · Ycomb jobs", never a document id | `packages/core/src/names.ts` |
| R3.5 | Problems sit on their node | An orange count on the node, a plain sentence in its panel | `apps/ui/src/review.ts` |
| R3.7 | Version notes and name in plain words | "Runs every day at 9:00 (was: by hand)" | `packages/recorder/src/design/v2/changes.ts`, `rules.ts` |
| R4.3 | "+" forms compile to real steps | The form's step is checked like any edit and inserted on the draft | `apps/ui/src/AddNode.tsx` (`stepOf`), `service.ts` (`editDraft`) |
| R5.1 | The design agent reads blocks | A block is a short list of step ids; `read_workflow { step }` unfolds one | `design/v2/tools.ts` (`workflowFile`) |
| R5.2 | The design agent writes blocks | `{ block, steps }`; an emptied block is dropped | `design/v2/tools.ts` (`expandStep`) |
| R7.1 | A run's page by block | Steps under their block's title with a state, folded when it went well | `apps/ui/src/runlog.ts`, `screens/Run.tsx` |
| R7.2 | Repair names the block | "Fill in Google Sheets (s11)" | `packages/player/src/repair/`, `core/names.ts` (`whereIn`) |

---

## 2. Partly done (10 items), re-checked

"Phase 2 id" is the fix in this audit that finishes it. Three rows are closed or merged by decision, not by code.

| Plan id | What is done | What is missing | Decision / Phase 2 id |
|---|---|---|---|
| R1.6 Code that checks step kinds | Outline, report, editor and tree handle blocks; code that walks steps with `walkSteps` needs no change | Repair's briefing doesn't describe `group`; version notes treat a block as one step; the ladder's detour stops at a block's edge; the edit error wording | **B1 ✔ done in Phase 2:** the briefing describes a block; version notes treat a block as one (a grouping is one note, a change inside isn't noted twice); a Confirm at the top of the next block completes the send; the edit error says "block". (A compile note: not needed, compile runs before blocks) |
| R2.6 Names for copied values | Named by column, label or the words before it ("amount", "link"); the design agent renames the rest | A value nothing describes stays `copied_1` until the agent renames it | **Closed: done by design.** The code names what it can; naming the rest is the agent's job |
| R3.6 Plain words for the agent's checks | The window rewrites the common ones (`plainProblem`, `apps/ui/src/review.ts:49-67`) | The gate's own messages still reach the window raw for several kinds | **B2 ✔ done in Phase 2:** nine more gate messages have a plain sentence (`plainProblem`) |
| R3.8 Screenshots before and after | Taken locally | They show the user's goal sentence, so they can't be committed | **Dropped for privacy** |
| R4.1 "+" under every node | In the editor: after every step, after the start, in empty loops and arms | Not on the workflow page | **Merged into R4.6** (the page's Edit mode) |
| R4.2 The node-type menu | Open, Click, Type, Read, AI step, Find files, App action | "Ask me" and "Wait for my OK"; "Show me" | **B4 ✔ done in Phase 2:** "Ask me" and "Wait for my OK" are in the "+" menu (a question, or an approval, on the step after the spot). Show me → R4.7 |
| R4.5 Group by hand | In the editor's step panel: block, for each, only if, unwrap, rename | "Put in a block" is still offered for a step already in a block (core refuses it) | **B3 ✔ done in Phase 2:** "Put in a block" is hidden for a block and for a step inside one (`blocks.ts`) |
| R5.3 Design prompt in blocks | The FILE section says to think in 5–8 named blocks | The rest of the prompt doesn't; no example reads a page in one block and writes in another (the YC failure) | **B5 ✔ done in Phase 2:** the worked example (a page read in one block, written in another) is in the file-mode prompt, with a test |
| R5.5 Real-model measurement | One run: 5 nodes, 3 questions, $0.131 | The recorded steps were kept because the sheet write wasn't built; the target was 2 runs | **B6** (the real checks in Phase 2) |
| R6.2 Undo and redo | The editor has them (`undoDraft`, `redoDraft`) | Not on the workflow page | **Merged into R4.6** |

---

## 3. Not started (5 items), explained

These five are the PR's "Next". None has code. For each: what it is, why it is needed, what exists today, and why it
isn't built. The plan's own order was design quality first (R5.3, R5.4), then R4.6, R6 and R7 (`reports/plan-oct26-workflow-revamp.md`, "Resume here"). R4.4 and R4.7 have no slot in it.

### R4.4 App action form (medium)

- **What.** Adding an app step by hand: pick the app, pick the tool, and a field appears for each argument the tool
  takes (from the tool's schema), with a picker for the documents the recording used.
- **Why it is needed.** Today the "+" App action is a dropdown of tool names and a box where you type **raw JSON**
  (`apps/ui/src/AddNode.tsx:256-270`, "Its values (JSON)"). Nobody should have to write `{ "spreadsheet_id": "…" }` to
  say "add a row to my sheet". Without the form, adding or fixing an app step by hand is error-prone, and only the
  design agent does it well.
- **Why not built.** The agent writes app steps, so the hand path was ranked below design quality. It needs the daemon
  to return a tool's schema to the window (`appTools` exists but returns names), and a small form generator.

### R4.6 Edit and Test as two modes of the workflow page (big)

- **What.** The workflow page gets **Edit** (the "+", rename, Group it, undo, all on the page) and **Test** (runs the
  safe test and puts a ✓ or ✗ on each node), with Go live as one button. The two halves left over from R4.1 and R6.2
  belong here.
- **Why it is needed.** Today editing happens in a separate editor screen, and after a hand edit there is no way to
  check it except a real run. A user can't see that a fix works before it runs for real.
- **Why not built.** It is the largest item: it merges two screens (`Workflow.tsx` and `Editor.tsx`), and R4.7 and R6.1
  show their results on the nodes, so they wait for it.

### R4.7 Show me (big)

- **What.** Record just one block by doing it once ("show me how to fill this form"); it is compiled and named like a
  recording and put in at the "+".
- **Why it is needed.** When one part of a workflow is wrong or new, the only ways today are to record the whole task
  again or build the part by hand. It also lets a user teach repair the right way.
- **Why not built.** It needs a recording session with a *scope* (start and stop around one block), compile
  into an existing workflow, and UI for the demonstration. Nothing in the recorder takes a scope today.

### R5.4 The gate and the critic speak in blocks (medium)

- **What.** Their messages name blocks: "'Add a row for each job' types into a cell it can't find", not
  "s14: …".
- **Why it is needed.** The agent now thinks in blocks (R5.1–R5.3), but the feedback it gets in the loop still comes
  as step ids, so it fixes at the wrong level. The critic even receives blocks as bare id lists (bug C1). The window
  maps ids to blocks only after the fact.
- **Why not built.** It waited on R5.3's measurement: how the agent reads blocks decides which messages matter.

### R6.1 The chat box, "What would you like to change?" (big)

- **What.** A box on the workflow page where the design agent edits the saved workflow from a sentence ("also skip jobs
  older than a week"); the changes show on the nodes before you save.
- **Why it is needed.** Today a change means the editor (step by step) or a new recording. A sentence is how people
  expect to change an agent's work.
- **Why not built.** It needs the design agent to run on an existing workflow with no recording (evidence optional),
  one episode per message, and the page's Edit mode (R4.6) to show the changes. Both are open.

---

## 4. More not started, found by scanning the whole product

These are features or product decisions, not bugs, so Phase 2 lists them and doesn't build them. Each says what it is,
why it matters, and why it isn't built. Evidence is `file:line` on `main`.

| # | What | Why it matters | Why it isn't built | Evidence |
|---|---|---|---|---|
| N1 | **Test one block alone** | You can't check one part of a workflow without running it all (§8) | Needs an API with a start step, the values earlier blocks made, and the page it expects; it belongs in R4.6's Test mode | `packages/player/src/run.ts:151-161`, `maxSteps` at `run.ts:61` |
| N2 | **Secret inputs from the Keychain** | A recorded password field becomes a `secret` input with no default; the run stops with "input … has no value" | Needs a way to enter the secret once and keep it in the Keychain; a product decision on where the person types it | `packages/player/src/node/inputs.ts:80`; `recorder/src/compile.ts:129, 317` |
| N3 | **Targets inside iframes and shadow roots** | A control you can see is "not found" if it sits in a frame | The matcher was written for the top page; frames need a way to name the frame in the saved target | `packages/player/src/web/match.ts:6` |
| N4 | **List position used by replay** ("the top job") | Recording stores where an item sat in its list; replay never reads it, so "the first job" can only be found by its text | The schema has it; the matcher and the saved target don't use it | `packages/core/src/trace.ts:85-90`; `apps/extension/src/describe.ts:386` |
| N5 | **Repair's fast probing model (X6)** | The whole repair episode runs on the large model; cheap probing could cost less | Needs a split of the episode into probe and decide; measure first | `packages/player/src/repair/repair.ts:30, 124` |
| N6 | **Open a Drive document by its id (older plan C1)** | When a step clicks a file in a list, replay can't fall back to opening it by address | Design proposes "open directly"; the player has no fallback | `recorder/src/evidence/proposals.ts:178-189`; `repair/ladder.ts:94` |
| N7 | **"Hide emails and ids from the AI" setting (older plan P1)** | A person who wants emails and ids masked has no switch | Only private words are masked today; the opt-in was never built | `packages/recorder/src/mask.ts:3-4` |
| N8 | **Shorter design prompts (older plan D7)** | The file-mode prompt is 200 lines, with "don't" lists that code already enforces | Needs a real-model measurement to know what can go; cutting blind could lower quality | `design/v2/prompt.ts` (200 lines against 190 at `b933fee`) |
| N9 | **The agent asks mid-build (older plan D3)** | A question the agent raises while building waits until the build ends | Only app offers are asked before building; the rest are batched | `design/v2/orchestrator.ts:503, 616-636`; `tools.ts:687` |
| N10 | **"When an email arrives" trigger** | The one trigger the docs promise that doesn't exist | Triggers are schedules and folder watches; email needs a mailbox connection and a poller | `packages/core/src/frequency.ts:12`; readme "Not yet" |
| N11 | **Mac-app repair past the first cheap fix; the fix you show saved as the repair** | Repair for Mac apps stops early; a fix a person demonstrates is not kept | Needs Mac-side recording of a demonstration | readme "Not yet"; `docs/design.md` status table |
| N12 | **30-day limit on run logs** | Logs grow for ever; the docs say a limit is planned | No pruning code exists; a retention rule is a product decision | `docs/product.md` ("a 30-day limit is planned"); nothing in `apps/daemon/src/store.ts` or `lifecycle.ts` |
| N13 | **Composio apps that need their own key** | Only apps Composio can sign a user in to by itself are listed | A per-app key flow is a product and security decision | `apps/api/src/tools/composio.ts:60-63` |
| N14 | **Release build and CI `.dmg`** | No downloadable app yet | `pnpm release` was never run; CI doesn't build the app | readme "Not yet" |
| N15 | **Mac-app elements with no name (Numbers cells)** | They can't be targeted | Nothing in `apps/mac` handles them | v2-fixed F11 (no match for Numbers in `apps/mac`) |
| N16 | **Spoken "never do X" becomes a Never rule** | What you say aloud isn't enforced; the form asks only for the goal | The Never list starts empty and nothing turns narration into rules | `apps/daemon/src/record-control.ts:168`; `design/v2/rules.ts:140` |
| N17 | **List places on tables and component grids** | "The third row" on a table isn't recorded by its place | Cell roles are skipped on purpose; table layouts need their own rule | `apps/extension/src/describe.ts:386-395` |
| N18 | **Canvas apps beyond Sheets** | A canvas app other than Sheets (a drawing tool) can't be replayed: its clicks are marked "drawn" | No connector row and no vision rung in the player | `apps/extension/src/capture.ts:252-254`; `connectors.ts:23-27` |
| N19 | **"All of them" in the which-file question** | A run that should take every matching file can't be chosen from the question | The options are "ask each time", "newest", "always this file" | `recorder/src/skeleton.ts:581-588` |
| N20 | **A reminder for a question that waits for ever** | A run waiting for you has no expiry or nudge | By design: "it waits as long as needed"; a reminder is a small feature | `apps/daemon/src/service.ts:622-650` |
| N21 | **Prompt caching for the design agent** | About 15–22k input tokens are re-sent every turn, which is most of a design's cost | Only old tool results are condensed; caching depends on what the model host supports, and needs measuring first | `packages/agent/src/agent.ts:391`; none in `packages/llm/src` |
| N22 | **Repair saying "this workflow is wrong"** | Repair keeps trying to fix a step that shouldn't exist; escalating is its only way out | Needs a new outcome and a place to show it; the cause is mostly closed at the source (clicks on containers are dropped) | `packages/player/src/repair/repair.ts:155-166` |
| N23 | **Several recordings at once (W4)** | While one recording is being turned into a workflow you can't start another; W1's Stop lets you end it, but not overlap two | The daemon keeps one recording state (`record-control.ts` has one `phase` and one session), and the Chrome button, Shadow.app and the Record screen all assume it; a set of sessions touches the extension and the Mac app too, and the record side is Rushil's own: a product decision first | `apps/daemon/src/record-control.ts:67-76`, `apps/daemon/src/main.ts` |

---

## 5. Bugs, by area

Every bug is fixed in Phase 2, whatever its size; only features and decisions (§4) are listed and left. Each row was
opened in the code on 27 Oct (the line numbers are as of `main`; Phase 2 re-checks each as it fixes it). Severity:
**BIG** a run does the wrong thing and says ok, loses data, or can't recover; **MEDIUM** a run fails or misleads, but
visibly; **SMALL** wording, an edge, a slip. **(A)** = in Akshat's area, flagged in the PR.

### 5.0 The ones you named

| Id | Sev | What goes wrong | Where | Fix |
|---|---|---|---|---|
| A1 | BIG | **Replay can't type into a sheet grid.** Recording drops the grid clicks (`normalise.ts:539, 551`, a compile note only); replay types into whatever cell is selected and reports ok. The design can keep those steps even when an app covers the page | `normalise.ts:551`, `compile.ts:102-104`, `web/executor.ts:228` | The general app rule: a `drawn` flag on the step, a gate that refuses a `drawn` page step where a connected app covers the page, "Can't run yet" when it isn't connected — **✔ done in Phase 2 (design-side gate corrected 28 Oct, §5.5 Y1):** the recorder keeps `drawn: true` on the step (`skeleton.ts`, `core/skill.ts`); the gate sends the agent back when a connected app covers the page; with no app connected, or none covering it, the review says "can't run yet" and what to connect, and Go live is refused **Checked for real, 27 Oct:** a workflow with a `drawn` grid step and Sheets connected was stopped before step 1 with this message, at $0 (`testing/checkpoint-7.md`) |
| A2 | BIG | The run starts, then fails at a step it was never going to finish. The check before step 1 exists only for app steps (`prepareMcpSteps`, `runner.ts:112`), counts as a failed run, and says nothing about a `drawn` step | `daemon/mcp-tools.ts:128-150`, `runner.ts:112` (A) | Extend that check to `drawn` steps; end as an inbox question (Connect / No), not a failed run. New failure class `app_needed` for what can't be known up front — **✔ mostly done in Phase 2:** the pre-run check now catches a `drawn` step and stops before step 1 with what to connect (`mcp-tools.ts`); such a stop (`needs an app:`) no longer counts toward auto-pause; replay fails a `drawn` step loudly without touching the page; classified `environment` (no ladder, no model). **Not built:** the inbox card with Connect / Use it / No: the run ends with the message and you connect in Apps and run again **Checked for real, 27 Oct:** the stop came before any step, with no browser and no model |
| A3 | BIG | **Repair can't add an app step.** Three locks: the repair briefing never lists the connected tools (`connectedTools` unfilled, `runner.ts:309-313`, so it says "none"); the ladder counts the guard's `ask` as a violation (`guard.ts:148-151`); a try can't get approval (`verify.ts:58-64`) | `runner.ts` (A), `repair/recover.ts` (A), `guard.ts`, `repair/tools.ts` | Fill the tools, let repair list and read an app's tools, make committing an app step an inbox question — **✔ done in Phase 2:** the repair briefing lists the connected tools (`connectedToolsOf`, `runner.ts`); an app-step fix is committed on your yes without a try, since it would write for real (`onlyAppSteps`, `repair/tools.ts`); the repair role says to do it. The ladder still never adds one (no human to ask) **Checked for real, 27 Oct:** app writes (a sheet cell, a doc line, each asked first) and their read-backs. **Repair checked live on a failing Docs step, 4 runs ($0.25): the agent can do it but does not reliably choose to.** Run 3 read the tool's arguments and wrote the exact right step; run 4, with only the try-refusal message added, never used the app (9 page looks, then escalated). The commit-for-your-yes step was not reached live. Fixes found on the way are in (`41ac2f2`, `7dab324`, `7dc57eb`); a code-driven app-first step is the proposed next fix. See `testing/checkpoint-7.md` |
| A4 | MEDIUM | **The connector's tool list is cut to 8 per app** (`LISTED_TOOLS = 8`, `design/v2/connectors.ts:189`). Akshat set it to 40 on 25 Oct (`542a6df`) and cut it to 8 the same day (`b6c4faa`) because all of them made a 27k-character message. (The *other* 8 is the critic's cap on gaps, `critic.ts:24`.) | `connectors.ts:189-228` | Back to 40, with each tool's line cut from 160 to about 100 characters, and a test that holds the message size — **✔ fixed in Phase 2** (`LISTED_TOOLS` 40, lines cut to 100 characters; a test holds the size under 7 k for one app and 20 k for three) |
| A5 | BIG | **Pop-ups over the page are not handled** (§6 rows 1–5): no code listens for `Page.javascriptDialogOpening`; a dialog hangs the page until a 15-second timeout, which repair then treats as "Chrome did not answer" | `extension/src/replay.ts`, `player/src/web/cdp.ts:67-99`, `classify.ts:40` (A) | JS dialogs **✔ fixed in Phase 2** (alert and "Leave this page?" accepted; a confirm or prompt accepted only in an approved step, else dismissed and reported). Still open: following a window the page opens, downloads, permission asks, the print preview **Checked for real, 27 Oct** (real Chrome, extension reloaded): an alert is accepted; a confirm in an unapproved step stops with the page's words; a confirm in an approved step is accepted |

### 5.1 Record and the design agent

| Id | Sev | What goes wrong | Where | Fix |
|---|---|---|---|---|
| C1 | MEDIUM | The critic sees each block as a bare list of step ids, so it may call a rule "not built" when a block builds it (extra fix turns, or a real gap passes) | `design/v2/orchestrator.ts:559` (`workflowFile` folds at `tools.ts:172-183`) | Pass `{ full: true }`, which already exists — **✔ fixed in Phase 2** |
| C2 | MEDIUM | A read-only app step is saved with approval switched back on: `requireApprovals` runs at save with no list of read-only tools, so every `mcp` call counts as outward. A read then asks you each run, and a scheduled run waits in the inbox | `apps/daemon/src/record.ts:340`, `guard.ts:41` | Hand the design's `readOnlyTools` to the save — **✔ fixed in Phase 2** |
| C3 | MEDIUM | One read-only app step anywhere switches off the "none of your work is left" check, so the agent can remove every recorded write with a reason and the gate passes | `design/v2/gate.ts:387-388` | Count only app steps whose tool isn't read-only — **✔ fixed in Phase 2** |
| C15 | MEDIUM | Accepting the "list item" proposal ("the newest, not the third") changes nothing: it has no edits, nothing checks the agent built it, and the review lists it as accepted | `evidence/proposals.ts:307`, `design/v2/tools.ts:1311-1321` | Don't record "accept" without edits, or have the gate check the steps changed — **✔ fixed in Phase 2** |
| C16 | SMALL | `design.json` cuts the plan reply to 4,000 characters and keeps no understand or critic reply, so a design can't be diagnosed from it | `orchestrator.ts:412`, `understand.ts:31`, `critic.ts:41` | Push each full reply to the transcript — **✔ fixed in Phase 2** |
| C23 | SMALL | "The recording already answers this" matches loosely and can drop a real code-side question | `orchestrator.ts:517-523` | **Checked, not a bug:** such an unknown is handed to the agent together with what the recording holds (`orchestrator.ts:517-523`), and the agent's own ask is never held back: nothing is dropped |
| C24 | SMALL | The vision timeout is still 90 s, and picture captions on a long recording take minutes | `llm/src/catalog.ts:82`, `evidence/captions.ts:24` | Size the timeout to the call; cap a caption's tokens — **✔ fixed in Phase 2** |
| C26 | SMALL | A stale `TODO(core): implement describeElement` comment, which has been built for a long time (`apps/extension/src/describe.ts:76`) | `packages/core/src/descriptor.ts:24` | Delete the comment — **✔ fixed in Phase 2** |

*Checked and not bugs:* a link with no accessible name (`seenAs` is for the designer by design; replay finds it by role, css and href: `locator.ts:14-19`);
generated ids (filtered in the extension before the recorder sees them: `describe.ts:37-38`).

### 5.2 Replay

| Id | Sev | What goes wrong | Where | Fix |
|---|---|---|---|---|
| C5 | BIG | **`on_item_fail: skip` never skips** while repair is on. A failing item returns "paused" (`run.ts:406`), and the loop only skips on "failed" (`run.ts:482`). One bad item starts paid repair, may save a version fitted to that one item, then the run waits and the other items don't run | `player/src/run.ts:406, 482`, `repair/recover.ts:56` (A) | Don't call the failure hook when the enclosing loop skips — **✔ fixed in Phase 2** |
| C28 | BIG | **`fs.write` silently overwrites an existing file**, and non-text content (a list, a number) becomes an empty file; the step says ok and needs no approval | `player/src/node/fs-channel.ts:123-128` | Write to a free path unless append; fail on non-text content; make overwriting an existing file ask — **✔ fixed in Phase 2** |
| C29 | BIG | **A number is read by stripping every character that isn't a digit, dot or minus:** "Rs. 500" becomes 0.5, "1.234,56" becomes 1.23456, "12k" becomes 12. A wrong number feeds branches and later steps with no error | `core/src/vars.ts:166`, `player/src/conditions.ts:49` | Reject text with stray dots or separators; fail rather than guess — **✔ fixed in Phase 2** |
| C6 | MEDIUM | An empty `text_visible` (or a `{{var}}` that resolves to empty) always holds: `includes("")` is true. A check that can't fail, and the run says succeeded | `player/src/web/checks.ts:12-14`, `core/src/skill.ts:103-104` | An empty value fails the check; `.min(1)` in the schema — **✔ fixed in Phase 2** |
| C9 | MEDIUM | The extension has one tab map and `endRun()` ignores which run. One run ending, or a cancel, closes **every** named tab, including a waiting run's. The resumed run finds a blank tab | `extension/src/replay.ts:134-145`, `background.ts:98-99` (A) | Store the run id on each tab; close only that run's — **✔ fixed in Phase 2** |
| C10 | SMALL | DevTools `attach` and the four `*.enable` calls have no time limit, and the tab counts as set up before they succeed | `extension/src/replay.ts:87-91` (A) | Send them through `withTimeouts`; mark attached after they succeed — **✔ fixed in Phase 2** |
| C21 | SMALL | The test run highlights in the last-used tab, not the step's own | `runner.ts:208`, `extension/src/replay.ts:93, 130` | Highlight in the step's tab — **✔ fixed in Phase 2** |
| C30 | MEDIUM | A `select` on a control that is no longer a `<select>` fails with "target is not a <select>", which the classifier calls bad *data*, so repair never tries | `repair/classify.ts:74`, `web/executor.ts:36` | Test the web drift errors before the data pattern — **✔ fixed in Phase 2** |
| C31 | MEDIUM | A `navigate` to an address that differs only by `#fragment` (Sheets `#gid=`, single-page apps) never "finishes loading": it times out and is retried after 30 s and 2 min | `web/executor.ts:143-146` | If only the hash differs, treat the page as loaded — **✔ fixed in Phase 2** |
| C33 | SMALL | `data.pick` keeps both readings of an ambiguous date (10/3/2026) and takes the first matching row, which can be the wrong date's | `player/src/node/data-channel.ts:27-56` | Fail as ambiguous when two readings match different rows — **✔ fixed in Phase 2** |
| C34 | SMALL | A pause inside a loop item saves that item's scope as the run's variables; after a resume, one item's values leak to later items and past the loop | `player/src/run.ts:129, 413, 478` | On resume restore the outer scope plus the one item — **✔ fixed in Phase 2** |
| C7 | MEDIUM | An app call has the SDK's default 60 s limit, but `mcpChannel` passes no signal, so **Stop can't cancel it**, and a slow write that finished shows "Request timed out", after which repair or a retry may repeat the write | `daemon/mcp-tools.ts:87-122` (A) | Pass the step's timeout and the run's signal — **✔ fixed in Phase 2** |
| C8 | SMALL | The safe test reports a signed-out or unconnected app step as "failed", not "not run" | `daemon/rehearse.ts:19-23` (A) | Add an app branch to `notRunWhy` and to the gate's exemption (`gate.ts:471`) — **✔ fixed in Phase 2** |

### 5.3 Repair

| Id | Sev | What goes wrong | Where | Fix |
|---|---|---|---|---|
| C4 | MEDIUM | **Repair's per-run budget resets after every wait.** A repairer is built per leg (`daemon/main.ts:194`), so "2 repairs per run" and the dollar cap restart each time a run waits; a run that keeps waiting can spend repair money again and again | `apps/daemon/src/main.ts:194`, `repair/repair.ts:69-111`, `recover.ts:74` (A) | Keep one repairer per run id — **✔ fixed in Phase 2** |
| C12 | MEDIUM | A repair that adds a plain **Enter** (or typed text with a newline) isn't treated as outward: in a chat or form it sends or submits, with no ask, and is tried live and committed. Design has `maySend` (`rules.ts:165`); repair doesn't use it | `core/src/guard.ts:28-33`, `repair/verify.ts:33` | Treat plain Enter and text with a newline as outward — **✔ fixed in Phase 2** |
| C18 | MEDIUM | "The next step's target is visible" counts as proof of a retarget, with no comparison with before the try, so a wrong click that did nothing passes and is saved as the next version | `repair/verify.ts:99-103` (A) | Measure the next target before the try; count it only if it wasn't visible then — **✔ fixed in Phase 2** |
| C11 | SMALL | The ladder's fuzzy match gives a prefix match 0.8, so "Add" can beat "Address…", and with no recorded role any control role can match | `repair/ladder.ts:127-132`, `inspect.ts:304, 335-339` (A) | No fuzzy retarget without a recorded role; require the same role group — **✔ fixed in Phase 2** |
| C32 | MEDIUM | A repair of an older version (a run waiting on v3 while v4 was saved by hand) is saved as the latest+1: your newer edits stop being the latest | `daemon/main.ts:196`, `daemon/skill-store.ts:39` | Refuse or re-base when the repaired version isn't the latest — **✔ fixed in Phase 2** |

### 5.4 Window, daemon and tooling

| Id | Sev | What goes wrong | Where | Fix |
|---|---|---|---|---|
| C20 | MEDIUM | **`pnpm lint` fails on `main`** (CI red): a label whose control Biome can't see through a ternary | `apps/ui/src/AddNode.tsx:154` | **Fixed in this audit's first commit** (one suppression with its reason) |
| C22 | MEDIUM | **Run now in the window never asks which file to use**: it starts with no inputs and the player takes the newest match; only the terminal `run` asks | `apps/ui/src/screens/Workflow.tsx:108`, `player/src/node/inputs.ts:61-73`, `daemon/main.ts:517` | Ask in the window, or honour "ask me each time" — **✔ fixed in Phase 2** |
| C25 | SMALL | An extension that wasn't reloaded after a rebuild sends no pictures, and nothing tells you | `extension/src/button.ts:128` | The daemon compares the extension's version on connect and says so — **Not fixed (listed):** the extension's version is always 0.0.0, so the daemon can't tell an old copy from a new one; it needs a build id baked into the bundle and compared on connect |
| C27 | SMALL | Two Biome warnings that stay: CSS descending specificity (`apps/ui/src/styles.css:1746`) and a spread on a reducer's accumulator (`scripts/evidence.ts:51`) | as shown | Reorder the rule; push into the accumulator — **✔ fixed in Phase 2** |
| W1 | MEDIUM | **No way to stop "Turning your recording into a workflow".** Once Stop was pressed, the design ran until it finished or failed, and the daemon takes one recording or design at a time, so a new recording could not start meanwhile (reported by Rushil, 28 Oct) | `apps/daemon/src/record-control.ts`, `record.ts`, `service.ts`, `apps/ui/src/screens/Record.tsx` | A Stop on the Record screen: the design is aborted at its next model call (an in-flight call is dropped), that recording's waiting questions are dismissed, nothing is saved, the recording is kept for a day, and a new one can start at once — **✔ fixed (28 Oct). Checked live:** with a model that never answered, Stop freed the screen in 0.6 s, the model call was closed by the client, nothing was saved, and no question stayed waiting |
| W2 | SMALL | The recording's questions showed on the Record tab as well as in the Inbox, so the tab was both the steps and the questions | `apps/ui/src/screens/Record.tsx:68` | The Record tab keeps to the steps and the Stop; a line says "N questions are waiting for you in the Inbox" with a link — **✔ fixed (28 Oct). Checked live** (the goal question showed in the Inbox with its badge, and only the pointer on Record) |
| W3 | SMALL | The Workflow, Run and Record screens had no Back, and every screen was held to a 980 px column (`.content { max-width: 980px }`), so they looked contained | `apps/ui/src/main.tsx`, `nav.ts`, `styles.css` | "← Workflows" / "← Runs" / "← The workflow" (a re-record) on the detail screens, Record back to Workflows, and the screens use the whole stage — **✔ fixed (28 Oct). Checked in a browser** on the Workflow, Run and Record screens |
| W5 | MEDIUM | **A recording started with Chrome's extension not connected captured nothing, said only "Nothing to save: no steps were recorded", and the Record screen never warned.** The step feed of what happened was gone once the screen went idle (reported by Rushil, 28 Oct, after his bridge file was removed by a reset) | `apps/daemon/src/record-control.ts`, `main.ts`, `types.ts`, `apps/ui/src/screens/Record.tsx`, `questions.ts` | A warning above the goal box when no extension is connected (it clears by itself within 4 s of Chrome connecting); an empty recording says Chrome wasn't connected and what to do; "What happened" keeps the last step feed under "Last recording" — **✔ fixed (28 Oct). Checked live** on a scratch daemon: warning shown, empty recording explained, warning cleared once an extension connected |

### 5.5 Found by Rushil's YC → Google Sheet recording (28 Oct): the design stopped after five refusals

The recording was designed with Sheets connected (40 Sheets tools shown). The review said "Can't run yet: s2, s11 work in a drawn area of this site: no connected app covers this site". Sheets *was* connected: the faults were in Shadow. **Correction to A1 above:** "checked for real" covered only the run's preflight; the design-side gate was never checked against a real recording, and it was wrong.

| # | Sev | What went wrong | Where | Fix |
|---|---|---|---|---|
| Y1 | BIG | The gate looked up the page of the *typing* step, but only steps that open a page have one, so a drawn step found no app ("no connected app covers this site") and the agent was never sent to the app's tool. The test that should have caught it keyed its map by the typing step | `design/v2/gate.ts` (`drawnProblems`), `core/skill.ts` (`webPages`), `daemon/mcp-tools.ts` | One rule, shared with the run's preflight: a step's page is the last one opened in its tab. A design that still ends with a drawn step, app connected, now says "can't run yet" too — **✔ fixed (28 Oct)** |
| Y2 | BIG | App steps refused for shapes code could settle: `spreadsheet_id` for the tool that says `spreadsheetId`, a step with `tool` and no `do`, one row where a list of rows goes, a missing argument named without its allowed values, a trigger input written `"type": "number"` (refused four times as "a step, type: Invalid input") | `design/v2/connectors.ts` (`fitArguments`, `describeArgument`, `rowProblems`), `tools.ts` | Code renames and wraps and says so; refusals name the choices and the real path — **✔ fixed (28 Oct)** |
| Y3 | MEDIUM | Shadow's own window (the Record button's Stop) was recorded as a block "Open 127.0.0.1:… / Click Stop" | `daemon/daemon.ts`, `main.ts` | Events from the window's own address are dropped at capture, so the design agent never sees them — **✔ fixed (28 Oct)** |
| Y4 | MEDIUM | The same questions listed twice in "Not asked"; "How often should it run?" asked although the form holds the user's Frequency; a question about an input the design removed still asked | `orchestrator.ts`, `tools.ts` | Each once; frequency never asked; an input from the recording that no step reads is dropped — **✔ fixed (28 Oct)** |
| Y5 | MEDIUM | "The test run didn't run (no automation window)" was shown whenever the design stopped early | `review.ts` | Says the design stopped before it got there — **✔ fixed (28 Oct)** |
| Y6 | BIG | **"The top 5" had no code path.** An AI step asked to take the first 5 returned items 1, 2, 3, 2, 5 and the run stopped on its own pick check (live run, 28 Oct); `max_items` is a cap that fails the run on a longer list, not a count | `core/skill.ts` (**(A)** loop `first`), `player/run.ts`, `gate.ts`, `prompt.ts`, `guard.ts` | A loop goes through only its first N, counted by code; the gate sends "take the first N" AI steps to it — **✔ built (28 Oct); not yet checked live: needs the daemon restarted** |
| Y7 | MEDIUM | An AI step with no inputs told to read "the page" would invent its answer | `gate.ts` (`stepProblems`) | The gate says it sees only its inputs — **✔ fixed (28 Oct)** |
| Y8 | MEDIUM | The critic asked for the literal cell A2/A3 (which would write over earlier rows) | `critic.ts` | The critic is told a recorded cell shows where one row landed — **✔ prompt fixed (28 Oct)** |
| Y9 | MEDIUM | An approval card for an app write ("Approve: Append one job row to sheet") shows no values: you approve blind | `daemon/service.ts`, inbox card | **Open**: show the resolved arguments on the card |

Live evidence (28 Oct, Rushil's daemon, real model and Sheets, within the ledger): the model's own corrected workflow ran its page read, sheet read and AI extraction of 20 jobs for real; the append was not approved because the old daemon ignores `first`.

*Checked and not bugs:* a resumed run or walk that did nothing isn't "nothing to do" (`run.ts:182-191`: a resumed leg can't see the acts of the leg before it, and a walk's skips are yours: deliberate).

**Totals:** 35 bugs. **7 BIG** (A1, A2, A3, A5 from you; C5, C28, C29 found by the scan), **16 MEDIUM**, **12 SMALL**. One
(C20) is already fixed in the commit that wrote this file; Phase 2 fixes the other 34. A step that was never
meaningful but is classed as drift and "repaired" (`classify.ts:80-90`) is mitigated at the source and listed as N22.

Reported by Rushil after Phase 2 (28 Oct): W1, W2, W3 and W5 below, fixed; the fourth part of that report (several recordings at once) is N23.

---

## 6. What can go wrong while a workflow runs

What a person sees, in the order a run meets them. "Fix" is the Phase 2 id that closes it; "listed" means it is not
fixed in this audit.

| # | What can go wrong | What you see | Fix |
|---|---|---|---|
| 1 | A pop-up over the page: a page's own `alert`, `confirm`, `prompt`, or "Leave this page?". Nothing in the extension or the player listens for `Page.javascriptDialogOpening` | The page freezes behind it; the step times out ("did not answer") and repair sees a frozen page | **✔ fixed (A5, JS dialogs):** an `alert` or "Leave this page?" is accepted; a `confirm` or `prompt` is accepted only inside a step you approved, else dismissed and the step fails with "the page asked …" for you to answer by hand |
| 2 | The page's own Print button (Chrome's print preview over the run). Only Shadow's own `save_pdf` step prints, through `Page.printToPDF` | The run waits behind the preview. Not verified live | listed: not fixed. Needs a live Chrome to verify (print preview, a popup window, Save-as and permission asks are browser UI, not page dialogs) |
| 3 | A window the page opens by itself (an OAuth sign-in, `target=_blank`). Tabs are followed by address; nothing follows a window the page opens | The next step looks in the wrong tab | listed: not fixed. Needs a live Chrome to verify (print preview, a popup window, Save-as and permission asks are browser UI, not page dialogs) |
| 4 | Chrome's own Save-as and permission asks (notifications, location, clipboard). Download behaviour is set only in the dev path (`player/src/node/chrome.ts:108`) | The run stops behind it | listed: not fixed. Needs a live Chrome to verify (print preview, a popup window, Save-as and permission asks are browser UI, not page dialogs) |
| 5 | A Mac app's modal sheet or alert; nothing in `apps/mac/Sources` looks for them | Mac-app steps can't find their target | listed (needs `pnpm setup:mac` to verify) |
| 6 | **Typing into a spreadsheet's cells.** Recording drops the grid clicks (`normalise.ts:551`, a compile note only); replay types into whatever cell is selected and reports ok | Data lands in the wrong cell, with a green run | **✔ fixed (A1, A2):** the step carries `drawn`, replay refuses it before touching the page, the design uses the app, and a workflow without the app can't go live |
| 7 | A workflow with app steps, **signed out**: `prepareMcpSteps` fails the run before step 1 ("this workflow uses a connected app: sign in to Shadow in Settings first", `apps/daemon/src/mcp-tools.ts`) | A failed run, no money spent. It counts toward the three-failures auto-pause | **✔ fixed in part (A2):** it stops before step 1 with "needs an app: …sign in", and no longer counts toward the three-failures auto-pause. The Connect card is not built |
| 8 | An app step whose **app isn't connected** ("step s11 uses …: connect googlesheets in Apps first") | The same: failed before step 1 | **✔ fixed in part (A2):** the same: stops before step 1, not counted toward auto-pause |
| 9 | **shadow-api down** or unreachable | "Shadow's service could not list your connected apps: …", failed before step 1 | listed |
| 10 | A **local** shadow-api restarted (`STORE=memory` forgets sign-ins) | App steps fail until you sign in again | documented (§10) |
| 11 | A missing or invalid `COMPOSIO_API_KEY` | Missing: the app routes answer 503 (`apps/api/src/app.ts:252`). Invalid: shadow-api logs `composio ok:false` once at start (`apps/api/src/main.ts:40-45`), then the app calls fail. Either way app steps fail | listed |
| 12 | A **hung app call**: the MCP channel has no timeout (C7) | The run sits until you press Stop | **C7** |
| 13 | **Another run ends** and closes the named tabs (C9) | A second run in progress loses its tab | **C9** |
| 14 | DevTools `attach` and `*.enable` have no time limit (C10) | A stuck tab hangs the step | **C10** |
| 15 | An **empty `text_visible` check** always passes (C6) | A check that can't fail, so a wrong page looks fine | **C6** |
| 16 | A target inside an **iframe**: the matcher doesn't look inside frames (`player/src/web/match.ts:6`) | "Not found" for something you can see | listed |
| 17 | A **secret input** (a password field): no way to supply it (`player/src/node/inputs.ts:80`) | "input … has no value" | listed |
| 18 | The **free tier used up** | AI steps and app steps wait; page and Mac-app steps still run | by design |
| 19 | **Two daemons** (the login-item one and `pnpm daemon`) | The second stops with "another daemon is already listening on …" (`apps/daemon/src/server.ts:20`) | documented |
| 20 | A **Run now of a workflow that fails** starts the paid repair agent | Real money per failed run (about $0.04–0.07 each, measured on 23 Oct) | by design; announce it when testing |
| 21 | **File upload steps** without "Allow access to file URLs" on the extension | "Not allowed" | documented |

---

## 7. The older reports reconciled

Each row of the older reports was opened against the code on 27 Oct. Ids are the reports' own (section, then the
row's place in its table). "→" says where the row went in this file.

### 7.1 `section-study.md` (18 Oct, replay and recovery): 87 rows

**60 fixed, 14 partly, 12 open, 1 undecided.** The fixed ones need no action; the main ones are noise and selection
clicks dropped (R1-1, R9-1, R9-2: `normalise.ts:196, 257, 326, 574`), tab switches kept and named tabs (R2-1, R9-5:
`background.ts:361`, `replay.ts:62`), screenshots and narration detection (R5-1, R7-1: `mac-binary.ts:7`), narration by step
ranges (R8-1), `{{variable}}` file checks, the guard's keep-the-work rule (D4-1, D4-2: `gate.ts:363-396`), the agent's
tools and ids (D3-1…D3-8, `design/v2/tools.ts`), the matcher reading text, label and `near` (P3-1, P3-2:
`web/match.ts:159, 262`), DevTools timeouts in repair's tries (P9-1, X4-1: `cdp.ts:67-99`), "extension did not answer"
classed as environment (X1-2: `classify.ts:40`), and the keep-a-step-in-its-tab fix (P2-2).

Not fixed:

| Id | The problem | Status | Where it went |
|---|---|---|---|
| R1-2 | A link with no accessible name is recorded as `link:''`; the `seenAs` words reach only the designer (`describe.ts:156`) | PARTLY | Not a bug: replay finds it by role, css and href (`locator.ts:14-19`) |
| R1-3, R9-3, P4-1 | Typing into a Sheets grid: the cell is read from the Name Box (`capture.ts:133`) but replay has no go-to-cell; typing lands in the selected cell (`normalise.ts:539`) | PARTLY | **A1–A3**: the answer is the connected app (decision 1), not a grid adapter |
| R3-1 | Numbers clicks recorded as nameless `AXScrollArea` and dropped (`normalise.ts:162`) | OPEN | N15 (§4) |
| R5-2 | A stale extension (not reloaded after a rebuild) sends no pictures; the daemon doesn't notice (`extension/src/button.ts:128` handles only the page button) | OPEN | **C25** |
| R9-6 | A click that expanded something is kept as a step on purpose (`normalise.ts:574-584`) | PARTLY | By design |
| R9-7, R10-4, D2-3 | Repeats, dates and constants are *proposed* by code (`proposals.ts:98, 330, 418`); the model decides | PARTLY | By design |
| R10-3 | "The top job" is recorded as list position but the draft locator doesn't store it (`locator.ts`) | PARTLY | N4, **C15** |
| D1-2 | About 15–22k input tokens re-sent each turn; no prompt caching found (`agent/src/agent.ts:391`) | OPEN | N21 |
| D2-2 | Many checks left `{}` (`skeleton.ts:261-283`); the report called it harmless | OPEN | By design |
| D5-3 | A question can block a save for as long as it takes you (`record-control.ts:7`) | PARTLY | N20 |
| D7-3 | Near the cost cap in both recordings; cap raised to $0.25, not removed (`budget.ts:8`) | PARTLY | Watch; measured in the real checks |
| P4-2 | No evidence a designed workflow reads existing rows before writing (`skeleton.ts:187, 226`) | PARTLY | B6 (real check) |
| P6-2 | `on_item_fail: skip` never skips while repair is on (`recover.ts:56`, `run.ts:406, 482`) | OPEN | **C5** |
| P8-2 | A repaired outward step can't be proven by running it, because a try can't get approval (`verify.ts:33, 58`) | PARTLY | **A3** (the approval lock) |
| P8-3 | Typing into another site's document never needs approval (`guard.ts:21-39`) | OPEN | Decision, unchanged: listed |
| X1-1 | A step that never made sense (a container click) is classed drift and "repaired" (`classify.ts:80-90`) | OPEN | Mitigated at the source (R1-1); no further fix |
| X2-2 | The ladder's fuzzy rung can retarget a container click onto a button whose name starts the container's text (`ladder.ts:127`, `inspect.ts:303`) | OPEN | **C11** |
| X3-1 | "The next step's target is visible" counts as evidence for a wrong fix (`verify.ts:85-114`) | OPEN | **C18** |
| X3-2 | A try may start after the failed step | UNDECIDED | Could not be traced from the report's wording; dropped |
| X4-3 | Repair keeps fixing a step that shouldn't exist; it has no way to say "this workflow is wrong" (`repair.ts:155-166`) | OPEN | N22 |
| X4-4 | The failure report is built once and re-shown, not rebuilt (`repair.ts:119`) | PARTLY | Small; listed |
| X6-1 | A ladder fix is saved without review (`recover.ts:122`, `repair.ts:78-90`); only an agent commit asks (`guard.ts:67`) | OPEN | Decision: repair commits go live at once, and Roll back exists |
| X6-2 | Repair's per-run limits reset after every wait (`daemon/main.ts:194`) | OPEN | **C4** |

### 7.2 `plan-oct25-agents-v3.md`, `record-v2-whats-fixed.md`, `review-oct25-record-mcp.md`, `oct26-file-mode-yc-evals.md`

Fixed since they were written (no action): named tabs kept while a run waits (`runner.ts:326`, `cf31b8d`); a
`{{variable}}` file path checked when designed (`fs-channel.ts:64-65`); the agent's `confirm` means nothing now
(`tools.ts:697`); the walk log's `highlighted` and "no value yet" in a test run (`run.ts:322-357`); a `do` step's `id`
and `requires_approval` no longer leak into its args (`tools.ts:977`).

| Report and id | The item | Status | Where it went |
|---|---|---|---|
| plan-oct25 D3 | The agent can ask any time; today only app offers are asked first, the rest after building (`orchestrator.ts:503, 616-636`) | PARTLY | N9 |
| plan-oct25 D7 | Prompts shorter, no "don't" lists code enforces; the file is 200 lines against 190 (`prompt.ts`) | PARTLY | N8 |
| plan-oct25 P1 | The "Hide emails and ids from the AI" setting | OPEN | N7 |
| plan-oct25 X4 | Repair offers to connect an app; repair has no app or connect code (`repair/*`) | OPEN | **A3** |
| plan-oct25 X6 | Repair's fast probing model; the whole episode runs on the smart profile (`repair.ts:124`) | PARTLY | N5 |
| plan-oct25 C1 | The player opens a document by id when a step clicked it in a list | PARTLY | N6 |
| plan-oct25 C2 | Sheets-grid writes by replay stay unsupported; with no app connected the design still types into cells and nothing warns | PARTLY | **A1** (the warning and the gate) |
| plan-oct25 §6 | Re-measure the YC task with Sheets connected, tasks A–E, a forced failure | UNKNOWN | The real checks (Phase 2) |
| v2-fixed F7 | The test run highlights in the last tab, not the step's own (`runner.ts:208`, `extension/replay.ts:93, 130`) | OPEN | **C21** |
| v2-fixed F9 | Replay can't write to a sheet cell or the next empty row (`executor.ts:228` reads Sheets as CSV only) | OPEN | **A1–A3** |
| v2-fixed F11 | Mac-app elements with no name | OPEN | N15 |
| v2-fixed F12 | A question can wait for ever (`service.ts:622-650`) | OPEN | N20 |
| v2-fixed F13 | "All of them" isn't offered in the which-file question (`skeleton.ts:581-588`) | PARTLY | N19 |
| v2-fixed F14 | Run now in the window never asks which file (`Workflow.tsx:108`; only the terminal `run` asks, `main.ts:517`) | OPEN | **C22** |
| v2-fixed F15, D4 | A spoken "never do X" isn't enforced (`record-control.ts:168`, `rules.ts:140`) | OPEN | N16 |
| v2-fixed F16 | `design.json` keeps the first message, the plain list and the plan reply, but no sign of stage 1's own reasoning | PARTLY | **C16** |
| v2-fixed F19 | List places on tables and grids (`describe.ts:386-395`) | OPEN | N17 |
| v2-fixed F22 | Canvas apps: a Sheets canvas can use the app route (`connectors.ts:23-27`); others have neither a connector nor a vision rung | PARTLY | N18 |
| v2-fixed F29 | "Recording already answers this" still drops code-side unknowns on a loose word match (`orchestrator.ts:517-523`) | PARTLY | **C23** |
| v2-fixed, rules | The gate checks only that the steps a rule names exist (`gate.ts:404-423`); the critic never blocks a save | PARTLY | Listed: needs a design |
| v2-fixed, captions | Picture captions: three at a time, but the vision timeout is still 90 s (`llm/src/catalog.ts:82`) | PARTLY | **C24** |
| v2-fixed, budget | One design spent all $0.25 in 55 calls; the call cap is gone, stuck designs stop (`budget.ts:7`) | PARTLY | Watch; measured in the real checks |
| v2-fixed, variance; D1–D3 | Six designs of D, three right; the KPI example not followed | UNKNOWN | Model behaviour; the real checks |
| v2-fixed, day 2; Mac | Day-2 re-runs, Rushil's four Mac recordings, real ⌘P, voice, Move to Trash | DONE (mine) | §9: day-2 A–D re-run on 27 Oct, `testing/checkpoint-7.md`; his are struck off |
| review | A recording on a real Google Sheet with Composio connected | PARTLY | App steps on a real sheet and doc verified 27 Oct (write and read-back); a recording of a Sheets task, designed with Sheets connected, is still to do |
| review | Rushil's review of `design/v2` | UNKNOWN | A human review |
| oct26-evals 1 | Replay into the Sheets grid unsupported; re-measure with Sheets connected | PARTLY | **A1–A3** built; the drawn stop and app writes checked for real 27 Oct; the re-design with Sheets connected needs a new recording |
| oct26-evals 2 | Does the run-5 shape hold on a second run; Nemotron sends big arguments as JSON strings (`tools.ts:34, 1222-1233`) | OPEN / PARTLY | The real checks (B6) |

---

## 8. Can a block run and be tested on its own?

**No.** It is a gap, and it is now item "Test one block" in §4.

- The player can start at any step id, which includes a block (`packages/player/src/run.ts:151-161`, `resume.at`), and
  stop after N steps (`maxSteps`, `run.ts:61, 123`; tested in `interpreter.test.ts:426`).
- What is missing: an API that takes a start step, **the values the block reads from earlier steps** (a block that
  writes a sheet needs the rows an earlier block read; nothing supplies them), **the page it expects open**, and a "Test
  this block" button. Without them a block run starts in the wrong place with empty variables.
- What exists instead: the **safe test** (`apps/daemon/src/rehearse.ts`), which runs the whole workflow without
  anything that sends or deletes, and **Walk through**, which runs one step at a time. Both are whole-workflow.
- It would be a small addition to R4.6's Test mode (a node's "Test from here").

## 9. Phase 5 (the proof matrix)

| Part | Whose | Status |
|---|---|---|
| Rushil's ⌘P check and the four Mac recordings | Rushil | **Struck off**: they need his own recordings and Mac permissions, so they are not on my list |
| A–D day-2 Run now from `~/shadow-tests/checkpoint-6/kit/` on `main`'s code | mine | **Done 27 Oct.** All four did their task, each result read against its live source (`testing/checkpoint-7.md`); $0.0003 |

## 10. How to run it

`pnpm daemon` does **not** start shadow-api. Connected apps need both:

1. In the root `.env` (copy `.env.example`): `NEBIUS_API_KEY`, `COMPOSIO_API_KEY`, and `SHADOW_API_URL=http://localhost:8080`.
2. Terminal 1: `pnpm api` (shadow-api on :8080; memory store, dev sign-in, no quotas; reads the root `.env`). Check:
   `curl localhost:8080/healthz` → `{"ok":true}`.
3. Terminal 2: `pnpm daemon`.
4. In the window: Settings → Sign in (the local page takes any email), then Apps → Connect.
5. With `STORE=memory`, sign in again whenever `pnpm api` restarts.

Without connected apps, only `pnpm daemon` is needed (a `NEBIUS_API_KEY` in `.env` serves the model calls directly).
Before the change that added `pnpm api`, the `COMPOSIO_API_KEY` in `.env` was read by nothing. Details:
`apps/api/README.md`, `readme.md` ("Running from the repository"), `CLAUDE.md`.

## 11. Where to read

| File | What it has |
|---|---|
| `reports/plan-oct26-workflow-revamp.md` | The revamp, item by item (R1–R7) with marks; "Resume here"; the log of what was measured |
| `reports/oct26-file-mode-yc-evals.md` | The real design runs on the YC recording |
| `reports/section-study.md` | The 18 Oct study of replay and recovery: each row's status is in §7 |
| `reports/plan-oct25-agents-v3.md`, `record-v2-whats-fixed.md`, `review-oct25-record-mcp.md` | Older plans and reviews; their open rows are in §7 |
| `testing/design-eval-ledger.md` | Every real-model run and its cost |
| `docs/cloud-architecture.md`, `apps/api/README.md` | shadow-api: sign-in, the model relay, the MCP endpoint, quotas |
| `CLAUDE.md` | The pipeline map, commands and conventions for whoever changes the code |

Also in the merge: PR #26 added a Composio skill for the agents (`.agents/skills/composio`, `skills-lock.json`). It is not
part of the revamp.
