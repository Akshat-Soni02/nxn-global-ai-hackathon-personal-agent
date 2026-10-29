# Shadow: Devpost submission (Nebius x NVIDIA Global AI Hackathon, Personal AI track)

Deadline: **30 Oct 2026, 10:00 PT**. Paste each field below into Devpost in the order of your sheet. Everything between
the `<!-- PASTE START -->` and `<!-- PASTE END -->` markers is the text to paste; everything else is a note for you.

## 0. Paste sheet

| # | Devpost field | Where in this file | Length |
|---|---|---|---|
| 1 | Elevator pitch | §1 | 200 characters or fewer (confirm the limit shown in the form) |
| 2 | About the project | about 989 words | about 850; Devpost sets no limit. Trim "How we built it" (about 250) first if you want it shorter |
| 3 | Built with | §3 | tags |
| 4 | Try it out links | §4 | 3 links |
| 5 | Project media | §5 | video of 3 minutes or less, plus stills |
| 6 | Feedback on Token Factory, AI Cloud and NVIDIA | §6 | about 500 words |

**Never claim (each one is checked against the repo):**
- A live YC → Google Sheet append. As of 28 Oct it read the page and the sheet but the append was not proven. Neither the written fields nor the video claim it; the video uses the Wikipedia workflow instead (§5.0).
- Reliable repair onto a connected app's tool. In 4 live runs ($0.25) it never wrote anything (`testing/checkpoint-7.md`). The code-driven fix is built, not checked live.
- A task-coverage percentage. The only figure (7%) was estimated by reading code on 6 Oct and never measured.
- NemoClaw, OpenShell, Hermes Agent, Nebius Serverless, or any use of Nebius AI Cloud. Shadow uses Token Factory only.
- A notarised app, Intel Macs, or browsers other than Chrome.

---

## 1. Elevator pitch

<!-- PASTE START -->
**Main (use this one):**

Teach Shadow a task once. Nemotron designs it, and after that it runs as plain code: no AI call per click, almost no cost. It mends itself when a page changes. Nemotron on Nebius Token Factory.

**Alternate B:**

Do a work task once. Shadow learns it, runs it on its own with no AI call per click, and repairs itself when a site changes. NVIDIA Nemotron on Nebius Token Factory.

**Alternate C:**

Most agents think on every click. Shadow thinks once, when it learns your task, and again only when something breaks. Nemotron on Nebius Token Factory.
<!-- PASTE END -->

Character counts are in §8 (checks).

---

## 2. About the project

<!-- PASTE START -->
## Inspiration

Every job has a Monday-morning ritual: the ops analyst copies weekly numbers from an email into a sheet; the accounts-payable clerk renames invoices and files them; anyone back from a trip builds an expense report. None of it is hard. It is endless, and it is yours alone, so no team will build software for it.

The tools that exist fail in two ways. Old-style automation breaks the day a site renames a button. Newer browser agents survive changes, but call a large model on every click of every run: slow, costly, and a stranger's model reading your screen.

We wanted a third way: show it once, and let the model work only when needed.

## What it does

**Most agents think on every click. Shadow thinks once, when it learns, and again only when something breaks.**

Shadow learns a work task from watching you do it once, then does it for you.

1. **You record.** Do the task your usual way in Chrome, Mac apps and Finder, and say what it is for.
2. **Nemotron designs.** NVIDIA Nemotron 3 Super turns the recording into a workflow of about ten named blocks ("Open the jobs page", "Fill in the sheet") with loops, branches and connected-app steps (Sheets, Docs, Gmail, Slack and more, through Composio). A click on "the top job" stays "the top job", not the job you happened to click. It asks only where it is unsure.
3. **It runs on its own**, on a schedule, when a file appears, or when you start it. Clicks and typing replay with no model call. Anything that sends, pays or deletes waits in an inbox for your OK, with the exact values shown.
4. **It repairs itself.** When a page changes, cheap code fixes come first, then a repair agent tries a fix on the live page. It is saved as a new version only if it works; one click rolls it back.

It is a personal assistant in the plain sense: always on, remembering your answers locally, with every learned task kept as a reusable, versioned skill. Recordings, workflows and memory stay on your Mac. Passwords are never recorded.

## How we built it

Two Nemotron models on Nebius Token Factory, each doing the job its size suits, behind one OpenAI-compatible client.

**Nemotron 3 Super (120B MoE, 12B active) designs and repairs.** The design agent runs in a tool loop (write, edit, read, look, ask, test, done). After every draft, *code* checks it: a step the runner cannot run, recorded work left out, more AI calls than a run allows. A second Super call, the critic, reviews the result before it is saved. The repair agent gets the failing step and an outline of the page, and tries its fix live; guard code stops it adding a step that sends or pays, or switching an approval off.

**Nemotron 3.5 Lightning (30B MoE, 3B active) runs the AI steps.** The judgement inside a workflow (summarise, classify, pick the jobs not already in the sheet) costs about $0.0002 a step, thinking off, the answer checked by code. If code finds the answer wrong, the same question goes once to Super with what was wrong. On one repeated pick, Super was right 3 of 3 where Lightning was not.

**Replay is deterministic.** Four saved workflows re-ran on day two; their AI steps cost $0.0003 in all.

Token Factory gave us: `json_schema` output, the per-call thinking switch, automatic prompt caching (2,784 of 2,806 tokens cached on a repeat) and Zero Data Retention.

Stack: TypeScript, a Swift menu-bar app, a Chrome extension, a local Node daemon, and one small Hono service on Cloud Run.

## Challenges

Nemotron is a capable agent with habits we had to engineer around.

- **One tool call per turn.** In 17 of 18 saved designs each call carried one action, so long designs ran out of calls. Now one call plans every change; code applies them.
- **Slips in tool arguments.** One design sent the workflow as a doubly-escaped JSON string 9 times; names arrived camelCase for snake_case. Code now settles these instead of refusing.
- **Reaching for AI when code will do.** Asked for "the top 5", an AI step returned items 1, 2, 3, 2, 5. Now a loop's `first: N` counts, and the gate counts a workflow's AI calls against the run limit.
- **Reasoning shares the answer's token budget.** Super once spent all 8,192 tokens reasoning and answered nothing. We doubled it.

Where it stands: on our hardest recording (YC jobs into a Google Sheet), the early designs stalled, mostly on form; the seventh re-design finished right, with every column, the first five jobs and three AI calls. Code now settles most of those stalls.

## Accomplishments that we're proud of

- A real download: **Shadow.dmg** for Apple-silicon Macs, Google sign-in, no API key.
- Four recorded workflows (Wikipedia article to dated PDF, Hacker News top three, USD to INR, newest YouTube video) re-ran on day two and did their task. Three matched their live source; the fourth could not be confirmed independently.
- A 33-click recording becomes ten named blocks.
- About 100 real model runs while building cost **$8.34** in all, each one in a public ledger.
- 423 commits in a month, about 63,000 lines of TypeScript and Swift, 130 test files that never call the real model.

## What we learned

Code should decide what code can decide. Each time we gave a model something a loop or a counter could do, it cost us a failure; each time code checked the model's answer, the failure became a retry. What worked: a cheap model, a code check, and an escalation path to a bigger one.

## What's next

A "when an email arrives" trigger. Mac-app repair beyond the first cheap fix. Measuring task coverage on 15 real workflows with people who actually do them. Running shadow-api on Nebius compute.
<!-- PASTE END -->

---

## 3. Built with

<!-- PASTE START -->
nvidia-nemotron, nemotron-3-super, nemotron-3.5-lightning, nebius-token-factory, glm-5.3-flash, typescript, swift, node.js, react, next.js, hono, zod, model-context-protocol, composio, chrome-extension, chrome-devtools-protocol, macos-accessibility-api, apple-speech, apple-vision, sqlite, google-cloud-run, firestore, github-pages, gsap, vitest, biome, esbuild, pnpm
<!-- PASTE END -->

Each tag appears in a `package.json` or in the code (checked 29 Oct: `@composio/core`, `@modelcontextprotocol/sdk`, `hono`, `zod`, `next`, `react`, `gsap`, `firebase-admin`, `vitest`, `@biomejs/biome`, `esbuild`; `node:sqlite`, `chrome.debugger`, `AXUIElement`, `VNRecognizeTextRequest` and `SpeechAnalyzer` in `apps/` and `packages/`). Cloud Run and GitHub Pages are in `DEPLOY.md`.

---

## 4. Try it out

<!-- PASTE START -->
- Website: https://akshat-soni02.github.io/nxn-global-ai-hackathon-personal-agent/
- Download (macOS, Apple silicon): https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent/releases/latest/download/Shadow.dmg
- Code (MIT): https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent
<!-- PASTE END -->

**Note for judges** (paste into the testing instructions box if there is one):

<!-- PASTE START -->
Needs an Apple-silicon Mac (macOS 14+) and Google Chrome. The first launch is blocked by macOS because the app is signed by us but not notarised: press Done, then System Settings → Privacy & Security → Open Anyway (steps in the README). Sign in with Google: no API key is needed, and model calls go through our service on the free tier. Load the Chrome extension: `chrome://extensions` → Developer mode → Load unpacked → press ⌘⇧G, paste `/Applications/Shadow.app/Contents/Resources/extension`, Return, Select; then turn on "Allow access to file URLs". Then press Record, do any small task in Chrome, press Stop.
<!-- PASTE END -->

**Before you submit:** open all three links in a private window. Keep `shadow-api` on Cloud Run and its Token Factory key and credits alive through 1–15 Dec (judging).

---

## 5. Project media

### 5.0 Which workflow to show: Wikipedia featured article → dated PDF

**Decision: show the Wikipedia workflow as the hero. Do not show YC → Google Sheet** (the append is not proven).

| Candidate | Works today? | Evidence in the repo | Model calls while it runs | Verdict |
|---|---|---|---|---|
| **Wikipedia featured article → PDF named "date - title"** | **Yes** | Ran on two different days and saved a *different* article each time (Battle of Schliengen, then the 1986 New York Mets season); it was designed in 5 model calls for $0.018 and ran in about 2 seconds (`testing/design-eval-ledger.md`, `testing/checkpoint-7.md`) | **0** | **Hero.** Public page, no login or secret on camera, a real file in Finder, and it proves the whole idea: Shadow learned "today's article", not the clicks |
| Hacker News top 3 → notes | Yes | Titles and points matched the live front page on day two (`checkpoint-7.md`) | 1 small-model step | **Optional 25-second insert** to show Lightning. Its destination is a test notes page, so keep it short |
| USD → INR rate → notes | Yes | 95.0157 saved; the source showed 94.9754 ten minutes later, 0.04% apart | 1 small-model step, and the Save waits for an OK | Optional: shows the approval card |
| Newest YouTube video | Yes, but not independently confirmed | `checkpoint-7.md` | 1 small-model step | Skip |
| YC jobs → Google Sheet | **No** | Designed correctly and read for real; the append was never approved live | n/a | **Do not show, do not mention in the video** |
| Repair when a site changes | Not shown live | Cheap fixes and the repair agent are tested; a live repair onto an app was not reliable | n/a | Only if you verify it first (§5.3). Otherwise leave it out |

**Why Wikipedia wins:**
1. Anyone understands it in two seconds.
2. The second PDF is a visibly different article, so nobody can say it just replayed a recording.
3. It costs $0.0000 to run, which is your cleanest number on screen.
4. It has worked twice on different days. YC has not worked once.

**One thing to know:** the proven copies of this workflow are in the test kit (`~/shadow-tests/checkpoint-6/kit`), not in the Shadow.app on your Mac, whose data folder is empty. So you **record it fresh** on your Mac, in the real app.

### 5.1 The pitch you say out loud (60–75 seconds)

Use this for a live pitch, a Shark-Tank-style round, or the first thing you say to a judge. It follows the order judges listen in: result, problem, how, proof, why Nemotron, ask.

> **Result (10 s).** "Two PDFs. I made the first one by hand, once. The second one I never touched: a different Wikipedia article, named correctly, saved by itself, with no AI model called.
>
> **Problem (10 s).** "Everyone has chores like this: copy, rename, file, repeat. Too small for anyone to build software for, too long to enjoy. Old automation breaks when a site changes. New AI agents call a big model on every click, forever.
>
> **How (20 s).** "Shadow does it differently. You do the task once. Nemotron 3 Super, on Nebius Token Factory, turns that recording into a workflow, and it asks only about what it is unsure of. After that, it replays as plain code. A small model, Nemotron 3.5 Lightning, answers only the steps that need judgement, for about two hundredths of a cent.
>
> **Proof (15 s).** "Code checks every answer the models give. Anything that sends, pays or deletes waits for your OK. Your recordings and data stay on your Mac. About a hundred real runs while we built it cost eight dollars.
>
> **Close (10 s).** "Most agents think on every click. Shadow thinks once, when it learns, and again only when something breaks. It's a download you can try today."

### 5.2 The video (3:00 or less, public, on YouTube)

Devpost asks the video to show how you used Token Factory and Nemotron: the model names and a cost are on screen in beats 3–7. Voice-over is about 330 words, about 2:20 at 150 words a minute, which leaves room for footage.

| Time | On screen | Voice-over | Scores on |
|---|---|---|---|
| **0:00–0:20 Cold open** | Finder, folder "Reading". Left: `29 Oct - <Article A>.pdf` (you made it by hand). Right: `30 Oct - <Article B>.pdf` appearing, made by Shadow. A counter in the corner: "model calls while it ran: 0 · $0.0000". No logo, no names | "Two PDFs. The first one I made by hand, once. The second one I never touched: a different article, named correctly, saved by itself. And no AI model was called while it ran." | Design, Potential Impact |
| **0:20–0:35 Names** | Title card with the mark and the two names | "I'm Rushil Jariwala, and this is Akshat Soni. We built Shadow: show it a work task once, and it does that task for you from then on." | |
| **0:35–1:15 Teach and design** | The Record form with the goal ("Save today's featured Wikipedia article as a PDF in Reading"); you doing it in Chrome, sped up; Stop; Nemotron designing with the model name and the cost on screen; the workflow appearing as a few named blocks | "Here is the whole lesson. One sentence about the goal, then I do the task my normal way: open Wikipedia, open today's featured article, save it as a PDF, name it, file it. Then Nemotron 3 Super, running on Nebius Token Factory, designs the workflow. It doesn't replay my clicks. It works out that 'the featured article' means whichever one is featured that day, and that the file name is the date plus the title. Designed for [read the real cost off the screen]." | Technological Implementation, Quality of the Idea |
| **1:15–1:45 The run** | The run page by block, each with a tick; "model calls: 0"; the PDF landing in the folder | "Now the run. Every click and keystroke replays as plain code, so no model is called. That's why it costs nothing to run every day. Anything that sends, pays or deletes waits in the inbox for my OK, with the exact values on the card." | Technological Implementation, Design |
| **1:45–2:15 Two models** *(optional: use the Hacker News workflow from the test kit)* | A run page with one AI step, its model name (Nemotron 3.5 Lightning) and its cost | "Some tasks need judgement, like picking the stories I haven't saved yet. A small model, Nemotron 3.5 Lightning, answers that for about two hundredths of a cent, and code checks the answer. If the check fails, the question goes once to the bigger model." | Technological Implementation |
| **2:15–2:40 Yours to keep** | Settings (connected, the privacy switches), the Keychain secret field, an approval card | "And it stays yours. Recordings, workflows and memory live on your Mac. Passwords are never recorded. Model calls go through our service to Token Factory with zero data retention." | Design, Potential Impact |
| **2:40–2:55 Close** | The model table (Super, Lightning, prices), your Token Factory usage page, the download link | "Why Nemotron on Token Factory? The work splits by size: Super thinks when we design and repair; Lightning answers inside runs. About a hundred real runs while building cost eight dollars. Shadow thinks once, when it learns, and again only when something breaks. Download it below." | All four |

**If you ran it by hand instead of letting a schedule fire:** change the opening's last line to "The second one took one button press, and no AI model was called while it ran." Say "by itself" only if a schedule actually fired.

**Beat 2:15–2:40 alternative, only if you verified a live repair first:** "When a site changes and a step breaks, Shadow doesn't stop. Cheap fixes first, then the bigger model proposes a fix and tries it on the live page. It's kept as a new version only if it works, and one click rolls it back." Show the ordinary repair card (what changed, in which block) and Roll back. If you did not verify it, keep the "Yours to keep" beat above and do not stage a repair.

**Never say in the video:** "works on any website", "every morning" (unless it really ran that way), anything about YC or Google Sheets writes, "fully autonomous", a coverage percentage.

### 5.3 Record-day plan (be done before the deadline, 17:00 UTC on 30 Oct)

Wikipedia changes its featured article at **00:00 UTC**. That is 5:30 am IST on 30 Oct, or 5:00 pm PDT on 29 Oct. You need one run before that time and one after it, and both before 17:00 UTC (22:30 IST) on 30 Oct.

**Today, before 00:00 UTC (the recording and the first PDF):**
1. Open Shadow, check Settings says "Connected to Nemotron", and check the Chrome extension is loaded.
2. Off camera, as a dry run: Record the task once with the goal sentence from the table above, answer any question, press Looks right, and Run now. Check the PDF is named "date - title" and opens. A design costs about $0.02–0.05.
3. If the dry run works, record it again **on camera** (this is the "teach and design" footage, with the real model name and cost on screen). Keep the first PDF as Article A.
4. Set Frequency to every day at a time after 00:00 UTC that is before you will be awake to film (for example 6:00 your time), press Go live, and keep the Mac awake and Shadow running (`caffeinate -dimsu` in a terminal).

**Tomorrow, after 00:00 UTC (the second PDF and the run footage):**
5. If the schedule fired, film the Finder folder with both PDFs and the run page. If it did not, press Run now and film that, and use the "one button press" line.
6. Film the Token Factory usage page (your real usage) and the Settings screen for the close and the privacy beat.
7. Optional: film the Hacker News workflow's run page from the test kit for the 1:45 beat.

**If the live design misbehaves** (it stalls or asks odd questions): do not film the stall. Use the saved Wikipedia workflow from the test kit (`main-page-n0x09c`: same product code, scratch data) for the design and run footage, and say nothing that implies it was recorded on your Mac if it was not.

**If Wikipedia's second article cannot be filmed in time:** open with the Hacker News workflow instead (two runs hours apart show different stories) and keep Wikipedia as the explanation in the recording beat.

**Cost and ledger:** a real design run costs money; announce it first and add a row to `testing/design-eval-ledger.md` (cap $10).

### 5.4 Stills (Devpost image gallery: 6, in this order)

1. Finder with the two PDFs. Caption: *One made by hand, one made by Shadow: a different article, named correctly.*
2. The Record form with the goal sentence. Caption: *You say what the task is for, then do it your usual way.*
3. The workflow as a short list of named blocks. Caption: *Nemotron turns the recording into blocks, named in plain words.*
4. The run page by block, with "model calls: 0". Caption: *Replay is plain code: a run with no AI step makes no model call.*
5. An approval card with values (or the version history with Roll back). Caption: *Anything that sends, pays or deletes waits for you, and shows what it will do.*
6. The architecture diagram (`docs/guide/13-the-whole-picture.png`). Caption: *Your Mac holds the data; Nemotron on Token Factory is the model.*

### 5.5 YouTube title and description

<!-- PASTE START -->
**Title:** Shadow: do a work task once, and it runs itself (NVIDIA Nemotron on Nebius Token Factory)

**Description:** Shadow learns a task from watching you do it once, runs it on its own, and mends itself when a site changes. Nemotron 3 Super designs the workflow; Nemotron 3.5 Lightning answers the AI steps, at about $0.0002 each. Replay itself makes no model call. Code: https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent · Download: https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent/releases/latest/download/Shadow.dmg
<!-- PASTE END -->

### 5.6 Questions judges ask, and honest answers

- **"What is new here?"** Agents that act for you usually call a big model on every click. Shadow calls a model when it learns the task and when a step fails, and runs the rest as plain code. It is cheaper, faster, steadier and more private.
- **"Where exactly is Nemotron?"** Super designs the workflow (a tool loop, checked by code after every draft, reviewed by a critic call), edits it from a sentence, and repairs it. Lightning answers the AI steps inside a run. Both run on Nebius Token Factory.
- **"Does it work on any site?"** No. It works on tasks it can watch in Chrome, Mac apps and Finder. Today's limits: a spreadsheet's drawn grid needs the connected app, Chrome's own "where to save" window needs you, and "when an email arrives" is not built yet.
- **"What if a model gets it wrong?"** Code checks the answer. A wrong AI answer is asked once more of the bigger model and fails the run if it is still wrong. Anything that sends, pays or deletes waits for your OK, and a repair can never add one or turn an approval off.
- **"What does it cost?"** An AI step is about $0.0002. A plain run is $0. Designing a recording cost between $0.01 and $0.20 in our runs.
- **"Is it private?"** Recordings, workflows and memory stay on your Mac. Passwords are never recorded; secrets go to the Keychain. Model calls go through our service to Token Factory with zero data retention.
- **"What failed?"** Honest answer: the model took one tool action per turn and slipped on argument shapes, so we built plan-then-apply and code that settles the slips. Our hardest recording, YC jobs into a sheet, stalled in early designs before it finished right.

---

## 6. Feedback on Nebius Token Factory, AI Cloud and NVIDIA

Each point comes from a run or a measurement in this repository (`FEEDBACK.md`, `testing/`).

<!-- PASTE START -->
### Nebius Token Factory

**What worked.** One OpenAI-compatible endpoint served two Nemotron models and a vision model; swapping a model was one line of config. `json_schema` output, tool calling and the per-call thinking switch behaved the same across both Nemotron models. Prompt caching happened without our asking (2,784 of 2,806 tokens cached on a repeated design prompt), and Zero Data Retention as one organisation setting made a privacy-first product easy to build and to explain. At $0.06 per 1M input tokens, Lightning affords a model call on every scheduled run.

**What would help.**
- Reasoning and the answer share one `max_tokens` budget. Nemotron 3 Super once spent all 8,192 on reasoning and returned nothing. A separate reasoning budget, or a clear finish reason when reasoning uses it up, would make this obvious at once.
- Usage reports `cached_tokens`, but we found no published price for them, so our meter charges full price and our costs are an upper bound.
- Models were removed in waves while we built. Deprecation dates in `/v1/models` would help builders plan.
- The trial credit needs a bank card: fine for us, a hurdle for students.

### NVIDIA Nemotron 3 Super

**What worked.** With tools, it reads a messy 33-event recording and builds a workflow with loops, branches, AI steps and connected-app steps, for $0.01 to $0.20 a design. On our hardest recording its seventh design got the right columns, the first five jobs and three AI calls.

**Where we would most like to see it grow.**
- *Parallel tool calls.* In 17 of 18 saved designs each call carried one action. We built plan-then-apply around it.
- *Argument fidelity.* One design sent the workflow as a doubly-escaped string 9 times; camelCase arrived where the schema said snake_case. Code settles these now.
- *Consistency in agentic repair.* In two live runs one message apart, one read the tool's arguments and wrote exactly the right step; the next never used the tool. For agents that run unattended, steadier tool choice is what matters most.

### NVIDIA Nemotron 3.5 Lightning

**What worked.** Fast and cheap enough ($0.06 / $0.24 per 1M tokens) to sit inside every scheduled run, with thinking off by default.

**What we learned.** "Top" is ambiguous, and instruction wording matters. On real data, "the top 3" scored 0 of 3 for Lightning (it dropped item one) and 0 of 3 for Super too (it picked by points). "The first 3 in the list's order" scored 2 of 3 for Lightning, 3 of 3 with thinking on, and 3 of 3 for Super. Told not to repeat a saved story, Lightning repeated it once; Super was right 3 of 3. A short prompt-pattern note for ordered selection in the model card would save builders an afternoon. We now check answers in code and escalate.

### Nebius AI Cloud

We did not run on it, and want to say why, since that is feedback too. Shadow's server is one small stateless container, and the hackathon credits cover Token Factory, not AI Cloud. GPU-hour billing is a poor fit for a project that must stay live through judging. Credits that covered AI Cloud's serverless containers would let us try it; the container is ready to move.
<!-- PASTE END -->

---

## 7. Fact sheet (for you, not pasted): where each number comes from

| Claim | Source |
|---|---|
| Deadline 30 Oct 2026, 10:00 PT; video 3 minutes or less; four equal criteria | `research_notes/LLM driven record and replay/nebius_models_and_access.md:20, 67-71` |
| 99 ledger rows, $8.34 in all | `testing/design-eval-ledger.md`, rows beginning `\| 2026`, summed (29 Oct). Some rows' costs are estimates ("est."), so say "about 100 runs, about $8" |
| Lightning: thinking off, $0.06 / $0.24; Super: thinking on, $0.30 / $0.90; Super's `maxTokens` 16,384 | `packages/llm/src/catalog.ts:62-80`; prices in `README.md` |
| AI step about $0.0002; four day-2 workflows' AI steps $0.0003 | `README.md` (Nemotron section); ledger row of 27 Oct |
| Lightning wrong, Super 3 of 3 | `packages/player/src/node/llm-step.ts:171-172`; ledger 24 Oct |
| "Top 3" probe: Lightning 0/3, Lightning+thinking 0/3, Super 0/3; "first 3 in the list's order": Lightning 2/3, with thinking 3/3, Super 3/3 | ledger row of 24 Oct ("AI step probe") |
| Caching 2,784 of 2,806 tokens | ledger row of 28 Oct (N21) |
| 17 of 18 designs: one tool call per turn; 9 double-escaped workflows | `FEEDBACK.md`, Nemotron section |
| Reasoning used all 8,192 tokens (25 Oct) | `FEEDBACK.md`; `catalog.ts:74` comment |
| "Top 5" AI step returned 1, 2, 3, 2, 5 | `reports/changes.md` §5.5, Y6 |
| The 7th YC re-design finished right (columns, first 5 jobs, 3 AI calls) | `FEEDBACK.md`, Nemotron section; `README.md`; ledger rows of 28 Oct. Don't quote a "2 of 7" rate: it is only in a private memory note |
| 4 repair runs, $0.25, nothing written | `testing/checkpoint-7.md`, check 5 |
| Day-2 results of A–D; B unconfirmed | `testing/checkpoint-7.md` |
| 33 steps → 10 blocks | `reports/changes.md` §1 (R2.1, R2.4) |
| 423 commits; about 63,000 lines; 130 test files | `git rev-list --count HEAD`; line count of `*.ts`, `*.tsx`, `*.swift` under `apps/` and `packages/` (includes tests) |
| Contributors | `git shortlog`: Rushil Jariwala (`ruseellkj`) and Akshat Soni |

---

## 8. Checks run on this file

Measured on 29 Oct, after the last edit.

| Check | Result | Target |
|---|---|---|
| Pitch, main | 193 characters | 200 or fewer |
| Pitch B / C | 165 / 151 characters | 200 or fewer |
| About the project | about 989 words | about 850; Devpost sets no limit. Trim "How we built it" (about 250) first if you want it shorter |
| Feedback | 542 words | 450 to 550 |
| Voice-over | about 310 words across 7 beats (about 2:05 at 150 words a minute); the live pitch in §5.1 is about 230 words (about 75 seconds) | 400 or fewer; 3:00 hard limit |
| Links | site, repo and `Shadow.dmg` all answered (HTTP 206, 29 Oct) | open them in a private window again before submitting |
| Spend | 99 ledger rows, $8.34 | matches "about 100 runs, about $8" |

To refresh: split each paste block on its markers and count with `wc -w`; count the pitch lines with `awk '{print length}'`.
