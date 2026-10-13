# 14 · Record, replay and AI

> Updated 13 Oct 2026, after Akshat's milestones 3–8 were merged. The design is [`docs/design.md`](../design.md); this page says the same in short, and what is built.

![Shadow end to end](14-shadow-architecture.png)

Editable: [`14-shadow-architecture.excalidraw`](14-shadow-architecture.excalidraw) (open at [excalidraw.com](https://excalidraw.com), menu → Open).

*The picture was drawn on 12 Oct, before the merge. Where it disagrees with this page (triggers are built now; screenshots send only text), this page is right. It is redrawn when the record side is done.*

## 1. Record: from showing a task to a workflow

| # | Step | What happens | Status |
| --- | --- | --- | --- |
| 1 | **Describe** | Pressing Record (Chrome button, desktop button, menu bar, or `record` in the terminal) opens a short form. **Goal** is required. **Frequency** defaults to "Only when I start it". **What changes**, **What stays the same** and **Never** may be left empty. Recording starts when you send the form | Built |
| 2 | **Consent** | Two switches on the form: **Screen** (a picture at each step; only the words read from it leave the Mac) and **Microphone** (your narration; only its text leaves the Mac) | Screen: built. Microphone: not yet |
| 3 | **Record** | You do the task. Three things are captured on one clock, into `recordings/<session>/`: the **events** (Chrome extension, Shadow.app for Mac apps, the file watcher), a **screenshot** per event, and your **voice** | Events, screenshots: built. Voice: not yet |
| 4 | **Stop → first draft** | Code tidies the events into steps (`normalise`), remembers each control by its role and name, never x/y (`skeleton`), then one Nemotron call adds what each step is for, which values change, and checks (`compile`) | Built |
| 5 | **Understand** | The **design agent** turns the flat list into a tree: a loop for repeated work, a branch for "only if", an LLM step for reading or summarising, variables for what changes. If it can't finish, the first draft is kept | Built; tried with a scripted model only (no API key yet) |
| 6 | **Drill** | Questions only where it is unsure ("always the newest email from Reporting Bot, or this one?"). They wait in the inbox and show on the Record screen next to the draft, with the step marked; answers are remembered | Built |
| 7 | **Save** | The workflow is saved as `skills/<id>/v1.json`. Approval is turned on, by code, for every step that sends, submits, pays, publishes or deletes, or matches Never. The recording folder is deleted 24 hours later | Built |

Every recording becomes a **new** workflow with its own id (`upload-invoice-k3f9q2`); `run upload-invoice` finds it by the start of its id.

## 2. Replay: running a workflow

1. **Start:** its Frequency (a schedule, or a file appearing in a folder) once it is **live**, or **Run now** / `run <id>` any time.
2. **Inputs:** a value you give, a file found by its rule ("the newest PDF in Downloads"), or the default. A wrong file stops the run before step 1.
3. **The steps run in order.** An action finds its control by role and name in Chrome's accessibility tree (never by position), acts like a person, waits, and checks. No model is used. An **LLM step** makes one call to Nemotron 3.5 Lightning. An **approval** or a **question** waits in the inbox; the run is saved and goes on when you answer, even after a restart.
4. **A step fails:** code sorts it out first. A site that is down is retried; a login page waits for you; an empty inbox ends the run as "nothing to do". Only a **changed site** (drift) is repaired: first cheap fixes with no model (wait longer, a close match), then the **repair agent** (Nemotron 3 Super) looks at the page, edits the workflow and tries it.
5. **A fix counts only with proof** (the step's check passes, or the next step's control is found). It is saved as the next version (`by: debug`), you are told, and one click rolls it back. If nothing works, the run waits for you: do the step by hand and press skip.
6. **Three failed runs in a row** that a trigger started pause the workflow.

## 3. Where the model is used

| Moment | Model | Why |
| --- | --- | --- |
| Describe, record | None | Only capturing |
| After Stop | Nemotron 3 Super (`smart`): one call (`compile`), then the design agent | Turning behaviour into intent |
| A normal run | None, except LLM steps: Nemotron 3.5 Lightning (`fast`) | Runs stay predictable and cheap |
| A step failed on a changed site | Nemotron 3 Super: the repair agent, after the cheap fixes | Fixing the workflow |

All calls go through `packages/llm` to Nebius Token Factory with your own key.

## 4. What leaves your Mac

**Only text**, and only to Token Factory: the form, the events without sensitive values, the narration's text, the words read from screenshots with private ones replaced by ███ (emails, phone and card numbers, keys, your Never words), and for repair the failure report and the page outline. **Pictures and audio never leave the Mac.** Passwords are never recorded.

## 5. Files on your Mac

| Where | What | How long |
| --- | --- | --- |
| `~/Library/Application Support/Shadow/skills/<id>/vN.json` | Each version of a workflow | Kept |
| `…/Shadow/skills/<id>/state.json` | Draft, live or paused, and why | Kept |
| `…/Shadow/recordings/<session>/` | One recording: the form (`description.json`), events (`trace.jsonl`), `meta.json`, screenshots with private lines blacked out (`shots/`), their masked words (`screen.jsonl`), what the design agent did (`design.json`); later audio and transcript | 24 h after the workflow is saved, or after Stop if never saved; at once if empty |
| `…/Shadow/traces/<session>.jsonl` | Recordings made before 13 Oct: events only | Kept, left as they are |
| `…/Shadow/runs/<run>.jsonl`, `<run>.repair-N.json` | What each run did; each repair's transcript | Kept (30 days planned) |
| `…/Shadow/shadow.db` | The runs list and the inbox (SQLite) | Kept |
| `…/Shadow/memory.db` | Drill answers and site notes (SQLite) | Kept; never holds secrets |
| `…/Shadow/ai-cache/` | LLM step answers, per day | Pruning planned |
| `…/Shadow/api.json`, `daemon.sock` | How the window and programs reach the daemon (only your user can read them) | While running |
| `…/Shadow/native-host` | The small program Chrome starts to reach the daemon | Kept |
| `~/Library/Logs/Shadow/` | `daemon.log`, `app.log`, `launchd.log` | Rotated |
| `~/Library/LaunchAgents/com.shadow.daemon.plist` | Starts the daemon at login (`pnpm setup:daemon`) | Kept |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.shadow.daemon.json` | Tells Chrome where the native host is | Kept |
| macOS's own settings | Your Accessibility, Screen Recording and Microphone answers | macOS keeps them |

`SHADOW_HOME` moves the data folder (tests use a scratch one); `SHADOW_LOG_DIR` moves the logs.

## 6. The code

| Side | Files |
| --- | --- |
| **Record** | `apps/extension/src/capture.ts`, `content.ts`, `describe.ts`, `button.ts` (web events and the Chrome button) · `apps/mac/Sources/Recorder.swift`, `AX.swift`, `Panel.swift` (Mac apps, desktop button) · `apps/daemon/src/record.ts`, `fs-watch.ts`, `locate-file.ts`, `trace-store.ts` (the session, file events) · `packages/recorder/` (`normalise`, `skeleton`, `compile`, `drill`) |
| **Replay** | `packages/player/` (`run.ts` the interpreter, `web/` matching and acting, `node/inputs.ts`, `repair/` classify, ladder, repair agent, verify) · `apps/extension/src/replay.ts` · `apps/mac/Sources/Player.swift` · `apps/daemon/src/runner.ts`, `service.ts`, `triggers.ts`, `lifecycle.ts`, `store.ts` |
| **Shared** | `packages/core` (the workflow format, `check.ts`, `edit.ts`, `guard.ts`, `briefing.ts`) · `packages/llm` · `packages/agent` (the agent loop) · `packages/memory` · `packages/ipc` · `apps/ui` (the window) · `apps/native-host` · `apps/daemon/src/api.ts`, `http.ts`, `daemon.ts`, `main.ts` |

## 7. Found in the code, for Akshat

1. **Safety, likely (found by reading, not yet shown by a test):** a repaired outward step (Submit) can skip its one-time approval. The daemon's approve hook answers `WAIT`, which counts as true, so `tryDraft` (`verify.ts`) marks the step approved and `approveOnce` (`repair.ts`) leaves it out. The step then runs without approval unless it already required one.
2. `try_steps` can start after the failed step, so a fix may be saved without proof that the failed step works.
3. The per-run repair limits ($0.25, 2 episodes) start again after every wait.
4. `on_item_fail: "skip"` never skips while recovery is on: one bad item fails the run.

## 8. Next on the record side, in order

1. ~~The description form and the two consents, from every Record button.~~ Done.
2. ~~The recording folder and deletion after 24 hours.~~ Done.
3. ~~The design agent.~~ Done (the real model still to try).
4. ~~The drill shown on the draft tree.~~ Done.
5. ~~Screenshots: words read on the Mac, private ones masked.~~ Done (Chrome and Mac windows still to try by hand).
6. Voice: narration turned into text on the Mac.
