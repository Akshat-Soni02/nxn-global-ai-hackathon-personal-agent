# Oct 26: the YC jobs → sheet recording, designed five times with the workflow as a file

The Oct 25 recording ("collect the top 5 YC jobs every day into my sheet, skip ones already there"; diagnosis in
`oct25-yc-jobs-to-sheet.md`) re-designed offline with `pnpm design:eval --real` (Nemotron 3 Super, no connected apps),
after the plan's build (`plan-oct25-agents-v3.md`): the design agent edits the workflow as a JSON file
(`read_workflow` / `write_workflow` / `edit_workflow`), a critic takes a second look at done, and questions aren't
held back. Each run's failures were fixed in code before the next.

| Run | Commit | Calls | Cost | Outcome | What stopped it → fixed in |
|---|---|---|---|---|---|
| 1 | `b933fee`+`f9a6c94` | 13 | $0.096 | kept | recorded steps named by id in a loop refused; `{type: "schedule", expr}`; the workflow sent as a broken JSON string five times, told only "write it as { steps }"; error paths like `steps.9.steps.1.steps.9`; its dedup question held back ("the recording may already answer this") → `e522b9a` |
| 2 | `e522b9a` | 15 | $0.105 | kept | `{type: "cron"}`; full-form steps with short names (`type: "ai_step"`, `"condition"`, `action: "read_all"`); `ask` with a sentence as its step, refused and resent six times; a 600-character done summary invalid → `c196bc3` |
| 3 | `c196bc3` | 24 | $0.128 | kept | built the right shape, but its writes had no `why`, so the replaced typing steps counted as lost work and it had no way to explain them afterwards (done six times); typing into `"C{{row}}"` didn't count as the typing into `A4` → `443b1b0` |
| 4 | `443b1b0` | 30 | $0.254 | kept (out of budget) | sent the workflow as a JSON string 12 times, broken at the same nesting each time; its object writes were partial and replaced everything → `1d5d08e` |
| 5 | `1d5d08e` | 16 | $0.098 | **designed** | — (one leak found after: a `do` step's `id` and `requires_approval` in its args → fixed after the run) |

Ledger after: $5.63 of $10.

## What run 5 built

```
start  schedule 0 9 * * 1-5 (weekday mornings)
s1     open ycombinator.com/jobs
s2     read the page                                     → page_text
ai1    "the first 5 job listings in the order they appear" (company, role, pay)   → top_jobs
s3     open the sheet by its address (docs.google.com/spreadsheets/d/███)   no Drive → Recent detour
s4     read the sheet                                    → sheet_text
ai2    the entries already in it (date, company, role, pay)                 → existing_jobs
ai3    top_jobs whose company and role aren't in existing_jobs              → new_jobs
loop   for each job in new_jobs
  s5   read column A; ai4 the next empty row             → next_row
  s6–s12  type the date (today, D MMM), company, role, pay into A–D{{next_row}}
```

It asked one question, which is the user's to answer: how to tell a job is already in the sheet. This is the task as
they described it, and every earlier design of this recording (Oct 25: none built) missed it.

## What is still open

- **Replay into Sheets' grid**: s6–s12 type into the grid by its cells, which replay doesn't support (plan C2). With
  Google Sheets connected the design is told to write with an app step instead; this eval had no connectors. The next
  measurement is the same recording with Sheets connected (needs a valid Composio project key: `ak_…`).
- **One run in five**: runs 1–4 failed on how the model wrote things, each fixed in code; a second run 5 would say
  whether the shape holds. Nemotron's habit of sending big tool arguments as strings is the main risk: the schema now
  says object, which fixed it once.
- From the plan, not built: offering to connect an app from a repair (X4), the fast model for repair's probing (X6),
  the "Hide emails and ids" setting (P1), shorter prompts (D7).
