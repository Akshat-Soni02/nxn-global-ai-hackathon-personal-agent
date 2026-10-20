# Checkpoint 3: design agent v2 on the real model

Plan 3, Task 14. Step 1 (20 Oct): the four bench recordings through `pnpm design:eval <folder> --real --yes`, on
Nemotron 3 Super. The eval does what Stop does: evidence → design agent v2 → saved workflow. There is no daemon, so the
test run in the automation window doesn't run ("not tested"). Every question is answered with Enter, which takes the
default. Steps 2–3 (Rushil records KPI, YC and Play Store on his Mac) are still to do.

## Step 1: the four recordings

| Recording | Checks (✓ / all) | Cost | Model calls | Questions asked | How it ended |
|---|---|---|---|---|---|
| kpi-email-to-sheet | 3/7 (1 is a known gap: next empty row) | $0.0373 | 12 | 3 | designed |
| timesheet | 5/5 | $0.0228 | 9 | 1 | designed |
| yc-top-job | 3/5 (1 is a known gap: next empty row) | $0.1235 | 40 (all) | 3 | kept: ran out of calls while putting the answers in |
| playstore-to-chat | 5/6 | $0.0122 | 5 | 0 | designed |

Spent $0.1958 in all; the ledger shows $0.6292 of $5.

### What failed, and why

Not fixed and not re-run, by Rushil's choice on Oct 20. They are F1–F5 in
[`reports/record-v2-changes.md`](../reports/record-v2-changes.md#failures-to-fix).

1. **How often it runs (KPI ✗, Play Store ✗, YC listed as a gap).**
   - **What happened:** the task model's cadence came back `kind: "manual"` while quoting "Every day I get these KPI
     emails…" and "Every month I post all the Play Store reports…". The gate checks the frequency only when the task
     model says it isn't manual, so it took the model's word.
   - **YC:** said "schedule", but with an empty cron, and ran out of calls before setting the trigger.
   - **Fix to make (code):** the gate finds frequency words in what was said and written ("every day", "each morning",
     "monthly", "every Monday"…). When they are there and the workflow only runs by hand, done is refused, whatever the
     task model says.
2. **KPI: no loop, "the newest one" not built.**
   - **What happened:** the task model took the email subject, "Daily KPIs - w/c 19 Oct", to be a value the user
     gives, not "the newest email in the list". The build then:
     - removed three steps (the header click and two page openings; one was the sheet's, so the paste would now run
       on the Gmail page);
     - accepted the date proposal;
     - claimed rule 0 ("always the newest one") was built by the recorded click on that one email.
   - **Why the gate let it through:** the gate checks that the named steps exist, not what they mean.
   - **The fixture is old-format:** it has no list position, so code made no list_item proposal to accept.
   - **To look at:**
     - a gate check that a rule naming "newest", "top", "latest" or "every" is built by a loop, an AI step or a
       list_item;
     - re-recording KPI in Step 2, which gives the list position.
3. **YC: 40 calls, half of them refused (20).** These are tool-forgiveness gaps:
   - `remove` with `"s2, s3"` as one string: read as one id, "no step s2, s3" (×1).
   - `remove s3` (the copy) while s5 still pastes `{{copied_1}}`: refused 4 times. The message doesn't say to change
     s5 first.
   - `add { do: "ai_step" }`: refused 3 times, although the message names ai_step.
   - `ai_step` with `output.type` as a string ("text") and `inputs: ["{{s6}}"]` (a step id, not its save_as name):
     refused.
   - **Fixes to make (code, the spec's "Forgiveness"):**
     - split comma-separated ids;
     - on a removal blocked by a later step's `{{var}}`, name that step and say to change it first (or in the same
       turn);
     - forward `add { do: "ai_step" | "llm" }` to ai_step;
     - accept a string `output.type`;
     - read `{{s6}}` as the save_as of step s6.
4. **Questions (KPI ✗: 3 asked).** Two were answerable from the recording: which columns (recorded), and "should it
   run on its own?" ("every day"). The evidence check showed the agent the quotes, and it asked again with
   `confirm: true`. Fix 1 removes the frequency one.

### What went well

- **Timesheet:**
  - kept the project NX-202 because they said "always NX-202", without asking;
  - made the hours an input;
  - nothing removed.
- **Play Store:**
  - kept the upload and the send (the Oct 19 v1 run had removed everything);
  - "all the reports" as an all-files upload;
  - today's date;
  - no questions.
- **Every run:** proposals were accepted by id, and no tool call was invalid. The masked evidence and
  `<untrusted_data>` were in place.

## Step 2: Rushil's recordings (to do)

Rebuild the extension and reload it, restart the daemon (`launchctl kickstart -k gui/$(id -u)/com.shadow.daemon`),
`corepack pnpm setup:mac`, then record KPI, YC and Play Store ("one report, two months") with Screen and Voice on.
