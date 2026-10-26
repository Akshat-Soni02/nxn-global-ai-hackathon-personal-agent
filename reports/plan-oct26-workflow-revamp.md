# Workflow revamp: blocks people can read, fix and build (running plan, started Oct 26)

**This file is the source of truth for this work.** Anyone picking it up (a later session, Akshat, Rushil) starts at
[Resume here](#resume-here), does the next unchecked item, ticks it with its commit, and adds a line to the
[log](#log). Branch: `feat/workflow-revamp` (from `feat/record-mcp`, which is draft PR #24).

## 1. The problem, from the YC jobs → sheet workflow (screenshots, Oct 26)

What the user sees on a workflow's page today:

| What | Why it's a problem |
|---|---|
| **33 cards for one task**, one per browser event: "Open drive…", "Open what is at the place they clicked", "Click 'Ycomb jobs Google Sheets More info (Option + →)'", "Press Enter in the combobox", "Paste into 'C4'", "Press Enter in 'C4'" | Nobody can read the task in it. An hour isn't enough to check it. The user thinks in 5–7 things ("open the jobs, pick the top 5, open my sheet, skip the ones already there, add a row each"); we show the mouse and keyboard |
| **Titles made from locators** (an accessibility name with "(Option + →)" in it), and the same title twice ("Copy the text of '$160K - $200K'" ×2) | The title doesn't say what the step is *for* |
| **Raw detail on every card**: `WEB`, `s27`, `navigate`, `extract → copied_3`, `type "C4"` | Debug data shown as content; ids mean nothing to a user |
| **Long addresses spill out of the card** (`docs.google.com/spreadsheets/d/…`, the sheet's whole id) | Broken layout, and a private id on screen for anyone looking over a shoulder |
| **"Still to check" and "Not tested"** are the agent's raw messages: "rule 0 … no step open_yc_jobs, extract_top5 in the workflow", "s29 read exactly what s28 read…", nine "s5: target not found" | Written for the design agent, not the user. Nothing points to the card it is about |
| **Versions**: "removed s3; s2: check nothing; s4: check nothing; s7: url … → nothing" | A diff of internals |
| **No way to build or fix by hand** beyond the editor's per-step fields | The user can't add "an AI step here" or "skip this" in the way Gemini Enterprise's "+" allows |

What Gemini Enterprise's workflow builder gets right (the reference screenshot): **few nodes, each named for what it
does** ("Check calendar availability", "Focus time check"), an icon for its kind, an **If / Else** fork, a **"+" under
every node and in every empty arm** that adds a node of a chosen type with a short form, **Edit / Test** as two modes,
**Turn on** as one button, and **"What would you like to change?"**, a chat box that edits the workflow.

What we keep that they don't have: the workflow is **learned from one recording**, it acts in the user's own browser
and Mac apps, and it repairs itself. The revamp must keep all three and make them readable.

## 2. Principles

1. **A node is one thing the user would say they did.** Browser events are how a node does it, not what the workflow
   is. Target: the YC task in **≤ 8 nodes** (today 33).
2. **Every node has a name** that says what it does for the task, verb first, ≤ 6 words: "Open the jobs page",
   "Pick the top 5 jobs", "Skip jobs already in the sheet", "Add a row for each job". Never a locator, a URL, an id.
3. **The card shows the name and what it makes**, nothing else: an icon for its kind, the name, at most one quiet line
   ("→ top 5 jobs", "asks you first"). Ids, channels, actions, locators, values and test results live in the node's
   **details panel**, under **Details** (what it does, editable) and **Debug** (its browser steps, locators, last run).
4. **Problems sit on the node they're about**, in plain words ("Couldn't find the row's cell in the test"), with a
   count at the top. The agent's own wording never reaches the user.
5. **Everything the agent can do, the user can do by hand**: add a node of any kind with "+", rename, change, move,
   remove, wrap in "for each" or "if". The same edit operations underneath, so a hand edit and an agent edit are the
   same thing in history.
6. **Code first, model second**: grouping recorded events into nodes and naming them is code's job from the evidence
   (it already finds "chains" for proposals); the design agent refines names and structure; it never has to invent
   them from 33 events.

## 3. The model: blocks

**Decision (Oct 26): a new control kind, `group` (shown as a "block").** A block is a named node that holds the steps
that do one thing:

```json
{ "id": "b2", "type": "control", "kind": "group", "intent": "Open the jobs sheet",
  "steps": [ { "id": "s2", "…": "navigate drive" }, { "id": "s4", "…": "click Recent" }, { "id": "s5", "…": "open the sheet" } ] }
```

- It runs its steps in order, like the body of an `if` that always holds. Paths read `b2 > s5`.
- Inner steps keep their ids: repair, the ladder, approvals, `{{vars}}` and the run log work unchanged.
- A block is the unit of moving, removing, wrapping in a loop, renaming and adding.
- Loops and ifs hold blocks; a block holds plain steps (no blocks inside blocks: one level keeps it readable).
- A single step that already reads as one thing (an AI step, an app step, "Open the jobs page") needs no block.

*Rejected:* a `block: "title"` field on each step, with the UI joining neighbours. Moving, removing and adding "a node"
would then mean editing several steps that only share a label, and the agent and the user could split a block by
accident.

## 4. The work, in order

Status: ☐ to do · ◐ started · ☑ done (with commit). Each item is small enough for one sitting; tick it in the same
commit that does it.

### R1. Blocks in the core (the foundation; nothing visible yet)

| # | Item | Where | Status |
|---|---|---|---|
| R1.1 | `kind: "group"` in the Step schema (id, intent, steps ≥ 1), in `StepInput`, `walkSteps`, `findStep`, the discriminated union | `packages/core/src/skill.ts` | ☐ |
| R1.2 | Variables: a block doesn't scope (what its steps save is visible after it) | `packages/core/src/check.ts`, `vars.ts` | ☐ |
| R1.3 | Edit operations: insert / move / remove a group, `wrap` steps into a new group, `unwrap`, `set intent`; positions `into` a group | `packages/core/src/edit.ts` (+ `describeEdit`) | ☐ |
| R1.4 | The guard: a block is a container (removing one removes its steps, judged step by step) | `packages/core/src/guard.ts` | ☐ |
| R1.5 | The player runs a group's steps in order; resume inside a group; the run log names the block | `packages/player/src/run.ts` | ☐ |
| R1.6 | Everything that walks steps by kind: outline, approvals, rules, gate, review, tabsFixed, compile | `packages/recorder/src/**`, `packages/core/src/briefing.ts` | ☐ |
| R1.7 | Tests: schema, edits, run with a failure inside a block and resume, repair inside a block | each package | ☐ |

### R2. Code groups and names a recording (the YC task: 33 → ≤ 8)

| # | Item | Where | Status |
|---|---|---|---|
| R2.1 | `blocksOf(steps, evidence)`: consecutive steps grouped by what they do: a *reach* chain (navigate + clicks that only get somewhere, `isDocument`/`endsAt` in proposals.ts already finds these) → "Open ‹page›"; reads on one page → "Copy ‹what› from ‹page›"; typing/pasting/Enter into one form or sheet → "Fill in ‹form/sheet›"; an outward click → its own block | new `packages/recorder/src/blocks.ts` | ☐ |
| R2.2 | Names by code: the page's title or site name, never the URL ("Open the YC jobs page", "Open 'Ycomb jobs' sheet"); a document by its title from the tab | `blocks.ts`, `evidence/pages.ts` | ☐ |
| R2.3 | The recorded workflow is saved with blocks (compile), so even a design that does nothing is readable | `packages/recorder/src/compile.ts` | ☐ |
| R2.4 | Measure on the YC recording offline (`pnpm design:eval`, fake model, free): node count and names, in the log below | `scripts/design-eval.ts` | ☐ |

### R3. The workflow page: clean nodes, details on the side

| # | Item | Where | Status |
|---|---|---|---|
| R3.1 | Node face: kind icon (web, app, AI, files, if, for each, ask), the name, one quiet line; no ids, no channel/action; text wraps, never spills (`overflow-wrap: anywhere`, max two lines) | `apps/ui/src/WorkflowTree.tsx`, `styles.css` | ☐ |
| R3.2 | A block is one node; its steps open in the side panel, not in the tree | `WorkflowTree.tsx` | ☐ |
| R3.3 | Side panel on the workflow page (the editor has one): **Details** (what it does, inputs, what it makes, asks first) and **Debug** (its steps with ids, locators, values; last run's result per step) | new `apps/ui/src/NodePanel.tsx` | ☐ |
| R3.4 | Addresses shown as site + page title ("Google Sheets · Ycomb jobs"), never a document's id | `apps/ui/src/format.ts` | ☐ |
| R3.5 | Problems on nodes: a badge on the node, a plain sentence in its panel; the page shows "2 things to check" with links to the nodes | `apps/ui/src/review.ts`, `Workflow.tsx`; the daemon's review gets `{ step, plain }` per problem | ☐ |
| R3.6 | Plain words for the agent's checks (`gate.ts` messages → a user sentence each): "didn't find it in the test" → "Couldn't find ‹what› on the page when testing" | `packages/recorder/src/design/v2/review.ts` | ☐ |
| R3.7 | Versions in plain words by node name: "Runs every day at 9:00 (was: by hand) · Skips 'Open Drive' · The date is today's" | `packages/recorder/src/design/v2/rules.ts` (`changeNotes`), `Workflow.tsx` | ☐ |
| R3.8 | Screenshots before/after with the YC workflow (`shoot.mts`, MOCK=1), in this file | — | ☐ |

### R4. Build and fix by hand: "+" and node types

| # | Item | Where | Status |
|---|---|---|---|
| R4.1 | "+" under every node and in every empty arm or loop; one in the editor first, then on the page in Edit mode | `WorkflowTree.tsx` (`onAdd(at)`) | ☐ |
| R4.2 | The node-type menu: Open a page · Do something on a page (click/type, by target or **Show me**) · Read from a page · AI step · App action (connected apps) · Files · Ask me · If · For each · Wait for my OK | new `apps/ui/src/AddNode.tsx` | ☐ |
| R4.3 | A form per type, compiled to steps by the same short forms the agent uses (`{ do: … }` → `compile`), so hand-built steps are as runnable as agent-built ones; the daemon applies them as edit ops on the draft | `AddNode.tsx`, daemon `draft.*` API, a shared `compile` export from the recorder | ☐ |
| R4.4 | App action form from the tool's JSON schema (pick app → tool → arguments; `<id:…>` picker for recorded documents) | `AddNode.tsx`, daemon `apps.tools` | ☐ |
| R4.5 | Rename, remove, move up/down, wrap in "for each" / "if", unwrap, from the node's panel | `NodePanel.tsx`, edit ops from R1.3 | ☐ |
| R4.6 | Edit / Test as two modes of the page (Test runs the safe test and puts results on the nodes); Turn on as one button | `Workflow.tsx` | ☐ |
| R4.7 | **Show me**: record just one block (start/stop around a short demonstration), compiled and named like R2, inserted at the "+" | recorder session with a `scope`, daemon, UI | ☐ |

### R5. The design agent works in blocks (more reliable designs)

| # | Item | Where | Status |
|---|---|---|---|
| R5.1 | The workflow file the agent reads is block-level: blocks with their names and inner steps folded to one line each (`read_workflow { step: "b2" }` unfolds one) | `design/v2/tools.ts` (`workflowFile`) | ☐ |
| R5.2 | `write_workflow` accepts blocks: `{ "block": "Open the jobs sheet", "steps": [ … ] }` short form, recorded steps by id inside | `expandStep` | ☐ |
| R5.3 | Prompt: plan in blocks first (5–8 named things), then fill each; names are the user's words | `design/v2/prompt.ts` | ☐ |
| R5.4 | The gate and the critic speak in blocks ("'Add a row for each job' types into a cell it can't find") | `gate.ts`, `critic.ts` | ☐ |
| R5.5 | Measure: the YC recording, real model, 2 runs (ledger ≤ $0.50); target: designed, ≤ 8 nodes, every node named | `design-eval` | ☐ |

### R6. "What would you like to change?" (edit by chat)

| # | Item | Where | Status |
|---|---|---|---|
| R6.1 | A chat box on the workflow page: the design agent in file mode on the saved workflow's draft (no recording needed: evidence optional), one episode per message, the changes shown on the nodes before saving | daemon `draft.chat`, `designV2` with an existing skill, UI | ☐ |
| R6.2 | Undo / redo on the draft (edit history), as in the reference | daemon draft store, UI | ☐ |

### R7. Repair and runs in blocks

| # | Item | Where | Status |
|---|---|---|---|
| R7.1 | A run's page shows blocks with a state each (done, running, failed, skipped), the steps inside on demand | `apps/ui/src/screens/Run.tsx`, `runlog.ts` | ☐ |
| R7.2 | Repair's question and escalation name the block ("'Add a row for each job' stopped: …") | `packages/player/src/repair/*` | ☐ |

## 5. Decisions and open questions

- ☑ **Blocks are a control kind** (`group`), one level deep (§3).
- ☑ **Names are code's first** (R2.2), the agent's second (R5), the user's last word (R4.5).
- ☐ Show the "Debug" tab to everyone, or behind a setting? *Proposed:* everyone, folded; it's where a user learns why a
  node failed.
- ☐ Keep the per-step editor (`Editor.tsx`) once the page has Edit mode? *Proposed:* fold it into the page in R4.6.
- ☐ Is a loop over a block's steps written as a block inside "for each", or does "for each" hold steps directly?
  *Proposed:* either; the UI draws a for-each with one block inside as one node "For each job: Add a row".
- ☐ Rushil: review R1 (core schema) before R2 builds on it.

## Resume here

**Next:** R1.1. Read `packages/core/src/skill.ts` (LoopFields, BranchFields, the `Step` union, `walkSteps`), add the
`group` kind, and follow the type errors (`pnpm -r exec tsc --noEmit`) through R1.2–R1.6.

How to check work: `pnpm exec vitest run` (all packages), `pnpm exec tsc -p <package>`, `pnpm exec biome check packages
apps`; the UI with `MOCK=1 tsx …/shoot.mts` (see `reports/` for how screenshots were taken before); the design with
`pnpm design:eval <recording folder>` (fake model, free) or `--real --yes` (ledger in `testing/design-eval-ledger.md`).
Never commit a real document id, email or recording: use made-up ones in tests.

## Log

- **Oct 26**: plan written from the YC workflow's screenshots and Gemini Enterprise's builder. Branch
  `feat/workflow-revamp` from `feat/record-mcp` (`ce2bdbe`).
