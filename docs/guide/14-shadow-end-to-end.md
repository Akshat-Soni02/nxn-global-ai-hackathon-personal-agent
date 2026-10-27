# 14 · Record, replay and AI

> Updated 13 Oct 2026, evening, after sprint 4: the editor, Walk through, pictures for the agents, Record again, the packaged app.
>
> **Since 25 Oct (managed):** wherever this page says "one Nemotron call" or "the model", the call now goes through `shadow-api` on Google Cloud, which adds Shadow's Nebius key and counts it against the free tier; there is no key in the Keychain, only a device token. Workflows can also have `mcp` steps that call a connected app (Google Sheets, Gmail…) through Composio. See [13 · The whole picture](13-the-whole-picture.md) and [`docs/cloud-architecture.md`](../cloud-architecture.md). The design is [`docs/design.md`](../design.md); this page says the same in short, and what is built.

![Shadow end to end](14-shadow-architecture.png)

Editable: [`14-shadow-architecture.excalidraw`](14-shadow-architecture.excalidraw) (open at [excalidraw.com](https://excalidraw.com), menu → Open).

*Redrawn on 13 Oct after the record side was built; that evening the boxes for Edit, Test, the Keychain, the login item and the dmg turned green (built), and the "found in the code" box records the fix.*

## 1. Record: from showing a task to a workflow

| # | Step | What happens | Status |
| --- | --- | --- | --- |
| 1 | **Describe** | Pressing Record (Chrome button, desktop button, menu bar, or `record` in the terminal) opens a short form. **Goal** is required. **Frequency** defaults to "Only when I start it". **What changes**, **What stays the same** and **Never** may be left empty. Recording starts when you send the form | Built |
| 2 | **Consent** | Three switches on the form, remembered in Settings: **Screen** (a picture at each step; only the words read from it leave the Mac), **Microphone** (your narration; only its text leaves the Mac) and **Pictures** (off by default: when an agent is unsure what it sees, the picture itself may go to the model, with the private words blacked out) | Built |
| 3 | **Record** | You do the task. Three things are captured on one clock, into `recordings/<session>/`: the **events** (Chrome extension, Shadow.app for Mac apps, the file watcher), a **screenshot** per event, and your **voice**. The pill's trash discards the recording | Built (screenshots and voice still to try by hand with macOS's permissions) |
| 4 | **Stop → first draft** | Code tidies the events into steps (`normalise`), remembers each control by its role and name, never x/y (`skeleton`), then one Nemotron call adds what each step is for, which values change, and checks (`compile`) | Built |
| 5 | **Understand** | The **design agent** turns the flat list into a tree: a loop for repeated work, a branch for "only if", an LLM step for reading or summarising, variables for what changes. It checks its own draft after every edit, and with the Pictures consent it can ask for a step's masked picture to be described. If it can't finish, the first draft is kept | Built; tried with a scripted model only (no API key yet) |
| 6 | **Drill** | Questions only where it is unsure ("always the newest email from Reporting Bot, or this one?"). They wait in the inbox and show on the Record screen next to the draft, with the step marked; answers are remembered | Built |
| 7 | **Save** | The workflow is saved as `skills/<id>/v1.json`. Approval is turned on, by code, for every step that sends, submits, pays, publishes or deletes, or matches Never. The recording folder is deleted 24 hours later | Built |
| 8 | **Edit** | On a workflow's page, **Edit** opens a draft beside it: change what a step is for, its values, an LLM step's instruction, toggle approval, remove a step, move it up or down. Each change is saved at once and checked; undo, redo, Discard; **Save as the next version** (`by: user`). The live version keeps running until then | Built (adding a step: not yet) |
| 9 | **Walk through** | Runs the workflow, or its draft, one step at a time in the automation window: the target is outlined, and the inbox asks **Next** (a step that only reads or opens a page), **Do it** (a step that acts; this counts as its approval), **Skip** or **Stop**. Pages behind a click are reached by doing that click | Built |
| 10 | **Record again** | On a workflow's page: a new recording of the same task becomes that workflow's next version (`by: record`), keeping its id, name, Frequency and state | Built |

Every plain recording becomes a **new** workflow with its own id (`upload-invoice-k3f9q2`); `run upload-invoice` finds it by the start of its id. Record again is the one exception.

## 2. Replay: running a workflow

1. **Start:** its Frequency (a schedule, or a file appearing in a folder) once it is **live**, or **Run now** / `run <id>` any time.
2. **Inputs:** a value you give, a file found by its rule ("the newest PDF in Downloads"), or the default. A wrong file stops the run before step 1.
3. **The steps run in order.** An action finds its control by role and name in Chrome's accessibility tree (never by position), acts like a person, waits, and checks. No model is used. An **LLM step** makes one call to Nemotron 3.5 Lightning. An **approval** or a **question** waits in the inbox; the run is saved and goes on when you answer, even after a restart.
4. **A step fails:** code sorts it out first. A site that is down is retried; a login page waits for you; an empty inbox ends the run as "nothing to do". Only a **changed site or app** (drift) is repaired: first cheap fixes with no model (wait longer; on web pages also a close match), then the **repair agent** (Nemotron 3 Super) looks at the page, edits the workflow and tries it. With the Pictures consent it can also ask for a masked picture of the page or window to be described.
5. **A fix counts only with proof** (the step's check passes, or the next step's control is found). A try never counts a waiting approval as given (fixed 13 Oct). The fix is saved as the next version (`by: debug`), you are told, and one click rolls it back. If nothing works, the run waits for you: do the step by hand and press skip.
6. **Three failed runs in a row** that a trigger started pause the workflow. Walk-throughs never count.

## 3. Where the model is used

| Moment | Model | Why |
| --- | --- | --- |
| Describe, record | None | Only capturing |
| After Stop | Nemotron 3 Super (`smart`): one call (`compile`), then the design agent | Turning behaviour into intent |
| A normal run | None, except LLM steps: Nemotron 3.5 Lightning (`fast`) | Runs stay predictable and cheap |
| A step failed on a changed site | Nemotron 3 Super: the repair agent, after the cheap fixes | Fixing the workflow |
| An agent asks to see the screen (`describe_step_screenshot` in the design agent, `describe_screen` in the repair agent) | GLM-5.3-Flash (`vision`): one masked picture, only with the Pictures consent | A question the words alone can't answer |
| Settings → Save and check | One small call on the `smart` profile | "Connected to Nemotron" |

All calls go through `packages/llm` to Nebius Token Factory with your own key, read from the Keychain (`.env` wins in development).

## 4. What leaves your Mac

**Only text**, and only to Token Factory: the form, the events without sensitive values, the narration's text, the words read from screenshots with private ones replaced by ███ (emails, phone and card numbers, keys, your Never words), and for repair the failure report and the page outline. **Pictures and audio never leave the Mac**, with one exception you turn on yourself: with the **Pictures** consent, a picture with its private lines blacked out may be sent once when the design agent or the repair agent asks what it sees. The working copy is deleted as soon as the model has answered, also when the send is refused (the consent withdrawn meanwhile), and anything left by an earlier daemon is deleted at the next start. Passwords are never recorded.

## 5. Files on your Mac

| Where | What | How long |
| --- | --- | --- |
| `~/Library/Application Support/Shadow/skills/<id>/vN.json` | Each version of a workflow | Kept |
| `…/Shadow/skills/<id>/state.json` | Draft, live or paused, and why | Kept |
| `…/Shadow/skills/<id>/draft.json` | The editor's draft: the version it was made on and the edit operations | Until Discard or Save as the next version |
| `…/Shadow/recordings/<session>/` | One recording: the form (`description.json`), events (`trace.jsonl`), `meta.json`, screenshots with private lines blacked out (`shots/`), their masked words (`screen.jsonl`), what the design agent did (`design.json`), your narration (`voice.m4a`, `voice.json`) and its masked text (`transcript.jsonl`) | 24 h after the workflow is saved, or after Stop if never saved; at once if empty or discarded |
| `…/Shadow/traces/<session>.jsonl` | Recordings made before 13 Oct: events only | Kept, left as they are |
| `…/Shadow/runs/<run>.jsonl`, `<run>.repair-N.json` | What each run did; each repair's transcript | Kept (30 days planned) |
| `…/Shadow/shadow.db` | The runs list and the inbox (SQLite) | Kept |
| `…/Shadow/memory.db` | Drill answers and site notes (SQLite); Settings shows and deletes entries | Kept; never holds secrets |
| `…/Shadow/config.json` | Settings: the three consents, model names and prices | Kept |
| `…/Shadow/ai-cache/` | LLM step answers, per day | Pruning planned |
| `…/Shadow/api.json`, `daemon.sock` | How the window and programs reach the daemon (only your user can read them) | While running |
| `…/Shadow/native-host` | The small program Chrome starts to reach the daemon (development; the packaged app points Chrome at the one inside it) | Kept |
| Your login Keychain, item "Shadow: Nebius Token Factory key" | Your API key, stored by the `security` tool with the key on its stdin | Until you remove it |
| `~/Library/Logs/Shadow/` | `daemon.log`, `app.log`, `launchd.log` | Rotated |
| `~/Library/LaunchAgents/com.shadow.daemon.plist` | Starts the daemon at login from the repo (`pnpm setup:daemon`, development) | Kept |
| `Shadow.app/Contents/Library/LaunchAgents/com.shadow.daemon.plist` | The same for the packaged app, registered by the app itself on first run (`SMAppService`) | With the app |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.shadow.daemon.json` | Tells Chrome where the native host is (written by `pnpm setup:native-host` or by Connect Chrome in the app) | Kept |
| macOS's own settings | Your Accessibility, Screen Recording and Microphone answers; the login items | macOS keeps them |

`SHADOW_HOME` moves the data folder (tests use a scratch one); `SHADOW_LOG_DIR` moves the logs; `SHADOW_BUNDLE` tells the daemon it runs from inside the app.

## 6. The code

| Side | Files |
| --- | --- |
| **Record** | `apps/extension/src/capture.ts`, `content.ts`, `describe.ts`, `button.ts`, `shot.ts` (web events, the Chrome button, tab screenshots) · `apps/mac/Sources/Recorder.swift`, `AX.swift`, `Panel.swift`, `Pill.swift`, `Screen.swift`, `Voice.swift` (Mac apps, the SwiftUI record pill with discard, window screenshots, `--ocr` / `--redact`, narration, `--transcribe`) · `apps/daemon/src/record-control.ts` (the form first, from every button), `recording-store.ts` (the folder, 24 h), `record.ts` (compile, Record again), `screen.ts`, `voice.ts`, `describe.ts` (a masked picture for the agents), `fs-watch.ts`, `locate-file.ts`, `trace-store.ts` · `packages/recorder/` (`normalise`, `skeleton`, `compile`, `design/` the design agent, `drill`, `mask`, `approvals`) · `apps/ui/src/screens/Record.tsx` (the form, the drill on the draft) |
| **Replay** | `packages/player/` (`run.ts` the interpreter and the walk gate, `web/` matching, acting and highlight, `node/inputs.ts`, `repair/` classify, ladder, repair agent, verify, `describe`) · `apps/extension/src/replay.ts` · `apps/mac/Sources/Player.swift`, `Highlight.swift` · `apps/daemon/src/runner.ts`, `service.ts` (runs, walks, drafts), `triggers.ts`, `lifecycle.ts`, `store.ts`, `walk.test.ts` |
| **Shared** | `packages/core` (the workflow format, `check.ts`, `edit.ts`, `guard.ts`, `briefing.ts`, `messages.ts`) · `packages/llm` (`vision.ts`) · `packages/agent` (the agent loop) · `packages/memory` · `packages/ipc` (`paths.ts`, the bundle paths) · `apps/ui` (the window: `Editor.tsx`, `Settings.tsx`, `Inbox.tsx`, `Workflow.tsx`) · `apps/native-host` · `apps/daemon/src/api.ts`, `http.ts`, `daemon.ts`, `main.ts`, `draft-store.ts`, `settings.ts`, `keychain.ts` · `apps/mac/Sources/FirstRun.swift`, `LoginItems.swift`, `StatusMenu.swift`, `Icon.swift` · `scripts/package.ts`, `release.ts` · `apps/website` |

## 7. Found in the code, for Akshat

1. **Fixed 13 Oct** (`packages/player/src/repair/verify.ts`, with a test in `verify.test.ts`): a repaired outward step (Submit) could skip its one-time approval. The daemon's approve hook answers `WAIT`, which counted as true, so `tryDraft` marked the step approved and `approveOnce` left it out. Now a waiting approval is not an approval: the try ends as not proven, and an unapproved try never commits.
2. `try_steps` can start after the failed step, so a fix may be saved without proof that the failed step works. Left to you: the confirmation-page repair legitimately starts after it, so the rule needs an exception.
3. The per-run repair limits ($0.25, 2 episodes) start again after every wait.
4. `on_item_fail: "skip"` never skips while recovery is on: one bad item fails the run.
5. **The folder rule, run-time half.** The design agent may only read files in folders the recording touched. Since 13 Oct (evening) `designViolations` checks every way a path can be written (a new or changed fs step's `dir`, `path`, `from` and `to`, a glob that climbs, an input the agent declares, a local `file://` page, symlinks followed). What a design-time check cannot see is a path that only exists at run time, such as an llm step's output used as a file path. The clean fix is on your side: carry the allowed folders on the workflow and refuse in `packages/player/src/node/fs-channel.ts` before a file is opened.

## 8. What is left, and the sign-off list

**Checked by a test, end to end** (`apps/daemon/src/e2e.test.ts`, on a scratch folder with the real daemon objects, a scripted model and stand-in channels): the form, events over the socket, Stop, compile and the design agent, the editor's draft saved as v2, go live, a run in which the cheap ladder repairs a missing control (v3, no model) and Submit waits for an approval answered over local HTTP, then Record again saved as v4 with the live state kept.

**To try by a person (Rushil):**

- `pnpm setup:mac`, then turn Accessibility off and on again for Shadow (the ad hoc signature changed), and record with Screen and Microphone on: macOS asks for Screen Recording and the Microphone once.
- The real model: a key through Settings (or `.env`), `pnpm llm:check`, then workflow 1 of [`examples.md`](../examples.md) from a real recording. Everything above was tested with a scripted model.
- The packaged app on a clean Mac (a second user account will do): `pnpm package`, open the dmg, follow [`product.md`](../product.md) to "Connected to Nemotron", Connect Chrome, one recording.
- `pnpm release` once the dmg has been tried; then the Release link into the README.

**For Akshat to agree** (shared code touched in sprint 4; additions unless marked changed):

- **API methods** (`apps/daemon/src/api.ts`): `walk`; `draft`, `editDraft`, `undoDraft`, `redoDraft`, `discardDraft`, `publishDraft`; `recordDiscard`, `recordCancel`; `settings`, `setApiKey`, `setConsent`, `checkModel`, `memory`, `forget`, `setupChrome`.
- **Messages** (`packages/core/src/messages.ts`): `ax.highlight` and `ax.highlight_result`; `mac.screenshot` and `mac.screenshot_result`; `system.sleep` and `system.wake`; `discard` on `record.command`; `pictures` on `consent`.
- **Player** (`packages/player`): `RunDeps.walk` and `RunDeps.highlight`; the `walk` kind of `Waiting` and `Answer`; the `step.walk` log event; `RepairEnv.describeScreen` and `Recovery.describeScreen`; `repair/verify.ts` (changed: a waiting approval is not an approval); `repair/ladder.ts` and `repair/classify.ts` (changed: `ax` steps get the first rung and are classified).
- **Daemon types** (`apps/daemon/src/types.ts`): `walk` in `InboxKind`; `Checkpoint.skill` (the exact tree being walked, for a draft).
- **Design agent** (`packages/recorder/src/design`): validate after every edit; `describe_step_screenshot`.
- **Git:** everything is on `feat/taskplayer-record`, 25+ commits ahead of `main`, to go in as one PR.
- **Leftovers:** items 2–4 above, and the table in [`questions.md`](../questions.md), section P.
