# Record → workflow: the deep dive (step 4)

**What this is.** [Checkpoint 4](../testing/checkpoint-4.md) recorded five everyday tasks on real sites, and none of
the five saved workflows did its task. This file traces every failure to its cause in the code and says what was
fixed, with the commit and the test that proves it. It then answers three questions:
- which kinds of app record → workflow can handle;
- whether it needs MCP;
- whether it's production-ready.

**How it was done** (superpowers:systematic-debugging): no fix without a root cause read in code. Each fix started as
a failing test built from the real trace's shape, then got the smallest change that made the test pass. Rushil's rule
held throughout: fix from the code that exists, with as few lines as possible, and no per-app code.

**Scope:** record → workflow only. Replay and repair causes are listed for Akshat, not changed.

**The plan:** [`docs/superpowers/plans/2026-10-23-record-v2-fixes.md`](../docs/superpowers/plans/2026-10-23-record-v2-fixes.md).
**The verification run:** [`testing/checkpoint-5.md`](../testing/checkpoint-5.md).
**Updated Oct 24 for step 5:** only the statuses step 5 changed (§2's A and D, §4), each marked "Oct 24". Step 5 itself
is in [`record-v2-changes.md` § Step 5](record-v2-changes.md#step-5-oct-24-what-changed-after-rushils-own-recording)
and [`record-v2-plans-explained.md` §14–16](record-v2-plans-explained.md).

## The one-line answer

**Every one of checkpoint 4's failures came from the record side.** Each workflow was wrong before it ran:
- a paste wired to the wrong copy;
- the first page lost;
- a read step the runner can't run;
- a renamed file followed by its old name;
- a broken draft kept;
- a test failure "explained" by the reason the step was added.

All of those are now fixed in code, apart from the items listed under "Not fixed", each with its reason.

**Then checkpoint 5 tested the fixes on the real model and live,** and each run found the next cause (F35–F61), all
fixed in code. **Result: two of the five tasks (B, C) now do their task end to end when run;** in checkpoint 4, none
did. A's re-design builds the right loop but its live design gave up; D's pieces each work but the agent didn't finish
it within its calls; E is the canvas gap.

---

## 1. Root causes and fixes

### Capture, normalise, first draft (② ④ ⑤)

| # | What broke | Root cause (read in code) | Fix | Commit · test |
|---|---|---|---|---|
| F17 | A's Title and Value both got the points | `normalise.ts`: `case "paste": break;` ignored the moment of the paste. The field's `type` event comes when the field is left, after the next copy, and took `lastCopy` at that time | Each paste remembers the copy that was newest *when it was pasted*, by field | `42f9a6a` · "ties each paste to the copy that was newest when it was pasted" |
| F18 | A's step 1 opened the notes page; Hacker News was lost | `normalise.ts`: a navigation within 3 s (`FOLLOW_MS`) was merged into the previous one as a "redirect", **with no check that it's the same tab** | Merge only within the same tab | `42f9a6a` · "keeps a page opened in another tab soon after as its own step" |
| F18b | The tab was named "about:blank" | `evidence/tabs.ts`: `tab.title ??= e.title` took the blank tab's title | Take a title only when the event has a real page address | `42f9a6a` · "is named from the page it went to" |
| F33a | A's test run failed step 1, 3 times (was "unexplained") | **A knock-on of F18:** the merged step opened Hacker News but kept the check "address is notes.html" | Fixed by F18 | — |
| F23 | D2: the downloaded file became a "which file?" input; the move kept "23 Oct - Thuggee.pdf" | `skeleton.ts`: a rename stored its **literal** new path for later steps, and a download (a click's `produces`) was never linked | A rename gets an output (`renamed_1`) that later steps follow; a download adds "find the file this run downloaded" (`fs.find`, `since_run_start`) | `42f9a6a` · "finds the file the download made, and the move follows the renamed file" |
| F24 | D: nothing in the watched folder was recorded | `fs-watch.ts`: `ignored()` tested every folder in the full path, so a watched folder inside `~/.claude` hid everything | Only names *below* the watched folder count | `42f9a6a` · "records files in a watched folder that is itself inside a hidden folder" |
| *new* | A's first copied title was saved with **no selector**, so replay can't find it | `apps/extension/src/describe.ts` `structuralCss`: the path stops at 6 levels and gives up if that isn't unique. Hacker News nests its story table in a layout table, so 6 levels also matched a header span | Climb past 6 levels while the path still matches another element | `cf92fa2` · "climbs past six levels while the path still matches something else" |

### Proposals (⑥)

| # | What broke | Root cause | Fix | Commit · test |
|---|---|---|---|---|
| F20 | Accepting "item 1 of the list" changed nothing; the agent thought it had | `evidence/proposals.ts`: list item, repeat, all files and constant carry `edits: []` but are marked runnable. Accepting replied "nothing to change". The prompt said every proposal is "prepared and checked" | Accepting one now says "nothing prepared to apply: build it yourself", and how. The prompt says only `[change ready]` ones are prepared | `e1c45dd` · "says a proposal with nothing prepared is a note to build" |
| F21 | "Open directly" offered to fix today's video or article in place | The guard works only for clicks with a list place | The proposal says: only if it's always this same page | `e1c45dd` · open-directly test |

### The design agent's tools (⑦ 7b)

| # | What broke | Root cause | Fix | Commit · test |
|---|---|---|---|---|
| F25 | "Read the page, let an AI step pick" failed in B, C and D | The player's `extract` needs a target (`executor.ts:246`), and the agent's read had none. **The player already accepts CSS selectors as targets** (`match.ts:149`) | A read with no target gets `{fallbacks: ["main", "body"]}`: the page's main part if it has one, else the whole page. No player change | `e1c45dd` · "reads a whole page when a read has no control" |
| F28 | The tools accepted steps the runner can't run:<br>- `fs.find {folder, pattern}`;<br>- a control found only "near Indian Rupee";<br>- an input whose default is `"{{today}}"` | `tools.ts` checked the step's schema, not what the runner needs | `stepProblems()` in `gate.ts` holds the runner's needs: each action's values, and a control it can score (role, attributes or a selector). `add` and `change` refuse a new or changed step that fails it, naming what's needed. `input` refuses a `{{…}}` default | `e1c45dd` · "refuses a step the runner can't run, saying what it needs" |
| F32, F3 | It burned its calls:<br>- D2 tried 9 times to set the schedule through `change`;<br>- ids sent in one string;<br>- `{{s6}}` used as a variable;<br>- a type written as a word | Small gaps in forgiveness | `change` on the trigger with a schedule *is* the trigger; `"s2, s3"` is split; `{{s4}}` is read as that step's output; `output.type: "text"` is accepted | `e1c45dd` · "forgives what the real runs got wrong" |

### The finish gate, and keeping a draft (⑦ 7f, ⑧)

| # | What broke | Root cause | Fix | Commit · test |
|---|---|---|---|---|
| F26a | B was saved with a step that failed its test | `gate.ts` took any reason the agent had given for a step as "explained", including the reason it gave when it *added* the step (`tools.ts:139`) | Only reasons given **since the last test run** explain a test failure (`sinceTest`) | `753b83b` · "explained only by a reason given after that test" |
| F26b | A test run that couldn't start was accepted (D, D2, E) | `gate.ts` ignored `test.outcome` | "The test run couldn't start (…)" is a problem, unless Chrome isn't there | `753b83b` · "a test run that couldn't start is a problem" |
| F26c | D2's check still expected `/wiki/Thuggee` | Checks on changed steps were never looked at again | A url or file check holding a literal, on a step whose arguments now use `{{…}}`, is a problem | `753b83b` · "a check that still holds the recorded page" |
| F26 / F28 | Unrunnable steps reached the saved workflow | Nothing checked runnability at the end | `runProblems()` at finish | `753b83b` · "a step the runner can't run is a problem" |
| F1 | "Every day" ran by hand when the task model wrote "manual" (D) | The gate checked frequency only from the task model | Frequency words in the goal or what was said ("every day", "each working day", "every Monday", "weekly"…) require a schedule | `753b83b` · "how often it runs comes from what was said" |
| F27 | C kept a draft that couldn't run (out of calls) | `orchestrator.ts` `kept` checked only for lost work | If what it reached has steps that can't run (and the recording didn't), the recorded steps are kept instead | `753b83b` · "keeps the recorded steps when a stopped design reached steps that can't run" |
| F30 | C's own questions were lost when it stopped early | `pending` held only code's questions | Its unasked questions are listed in the review | same test |

### Questions, honesty, record-keeping (7d, ⑨)

| # | What broke | Root cause | Fix | Commit · test |
|---|---|---|---|---|
| F31 | The review showed a summary describing a branch that didn't exist (D) | `review.ts` showed the agent's summary as the summary | Shown as "In the agent's words: …"; the changes listed are code's | `753b83b` · review test |
| F13 | "The latest report" picked "ask me each time" | `answers.ts` `optionText` included each option's stored value, and "ask me each time" stores `pick: "newest"` | File options are matched by their words only | `753b83b` · "matches the options … by their words" |
| F16 | `design.json` didn't keep the agent's first message or the plain list | Not stored | `firstMessage` and `plain` are kept | `753b83b` · orchestrator test |

### What the re-designs after the fixes showed (rounds 2 and 3)

The five recordings were designed again on the real model after the fixes above: round 1 led to `1a3f17a` (F45–F48),
round 2 and the live re-record of A to `f8c4215` and `fa5bf58` (F35–F44), round 3 and live C to `7e59721` and
`306e724` (F42b, F49, F50), live D to `45e0ebe`, `f89a0e9`, `4674a5c`, `389bf90` and `edd1241` (F51–F60), live A to `e64161d` (F61). Each row is a failure read in the agent's transcript (`design.json → transcript`).

| # | What broke | Root cause | Fix | Commit · test |
|---|---|---|---|---|
| F35 | A ran out of its 40 calls, twice, trying to put "type `{{story.title}}`" inside a loop | A deadlock in the tools. `add` refuses a step that uses `{{story.title}}` until a loop declares `story`; `loop` could only wrap steps that already exist. The agent had removed the recorded steps first (its natural plan), so nothing could be looped | `loop` also takes **new** steps (`{ do, intent, target, values }`, as `add` takes) and makes them inside it, in one edit | `f8c4215` · "makes a loop with new steps inside it" |
| F36 | "Invalid input" for `output.type: "list"` and `{ title: "text", points: "text" }` (A, B) | `ai_step` took a type word or core's full form only | The model's ways of writing a type are turned into core's: `"list"`, `"list of text"`, `{ title: "text" }`, `"string"` | `f8c4215` · "takes the output types the model writes" |
| F37 | "`{{new_emails}}` is a text, not a list", and no tool can change an AI step's type (A). **The prompt's own worked example did this** | An AI step with no type returns text; a loop needs a list | Looping over an AI step's result makes it a list (of objects, or of what it said one item is). The example now says `type: "list"` | `f8c4215` · "loops over what an ai_step returns even when it was declared as one value" |
| F38 | B spent 15 calls on "no step trigger"; E sent `change { step: "trigger" }` 3 times | The outline shows the trigger as `start  trigger …`, so the model calls it "trigger"; `done`'s rule check and every tool knew it only as `start` | The finish gate takes "trigger" for `start`; an unknown "trigger" says "the trigger is start"; `change` on the trigger with no `when` says how | `f8c4215` · gate and tools tests |
| F39 | One hint for every unknown value: "put the steps in a loop, item `copied_1`" (B), "item `s1`", "item `article_title`" (D2) | `hint()` assumed any undeclared value was a list's item | The hint says which step saves it (and that this edit removes it), that a step id saves nothing, or that nothing saves it yet. The loop hint is kept for `{{x.field}}` | `f8c4215` · "says what to do about a value nothing saves" |
| F40 | `add { do: "ai_step" }` refused (A, B, D2, E); D2's next try became an `extract` carrying an instruction, accepted with junk values | `add` builds actions only. Its passthrough put `instruction`, `inputs` and `output` into the step's values | `add` hands a step with an `instruction` to `ai_step`; `output: { name }` on any step is its `save_as`. **Reverses an earlier ruling** (B5), now that it happened 5 times | `f8c4215` · "makes an AI step when add is given one" |
| F41 | D2 stopped at call 34: "the model used its whole token budget and gave no answer" | A thinking model's 33rd reply thought past the 8,192-token cap; the episode ended and the plain list was kept | A failed reply ends that episode, not the design: one more episode starts from the workflow as it got to, on what's left of the budget (design only; the shared agent loop is unchanged) | `f8c4215` · "carries on from where it got to when a reply is cut off" |
| F42 | A, B and D2 asked "what time each day?"; D2 made `run_time` and `schedule_time` inputs. E added a "does the note already exist?" AI step and branch nobody asked for | The prompt said nothing on a time nobody gave, or on building beyond the rules | Prompt: a time they didn't say is 9:00, set in the trigger, never asked or an input; build nothing they didn't ask for (each AI step runs, and costs, every time) | `f8c4215` · prompt |
| F42b | Round 3: A still asked the time, and C's task model queued it itself | A prompt line isn't a rule the model must follow | `ask` refuses a time-of-day question with how to set it, and stage 1's own time question isn't queued | `7e59721` · "never asks the time of day" |
| F43 | The model resent a failing call unchanged: one `add` 20 times (A), 3–4 times (B, D2, E) | Each failure got the same hint, and the model didn't change its call | A call sent again exactly as before, on the same workflow, is answered "you sent this exact call before and it failed: …" without running it | `fa5bf58` · "says a call sent again exactly as before fails the same way" |
| F44 | A loop over an AI step's "list of objects" would ask the run's model for *any* object, so `{{story.title}}` could come out empty | An open object becomes JSON schema `{type: "object"}` with no fields (`vars.ts` `jsonSchemaOf`) | At save, an AI step's open objects get the fields its loop reads (`title`, `points`) | `fa5bf58` · "asks the run's model for the fields the loop reads" |
| F45 | B left "the newest video" not built, saying the recording had no selectors for it | The gate took any `not_built` reason | A rule about picking what changes (the newest, the top 3, ones not already done) said not built is turned back with how to build it: read the page, an AI step picks, a loop | `1a3f17a` · "turns back a rule about picking what changes" |
| F46 | A's rebuilt loop was refused as "your work is gone" | `lostWork` counted only the recorded step ids | The same action on the same control (role and name) counts as the recorded work kept | `1a3f17a` · "counts a new step doing what a recorded write did … as that work kept" |
| F47 | E's schedule was `"{{cron_expr}}"`; D2's rename was dropped after "a path from AI text" was refused | No check that a cron is a fixed time; the path refusal didn't say what to use instead | A schedule must be a fixed cron; the path refusal suggests `{{today\|D MMM}}` and `{{file.name}}` | `1a3f17a` · "refuses a schedule that isn't a fixed time" |
| F48 | Step lists sent as `"[s2, s3]"` to loop, branch and remove | Only a plain comma list was split | Brackets and quotes are split too | `1a3f17a` · "takes step lists as one string, with or without brackets" |
| F49 | Live C: eight changes "to read the whole page" each said ok, and the read kept its `{ role: "cell" }` control. The reasons then counted as explaining the failed test, so it was saved and failed at run time | `change` had no way to take a control away, and a change that alters nothing looked like any other success | `change { target: null }` makes a read read the whole page; a change that alters nothing says "nothing changed" | `306e724` · "lets a read drop its control", "says when a change changed nothing" |
| F50 | Live C: the read was given `{ role: "cell" }`, which matches every cell of a 50-rate table | A role alone counted as a control replay can find | A control the agent writes by role alone needs a name too (except to read them all, or `main`). Recorded ones stay the test run's to judge: on a page with one textbox, a role alone is enough | `306e724` · "refuses a control the agent gives by role alone" |
| F51 | Live D ran out of calls and kept a draft whose s2 opened `{{featured_title}}` but still checked for `/wiki/Thuggee`; Run now failed there | "Kept what it reached" judged the draft by `runProblems` only, and the stale-check rule lived in the finish gate | The stale-check rule is a run problem, so the kept path sees it too and keeps the recorded steps instead | `45e0ebe` · "counts a check still holding the recorded page as a run problem" |
| F52 | Live D: s1 opened the Main Page in a tab named "API", and the read after it, with no tab, read a page the test run had left in the window's first tab. The AI step then "found" a featured article that doesn't exist | A web step with no tab runs in the first tab; nothing checked that the steps after a page opened in a named tab name that tab | After a page opened in a named tab, a web step with no tab is a run problem, with the tab to give it | `45e0ebe` · "says a step with no tab … acts in another tab" |
| F53 | Live D: "find the file the download saved" failed in Run now, though the download had been approved and clicked | **A gap in my own F23 fix:** `skeleton.ts` added the find with no `timeout_ms`, and the runner then looks once (`fs-channel.ts:55`), 1 ms after the click | The find waits up to 60 s for the file, using the wait the runner already has. **For Akshat:** a find that will never match now takes 60 s before repair starts | `f89a0e9` · "finds the file the download made …" (now checks `timeout_ms`) |
| F54 | Live D's test run failed at that find, so the gate asked the agent to fix a step that was right | A test run never clicks Download (it would change something), so a file this run makes can never be there | The test run only outlines a find for a file this run makes. **For Akshat to sign off:** this line is in his package (`packages/player/src/rehearse.ts`), though the test run is record's (F33) | `f89a0e9` · "only outlines finding a file this run makes" |
| F55 | F51's stale-check rule fired on the plain list too, so it couldn't tell a broken draft from the recording | It compared a check to all of `url`, `to` and `from`; the plain rename reads `{{downloaded_1}}` but goes to a fixed name, and its check is right | A check is compared to the value it checks: `url_matches` to `url`, `file_exists` to `to` | `f89a0e9` · "judges a check by the value it checks" |
| F56 | Live D's agent gave s2 a control 15 times ("the link near *From today's featured article*"); each change said "nothing changed", and it ran out of calls | The recorded click on "Thuggee" became "open this address" (a go step), which has no control. No tool turns one kind of step into another, and nothing said how to get a click | A control given to a page-open step is refused with what to do: add a click after the step before it and remove the open, or put an earlier step's `{{value}}` in its address. A no-op change sent again counts as a repeat (F43) | `4674a5c` · "says a page opened by its address has no control" |
| F57 | `add { do: "web.read" }` and `"web.read_all"` were refused as "not supported by this channel" (D) | Only the plain verbs (`read`, `read_all`) were looked up; `web.read` was taken as channel `web`, action `read` | A channel in front of a plain verb is dropped first | `4674a5c` · "takes do with its channel in front" |
| F58 | An AI step with no inputs got "Too small: expected array to have >=1 items" (D, 3 times) | The schema's message | It says to read the page first and pass `{{page}}` | `4674a5c` · "says what an AI step with no inputs needs" |
| F59 | Live D's AI step picked the Main Page's image caption ("Thugs about to strangle a traveller") as the article's title, in the test run and again in Run now. The agent saw only "check did not hold: /wiki/Thuggee", and removed the check | The test report keeps each step's value, but the agent's `test` tool passed on only ids and errors | The agent sees what each step read or worked out (short, as page data). The prompt says a wrong pick is fixed in the AI step's instruction, never by removing the check that caught it | `389bf90` · "shows what each step read or worked out" |
| F60 | Live D's last try: the agent added a whole-page read, then removed and re-added it 10 times ("incorrect step type; need a plain read") until its calls ran out | The outline printed a read with no control as `web.extract … on element "?"`, which looks like a broken step | It prints "reads the whole page"; a control known only by its selector shows the selector | `edd1241` · "shows a whole-page read as one" |
| F61 | Live A was saved with only three page opens: the agent removed every save, said the page couldn't be read, and called done three times | After two refusals the finish gate lets a design through with its gaps listed, and that path skipped the protection a stopped design gets (F27) | A design that finishes past the gate is judged like a stopped one: if it lost your work or can't run, the recorded steps are kept | `e64161d` · "keeps the recorded steps when it finishes only because the gate stopped refusing" |

### The bench (Plan 1's measuring stick)

| # | What broke | Root cause | Fix | Commit · test |
|---|---|---|---|---|
| F34 | B and C passed every check and couldn't run; `uses_today` matched `{{today_date}}` | The checks look at shape only; `includes("{{today")` | Every bench run adds a **"runs"** verdict (`runProblems`); `uses_today` counts only the built-in date | `814bc5e` · "always says whether the workflow can run at all" |

---

## 2. Not fixed, and why

| # | What | Why not | Owner |
|---|---|---|---|
| F29 | "The recording already answers this" is loose: B's "At what time on Monday?" was matched by "Every Monday" | Making it need two matching words would break a real case: "Which email is the newest one?" really is answered by "always take the newest one", which shares one word. Code can't tell which word carries the question. The agent is shown the possible answer and must ask again if it isn't one; F31's fix makes its own choices visible as its own | record: open, a design decision |
| F13b | "All the reports" can't be answered from speech | It needs a file input that holds a list, plus a loop; the "all files" proposal covers that path | record |
| F19 | List places are wrong on table layouts (HN) and missed on component grids (YouTube) | Extension list detection, per layout. **"Read the page and let an AI step pick the newest or the top 3" now runs on any page** (F25), which covers these tasks without per-site code | record (later) |
| F22 | Canvas apps | Re-tested in checkpoint 5 with the note really drawn: the canvas click and the typing are still recorded on the properties panel on top, and replay can't find where to type. It needs the connector or vision rung (§3), not a capture patch | record (§3) |
| D | The design agent didn't finish D (Wikipedia PDF) within 40 calls in 4 of 5 live tries; the one finished design failed because the run's AI step took an image caption as the title | Every tool gap each try showed is fixed (F51–F60); D was stopped after its last try, as Rushil asked. Nothing at run time checks that an AI step's answer is plausible. **Oct 24:** no call cap now; D the print way does its task live (day 1), from code's proposals with no AI step. The download way can't be measured in the test browser | record |
| A | A's re-design claims "skip ones already saved" is built, but no step reads the saved list | The gate checks that a rule's steps exist, not what an AI step's instruction does. **Oct 24:** A does its task live (day 1): the top 3, then the next 3 with no duplicates, because code checks a "first N" pick when the run happens. The gate still doesn't check a rule's steps | record |
| — | Picture captions time out at 90 s each; with Pictures on, E took over 10 minutes to compile | Not looked into | record |
| F15 | A spoken "never do X" isn't a guard | A design decision: a quoted rule versus a code-enforced refusal | Rushil |
| F12 | A question can wait forever | Needs a daemon timeout policy | record (small) |
| F11 | Numbers cells (Mac elements with no name) | Needs Shadow.app and `pnpm setup:mac` | record |
| F14 | The app's Run now never asks which file | Run side (`service.start` skips `chooseFiles`) | to decide |
| F6, F7, F8, F9, F10 | Tabs during approval waits; which tab a tabless step runs in; matching by text or `near`; writing to sheet cells; run-time folder checks | Replay | Akshat |
| — | Run now on a failing workflow starts paid repair, which saves new versions on its own | Replay | Akshat |

---

## 3. Can it handle any app?

Here "handle" means: record it, and make a workflow the runner can run. This is judged by how a page is built, not by
which product it is.

| Kind of page | Example | Today | Evidence |
|---|---|---|---|
| Elements with names (most websites) | Hacker News, x-rates, Wikipedia, GitHub, Gmail, forms | **Yes.** Clicks, typing, copies, selections, tabs and what each click did are recorded. Targets have a role and name, attributes or a CSS path. Values that change can be read from the page by an AI step | checkpoints 1, 4, 5 |
| Web components (shadow DOM) | YouTube, YouTube Studio | **Mostly.** Capture sees inside them (`composedPath`). Some copies point at a large container; their grid isn't seen as a list (F19), but reading the page plus an AI step works | checkpoint 4 B |
| iframes | embedded editors, payment forms | **Partly.** The content script runs in all frames; not tested live | — |
| Lists that redraw (virtual lists) | Gmail | **Yes for capture** (list place); replay can't use a place yet (F8) | checkpoint 1 |
| Canvas apps | Google Sheets / Docs / Slides, Canva, Figma, Excalidraw, maps | **No, in general.** A click hits a drawn surface with no element. Sheets alone has a special adapter (`adapters/google-sheets.ts`, the Name Box) and a read through its CSV export | checkpoint 1 (Sheets), checkpoint 5 (Excalidraw) |
| Mac apps with Accessibility names | Notes, Reminders, TextEdit | **Yes for capture**, through Shadow.app | earlier tests |
| Mac apps with nameless controls | Numbers cells | **No** (F11) | — |
| Files | Downloads → rename → move | **Yes**, now chained by variable (F23) | checkpoint 4 D2 |

### Does it need MCP?

**Not for most websites,** now that a workflow can read a page and let an AI step pick the value. That's the general
path, and it needs no per-site code.

**Yes, as one general mechanism, for apps that draw their content or that are better written to through an API.**
That's Sheets, Docs, Slides, Canva, Figma, Slack and Notion. The ladder, in order of preference:
1. **Elements:** the page has controls with names. This is today's path.
2. **A connector:** when the app has an API and an MCP server is installed, the recording still shows what you did,
   and the design agent turns "pasted into B4 of KPI Sheet" into "add a row through the Sheets connector".
   - **What exists:** the script channel (AppleScript), and Sheets reading through CSV export.
   - **What's missing:** a connector step type, and a registry of installed MCP servers the design agent can see.
   - **Why it's general:** it's one mechanism for many apps, and it replaces per-app adapters like the Sheets one.
3. **Vision:** no elements and no API. Find the control in the picture at run time. Core already reserves a `vision`
   channel for replay to choose at run time (`skill.ts:203`), but it isn't built.

**Recommendation:** build rung 2 next for the canvas apps that matter (Sheets first: it's the most common write
target), as a generic connector step rather than another adapter. Leave rung 3 until a real task needs it.

## 4. Is it production-ready?

| Stage | Verdict |
|---|---|
| ① Describe, ② capture (element pages, files) | **Close.** Real sites recorded correctly; the gaps are canvas apps and nameless Mac controls |
| ③ Stop: pictures, captions, voice | **Close.** Voice not yet tried on a real task of yours. **Oct 24:** tried once, on Rushil's D: 0 words, because of the microphone (measured); the review now says so |
| ④ Normalise, ⑤ first draft | **Fixed for what checkpoint 4 found** (F17, F18, F23 and the selector depth); list places on tables and grids remain (F19) |
| ⑥ Evidence and proposals | **Honest now:** only the date and open-directly proposals change anything, and the agent is told so |
| ⑦ Design agent | **Works on simple tasks, not yet on long ones:**<br>- B and C were designed right and run end to end;<br>- it can no longer save a step the runner can't run, or a draft that lost your work (F27, F61);<br>- on longer tasks (A live, D) the model still gives up or runs out of its 40 calls, and the recorded steps are kept instead.<br>**Oct 24 (step 5):** A, B, C and D (print way) were each designed right and do their task live, day 1. No call cap; a final check for files; "Can't run yet" when it can't. Designs still vary: three of six of D's were right |
| ⑧ Save, ⑨ review | **Honest now:** the summary is labelled as the agent's words; unasked questions are listed |
| Replay | **Partly** (F6, F8, F9: Akshat). In checkpoint 5, runs with an approval step (B, C, D) went on after the approval and finished; repair ran on every failure and spent $0.05–0.08 each |

**Overall: not production-ready yet.** Record → workflow now builds its raw material correctly, refuses to save a
workflow that can't run or that lost your work, and does short tasks end to end (B, C). What's left:
- the design agent finishing longer tasks within its budget (A, D);
- AI steps whose answers nothing checks;
- canvas apps (E).

All of this is measured in [checkpoint 5](../testing/checkpoint-5.md).

**Oct 24, after step 5: still not production-ready, closer.** The first two items above are now partly done: A and D do
their task live, and code checks "first N" picks at run time. Rushil's own D recording ([checkpoint 6](../testing/checkpoint-6.md))
showed the scripted recordings had hidden real gaps (the print dialog, a file blamed on the wrong step). What's left:
- Rushil's Mac recordings (a real ⌘P, voice, a Finder move) and the day-2 re-runs;
- the design agent's variance;
- AI answers other than "first N" picks;
- canvas apps (E, deferred).
