# 03 · Tools: Chrome, Playwright, Electron, and how OpenAI did it

## Q1 · Which tool drives the user's own Chrome?

> *"tools to use (Playwright opens a new chrome profile window this behaviour is what i don't want)"*

### The short answer

**Our own extension, using `chrome.debugger`.** The repo has already chosen it (`apps/extension/manifest.json:19` requests `"debugger"`; `design.md:24` rules Playwright out). Through it, the extension sends CDP commands such as clicks, typing, uploads and accessibility queries to tabs in the Chrome that is already running, with the user's cookies, logins and extensions. It needs no flags, no relaunch and no second profile.

### The perspective that makes it simple

**Every outside tool that drives page content (Playwright, Puppeteer, any CDP client) reaches Chrome through a debug switch. Since Chrome 136, that switch is ignored for the default profile, so no outside CDP client can drive it. An extension is already inside.** macOS Accessibility can still press Chrome's own buttons from outside, as a human would, but it can't do page-level work like file uploads, network waits or reading the DOM (table below).

> **Doc-verified** (Chrome for Developers blog, *"Changes to remote debugging switches to improve security"*): *"from Chrome 136 we're making changes to the behavior of `--remote-debugging-port` and `--remote-debugging-pipe`."* These switches *"will no longer be respected if attempting to debug the default Chrome data directory"*, and *"must now be accompanied by the `--user-data-dir` switch to point to a non-standard directory."* The reason given: attackers were using the debug port to steal cookies.

The rule is about *where the profile lives*, not which tool you use. So every Playwright mode fails for the same reason.

### Why Playwright opens a new profile window, mechanically

Each Playwright entry point, and what it actually does:

| Playwright call | What it does | Result for us |
|---|---|---|
| `chromium.launch()` | Spawns a **new** browser process with a fresh temporary profile directory, controlled over `--remote-debugging-pipe` | **The window you saw**: empty profile, no logins, no extensions |
| `launchPersistentContext("~/Library/…/Chrome/Default")` | Spawns Chrome on *your* profile directory | Chrome refuses a second process on a profile that is already open (profile lock). Even with Chrome closed, the pipe switch is ignored on the default directory since 136 |
| `connectOverCDP("http://localhost:9222")` | Attaches to a Chrome that was started with `--remote-debugging-port=9222` | Ignored on the default directory since 136. With `--user-data-dir=/elsewhere` it works, but that is **a different, logged-out profile** |
| Chrome for Testing | A separate Chrome build for automation | A separate browser, so no logins |

The Cursor research reached the same place in three turns (`docs/research/cursor-chat-task-replay.md`):

1. It first suggested *"a dedicated automation browser profile"* (`:77`).
2. Then *"Attach via CDP… they must launch Chrome with remote debugging"* (`:164`).
3. Finally, once you said cookies and extensions were mandatory: *"You can **skip Playwright** if the extension plus a small Mac app is enough"* (`:222`).

Chrome 136 turns step 2 from "awkward" into "impossible". Sheet4's open question, *"Would playwright work if we don't want user to have seperate profile … for both Record & Replay"*, is answered **no**.

### All options, side by side

| Option | Uses the real profile? | Flags or relaunch? | Verdict |
|---|---|---|---|
| **Own extension + `chrome.debugger`** | ✅ | none | **Chosen.** CDP `Input.*` events are trusted input (`isTrusted: true`). Cost: a "debugging this browser" bar while attached |
| Content-script DOM events (`el.click()`, setting `.value`) | ✅ | none | Fallback only. `isTrusted: false`, and React-controlled inputs ignore a plain `.value =` |
| Playwright `launch` / `launchPersistentContext` | ❌ | yes | Ruled out (above) |
| Playwright `connectOverCDP` + debug port | ❌ since Chrome 136 | yes | Ruled out (doc-verified) |
| Relays that wrap `chrome.debugger` (Playwright MCP Bridge, Playwriter) | ✅ | none | **Dossier claim**: built on the same API. Copy the idea; don't depend on someone else's extension |
| Electron `webContents.debugger` | ❌ | — | Electron's own Chromium with its own cookie jar (Q2 below) |
| macOS Accessibility on Chrome's window | ✅ | needs a TCC permission | For Chrome's own UI and OS file sheets, not page content. Post-v1 |

### What `chrome.debugger` costs you, and how the design limits it

- **The infobar.** While attached, Chrome shows a bar saying the extension *started debugging this browser*. `design.md:195` limits it: *"attaches `chrome.debugger` only to tabs in the automation window, and only during a run."* Whether users accept it is an open question (`design.md:236`).
- **You rebuild what Playwright gave for free**: auto-waiting, the locator engine and tracing. In this repo they become, in turn:
  - `wait`/`check` (`skill.ts:66-67`);
  - `describeElement` + `match.ts`;
  - the run log.
- **Recording doesn't need it at all.** Capture runs in the content script, which reads DOM events. `chrome.debugger` is for *acting*, plus optionally reading Chrome's authoritative role and name at record time.

---

## Q2 · Electron desktop app, or Chrome extension?

> *"End goal is to create a desktop application using electron (ui and ux is not important for now) or a chrome extension."*

### The short answer

**Not "or". The extension is mandatory; Electron is an optional face for the daemon.** Electron bundles *its own* Chromium with its own cookie store, so a page opened in an Electron window is a logged-out stranger. That makes it the same problem as Playwright's new window. Whatever touches the user's tabs has to be the extension. Electron can at most replace `apps/daemon/src/main.ts` (today's stdin commands) with a tray icon, windows and notifications.

### What each piece can and cannot do

| Capability | Extension alone | Daemon (Node, today) | Electron shell around the daemon |
|---|---|---|---|
| Act in the user's logged-in tabs | ✅ | ❌ | ❌ (its windows are not the user's Chrome) |
| Survive Chrome closing; run schedules | ❌ (worker dies after 30 s idle; `chrome.alarms` only fires while Chrome runs) | ✅ | ✅ |
| Start Chrome when a schedule fires | ❌ | ✅ (`open -a "Google Chrome"`, planned `design.md:42`) | ✅ |
| Files, AppleScript, Shortcuts (`fs`/`script` channels) | ❌ | ✅ | ✅ |
| Keep the Nebius API key off the user's machine-readable extension | ❌ | ✅ (`llm/index.ts:2-3`) | ✅ |
| Keychain secrets | ❌ | via a native module | ✅ `safeStorage` |
| Tray icon, drill dialogs, run reports | popup only | stdin | ✅ |
| One-click installer (`.dmg`) | Web Store | ❌ | ✅ |

### How Electron would plug in, without rewriting anything

The daemon is already a library. `apps/daemon/src/daemon.ts:18` exports `startDaemon({ socketPath, log })`, and `main.ts` is a 22-line wrapper that reads stdin. An Electron app would be a new `apps/desktop` whose main process does the same thing with a tray:

```ts
// apps/desktop/src/main.ts  (proposed, not in the repo)
import { app, Tray, Menu } from "electron";
import { socketPath } from "@taskplayer/ipc";
import { startDaemon } from "@taskplayer/daemon/daemon";   // needs an "exports" entry in apps/daemon/package.json

app.whenReady().then(async () => {
  const daemon = await startDaemon({ socketPath: socketPath(), log: console.error });
  const tray = new Tray("icon.png");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Record", click: () => daemon.startRecording() },
    { label: "Stop",   click: () => daemon.stopRecording() },
  ]));
});
```

One thing needs a spike: the host launcher pins the Node binary path (`install-native-host.ts:28`). An Electron build has to ship a Node for the shim, or run the Electron binary as Node. Not needed in Sprint 2.

### Recommendation

- **Sprint 2–3:** no Electron. You said UI and UX don't matter yet. Stdin commands are enough to record, compile, drill and replay.
- **Sprint 4, if time:** add an `apps/desktop` Electron tray that calls `startDaemon`. It gives the demo video a "menu bar" and the sheet's "user interface layer", and it gets you a `.dmg`.
- **Extension-only** is a valid *different product*: web-only, Chrome-must-be-open, API key inside the extension. Choosing it would delete the daemon, the shim and the `fs` channel. The repo has deliberately not chosen this.

---

## Q3 · How OpenAI built Record & Replay

> *"how openai made the record and replay product https://community.openai.com/t/introducing-record-replay/1384088"*

### What the post itself says (Doc-verified, fetched today)

- Date: **June 18, 2026**.
- *"Show Codex a recurring task, like filing an expense report or submitting a time-off request."*
- *"Codex turns that demo into an inspectable, editable skill."*
- *"You control when recording starts and stops."*
- *"Record & Replay is available on macOS. Initial availability excludes the European Economic Area, the United Kingdom, and Switzerland. Computer Use must also be available and enabled."*

The post does **not** describe how replay executes.

### What secondary write-ups add (third-party, not OpenAI)

Several 2026 explainers (eesel.ai, techtimes.com, kingy.ai and others) describe the same mechanism:

- The recording becomes a `SKILL.md` that *"describes what the user is trying to accomplish at each step, not the exact input sequence."*
- Replay: *"You start a new thread, ask Codex to use the skill, and give it the values that differ this time… Codex uses the skill as context and completes the task with whatever tools are available, including Computer Use, browser actions, and installed plugins."*

**Dossier claims, not checked here:** the Codex app version (26.616), and an internal `event_stream_start`/`event_stream_stop` MCP server from a DEV Community teardown.

### The perspective that makes the comparison simple

**OpenAI's skill is a prompt for an agent. Ours is a program, with an agent as its exception handler.**

Every Codex replay is a full agent run. The model reads the instructions, looks at the screen, decides, acts and repeats. A Task Player replay executes stored targets and checks deterministically, and calls Nemotron only when a step fails (`design.md:132`).

There is a neat overlap: **our skill already contains their artefact.** Every `Step.intent` is a sentence of what the step achieves (`skill.ts:60-61`: *"The agent fallback relies on it"*). Read them in order and you have a `SKILL.md`:

```
upload-invoice  — "Upload the newest invoice PDF to the vendor portal"
  Inputs: invoice = newest invoice-*.pdf in ~/Downloads
  1. Open the portal's uploads page        (check: URL matches /upload)
  2. Attach the invoice                    (check: file name visible)
  3. Submit the upload                     (needs your approval)
  Done when: "Upload complete" is visible
```

What we keep *in addition* is everything their agent rediscovers on every run: `target`, `fallbacks`, `check` and `requires_approval`.

### Side by side

| | OpenAI Codex Record & Replay | Task Player |
|---|---|---|
| Sensing during the demo | Screen and accessibility, via Computer Use (permission-gated) | DOM events + element descriptors in the user's Chrome; FSEvents |
| Artefact | Natural-language `SKILL.md` (intent per step) | `Skill` JSON: intent per step **plus** locator, args, check, approval |
| Replay | Agent run in a new thread, every time | Deterministic interpreter; agent only on a failed step |
| Model calls per clean replay | Many (one or more per step) | **Zero** |
| Drift handling | Implicit: the agent re-reads the screen each time | Ladder of fallbacks → agent → learn-back writes v2 ([06](06-processing-and-learning.md)) |
| Unattended or scheduled | Scheduled tasks can use skills, if the app stays running ([automations](https://learn.chatgpt.com/docs/automations?surface=app)); whether a Computer Use skill runs unattended isn't documented | `Trigger`: schedule, folder watch are in the format; only manual `run` is built (Oct 2026) |
| Scope | macOS apps, through Computer Use, except terminal apps and ChatGPT itself ([computer use](https://learn.chatgpt.com/docs/computer-use)) | Chrome, files, and Mac apps through the Accessibility API (Task Player.app, [11](11-mac-apps.md)) |
| Auditability | The agent's reasoning | Run log: matched target, score and check per step |

### What to copy, and what not to

**Copy:**

- **The user-controlled start/stop.** The daemon already does this (`main.ts:14-15`).
- **A readable "skill card"** generated from `intent` fields, like the block above, for the dry run and for corrections.
- **"Give it the values that differ this time."** That is exactly `Skill.inputs` (`skill.ts:90`).

**Don't copy:**

- **The agent on every run.** It is slower, costs tokens every run, and behaves differently from run to run on forms and payments.

The hackathon story is the contrast: *"Codex re-thinks your task every time. Ours thinks once, then runs it for free, and only thinks again when the page changes."*

Sources: [OpenAI community post](https://community.openai.com/t/introducing-record-replay/1384088) · [Chrome remote-debugging change](https://developer.chrome.com/blog/remote-debugging-port) · [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) · [eesel.ai explainer](https://www.eesel.ai/blog/codex-record-and-replay-explained) · [TechTimes](https://www.techtimes.com/articles/318759/20260620/openai-codex-automation-gains-record-replay-show-it-once-skip-script.htm) · [kingy.ai guide](https://kingy.ai/news/codex-record-and-replay/)
