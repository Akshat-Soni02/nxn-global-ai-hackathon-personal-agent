# 11 · Mac apps: the Accessibility API, and the desktop button

> Written 3 Oct 2026. Uncommitted on `main`.

**The idea:** Task Player records a Mac app the way VoiceOver reads it.
- On a click, macOS's Accessibility API says *which control* is under the pointer: a button called "Save draft", the text field labelled "Hours".
- That description is stored, never the position.
- Replay asks the same API to find that control again and press it.

## How to get the API

There's nothing to download and no key. The Accessibility API (`AXUIElement`, in ApplicationServices) is part of macOS. What you need:

| Need | Where it comes from |
|---|---|
| A compiler for the Swift code | Xcode command line tools: `swiftc --version`; if missing, `xcode-select --install` |
| Permission to read and press other apps | **System Settings → Privacy & Security → Accessibility → Task Player** (macOS asks the first time) |

Task Player.app is a real app (`apps/mac`, built by `pnpm setup:mac`), not a script, for one reason: macOS gives the permission to *the app that asks*.
- **Run from your terminal:** a helper would make the prompt name the terminal app. Granting that would let every script you ever run in that terminal control your Mac.
- **Launched through `open`:** the daemon starts it this way, so macOS asks for "Task Player" by name, and only Task Player gets the permission.

**After a rebuild, allow it again.** The app is signed without a developer account (ad hoc), and macOS ties the permission to that exact signature.
- `pnpm setup:mac` rebuilds only when the Swift sources change.
- If it did rebuild, turn Task Player off and on in that settings pane.
- If that doesn't take, run `tccutil reset Accessibility com.taskplayer.mac`, then choose *Allow Mac apps* again.

## What it records, and what it never does

| You do, in any Mac app | Recorded as | Replayed with |
|---|---|---|
| Switch to an app and act in it | `ax.open` before its first step | brings the app forward (launches it if needed) |
| Click a button, checkbox, row… | `ax.press` + the control (role, name, label, identifier, window, path) | `AXPress` on the control found again |
| Type into a field | `ax.set_value` with the field's **final value**, read from the field | sets the value (or selects all and types, for fields that refuse) |
| Choose a menu bar item | `ax.menu ["File", "Export As…"]` | walks the menus by title and presses the item |
| A shortcut, Return, Escape, an arrow | `ax.key { key, modifiers }` | the key, sent to that app |
| Right-click | `ax.press { button: "right" }` | opens the control's context menu (`AXShowMenu`) |

**Safety, by construction** (`apps/mac/Sources/Recorder.swift`):
- **Only while recording.** Watching starts at Record and stops at Stop; the button turns red in between.
- **Passive.** macOS's global event monitors see a copy of a click or key *after* it happened; they can't block or change it.
- **No keystroke log.** Characters are never recorded. A field's value is read from the field when you leave it. Only shortcuts, Return, Escape and arrows are recorded as keys.
- **Passwords:** a secure field is never read. The step becomes a secret input, and macOS also hides keys from monitors while one has focus.
- **Pastes** (Cmd+V) are not kept, as on the web. The skill asks what should go there.
- **Finder is recorded by what it does to files, not by its clicks.**
  - Its moves and renames come from the file watcher as `fs.move` / `fs.rename` steps, so next month's file is the one moved.
  - Replaying "click the row named invoice-0923.pdf" would fail next month.
  - Finder clicks that change no file aren't recorded.
- **Never recorded:**
  - password managers;
  - terminals (their whole scrollback is one value);
  - Chrome (the extension records pages by element);
  - Task Player itself.
- **Values over 2 000 characters** (a whole document) are not kept; the skill asks instead.
- **Approval:** replay waits for your OK before "Delete", "Send", "Move to Trash", "Quit", "Erase", "Don't Save" and the like, and before Cmd+Delete.

## Which folders' file moves are recorded

**You don't set up any folders.**
- **By default** the daemon watches your **whole home folder**. It skips the places apps write to all day: `~/Library`, hidden folders, `node_modules`, and app libraries such as Photos.
- **Your cloud folders are included,** even though macOS keeps them inside `~/Library`: Google Drive, OneDrive and Dropbox (`~/Library/CloudStorage`) and iCloud Drive (`~/Library/Mobile Documents`). macOS may ask before they can be read; that part is untested.
- **macOS asks once** for Desktop, Documents and Downloads, when `pnpm daemon` starts, not in the middle of a recording. If you say no, the daemon says which folder it can't see.
- **A folder outside your home** (an external drive, `/Users/Shared`) is watched as soon as a Finder window shows it during a recording. For a drive, the whole drive is watched. Task Player.app reads the window's folder through Accessibility; if Finder doesn't say it that way, it asks Finder, and macOS asks you once under Automation.
- **To narrow it down:** `TASKPLAYER_WATCH_DIRS=~/Work:~/Downloads`.

Tested on this Mac:
- In a home folder, a move between two of its folders is recorded, and so is a move inside a Google Drive folder in `Library/CloudStorage`. A file an app writes in `Library/Caches` is not recorded. Removing either rule makes the test fail.
- A folder the daemon is told about during a recording (as Task Player.app does for Finder) is watched from then on, and a move inside it is recorded.

Not tested: Finder actually reporting its windows' folders, which needs your Accessibility permission.

## The desktop button

`Panel.swift` puts a small floating button above every app and every Space, bottom right. You can drag it anywhere.

| Look | Meaning |
|---|---|
| ● dark circle | ready; an amber dot means Mac apps aren't allowed yet (right-click → *Allow Mac apps*) |
| ■ red "Stop · 0:42" | recording |
| spinner, or the terminal icon | compiling, or a question is waiting in the daemon terminal |
| ✓ "Saved timesheet. Replay: run timesheet" | done |

It's a non-activating panel, so pressing Stop doesn't take focus from the app you were in. While it's on screen, Chrome's in-page button hides, so there's one Record button, not two. When the daemon stops, the app quits; the daemon starts it again next time.

## How the pieces talk

```
Task Player.app ──hello {from: "mac", trusted}──▶ daemon            (its own socket connection, not the extension's)
  button press  ──record.command──────────────▶ same code as typed `record` / `stop`
  recorder      ──record.event app_*──────────▶ the same trace as web and file events, ordered by time
  ax steps      ◀─run.step / run.step_result──  runner.ts routes channel "ax" here, "web" to Chrome
```

## Tested here, and how

**macOS lets an app use the Accessibility API on itself without permission.**
- `--fixture` mode opens a small timesheet window inside Task Player.app.
- A scripted user hit-tests each control at its screen position and calls the recorder's own functions, as a real click would.
- `scratchpad/harness/mixed.mjs` records **web + file + app in one session** through the real daemon. The web part ran in Chrome for Testing with the extension over native messaging.
- It then replays the skill a "month later": a new invoice, an empty form, a fresh browser window.

**Result: 14 of 14 checks.**
- **The trace:** `select, click, type, click, submit, fs_move, app_click, app_type, app_click, app_type, app_click, app_menu, app_click`.
- **The skill:** web ×4, fs ×1, ax ×6.
- **The replay:** every ax step was found again at match 1.0, including a field with no name, found only by the text next to it and its place in the window.
- **Hit-testing:** `AXUIElementCopyElementAtPosition`, with the screen-coordinate flip the real recorder uses.

**Not tested: needs your permission, your Mac and your apps.**
- the global monitors (real clicks and keys);
- other apps (cross-process Accessibility);
- bringing an app forward;
- keys sent to an app;
- clicking a real menu bar.

**Two-minute check after you allow Accessibility** (no Save dialog: see the limits):
1. `pnpm daemon`.
2. Open TextEdit with a new document, and press the desktop button.
3. Type a line, choose Format → Make Plain Text, then press Cmd+A and Cmd+B.
4. Press Stop and answer in the terminal.
5. Open a fresh document, then `run <id>`.

## Limits worth knowing

- **Shortcuts:** sent with US keyboard key codes.
- **Double-click:** recorded as one press, so opening a file by double-click isn't a separate step yet.
- **Drags inside a Mac app:** only their result on disk is recorded (the file watcher).
- **Electron apps** (Slack, Notion, VS Code, Teams) build their controls for the Accessibility API only when asked. Task Player asks (`AXManualAccessibility`) when such an app comes forward; untested so far.
- **Save and Open dialogs of sandboxed apps** (TextEdit, Preview) run as a separate macOS process. Steps inside them are untested; leave them out of a first test.
- **Apps that draw everything themselves** (games, some canvas apps) expose no controls to the Accessibility API, so there's nothing to record by meaning. Vision (post-v1) is the fallback there.
- **A renamed file's new name** is kept as recorded. Next month that gives `2026-09 invoice (1).pdf`, because Task Player never overwrites. Choosing a name per run is the model's job, when the model API is wired.
