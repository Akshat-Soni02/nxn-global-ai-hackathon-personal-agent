# 14 · Shadow end to end: what changed, record, replay, and where AI fits

> Written 12 Oct 2026. Sources: `docs/design.md` and the code on Akshat's branch `feat/app-window` (`6c61f1b`, 11 Oct), which is **not merged into main yet**. Every "built" below was read in that code.

![Shadow end to end](14-shadow-architecture.png)

Editable: [`14-shadow-architecture.excalidraw`](14-shadow-architecture.excalidraw). The sections in this note follow the diagram's numbers.

## Which picture to trust

- **Use diagram 14.** The older diagrams show the flat-skill flow from before the 8 Oct pivot:
  - [`architecture-map`](architecture-map.png) (7 Oct, its violet section 4 is now diagram §4);
  - [`how-it-works`](how-it-works.png) (1 Oct);
  - [`12-how-it-works-simply`](12-how-it-works-simply.png) (6 Oct).

  They're kept unchanged for history. Editing them now would add merge conflicts, because Akshat's branch already rewrote them for the rename.
- **There are two `design.md` files:**
  - main has the 514-line version;
  - `feat/app-window` has the 720-line version, which adds the workflow lifecycle, the daemon as a service, the app window, observability and packaging.

  The 720-line one is the truth.
- **The product is now called Shadow.** The data folder is `~/Library/Application Support/Shadow`, and the packages are `@shadow/*`.

## Q1 · What did Akshat change?

His branches are stacked, each on top of the previous one; none is in main.

| Branch | Adds |
|---|---|
| `feat/task-player-setup` | `packages/llm`, the single client every model call goes through. `packages/agent`, the agent loop. `core/edit.ts`, `core/guard.ts` and `core/briefing.ts`. Recovery from failures: pause, classify, cheap ladder, repair agent, verify, new version, rollback |
| `docs/desktop-app` | The plan for the daemon as a service, the app window, observability and packaging; "workflow control for users" |
| `feat/rename-shadow` | Task Player → Shadow |
| `feat/daemon-service` | Runs and an **inbox** in SQLite (`shadow.db`). A run that needs you **waits** with a saved checkpoint, so it survives a restart. An API on the Unix socket and on local HTTP with a token. The terminal becomes just a client. Log files |
| `feat/app-window` (tip) | Menu bar item, notifications, and a window (React in WKWebView) showing the inbox, workflows, runs, a run's repairs, and rollback. The daemon starts at login |

**Built vs not, today:**

| Built | Not built |
|---|---|
| Capture (web, Mac apps, files) | Description form |
| Compile (one model call) | Screenshots, voice |
| Drill (as inbox questions) | Consent, redaction, 24-hour deletion |
| The workflow format: trigger, action, llm, loop, branch, ask, approval, history | **Design agent** |
| The interpreter and llm steps | Drill on the tree |
| Recovery for web steps | Editor, highlight-only test |
| Agent runtime, llm package | Triggers, draft / live / paused |
| Daemon service and window | Key in the Keychain, packaging |

## Q2 · The updated record flow, end to end (diagram §1)

| # | Step | What happens | Status |
|---|---|---|---|
| 1 | **Describe** | A form before Record: Goal and Frequency, plus optional Changes, Stays the same and Never. See Q6 for which fields to require | Planned (Rushil) |
| 2a | **Consent** | First time only: Screen (yes/no) and Microphone (yes/no). macOS then asks for Screen Recording, Microphone and Accessibility, by the name "Shadow" | Planned |
| 2b | **Record** | Three streams on one clock, all code, no model: **events** (extension, Shadow.app Accessibility, FSEvents), **screenshots** (Q7) and **voice** (Q8) | Events built; the other two planned |
| 2c | **Stop** | Writes the recording folder. Today `traces/<session>.jsonl`, kept forever. Planned: `recordings/<session>/` with the trace, shots, audio and transcript, deleted 24 h after go-live | Partly built |
| 3a | **Code prep** | `normalise` merges keys, drops noise and adds a starting navigate. `skeleton` builds locators (never x/y), inputs, file rules and approvals on risky words. Planned: line the transcript up with the events | Built (alignment planned) |
| 3b | **Understand** | The **design agent** (Q4) turns behaviour into intent: variables, loops, branches, llm steps. Today this is `compile.ts`: one Nemotron Super call, re-asked up to 3 times when the JSON fails the schema | Planned (Rushil) |
| 4 | **Drill** | Questions only where it's unclear. Today they go to the inbox as `question` items on a flat list; answers go to `memory.db` | Built as a flat list; on the tree planned |
| 5 | **Draft tree** | Shown in the window before go-live. Today the window shows saved versions read-only | Planned |
| 6 | **Edit** | Field edits and approval toggles, using the same `core/edit.ts` operations as the agents | Planned (the edit operations are built) |
| 7 | **Test** | Highlight-only Play. First feature to cut if late | Planned |
| → | **Go live** | `skills/<id>/v1.json`, never overwritten | Built |

**Three gaps on the record side, found in the code:**
- **The recorder writes only action steps.** The schema and the player already run loops, branches, llm steps and asks; nothing in record produces them yet. The design agent is what adds them.
- **`description.changes`, `constants` and `never` are never filled.** They stay `[]`, so the repair guard's Never rules are **empty for every recorded workflow**.
- **A fresh recording has `history: []`,** so the window's Versions list is blank for v1.

## Q3 · The updated replay flow (diagram §3)

1. **A run starts:** `run <id>` or **Run now** in the window. Schedules come later.
2. **Inputs are filled:** a value you give, the file finder, or a default, plus the file checks.
   - Gap: Run now ignores "ask me each time" and takes the newest matching file.
3. **The interpreter walks the tree:**
   - **Action steps** run match → act → wait → check, with **no model**. Matching scores Chrome's accessibility tree (role + name 0.45, attributes 0.25, selectors 0.30) and needs one clear winner.
   - **llm steps** make one Lightning call each, with a typed answer, at most 3 per run, cached per day.
   - **Approvals and asks** become inbox items. The run waits with a checkpoint and continues when you answer, even after a restart.
4. **When a step fails** after its retries, the run **pauses**, keeping the tab, the variables and its position, and **code classifies the failure**:

   | Class | What happens |
   |---|---|
   | Transient | Retried at 30 s and 2 min, then it's handed to you |
   | Environment | The inbox says "waiting for you" |
   | Nothing to do | The run ends as a no-op |
   | Data | The run fails |
   | Drift | Repair (below) |

5. **Drift goes through three stages:**
   - **Cheap ladder, no model, web only.** It has two rungs: wait longer, then fuzzy match (score ≥0.6 and 0.2 ahead of the next).
   - **Repair agent**, if the ladder can't fix it.
   - **Verify by evidence**, in code: the step's check passes, the next target is found, or the success checks pass.
6. **If verified:** the fix is saved at once as v(N+1) with `by: debug`. An inbox item says "repaired", rollback is one click, and the run resumes at the same step.
7. **If not:** the inbox shows retry · skip · stop. Today you do the step by hand and press skip. Planned: Shadow records what you do and saves it as the fix, with `by: user`.

**Found in the code, for Akshat:**
1. **Safety, likely (read in the code, not run in a test):** a retargeted outward step (for example Submit) can be committed without ever running.
   - The daemon's approve hook answers `WAIT`, a Symbol, which is truthy. So `tryDraft` in `verify.ts` records the step as approved, treats the waiting trial as `ok`, and `approveOnce` then skips it.
   - The run then resumes at that step, which runs **without approval** unless its saved step already requires one.
2. `try_steps` can start past the failed step, so a commit may never prove that the failed step works.
3. The per-run repair limits ($0.25, 2 episodes) reset after every wait.
4. `on_item_fail: "skip"` never skips while recovery is on; a bad item fails the whole run.
5. **design.md and the code disagree here:**
   - design.md lists a "label + nearby heading" rung, and `describe_screen`, `run_log`, `open_menu` and `dismiss` tools; none is in the code.
   - "Thinking budget" is only on/off in the code.
   - design.md says the key comes from the Keychain; the code reads `.env`.

## Q4 · "An agentic loop for the repair in record step 6": is that the repair and design agents?

**Short answer:** it's the **design agent**. The repair agent is a different agent, on the replay side.

**What "repair in step 6" meant.** In the old diagram (`architecture-map` §4), step 6 was:
- **6a:** caption unclear steps;
- **6b:** compile the meaning (one Nemotron Super call);
- **6c, "check and repair":** code validates the model's JSON and sends the errors back, at most 3 tries.

That "repair" fixes the **model's own bad answer**, not a broken page. It still exists, in `compile.ts`.

**Akshat's suggestion** is to make 6b + 6c a **loop with tools**: the design agent, on the same `packages/agent` runtime as the repair agent. A one-shot call can only guess. A loop can look, try, check and ask:

| Turn | Tool | What it does (workflow 1, the KPI email → sheet) |
|---|---|---|
| 1 | `read_description`, `read_trace` | Goal "this week's KPIs in the sheet"; the user clicked one email, then typed 3 numbers |
| 2 | `read_transcript` | Over the email click: "I always take the newest one from Reporting Bot" |
| 3 | edit ops | The click becomes "the newest email from Reporting Bot". The typed numbers become variables |
| 4 | `add_llm_step` | "read Revenue, Signups and Churn from the email" → `kpis {revenue, signups, churn}` |
| 5 | `validate` | Fails: `{{kpis.revenue}}` is used before it's declared. The agent moves the llm step up |
| 6 | `dry_run` | Highlights the email row and the sheet's first empty row; both are found |
| 7 | `ask_user` (the drill) | "Always the newest email from Reporting Bot, or this exact one?" |
| 8 | `finish(workflow)` | The draft tree goes to the window |

**The two agents side by side:**

| | Repair agent | Design agent |
|---|---|---|
| Side | Replay (Akshat) | Record (Rushil) |
| Starts when | A step fails and the ladder couldn't fix it | You press Stop |
| Reads | Failure report, the live page, site notes | Description, trace, transcript, screenshots, memory |
| Changes | Steps of a live workflow, inside the guard | Builds the whole draft tree |
| Must not | Add outward steps, or touch your decisions, Never list or approvals | Invent an action you never showed: it has no locator for it, so it asks you to show it |
| Ends with | `resolve`, `commit` or `escalate` | `finish(workflow)` |
| Status | Built for web | **Not built**: no `packages/recorder/src/design/` yet |

## Q5 · OpenAI: `SKILL.md` vs `agents/openai.yaml`

- **`SKILL.md`** is for the **model**.
  - Its front matter (`name`, `description`) is the only part Codex reads to decide when to use the skill.
  - The body is the instructions, loaded only when the skill is chosen.
  - Record & Replay's output is a skill that "explains when to use the workflow, what inputs it needs, what steps to follow, and how to verify the result" ([Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)).
- **`agents/openai.yaml`** is for the **app**, not the model ([Build skills](https://learn.chatgpt.com/docs/build-skills); OpenAI's own reference calls it "intended for the machine/harness to read, not the agent"):
  - **`interface`:** `display_name`, `short_description`, icons, `brand_color`, `default_prompt`. This is how the skill looks in the ChatGPT desktop app.
  - **`policy.allow_implicit_invocation`:** when `false`, the skill runs only when called by name.
  - **`dependencies.tools`:** MCP servers it needs.
  - `default_prompt` is the only field that reaches the model, and only through the prompt it inserts.
- **Unconfirmed:**
  - The Record & Replay docs never name either file. The yaml is written by OpenAI's `skill-creator` scripts.
  - The docs spell it `.yaml` and list `.agents/skills` folders; `.codex/skills/…/openai.yml` is what people have observed.
- **For Shadow:**
  - We don't need a second file. One workflow JSON holds both:
    - `name`, `description`, the trigger and the approvals, which the window shows;
    - the steps, which the player runs.
  - The difference: their SKILL.md is prose a model re-interprets every run. Our tree is executed, so a run costs no model calls unless it breaks.

## Q6 · Should the user fill in the whole template before recording?

**What other products do:**

| Product | How it collects intent |
|---|---|
| **OpenAI** | One free-text prompt, with a suggested prompt filled in, plus the tip "State your goal and any specific inputs that might vary between skill uses before you start recording" |
| **Power Automate, Record with Copilot** (now deprecated) | **Narration is required**. It's what lets it add loops and conditions |
| **browser-use workflow-use** | Asks "What is the purpose of this recorded workflow?" **after** recording; the model infers the inputs |

**None of the products we could check asks for a structured form up front.**

**Recommendation:**
- **Before Record, ask only two things:**
  - **Goal** (required, free text). The placeholder tells the user to say what changes and what stays.
  - **Frequency** (dropdown, default "Only when I start it").
- **After Stop:** the design agent **proposes** Changes, Stays the same and Never from the trace and narration, and the drill shows them on the tree for one-click confirmation. Never also gets suggestions from risky steps, like "send" and "delete".
- **Why:** people can't predict their variables before doing the task, and a long form kills the "show me once" promise. But the goal and frequency are cheap to give and change the result the most.
- **It also fixes a gap:** today `never` is always empty, so the guard has nothing to enforce.

## Q7 · Screenshots: when and how

**Only after consent, at each event:**
1. **The window that is active gets the screenshot:**
   - **Chrome tab:** the extension calls `chrome.tabs.captureVisibleTab`. The extension already has `<all_urls>`.
     - It shouldn't need the macOS Screen Recording permission, because Chrome copies its own tab's pixels; confirm this once on a clean Mac.
     - Chrome allows at most **2 per second**, so take one per settled event, not one per keystroke.
   - **Mac app:** Shadow.app captures **that one window** with ScreenCaptureKit (`SCScreenshotManager` with a single-window filter). This needs the **Screen Recording** permission, and macOS 15+ may ask again periodically.
2. **Redact before saving:**
   - don't capture while a password field has focus, or in a blocked app;
   - black out known fields: password and card fields come from the content script, and secure fields from Accessibility;
   - on-device OCR (Apple Vision) masks emails, card numbers, keys and Never words, with padded boxes, because Vision's boxes aren't exact.
3. **Downscale and save:** for example to a long side of 1280, saved as `shots/<n>.png`. The trace event gets the shot's number.

**Where the screenshots go:**
- **On the Mac:** saved there and deleted 24 h after go-live.
- **To a vision model, design.md's plan:** **only** when an agent calls `describe_screen`, only with consent, only redacted, and sent to GLM-5.3-Flash.
- **"Stays on the Mac":** your note says screenshots stay on the Mac; design.md sends redacted ones with consent. To keep them strictly local, send only on-device OCR text and Accessibility labels instead. That decision is still open.

**What they're for:**
- the design agent, for steps the trace can't explain (canvas apps, spreadsheet cells, images);
- pictures in the drill;
- thumbnails in the tree.

**Never for replay:** replay never matches on pixels.

## Q8 · Voice: talking while doing, and talking without doing

**Capture:**
- Shadow.app records the microphone and transcribes it **on the Mac** with Apple's SpeechAnalyzer / SpeechTranscriber (macOS 26).
- Each piece of text carries its `audioTimeRange`. Shadow.app notes when the audio started on the daemon's clock, so the text lines up with the events.
- It needs the **Microphone** permission. Apple says the separate Speech Recognition prompt is only for the older `SFSpeechRecognizer`, so test whether it appears.
- The speech model is downloaded the first time.
- The audio is never sent anywhere; only the text is.

**What each kind of speech becomes** (code lines up the segments, the design agent decides):

| You say | When | Becomes |
|---|---|---|
| "I always take the newest one from Reporting Bot" | Over a click | How to choose the target: a rule, not this one email |
| "now just summarise this into 3 bullets for the team" | **With no events nearby** | An **llm step**. The agent adds a read of the text before it (`web.extract`), and the summary becomes a variable |
| "only if it's over 5000", "every Monday" | Any time | A branch, the trigger, or the description |

**Talking without doing:**
- An llm step only **transforms** data; it can't click or send. So if you say "and post it in Slack" without showing it, the design agent **asks you to show that part once**. It can't invent a click it has no locator for.

**At replay:**
- Nothing is played back.
- The llm step runs again with that day's data (Lightning, at most 3 per run, cached per day).

## Q9 · Where the LLM and the agents sit in the loop (Akshat's packages)

| Loop step | Model? | Which |
|---|---|---|
| 1 Describe, 2 Record | No | Code |
| 3 Understand | Yes | Design agent: Super in a loop. Today one call with up to 3 re-asks. Vision (GLM) only through `describe_screen` |
| 4 Drill | No new call | The questions come from step 3 |
| 5–7 Tree, edit, test | No | `edit.ts`, `check.ts`, highlight |
| 8 Run | Only llm steps | `fast` = Nemotron 3.5 Lightning |
| 9 Recover | Only after code fails | Classify (code) → ladder (code) → **repair agent** (`smart` = Super) → verify (code) |

**The building blocks:**
- **`packages/llm`:** the one door to Token Factory.
  - Profiles: `fast`, `smart`, `vision`.
  - Structured output with fallbacks `json_schema` → `json_object` → prompt.
  - Thinking on or off, tool calls, retries on 429 / 5xx, and a usage meter in dollars.
- **`packages/agent`:** the loop.
  1. It starts from a briefing and a task.
  2. The model picks **one** tool.
  3. The **guard** allows it or refuses it; a refusal is told back as a result.
  4. The tool runs, and page text is marked untrusted.
  5. The result goes into working memory, and the loop repeats.
  6. It stops at a finish tool or when the budget runs out (12 turns, $0.10, 20 live actions).
- **`core/edit.ts`:** 7 edit operations (retarget, insert, replace, remove, move, set, set_skill). The agents and the future editor use the same ones; every edit must pass the schema and `check.ts`.
- **`core/guard.ts`:** the Never rules in code.
  - **Refused:**
    - new outward steps, found by a word list (send, submit, pay, delete, upload, confirm, post…);
    - anything matching Never;
    - changes to the trigger, inputs, description, llm instructions or loop limits;
    - turning approval off or removing an ask;
    - scripts and new sites.
  - Gap: a target-less key press (Cmd+Enter) is never treated as outward.
- **`core/briefing.ts`:** tells the agent what it can do, generated from the code, so it never goes stale.

## Q10 · Where do agents fit in the product?

**Exactly two places:** after Stop (design) and after a failure (repair). Everything else is code or a single call:
- **Recording** only captures, so it needs no decisions.
- **A run** stays deterministic for safety and cost; an llm step is one bounded call.

UiPath puts the same rule as "maximally deterministic, minimally agentic".

## Q11 · "A skill should contain variables, a loop, a branch, an llm step, and an optional ask per step"

- The **schema** has all of them, and so does the **player**: `core/skill.ts`, `vars.ts`, `check.ts`, `player/run.ts`.
- The **recorder** emits none of them yet. That gap is what Rushil's work closes.
- Diagram §2 shows a full example with every node type and its JSON.

## What Rushil builds next (record side, in order)

1. **Merge `feat/app-window` into your branch.**
   - There are 4 conflicts: `skill-store.ts`, `main.ts`, `.env.example` and `architecture-map.excalidraw`.
   - One is a **product call:** Akshat's branch asks "next version or new skill?" when a recording's id already exists; yours gives every recording its own id.
2. **Screenshots first**, as you planned (Q7): the Chrome tab and the Mac window, redaction, `shots/`, each linked to its event in the trace.
3. **A small fix alongside:** write `description.never` (and `changes`) from the drill, so the repair guard has a Never list to enforce.
4. **Voice** (Q8): the transcript and its alignment.
5. **Description form**, Goal + Frequency, written into `description` and `when`.
   - The record screen in the window needs `record` / `stop` added to the daemon API.
6. **Design agent** on `packages/agent`, replacing `compile.ts`, with the drill on the tree. It also fills Changes / Never and writes a `by: record` history note.
7. **Deletion 24 h after go-live.**
