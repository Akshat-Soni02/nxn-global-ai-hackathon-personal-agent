# Questions, answered

> 13 Oct 2026. Rushil's questions on the product, each answered the same way: the short answer, one worked example,
> why not the other way, and the files that do it, in the order the data flows. Plain words; each acronym is spelled
> out the first time. What is built is built; what is not says so.

## A. The daemon's life

**The question.** What if the Mac sleeps? Where does the daemon run: a terminal, a background process, or inside the
desktop app? If one thing is closed, does the daemon still work? When does it stop? Today it is started in a
terminal; does killing the terminal stop the desktop app and the extension too?

**The answer.**
- The daemon is a Node program. It never runs *inside* Shadow.app (Swift) or Chrome: it is its own process, and
  the app, the extension and the window all talk to it over a socket or local HTTP.
- Who starts it decides when it stops. In development, `pnpm daemon` in a terminal: it dies with the terminal.
  With `pnpm setup:daemon`, or the packaged app, **launchd** (macOS's program starter) starts it at login and
  starts it again within 10 seconds if it exits. That is the always-on mode.
- A sleeping Mac runs nothing, launchd included. Nothing is lost: a run that was waiting for you stays saved, a
  schedule missed during sleep runs once on wake, and a step that timed out across the sleep is tried once more.
- Shadow.app and the extension are clients. With launchd in charge, the app now stays open when the daemon stops
  and asks launchd to start it again; without launchd (a terminal daemon) the app quits, as before.

| Scenario | Daemon keeps running? | A run in progress? | A scheduled run? | What you see |
| --- | --- | --- | --- | --- |
| Terminal closed (`pnpm daemon`) | No: it dies with the terminal | Stops mid-step; marked **interrupted** when the daemon next starts | Missed; runs once at the next start (`missed: run_once`) | The pill and the extension's button go grey; the app quits |
| Shadow.app quit | Yes | Web and file steps go on; a Mac-app step fails until the app is back | Yes | Open Shadow again; the daemon keeps everything |
| The window closed | Yes | Yes | Yes | Nothing changes: the pill and the menu bar stay |
| Menu bar only | Yes | Yes | Yes | The badge count and notifications |
| Chrome closed | Yes | A web step opens Chrome in the background and waits up to 30 s for the extension | Same | Chrome appears when a run needs it |
| The Mac sleeps, or the lid closes | Frozen with everything else | Frozen; on wake, a step whose clock ran out is tried once more | Runs once on wake (per the trigger's `missed`) | The daemon looks at its triggers the moment the Mac wakes |
| Log out | launchd stops it; starts it at the next login | Interrupted | Runs once at login | |
| Restart | Starts at login (LaunchAgent) | Interrupted | Runs once at login | |
| Daemon crash | launchd starts it again within 10 s | Interrupted | Catches up | The pill says "Shadow's daemon stopped: starting it again" |
| A new build installed | The new daemon starts; a second copy refuses to start while one listens | Interrupted | Catches up | |

**Example.** Monday 09:00, the weekly report is due; the Mac was asleep until 09:20. At 09:20 Shadow.app tells the
daemon "the Mac woke up"; the daemon looks at its schedules, sees the 09:00 slot was missed, and starts the run once.
The runs list says "started 20 min late".

**Why not the other way.** Putting the daemon inside the app process would tie its life to a window that people
close, and macOS gives permissions to an app, not to a Node process, so the two are kept separate and the app owns
the daemon's LaunchAgent instead.

**Files, in order.** `scripts/install-daemon.ts` (the LaunchAgent in development) · `scripts/package.ts` (the
LaunchAgent inside the app) · `apps/mac/Sources/LoginItems.swift` (registers it) · `apps/mac/Sources/main.swift`
(`DaemonControl`: kickstart, sleep and wake messages) · `apps/daemon/src/daemon.ts` (`system.sleep` / `system.wake`,
`wokeAt`) · `apps/daemon/src/main.ts` (looks at triggers on wake; the development-mode note) ·
`apps/daemon/src/runner.ts` (`unlessAsleep`: one more try after a wake) · `apps/daemon/src/triggers.ts` (missed
times) · `apps/daemon/src/service.ts` (`recover`: interrupted runs).

## B. Shadow.app and the window

**The question.** What is the difference between the WKWebView window and Shadow.app? Are they different things?
Who handles which part?

**The answer.**
- One app, two surfaces. **Shadow.app** is the Swift program macOS runs: the floating pill, the menu bar item,
  notifications, the first-run window, Mac-app recording and replay through Accessibility, screenshots, voice.
- **The window** is a view inside that app. It is a **WKWebView** (Apple's web engine, the one Safari uses)
  showing pages the daemon serves from `http://127.0.0.1:<port>/`. Those pages are the React code in `apps/ui`:
  inbox, workflows, the editor, runs, record, settings.
- The window holds nothing of its own. Every click is a call to the daemon; the token to call it arrives in the
  URL fragment, which a browser never sends anywhere.

**Example.** You press Approve in the window. The page sends `POST /api/answer` to the daemon; the daemon saves
the answer and continues the run; the page refetches the inbox and the card is gone.

**Why not the other way.** The workflow tree, its checks and its edit operations are TypeScript; a SwiftUI editor
would rebuild all of them. Electron would be a second app. A web view inside the real app gets both.

**Files, in order.** `apps/mac/Sources/Window.swift` (opens the page with the token) · `apps/daemon/src/http.ts`
(serves the pages and the API) · `apps/ui/src/main.tsx` (the shell and routes) · `apps/ui/src/screens/*`.

## C. memory.db

**The question.** Is memory.db on the user's Mac? What does it store? What are site notes?

**The answer.**
- Yes: `~/Library/Application Support/Shadow/memory.db`, a SQLite file. It never leaves the Mac and never holds a
  secret.
- One table, `memory`, with full-text search: `kind` (`fact`, `preference`, `site_note`), `text`, an optional
  `skill_id`, `created_at`.
- It is written by the drill (an answer marked as lasting), by the design agent (its own lasting answers) and by the
  repair agent's `note` tool. It is read at the start of a design or repair episode (`recall`).
- A **site note** is a fact about a website learnt during a repair, for the next repair: "the billing portal shows a
  cookie banner first".
- Settings shows every entry with a Forget button.

**Example.** The drill asks "always the newest invoice?" and you answer yes; the fact is saved. Next month's
recording of a similar task finds it and doesn't ask again.

**Why not the other way.** Keeping it in the model's prompt would mean sending your whole history on every call;
a local file is read only when it matters and can be deleted line by line.

**Files, in order.** `packages/memory/src/sqlite.ts` · `packages/recorder/src/drill.ts` ·
`packages/recorder/src/design/tools.ts` (`recall`) · `packages/player/src/repair/tools.ts` (`recall`, `note`) ·
`apps/daemon/src/settings.ts` (`memory`, `forget`) · `apps/ui/src/screens/Settings.tsx`.

## D. No model while recording

**The question.** It was discussed that the model would be called during live recording. Why was that dropped?
What is the status?

**The answer.**
- Nothing calls a model while you record. Only on-device work runs live: the event capture, Apple Vision reading
  the words on a screenshot and masking them, the microphone recording.
- The model is called after Stop: one call compiles the first draft, then the design agent reads the whole
  recording and turns it into the workflow, asking what it can't tell.
- Dropped because it would make recording slower (a model round trip per click), send partial, unmasked context
  before the Never list could be applied, cost money per click, and have nothing to ask yet: a question about
  step 3 can only be decided once steps 4 to 9 are known.
- Status: decided and built this way; a live "hint" mode is not planned.

**Example.** You record twelve clicks; nothing leaves the Mac. You press Stop; two seconds later the design agent
asks one question, on the step it is about.

**Why not the other way.** Live calls would need the model to understand half a task; after Stop it sees the whole
task once and decides better and cheaper.

**Files, in order.** `apps/extension/src/capture.ts` · `apps/mac/Sources/Recorder.swift` ·
`apps/daemon/src/record-control.ts` (`stop`) · `apps/daemon/src/record.ts` (`finishRecording`: compile, then
the design agent) · `packages/recorder/src/compile.ts` · `packages/recorder/src/design/design.ts`.

## E. The Record button and the form

**The question.** Does the record button open the desktop app's form, or the other way round? And the button's look.

**The answer.**
- The button comes first, the form second, always. Pressing Record anywhere (the pill, the menu bar, the button in
  Chrome, the extension's icon, `record` in the terminal) sends `record.command: start` to the daemon.
- The daemon answers with `record.status: form`. Shadow.app sees it and opens the window on `/record`. Without the
  app (terminal only), the same five questions go to the inbox.
- Recording starts only when the form is sent (`recordStart`). The pill then turns red with the clock.
- The pill is now SwiftUI: the record dot when idle; red with the stop square, the clock, a mic mark and a camera
  mark when those consents are on, and a trash button that throws the recording away. Drag it anywhere; its place is
  remembered.

**Example.** Press the pill. The window opens on the form. Type the goal, press Start recording. The pill shows
"Stop · 0:00". Press the trash: the recording's folder is deleted, nothing is compiled, the pill goes back to idle.

**Why not the other way.** Starting to record before the form would capture things before the Never list exists;
the form first means every recording has its guard rails from the first click.

**Files, in order.** `apps/mac/Sources/Pill.swift`, `Panel.swift` (the pill) · `apps/mac/Sources/main.swift`
(`press`, `discard`; opens the window on `form`) · `apps/daemon/src/daemon.ts` (`record.command`) ·
`apps/daemon/src/record-control.ts` (`press`, `start`, `stop`, `discard`) · `apps/ui/src/screens/Record.tsx`.

## F. Screenshots

**The question.** How does the screenshot step work? Does it know which event to capture, or capture everything and
drop the useless ones? Why isn't the GLM vision model used? What is the pipeline, with masking?

**The answer.**
- Capture everything, keep what matters. A picture is taken after every settled event (a click, typing, a file, a
  page change), throttled to one every 600 ms, never while a password field has focus. Chrome captures its visible
  tab; Shadow.app captures the active Mac window. Pictures are not "verified": the design agent later reads the words
  near each step and uses what helps.
- Masking has three layers: don't capture (password focus); black out the fields the page named (password and card
  fields); read all the words on the Mac with Apple Vision and replace emails, phone numbers, card numbers (Luhn
  checked), IBANs, keys, tokens and your Never words with ███, then black out those lines in the picture too.
- Two consents. "Read my screen": only the masked words reach the model (`screen.jsonl`). "Let the model see masked
  pictures": the blacked-out picture may be sent, once, to GLM-5.3-Flash (the vision profile) through one tool,
  `describe_screen`, used by the design agent (a recorded step's picture) and the repair agent (the live page or
  window). Off by default.
- One pipeline for both: the daemon's describer masks any picture with the same OCR and blackout before it leaves,
  and a test proves the original bytes never reach a request. Pictures are deleted with the recording a day later.

**Example.** A Gmail compose window. Words only: "To, Subject, Send, ███@███". With pictures on, the model adds "a
compose window; the To field is empty; Send is at the bottom left".

**Why not the other way.** Always sending pictures would ship your screen to a third party on every click; words
cover most of what the agents need, and the picture is there, blacked out, for the few cases they don't.

**Files, in order.** `apps/extension/src/shot.ts`, `background.ts` (capture, skip, field boxes) ·
`apps/mac/Sources/main.swift` (`shoot`), `Screen.swift` (capture, `--ocr`, `--redact`) ·
`apps/daemon/src/screen.ts` (read, mask, black out, `screen.jsonl`) · `packages/recorder/src/mask.ts` ·
`apps/daemon/src/describe.ts` (pictures for the model) · `packages/llm/src/vision.ts` ·
`packages/recorder/src/design/tools.ts` and `packages/player/src/repair/tools.ts` (`describe_screen`).

## G. When the rest of the form is asked

**The question.** Don't ask everything at the start; it is overwhelming. But then when are the other options asked?

**The answer.**
- Before recording, only the **goal** is required. Frequency defaults to "only when I start it". What changes,
  what stays the same and Never may be empty.
- After Stop, the design agent asks only what the recording and the goal can't tell it, at most 5 questions, each
  shown next to the step it is about. Typical: "always the newest email from this sender, or this one?", "what should
  the folder be when it runs on its own?".
- Anything still open waits in the Editor: every step can be changed later, approvals toggled, the Frequency set on
  the workflow's page.
- Nothing is asked twice: lasting answers go to memory.

**Example timeline.** 10:00 the form: goal only. 10:04 Stop. 10:04 one question on step 2. 10:05 saved as v1. 10:10
in the Editor you tick approval on step 5 and set "every Monday 09:00". 10:11 Go live.

**Why not the other way.** A full form before recording asks people to describe variables they haven't thought about
yet; after the recording the questions are concrete, and most never need asking.

**Files, in order.** `apps/ui/src/screens/Record.tsx` (the form) · `apps/daemon/src/recording-store.ts` (what is
required) · `packages/recorder/src/design/tools.ts` (`ask_user`, max 5) · `apps/daemon/src/record.ts`
(`fillForUnattended`) · `apps/ui/src/screens/Editor.tsx`.

## H. The design agent

**The question.** How does it work, what are its inputs, is the screenshot step before it, what steps make the
workflow, and which tools does it have?

**The answer.**
- Inputs: the form; the recording as steps by meaning (`normalise`); the first draft code and one model call made
  of it (`compile`); the masked screen words and the narration text, each lined up with the step it happened over;
  memory; and, with the pictures consent, a step's masked picture on request. Screenshots are read and masked before
  it starts, so yes, that step is before it.
- The loop: read the description and the recording → change the draft through edit operations → every kept edit
  comes back with what still stops the workflow (validate inside the loop, "6c") → ask at most 5 questions → finish
  only when nothing is left. If it can't finish (no model, an error, out of budget), the first draft is kept with the
  answers already given.
- Its tools: look: `read_description`, `read_recording`, `workflow`, `recall`, `describe_screen`; edit: `edit`
  (operations), `wrap_in_loop`, `wrap_in_branch`, `add_llm_step`; check: `validate`; ask: `ask_user`; finish:
  `finish`.
- Its guard, in code: targets only from the recording; a new step may only read (find, read, pick, extract, wait,
  navigate to a recorded site), and only in folders the recording touched; a recorded step keeps its kind; never a
  script; the form and the Frequency never change; approval never turned off. Budget: 16 turns, $0.10.

**Example.** Three downloads of three invoices become one loop "for each unread email labelled Invoices", with an
llm step that reads the vendor and amount, and a branch "if the amount is over 5,000, ask first".

**Why not the other way.** Letting the agent invent steps would let a model click things you never showed it; the
guard keeps it to understanding, not acting.

**Files, in order.** `packages/recorder/src/normalise.ts` · `skeleton.ts` · `compile.ts` ·
`apps/daemon/src/record.ts` · `packages/recorder/src/design/design.ts` (the loop and budget) · `design/tools.ts`
(the tools and `designViolations`) · `packages/agent/src/agent.ts` (the runtime) · `packages/core/src/edit.ts`.

## I. Voice

**The question.** The voice part is mysterious. People speak before they act, while, after, or just explain
without acting. How does it line up?

**The answer.**
- While recording, with the microphone consent, Shadow.app records `voice.m4a` and notes when it started on the
  daemon's clock. Nothing is transcribed live.
- After Stop, `Shadow --transcribe` runs Apple's on-device speech recognizer and returns pieces of text with their
  start and end seconds. The daemon masks them and writes `transcript.jsonl` with each piece's time on the
  recording's clock. The audio never leaves the Mac.
- Lining up: each piece goes with the last step that started before it, with one second of grace. So "I always take
  the newest one" said just before clicking the email goes with the click (speaking a little early is normal);
  said during or just after, it goes with the same click; a sentence said over no click goes with the step before
  it.
- The design agent sees the text next to the step, as "said: …". It uses it for intent, never as a step: "always
  the newest" makes the click "the newest email from this sender"; "I usually do this in Excel too" is just context.
- Weak spots: a long explanation with no action lands on whichever step came before it; two sentences across a
  click boundary split; the recognizer needs a clear voice.

**Example.** 00:12 click the email. 00:13 "this is always from Reporting Bot". The text is attached to the click;
the step becomes "open the newest email from Reporting Bot".

**Why not the other way.** Word-level alignment to mouse events would be fragile and would still not know what a
sentence refers to; by-step attachment plus the model reading both is simpler and good enough.

**Files, in order.** `apps/mac/Sources/Voice.swift` · `apps/daemon/src/voice.ts` ·
`apps/daemon/src/recording-store.ts` (`readNotes`) · `packages/recorder/src/design/tools.ts` (`notesByStep`).

## J. Steps 6 and 7

**The question.** "Edit any step, approval toggles" and "test (highlight only)" were not built. What are they, and
their use cases? Build them.

**The answer.**
- **Step 6, the Editor** (built): on a workflow's page, Edit opens a draft beside the workflow. Change what any step
  is for, its values (as JSON), an llm step's instruction, toggle human approval, remove, move up or down. Every
  change is saved at once as an edit operation; undo and redo; Discard; "Save as v(n+1)" makes the next version by
  you. The live version keeps running until you save. A refused change shows the daemon's reason.
- Use case: the agent made the Send step without approval; you tick approval, save as v2.
- **Step 7, Walk through** (built): runs a workflow (or its draft) one step at a time in the automation window.
  Before each step the target is outlined on the page or in the Mac app; the inbox asks Next (a step that only reads
  or opens a page), Do it (a step that acts: click, type, upload, send), Skip or Stop. Do it counts as the approval.
  Pages behind a click are reached by doing that click; that is why it is a walk, not a dry run.
- Use case: before going live, walk the invoice workflow once and watch each target light up.

**Example.** Walk through: step 1 opens the portal (Next). Step 2 outlines "Submit invoice" (Do it). Step 3 outlines
"Export" (Skip). Done.

**Why not the other way.** A pure highlight-only test cannot reach a page that needs a click first; a walk with the
user's hand on each acting step can.

**Files, in order.** Editor: `apps/daemon/src/draft-store.ts` · `service.ts` (`draft`, `editDraft`, `undoDraft`,
`redoDraft`, `discardDraft`, `publishDraft`) · `api.ts` · `apps/ui/src/screens/Editor.tsx`. Walk:
`packages/player/src/run.ts` (the gate) · `types.ts` (`walk`, `highlight`, `walkActs`) ·
`packages/player/src/web/inspect.ts` (`highlight` op) · `apps/mac/Sources/Highlight.swift`, `Player.swift` ·
`apps/daemon/src/runner.ts` · `service.ts` (`walk`) · `apps/ui/src/screens/Inbox.tsx`.

## K. The workflow format, loops and branches

**The question.** Explain the workflow; is this how a skill is designed now? What do loop and branch mean, and the
difference?

**The answer.**
- A skill *is* a workflow since the 8 Oct pivot: `id`, `name`, `version`, the description (the form), `steps` (a
  tree), `success` checks, `history` (one note per version: by record, user or debug).
- The first step is the trigger: when it runs (`manual`, a cron `schedule`, a `folder_watch`) and the typed inputs
  a run starts with. Every other step is an `action` (web, Mac app, files, script, data), an `llm` step (transform
  text into one typed value; never clicks), or a `control`: a **loop** or a **branch**.
- **Loop**: run the same steps once for each item of a list (`over: "{{emails}}"`, `item: email`). **Branch**: run
  one set of steps if a condition holds, else the other (`if: amount > 5000`). The difference in one line: a loop
  repeats, a branch chooses.
- Variables: every value a step reads was declared, with a type, by an earlier step; `{{invoice.amount}}` reads a
  field; the checker refuses a reference that doesn't exist, at save time.

**Example.**
```
start   trigger  every day at 10:00
l1      loop     for each email in {{unread}} (label "Invoices")
  s2    browser  download the PDF → pdf
  ai1   model    read vendor, number, amount from {{pdf}} → invoice
  b1    if       {{invoice.amount}} greater_than 5000
    s4  ask      "Large invoice from {{invoice.vendor}}. Continue?"
  s5    browser  create the bill in Xero                     [approval]
```

**Why not the other way.** A flat list of clicks can't say "for each" or "only if", which is why the format moved
from a list to a tree.

**Files, in order.** `packages/core/src/skill.ts` (the schema) · `vars.ts` (types and references) · `check.ts`
(the checker) · `packages/player/src/run.ts` (the interpreter) · `conditions.ts`.

## L. Checkpoint

**The question.** What is a checkpoint and where is it used?

**The answer.**
- When a run needs you (an approval, a question, a failure only you can fix, a walk-through step), the interpreter
  does not wait in memory. It ends its leg as `waiting` and the daemon saves a **checkpoint** on the run's row in
  `shadow.db`: the version, the inputs, where it stopped (`l1[2] > s3` means step s3 in the third item of loop l1),
  the variables, what you already answered for that step, and, for a walk of a draft, the exact tree.
- Answering the inbox item starts the next leg from the checkpoint with your answer. Hours later, or after a
  restart, the run goes on without redoing earlier steps.
- A run the daemon was in the middle of when it stopped has no checkpoint for that step: it is marked interrupted.

**Example.** Step 5 needs approval at 18:00; you approve at 09:00 next day; the run continues at step 5.

**Why not the other way.** A promise held in memory dies with the process; a saved checkpoint survives everything
but a crash mid-step.

**Files, in order.** `packages/player/src/run.ts` (`waitFor`, `resume`) · `apps/daemon/src/service.ts` (`leg`,
`answer`, `resumeWith`) · `apps/daemon/src/store.ts` (the `runs` table) · `apps/daemon/src/types.ts`
(`Checkpoint`).

## M. Repair for Mac apps

**The question.** Is the repair agent web only? What about Mac apps and other things?

**The answer.**
- Classification covers every channel: a Mac app that isn't running or isn't allowed is "environment", a missing
  control ("no AXButton like the recorded one") is drift.
- The cheap ladder: web steps get "wait longer" and "fuzzy match"; Mac steps get "wait longer" (the app finds the
  control again by title within the longer time). There is no second rung for Mac: there is no page to search for a
  lookalike.
- The repair agent probes and edits web pages (outline, find, inspect, click safely); for a Mac failure it can read
  the report, describe the window (with pictures consent) and edit, but cannot probe the app. Most Mac drift
  escalates to you: do the step by hand and press "go on".
- Files and llm steps are never "repaired": a missing file is "nothing to do" or data.

**Example.** Numbers renamed a button; the ladder waits longer, fails, the agent escalates with "show me the new
button"; you click it; the run goes on.

**Why not the other way.** Probing a Mac app means pressing real buttons in real apps; the risk isn't worth it at
this stage.

**Files, in order.** `packages/player/src/repair/classify.ts` · `ladder.ts` · `repair.ts` · `tools.ts` ·
`apps/mac/Sources/Player.swift` (`AX.find` with retries).

## N. The loop in diagram 14

**The question.** Explain the loop in the diagram.

**The answer.** The product's loop in one line: describe → record → understand → drill → tree → edit → walk → run →
recover → tree. The arrow back from "recover" to "tree" is the point: a repair, or a step you showed by hand,
becomes the next version of the same tree, so the workflow gets better with every failure instead of breaking. The
small loop inside "understand" (6b, 6c) is the design agent fixing its own draft after each edit, before it finishes.

**Files, in order.** `docs/guide/14-shadow-architecture.excalidraw` (box `s0_h` and section 1).

## O. Packaging

**The question.** No proxy, so no backend and each user's own key: how is the key stored in the Keychain and when?
What gets installed, a dmg? Do the pnpm commands run on the user's machine? How does the whole thing get published?

**The answer.**
- The user downloads **Shadow-<version>.dmg** from the GitHub Release, drags Shadow.app to Applications and opens
  it (right-click → Open the first time: ad hoc signature). No Node, no pnpm, no repo on their Mac.
- Inside the app: the Swift program, a Node binary, the daemon bundled into one file, the Chrome shim, the window's
  pages, the extension folder, the icon, and the daemon's LaunchAgent file. `pnpm package` builds all of that and the
  dmg (checked on 13 Oct: a 44 MB dmg); `pnpm release` publishes it with the extension zip.
- First launch: the app registers its LaunchAgent with launchd (SMAppService), which starts the daemon now and at
  every login. The first-run window asks for the Token Factory key, stores it in the login **Keychain** through
  macOS's `security` tool (the key goes on its stdin, never on a command line) and runs a connection check; then
  "Connect Chrome" writes Chrome's connection file pointing at the shim inside the app and shows the extension folder
  to load; then the permissions.
- The daemon reads the key from the Keychain when it starts (a `.env` key wins in development). Zero Data Retention
  is a setting on the Token Factory account, not in the app.
- The `pnpm setup:*` commands are development only; the app does the same things itself.

**Example.** A judge: download, open, paste the key, "Connected to Nemotron", Connect Chrome, load the extension,
record workflow 1.

**Why not the other way.** A proxy backend would hold every user's key and traffic on our server; with the daemon on
the Mac there is nothing to breach.

**Files, in order.** `scripts/package.ts` · `scripts/release.ts` · `apps/mac/Sources/LoginItems.swift` ·
`apps/mac/Sources/FirstRun.swift`, `main.swift` · `apps/daemon/src/keychain.ts` · `apps/daemon/src/settings.ts`
(`setApiKey`, `checkModel`, `setupChrome`) · `apps/daemon/src/main.ts` (`SHADOW_BUNDLE` paths) ·
`packages/ipc/src/paths.ts` (`bundlePath`).

## P. What is still missing

Ranked by how much it would show in a judge's hands, with the work it needs.

| Problem | Why it matters | Fix | Effort |
| --- | --- | --- | --- |
| Never run on the real model | Every agent test used a scripted model; prompts may need tuning | A key, `pnpm llm:check`, record workflow 1 from examples.md, fix what the transcript shows | 1 day |
| The packaged app never tried on a clean Mac | First run, launchd and the Keychain are built, not exercised end to end | Install the dmg on a second account or Mac and follow product.md | Half a day |
| The daemon can't stop a run mid-step | Cancel waits for the step to end | A cancel signal checked between attempts in `run.ts`; the extension aborts the CDP step | Half a day |
| One run at a time, one automation window | Two workflows due at the same minute queue | Fine for now; later one window per run | Later |
| No daily budget | A broken llm step could spend money in a loop | A daily cap in `config.json`; the usage meter refuses past it | Half a day |
| Run logs grow forever | Disk | Keep 30 days; prune `ai-cache` | Hours |
| No crash reports or diagnostics export | A judge's failure is invisible to us | A zip of logs, health and a run, without secrets | Half a day |
| The extension is loaded unpacked | Judges fiddle with chrome://extensions | The Chrome Web Store (unlisted) | A day plus review time |
| Updates by hand | A new dmg each time | Sparkle, or a "new version" check against the Release | 1 day |
| The ladder's label-and-heading rung | More drift would be fixed without a model | Match by nearby heading and label in `ladder.ts` | Half a day |
| Mac repair can't probe | Most Mac drift goes to the user | Safe AX probes (open a menu, read a window) behind the same guard | 2 days |
| Wrong but "successful" steps | A weak match on the wrong control never fails | A check before acting on a low-margin match; a "that was wrong" button on the run | 1 day |
| No "when an email arrives" trigger | Several example workflows start that way | A Gmail or IMAP watcher as a trigger | 2 days |
| Sheet writes and clipboard steps | Needed by examples 1, 10, 12 | Actions in the web executor and the schema (joint) | 2 days |
| Found while reading | | | |
| `try_steps` can start after the failed step | A fix can be saved without proof the failed step works (doc 14 §7, item 2) | Akshat's call: require a try through the failed step unless the fix removed it (the confirmation-page repair legitimately starts after it) | Hours |
| The repair budget resets after every wait | A run can spend more than $0.25 across waits | Keep the repairer's spend in the checkpoint | Hours |
| `on_item_fail: skip` never skips while recovery is on | One bad item fails the loop | Classify "data" inside a loop item as skip | Hours |

## Assumptions made while building (13 Oct)

- Pictures consent is remembered globally (Settings) and set per recording (the form), both in `config.json`'s
  `consent`; the form's value is what that recording uses.
- A walk-through of a draft runs the draft; of a workflow without a draft, its latest version.
- "Record again" keeps the workflow's name; the form's new goal replaces the description.
- Stopping a walk ends the run as cancelled, never as failed, and walk runs never count towards auto-pause.
