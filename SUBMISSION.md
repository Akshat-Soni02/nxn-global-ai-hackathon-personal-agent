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
- A live YC → Google Sheet append. As of 28 Oct it read the page and the sheet but the append was not proven. The written fields do not claim it; the video shows it only if it works for real on record day (§5).
- Reliable repair onto a connected app's tool. In 4 live runs ($0.25) it never wrote anything (`testing/checkpoint-7.md`). The code-driven fix is built, not checked live.
- A task-coverage percentage. The only figure (7%) was estimated by reading code on 6 Oct and never measured.
- NemoClaw, OpenShell, Hermes Agent, Nebius Serverless, or any use of Nebius AI Cloud. Shadow uses Token Factory only.
- A notarised app, Intel Macs, or browsers other than Chrome.

---

## 1. Elevator pitch

<!-- PASTE START -->
**Main (use this one):**

Do a work task once. Shadow learns it from watching, runs it on its own for fractions of a cent, and repairs itself when a site changes. NVIDIA Nemotron on Nebius Token Factory.

**Alternate B:**

Show Shadow a task once. Nemotron 3 Super turns it into a workflow that needs no model on every click, and repairs itself when a site changes. Private, on your Mac.

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

### 5.1 The video (3:00 or less, public, on YouTube)

Devpost asks the video to show how you used Token Factory and Nemotron: the model names and costs are on screen in beats 3–6.

**Cold open (0:00–0:25): PLACEHOLDER.** You said this is the weak part and you will change it. Three options, each built on something that has worked. Pick one, or replace it.

| Option | What the viewer sees in 25 seconds | Voice-over | about 275 words from 0:25 on, about 310 with the opener (about 2:05 at 150 words a minute) | 400 or fewer; 3:00 hard limit |
|---|---|---|---|
| **A. YC jobs → Google Sheet** (current choice) | Left: you, once, sped up (YC jobs page → copy 5 jobs → paste in a sheet). Right: Shadow alone on its next run; the approval card "Append 5 rows" with the values; rows land. | "Thirty-three clicks. I did this once. Then Shadow did it alone: read today's YC jobs, asked me to approve five rows, wrote them to the sheet." | **No.** Check on record day (§5.3). |
| **B. Wikipedia → dated PDF** (safe fallback) | Same split screen. Right: today's featured article saved as `29 Oct - <title>.pdf`; counter "model calls: 0 · $0.0000". | "I did this once, [N] days ago. Each run since, it has saved that day's article and made zero model calls." (Say "every morning" only if a daily trigger really fired; see §5.3.) | **Yes.** Saved a different article each day (24 Oct, 27 Oct) with no model call. |
| **C. Hacker News top 3 → notes** | Right: Shadow reads HN, Lightning picks, the notes fill; counter "AI calls: 1 · Nemotron 3.5 Lightning · $0.0002". | "One recording. Each run, it reads the front page and picks what I haven't saved, for two hundredths of a cent." | **Yes.** Titles and points matched the live page on 27 Oct. |

Rule for any opening: show the *result*, with no logo and no names, and put a number on screen (calls or cost). Names come after.

**Voice-over, 0:25 onwards.** Written so it fits whichever workflow you film: the [brackets] are the only parts that change (use the Hacker News workflow if YC fails: it has an AI step and a Save step that asks first). About 250 words; about 250 words, plus about 35 for the opener: about 1:55 at 150 words a minute, which leaves air for the footage):

| Time | On screen | Voice-over | about 275 words from 0:25 on, about 310 with the opener (about 2:05 at 150 words a minute) | 400 or fewer; 3:00 hard limit |
|---|---|---|
| 0:25–0:35 | Title card with the mark; two names | "I'm Rushil Jariwala, and this is Akshat Soni. We built Shadow: you show it a work task once, and it does it for you from then on." |
| 0:35–1:20 | The Record form, then the recording, then Nemotron designing; the model name and the cost on screen; the 33 steps folding into ten blocks; one question appearing beside a step | "Here is the one recording: [N] events. Nemotron 3 Super, running on Nebius Token Factory, reads it and writes the workflow in a tool loop, while code checks every draft. [N] named blocks. It asks one question, only about the step it was unsure of [say what it really asks; for YC: which column is the company]. The whole design cost [read the real cost off the screen]." |
| 1:20–1:50 | The run page by block; the AI step with its model and cost; the approval card with values | "Now the run. Clicks and typing replay with no model call. One step needs judgement [YC: pick the jobs not already in the sheet; HN: pick the stories not already saved], so Nemotron 3.5 Lightning answers it: about two hundredths of a cent. Anything that writes waits for me, with the exact values on the card." |
| 1:50–2:20 | A site change (a renamed button); the inbox card that says what changed and in which block; version 2; Roll back | "When a site changes, Shadow doesn't stop. Cheap fixes first. If those fail, Nemotron 3 Super gets the failing step and an outline of the page, proposes a fix, and tries it on the live page. It is saved as version two only if it works, and one click rolls it back. It can never add a step that sends or pays." |
| 2:20–2:50 | The model table (Super, Lightning, prices); the ledger; the download link | "Why Nemotron on Token Factory? Because the work splits by size. Super thinks when we design or repair. Lightning answers inside every scheduled run. One API, thinking switched per call, prompt caching, zero data retention. About a hundred real runs while building this cost eight dollars. Shadow thinks once, when it learns, and again only when something breaks. Download it below." |

The 1:50–2:20 beat is **shown only if the repair worked live** (see 5.3). If not, narrate it over the run page and the version history, and do not stage a fake.

### 5.2 Stills (Devpost image gallery: 6, in this order)

1. The workflow as ten named blocks. Caption: *A 33-click recording becomes ten blocks, named in plain words.*
2. A question beside a step while Shadow builds. Caption: *It asks only about what it is unsure of, next to the step.*
3. An approval card with values. Caption: *Anything that sends, pays or deletes waits for you, and shows what it will do.*
4. The run page by block. Caption: *Each block shows how it went. A run with no AI step makes no model call.*
5. The repair card in the inbox (what changed, in which block) with Roll back. Caption: *When a site changes, Shadow fixes the step, keeps the fix only if it works, and can roll it back.*
6. The architecture diagram (`docs/guide/13-the-whole-picture.png`). Caption: *Your Mac holds the data; Nemotron on Token Factory is the model.*

### 5.3 Record-day checklist

1. Restart `pnpm daemon` (his started before the 28 Oct fixes) and reload the extension in `chrome://extensions`.
2. Record YC → Sheet again (paste date → A, company → B, role → C). Run now, approve the 5 appends, check the rows **in the test sheet** before filming.
3. If the rows land: film option A. If not: film option B or C, with the Hacker News workflow in the middle beats (the [brackets] in the voice-over). For an honest "every morning": set the chosen workflow live with a daily trigger tonight, let it fire once, and film that run page.
4. For the repair beat, first check once off camera on `fixtures/pages/drift/renamed.html`. Use the ordinary repair card (not the "Shadow can fix it" connected-app card, which is not checked live). Roll back afterwards.
5. A real model run costs money: announce it first and add a row to `testing/design-eval-ledger.md` (cap $10).
6. Screen-record at 1080p; show the model name and the cost on screen at least twice.

### 5.4 YouTube title and description

<!-- PASTE START -->
**Title:** Shadow: do a work task once, and it runs itself (NVIDIA Nemotron on Nebius Token Factory)

**Description:** Shadow learns a task from watching you do it once, runs it on its own, and repairs itself when a site changes. Nemotron 3 Super designs and repairs the workflow; Nemotron 3.5 Lightning answers the AI steps, at about $0.0002 each. Replay itself makes no model call. Code: https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent · Download: https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent/releases/latest/download/Shadow.dmg
<!-- PASTE END -->

---

## 6. Feedback on Nebius Token Factory, AI Cloud and NVIDIA

Each point comes from a run or a measurement in this repository (`FEEDBACK.md`, `testing/`).

<!-- PASTE START -->
### Nebius Token Factory

**What worked.** One OpenAI-compatible endpoint served two Nemotron models and a vision model; swapping a model was one line of config. `json_schema` output, tool calling and the per-call thinking switch behaved the same across both Nemotron models. Prompt caching happened without our asking (2,784 of 2,806 tokens cached on a repeated design prompt), and Zero Data Retention as one organisation setting made a privacy-first product easy to build and to explain. At $0.06 per 1M input tokens, Lightning affords a model call on every scheduled run.

**What would help.**
- Reasoning and the answer share one `max_tokens` budget. On 25 Oct Nemotron 3 Super spent all 8,192 on reasoning and returned nothing. A separate reasoning budget, or a clear finish reason when reasoning uses it up, would make this obvious at once.
- Usage reports `cached_tokens`, but we found no published price for them, so our meter charges full price and our costs are an upper bound.
- Models were removed in waves in June and August. Deprecation dates in `/v1/models` would help builders plan.
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
| Pitch, main | 177 characters | 200 or fewer |
| Pitch B / C | 164 / 151 characters | 200 or fewer |
| About the project | about 989 words | about 850; Devpost sets no limit. Trim "How we built it" (about 250) first if you want it shorter |
| Feedback | 542 words | 450 to 550 |
| Voice-over | about 275 words from 0:25 on, about 310 with the opener (about 2:05 at 150 words a minute) | 400 or fewer; 3:00 hard limit |
| Links | site, repo and `Shadow.dmg` all answered (HTTP 206, 29 Oct) | open them in a private window again before submitting |
| Spend | 99 ledger rows, $8.34 | matches "about 100 runs, about $8" |

To refresh: split each paste block on its markers and count with `wc -w`; count the pitch lines with `awk '{print length}'`.
