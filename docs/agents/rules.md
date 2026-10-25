# Rules: what the agents may never do, what they ask first, and what they just fix

One table for every refusal and check in the design agent (`packages/recorder/src/design/v2/rules.ts`, `gate.ts`) and
the repair agent (`packages/core/src/guard.ts`), sorted on Oct 25 (reports/plan-oct25-agents-v3.md, P3):

- **never**: refused whatever the reason; the agent is told why and works around it. These protect the user (their
  decisions, their safety switches, their machine) or the run (a value it can't type, a step it can't run).
- **ask**: not the agent's to decide. Today some are refusals that say "ask the user instead"; the target is a
  question in the inbox (repair) or the design's question batch, and the change is made on yes.
- **fix or explain**: a check on the finished design. The designer fixes it or says why it will work; the critic
  (`critic.ts`) reads the design once these pass. What is left when done can't be refused again is listed in the review;
  a rule built by no step keeps the recording instead of saving "designed" (`kept`, P4).
- **dropped**: refusals that only second-guessed the agent. Removed, or to be removed where marked.

## Design agent

| Rule | Kind | Where | Note |
|---|---|---|---|
| The goal is the user's words: it can't change | never | `rules.ts` refusals | |
| How often it runs, when the form set it, can't change | never | `rules.ts` | the review shows it; the user changes it |
| Approval can't be turned off; code adds it to anything that sends, writes, pays or deletes | never | `rules.ts`, `requireApprovals`, `maySend` | app tools too, unless their hints say read-only |
| No script or shell steps | never | `rules.ts` | |
| A step matching the user's Never list | never | `rules.ts` | "ask them instead" |
| A masked value (███) typed, looked for or checked | never | `rules.ts`, `gate.ts`, `write_workflow` | code puts back a masked value copied as it was |
| A glob that leaves its folder | never | `rules.ts` | |
| A step the runner can't run (missing values, a control by role alone, a {{…}} default or cron) | never | `stepProblems`, `roleAlone`, `runProblems` | the write is refused with the exact problem |
| Files or folders outside the ones the recording used (paths, watched folders, inputs) | ask | `rules.ts` | refused today with "ask the user instead" |
| An address on a site the recording never visited, or built from a value | ask | `rules.ts` `reach` | refused today; target: a question with the site named |
| Using a connected app instead of the page | ask | `usableApps` (connectors.ts) | asked before building, with the Connect button |
| Removing work the user showed (typed, chose, moved, sent) | fix or explain | `lostWork` | a why is enough; the review highlights it |
| Every rule they said: built by real steps, or not built with why | fix or explain | `gate.ts` | unbuilt at the end: kept, not "designed" (P4) |
| What the test couldn't find, got empty, read twice, or made up | fix or explain | `gate.ts` | |
| A text check for text that never appeared, is empty, or is on a drawn page | fix or explain | `gate.ts` | |
| "Every day" said, but it only runs by hand | fix or explain | `gate.ts` | |
| A browser workflow that doesn't open a page first | fix or explain | `gate.ts` | |
| Five questions, then defaults | dropped | `questions.ts` | as many as it needs, on one screen (`MAX_QUESTIONS` 12, a ceiling only) |
| Refuse done twice, then save "designed" with gaps | dropped | `tools.ts` done | the critic's second look, then the honest finish |
| How-to questions (which library, which method) | never | `isHowTo` | building is the agent's; which sheet, tab or app is the user's and may be asked |

## Repair agent (`core/guard.ts`)

| Rule | Kind | Note |
|---|---|---|
| The trigger, inputs and defaults, the description, args the user set, AI instructions, max_items, on_item_fail | never | the user's decisions |
| Approval turned off, a question removed or changed | never | |
| Script steps | never | |
| A new step that sends, submits, pays, publishes or deletes, or a step turned outward | ask | `repairCheck().ask`: put to the user at commit (the run's own question), committed on yes; nobody there: escalated in plain words |
| A new app (mcp) step | ask | asked at commit like the others; offering to connect an app from a repair is not built yet |
| Going to a site the workflow doesn't use (an edit) | ask | asked at commit; a probe's `navigate` still stays on the workflow's sites |
| Removing an AI step, a loop or a step that needs approval | ask | asked at commit |
| Removing a step that asks the user a question | never | |
| Skipping steps that only got to a page a later step opens by its address | allowed | ladder rung 0, no model (`ladder.ts`) |
