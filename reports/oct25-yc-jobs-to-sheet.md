# Oct 25: YC jobs → Google Sheet, recorded, designed and replayed

> One recording by Akshat on the managed build (signed in, Google Sheets and Drive connected, Screen + Voice + Pictures
> on), designed by the real model, then **Run now**. What was asked, what each stage did, where it failed, why, and
> what to change. Data: `~/Library/Application Support/Shadow/recordings/17ec09f4…/` (evidence.json, design.json,
> two test-run logs) and `runs/jobs-x5ycck-…-f7d8.jsonl` with its repair. Sheet id and email are masked here.

## 0. The short version

- **The recording and the understanding were good.** 112 events became 33 steps; 31 of 33 pictures got a caption;
  the narration came through whole (17 pieces). The task model the agent wrote is right: every day, the top 5 jobs,
  only the new ones, date / company / pay / role, the least-experienced role. The test run read "Just Appraised",
  "Account Executive" and "$160K - $200K" correctly from the live pages.
- **The design failed, and the saved workflow is the recording with a schedule on it.** No loop over 5 jobs, no
  duplicate check, no app step, cells still typed one by one at A4–D4. The agent's own summary describes a workflow
  that doesn't exist.
- **The replay failed at the Drive detour** (s5, clicking the sheet in Drive's *Recent* list): "target not found";
  the repair agent searched for "Ycomb" six times and ran out of turns.
- **It is not the pictures, and mostly not the data.** Everything the agent needed was in its message, including the
  Sheets tools (`GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND`). Four things broke it, three of them ours: the build call
  ran out of tokens, the finish gate saved a design it had refused twice, the sheet was understood as "the first
  file in Recent" instead of one fixed sheet, and the message drowned the agent in ~80 tool lines. The fourth is the
  model: with its main step gone it made one small call per turn, accepted proposals, and claimed steps it never made.

## 1. What was asked

**Goal (typed):** "collect top jobs from ycombinator everyday … save those in a google sheet in my drive … usually top
5, but if some are already there, whatever are new."

**Narration (spoken), in short:** open YC jobs (latest first) → open my sheet from Drive ("Ycomb jobs": Date, Company
name, Pay, Role) → for each of the top 5: open the company, take the date, the company name, the role that needs the
least experience, and its pay → do this for 5, only if they're new.

**Recorded:** one company (Just Appraised): date in A4, company in B4, role in D4, pay in C4.

## 2. Stage by stage

| Stage | What happened | Verdict |
|---|---|---|
| ② Capture | 112 events → 33 steps, 15 left out (tab switches, grid clicks that go with the typing after them, one text selection) | ✅ |
| ③ Pictures | 31/33 captioned; **2 failed: "the model used its whole token budget"** (GLM always reasons; the caption cap was 400) | ⚠️ fixed today (`6435651`) |
| ③ Voice | 17 pieces of text, accurate | ✅ |
| ④ Evidence | Timeline correct. Sheet's address masked as `docs.google.com/spreadsheets/d/███` (its id looks like a key to the masker). Proposals: p1 date ✅, p2 open My Drive directly, p4 click *Recent*, p5 click the first job, p7 list item. **No proposal "open the sheet directly"** (s2–s5 end on the sheet, but s5 opened it in a new tab, which breaks code's chain) | ⚠️ |
| ⑤ Connected apps | Asked **"Use Google Drive directly?"** (answered: connected). Sheets wasn't asked because it was already connected | ❌ my bug: Drive was offered for *clicks that only navigate* (Recent, opening the file) |
| ⑥ Understand (task model) | Cadence daily 9:00 ✅, rules quoted ✅, values ✅, **but the sheet = `list_item` of s5** ("the first file in Recent") ❌ | ⚠️ |
| ⑦ Plan (one call writes every change) | **Failed: "the model used its whole token budget (reasoning counts too)"** (Nemotron 3 Super, `smart`, 8 192 tokens, thinking on; message 27 323 chars) | ❌ root cause #1 |
| ⑧ Build episode | 10 turns, **one call per turn, no reasoning text**: accepted p1, p2, p4, p5; set the schedule; tried to remove 32 steps at once (refused: one, s3, was already gone, so none were removed); called `done` 3 times naming steps it never made (`ai1`, `l1`, `extract_top5`, `loop_jobs`, `append_new`). Never looked at an app tool, never built a loop or an AI step | ❌ |
| ⑨ Test runs (2) | #1 failed at s4 ("Recent" not visible). #2 succeeded as far as a test goes: reads right, every cell write only outlined and **not found** (Sheets' grid) | ⚠️ |
| ⑩ Finish gate | Refused `done` twice (rules built by steps that don't exist, 9 steps the test couldn't find), **then saved it as "designed" with 12 gaps** | ❌ root cause #2 |
| ⑪ Saved workflow | The recording + daily schedule + `{{today|D MMM}}`. Still: My Drive → click Recent → click the file → … one company … type A4, B4, D4, C4 | ❌ |
| ⑫ Run now | s1, s2, s4 ok → **s5 "target not found"** (the file in Recent, by a name that includes Drive's keyboard hint "More info (Option + →)") → paused | ❌ |
| ⑬ Repair | 12 turns: `find "Ycomb"` ×6, opened My Drive (not Recent), never used the sheet's address that s9 already opens → out of turns, $0.033 | ❌ |

Cost: design $0.12 (44 model calls, 33 of them captions), repair $0.03.

## 3. Why, one cause at a time

**C1. The build step ran out of tokens (ours: limits).** The plan call is the design's main path since Oct 24: one
reply writing every change. Nemotron 3 Super reasons first and its reasoning shares `max_tokens` (8 192) with the
answer; on a 27 k-character message it used all of it and returned nothing. The episode that followed was the
fallback, not the design. Same family of fault as the captions (GLM, 400 tokens).

**C2. The finish gate lets a failed design through (ours: by design, and wrong here).** After two refusals the gate
saves "with gaps the review lists". `worse()` only falls back to the recording when work was *lost* or steps *can't
run*; a design that changed nothing important passes as "designed", and its summary (the agent's words) describes
steps that don't exist.

**C3. The sheet was read as "an item in a list" (ours: prompt + proposals).** The UNDERSTAND prompt says what was
clicked in a list "comes from that place next time (from_step or list_item)". Clicking your sheet in *Recent* matched
that. Nothing told the agent that s2–s5 only **reach a page** that s9 opens by its address anyway, and code didn't
propose "open the sheet directly" because s5 opened it in a new tab. Accepting p4 ("click Recent") and p5 made the
fragile path permanent, which is where the replay died.

**C4. The connected-app offer misfired (ours: my code, `connectors.ts`).** Any non-navigation step on an app's page
counted as work there, so the clicks on Drive's *Recent* and on the file offered **Drive**. Only typing, pasting,
copying and reading inside an app should count. The one app that mattered (Sheets) was connected, so it was used
silently, but…

**C5. …the agent got ~80 tool lines (ours: message).** Drive (≈50) and Sheets (≈30) tools, each with a long
description, on top of the 33-step timeline: 27 k characters. It never looked at one. A handful of relevant tools
(append values, get values, batch update) would have been readable.

**C6. The model, without its main step (the model's).** In the episode it sent one call per turn although 8 are
allowed, wrote no reasoning text, accepted proposals without building, and called `done` with invented step ids.
Earlier faults are gone (only 1 malformed call in 10, vs. half in early October), but on its own the episode doesn't
build a loop + AI step + app step for a task like this.

**C7. Replay and repair (mine).** s5's target is Drive's grid cell named with its keyboard hint ("… More info (Option +
→)"); in a fresh view it isn't there or isn't named the same. The repair agent repeats the same `find` with no guard,
and doesn't know that the next steps open the sheet by its address, so skipping s5 was the fix.

## 4. Your questions

- **Is it the model?** Partly (C6). But the two biggest failures (C1, C2) are our limits and our gate: the model never
  got to do its main step, and its weak fallback was saved anyway.
- **Does it still use images?** Yes: 31 captions went into the evidence, and pictures can be described on request.
  They helped the understanding, which was right. Pictures can't fix a build step that ran out of tokens.
- **Is the data reaching it?** Yes, all of it (timeline, narration, captions, pages, Sheets tools). Two things were
  missing or misleading: the sheet's address is masked (so "open the sheet" has to go by the page's name), and there
  was no proposal to open it directly.
- **Are the agent's instructions good?** Mostly, with three holes: (1) "list_item" pulls a fixed file opened from a
  list into a list item; (2) no rule that steps which only *reach* a page are replaced by opening it; (3) app tools
  are listed without saying which few fit the task.
- **Are last time's issues resolved?** Malformed calls (F3), stuck loops (F32/F43) and "every day" as a schedule (F1)
  held. Variance (3 of 6 right on Oct 24) did not: this run is a worse case, because its main step failed. Writing
  into Sheets' grid (F9) is still not possible by replay, which is why app steps matter for this task.

## 5. What to change, in order

| # | Change | Where | Fixes |
|---|---|---|---|
| 1 | Plan and agent replies: room for reasoning (`maxTokens` 32 k for the plan, 16 k per turn); on "used its whole token budget", the plan is asked once more with thinking off | `orchestrator.ts` plan, `catalog.ts` smart | C1 |
| 2 | A design that only accepted proposals and set the schedule, or whose `done` names steps that don't exist, is **kept** (the recording) and said so plainly, never "designed" | `orchestrator.ts` / `gate.ts` | C2 |
| 3 | Code proposes **"open it directly"** for a chain that ends on a page opened in a new tab (s2–s5 → the sheet), and the prompt says: steps that only reach a page are replaced by opening it; a file opened from Recent/search is one fixed file, not a list item | `evidence/proposals`, `prompt.ts` | C3, C7 |
| 4 | Connectors: only typing, pasting, copying and reading count as work in an app; navigation clicks never offer it | `connectors.ts` | C4 |
| 5 | App tools in the message: at most ~8 per app, the ones matching the recorded work (write: append/update; read: get), the rest by `look` | `connectors.ts` `appsSection` | C5 |
| 6 | Repair: the repeat guard (same call twice → said so), and "a later step opens this page by its address: skip this one" as a ladder rung before the agent | `player/repair` | C7 |
| 7 | Captions (done today): no 400 cap, three at a time | `6435651` | ③ |

**Expected result for this task after 1–5:** open YC jobs → read the page → AI step picks the top 5 (company, role
with the least experience, pay) → read the sheet (app, read) → AI step keeps the new ones → append them
(`GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND`, asks first) → every day at 9:00. No Drive, no clicks in Sheets.
