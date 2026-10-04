# 12 · How Task Player works, in plain words

> Picture: [12-how-it-works-simply.excalidraw](12-how-it-works-simply.excalidraw) (PNG next to it). Written 4 Oct 2026.

**The one-line version:** three helpers watch what you do and later do it again; one brain (the daemon) collects, decides and remembers. Nothing is ever remembered by screen position.

## 1. The four parts

| Part | Think of it as | What it watches or does |
|---|---|---|
| **Daemon** (`pnpm daemon`, in a terminal) | the brain | starts and stops recordings, saves everything, turns a recording into a skill, runs skills, asks you questions |
| **Chrome extension** | eyes and hands in **web pages** | sees your clicks and typing in pages; replays them in its own Chrome window |
| **Task Player.app** (the floating button) | eyes and hands in **Mac apps** | sees which button or field you used in any Mac app; presses it again on replay |
| **File watcher** (part of the daemon) | eyes on your **files** | notices a file being moved or renamed; moves it again on replay |

## 2. Starting: `pnpm daemon`

1. The daemon opens a "socket", a private line on your Mac that the other parts plug into.
2. It starts **Task Player.app**, which plugs in and shows the round button.
3. **Chrome's extension** plugs in too, if Chrome is open. If Chrome opens later, it plugs in then.
4. Nothing is recorded yet. Everything is connected and waiting.

## 3. You press Record: each helper starts listening

The button tells the daemon "start". The daemon tells every helper "recording now".

### Web pages: the extension's content script

- A **content script** is a small piece of our code that Chrome itself puts **inside every web page** (because the extension's manifest asks for it).
- It sits next to the page's own code and can see the page's **elements**: the buttons, fields and links, called the DOM. It doesn't read the accessibility tree.
- It was there from the moment the page loaded, but it ignores everything until it hears "recording now".
- From then on, when you click "Save draft", it writes down *which element*: `button "Save draft"`. That goes to the extension's background part, which adds the tab and page address, and on to the daemon.
- The extension's background part also notices things a page can't see: page loads, new tabs, finished downloads.

### Mac apps: Task Player.app and the Accessibility API

- **Nothing is put inside the Mac app.** Task Player.app watches from outside.
- When recording starts, it asks macOS: "give me a copy of every click and key." This is `NSEvent.addGlobalMonitorForEvents`, and it only works because you allowed **Accessibility**.
- When you click "Save" in TextEdit, macOS hands Task Player.app a copy of that click, with the screen point.
- Task Player.app then uses the **Accessibility API** (part of macOS) to ask TextEdit: "what is at this point?" TextEdit answers: `AXButton "Save"`. Every Mac app can answer this, because it's how VoiceOver works for blind users.
- That description (role, name, label, window) goes to the daemon. The screen point is thrown away.
- **Typing:** it never writes down your keys. It notes which field you're in, and when you leave it, it reads the field's final value. Password fields are never read.

### Files: the watcher and FSEvents

- **FSEvents** is a macOS service that tells a program "something changed at this path". That's all it says.
- The daemon watches your home folder with it. When a file disappears from one folder and the same file appears in another, the daemon writes down: **moved** `photo.jpeg` from Downloads to `Desktop/rushil`.
- It watches **results, not programs**. A move made in Finder and the same move made with `mv` in Terminal look identical.

What macOS reports, and what becomes a replay step today:

| You do | Does macOS report it? | A replay step? |
|---|---|---|
| move a file to another folder | yes | **yes** (`fs.move`) |
| rename a file | yes | **yes** (`fs.rename`) |
| copy a file (Cmd+C / Cmd+V, Duplicate, `cp`) | yes, as "a new file appeared" | **not yet**. Replay can copy (`fs.copy`), but the recorder doesn't write copies yet. |
| download a file in Chrome | yes | no, but it links the file to the click that downloaded it |
| delete it, or move it to the Trash | yes | no, on purpose |
| change what's inside a file | yes | no: we only look at files appearing and vanishing |
| open, read, Quick Look, `grep` | **never reported**: FSEvents is about changes, not reads | no |
| create a folder | yes | no: folders aren't followed, only files |

### FSEvents and the Accessibility API are different tools

| | **FSEvents** | **Accessibility API** |
|---|---|---|
| Answers | "a file changed at this path" | "this is the button or field under the click" |
| Used by | the daemon's file watcher | Task Player.app only |
| Example | `photo.jpeg` moved to `rushil/` | `AXButton "Save"` in TextEdit |
| Permission | macOS asks once for Desktop, Documents, Downloads (in your terminal's name) | Accessibility, for Task Player only |
| Role in **browser** clicks | **none** | **none**. Web pages are the content script's job. |

**Why they aren't one thing:** FSEvents knows nothing about buttons, and Accessibility knows nothing about where a file ended up. They meet in one place, the daemon's trace, sorted by time.

**Where they overlap: Finder.** Dragging a file in Finder is visible to both: Accessibility sees clicks on rows, and FSEvents sees the file move. Recording both would replay the move twice, and a row's position changes from one day to the next. So Finder is left out of Accessibility recording, and moves are recorded by their result through FSEvents.

**Where the web and files meet:**
- **A download:** Chrome tells the extension where it saved the file, and the watcher sees it appear. So the skill knows that this click made this file.
- **A file you drag into a page:** the page only learns the file's name, size and date, never its folder. After you stop, the daemon finds the file with **Spotlight** (the search behind Cmd+Space), not FSEvents (`locate-file.ts`):
  1. it asks Spotlight for every file with exactly that name: `mdfind 'kMDItemFSName == "photo.jpeg"'`;
  2. it keeps only files with exactly the same size in bytes;
  3. if several are left, it takes the one whose date is closest to what the page saw;
  4. if Spotlight finds nothing (a folder it doesn't index, an external drive, a file too new to be indexed), it searches the usual folders itself: Downloads, Desktop, Documents, Movies, Pictures, iCloud and Google Drive, up to 20,000 files.

  The folder it finds becomes the replay suggestion.
- **Chrome's own accessibility tree** is used during web **replay**, to find a button by role and name. That's Chrome's internal tree, read through the extension, not the macOS API.

## 4. Chrome: what happens in each case

| Case | What happens |
|---|---|
| You're already in Chrome when you press Record | Recording starts at once in every open tab. |
| Chrome is closed when you press Record | Web capture starts the moment you open Chrome: the extension plugs in and joins. |
| A tab was open before the extension was loaded or reloaded | The extension puts its content script into that tab when it connects. |
| New tab page, `chrome://` pages, Chrome Web Store | Chrome doesn't allow content scripts there, so clicks aren't recorded. The page you then open still is. |
| You open a new tab or switch tabs | Recorded: the extension sees new tabs and page loads. |
| Incognito window | Not recorded: Chrome turns extensions off in incognito unless you allow it. |
| Replaying while Chrome is closed | The daemon opens Chrome in the background and waits for the extension. |
| Replaying while you're using Chrome | Replay uses **its own separate window**, so your tabs aren't touched. |

**Fallbacks:**

| If… | Then… |
|---|---|
| the daemon isn't running | no Record button, nothing is recorded |
| Task Player.app isn't built | Chrome shows the Record button inside pages instead, and the toolbar icon works too |
| Accessibility isn't allowed | **Recording:** web pages and files in your home folder are still recorded. Mac apps aren't, and Finder folders outside home aren't reported. The button shows an amber dot. **Replay:** a Mac-app step fails at once with "Task Player may not use other apps yet". To fix it: right-click the button, choose Allow Mac apps, then switch Task Player on. It notices within 2 seconds. |
| the extension disconnects | it reconnects on its own, every few seconds to 30 seconds |

## 5. You press Stop: from recording to skill

| Step | What it is | Saved as a file? |
|---|---|---|
| **Trace** | the raw list of everything heard, in time order | **yes**: `traces/<session>.jsonl` |
| **Normalise** | tidies it up: 30 keystrokes become one "type 8"; a click that only focused a field disappears | no, only in memory |
| **Compile** | turns tidy steps into a skill: which channel, what to find, what may change next time. Code does it all; the AI model, if set up, adds meaning | no, only in memory |
| **Questions** | asked in the terminal: "which file next time?", "describe this task" | no |
| **Skill** | the finished recipe | **yes**: `skills/<id>/v1.json` |

All files are in `~/Library/Application Support/TaskPlayer/`.

**Why you don't see normalised or compiled files:** they're steps in between, not results. The trace (what happened) and the skill (what to do) are what's kept. `compile <session>` rebuilds a skill from a kept trace at any time.

## 6. Replay: `run <id>`

1. **Which file?** If the skill uses a file, it's settled **before step 1**, never in the middle, so a wrong file can't leave a task half done (see "Files at replay" below).
2. The daemon reads the skill **one step at a time** and sends each to the right helper:

| Step's channel | Who does it | How |
|---|---|---|
| `web` | the Chrome extension | in its own window, finds the button by role and name (Chrome's accessibility tree), then clicks or types |
| `fs` | the daemon itself | moves or renames the file |
| `ax` (Mac apps) | Task Player.app | see below |

3. A step that sends, pays, deletes or submits **waits for you to type `approve`**.
4. Each step prints ✓ or ✗. On ✗ the run **stops and tells you where**. The planned AI fallback would try to recover here; it isn't built.

### Files at replay

**Two ways to give the file:**
- **With the command:** `run move-photo ~/Desktop/new.jpeg`. Type `run move-photo ` and drag the file in from Finder; Terminal types its path. If a skill takes more than one file, name each one: `run <id> photo=<path> invoice=<path>`.
- **Otherwise the app asks**, before step 1. Enter takes the suggestion (the newest file like the one you recorded with), or you type or drag one in. The question shows the input's name, for next time.
- If you chose "the newest X" when you stopped recording, nothing is asked: it takes the newest file that passes the checks.
- **Schedules (later):** nobody is there to ask. The rule, or the trigger (the file that just landed), picks the file, and a file that fails the checks means the run doesn't start.

**The checks, on every file, before anything runs:**

| Check | Where the rule comes from | Example |
|---|---|---|
| it exists and is a file, not a folder | always | `no file at ~/Desktop/Gone.jpeg` |
| it isn't empty | always | `blank.jpeg is empty (0 bytes)` |
| it's the right kind | the page's own `accept` list on its file field, recorded with the upload; else the kind you recorded with (a photo: any image; a PDF: `.pdf`) | `report.pdf is the wrong kind of file: this step takes images` |
| it isn't too big | only if you set `max_mb` on the input yourself. Pages don't state their size limit in a standard way, so none is guessed. If a site refuses a big file, the step after the upload fails and the run stops there. | `clip.mov is 812.0 MB: this step takes at most 500 MB` |

**What a wrong file does:**
- **At the question:** you're told why and asked again, up to 3 times. Then the run stops.
- **With the command:** the run stops at once.
- **Either way, no step has run yet.**

**One more check at the upload itself:** the Chrome extension reads the page's file field again, in case the site changed what it takes since you recorded. A wrong file stops that step, and Chrome never gets it.

The rule is kept in the skill as `resolve.accept` (and `resolve.max_mb`), in the HTML `accept` syntax: `image/*`, `.pdf`, `application/pdf`.

### A Mac-app step, from trigger to click
It goes there and back: daemon → Task Player.app → the app → Task Player.app → daemon. On replay the last stop isn't "macOS"; it's the app itself, which presses its own button when asked through Accessibility.

1. The daemon sends the step (say, *press `AXButton "Save"` in TextEdit*) to Task Player.app over the socket.
2. If TextEdit isn't open, Task Player.app opens it; then it brings it to the front.
3. It asks the Accessibility API for TextEdit's windows and looks through every control for the best match: same role, same name, label, window and position in the window. It accepts a match only if it's clearly the best one.
4. It presses it directly (`AXPress`). This isn't a mouse click at a screen point, so it works even if the window has moved. Typing sets the field's text, menus are opened by their titles (File → Export…), and a shortcut is sent as a key press to that app only.
5. It sends ✓ back, or ✗ with the reason. The daemon moves on to the next step, or stops the run.

**What starts a run today:** only you, typing `run <id>`. Scheduled runs ("every Monday") and "when a file lands in this folder" exist in the skill format but aren't built yet.

## 7. Where the AI model fits (not set up yet)

| When | How often | What for | Status |
|---|---|---|---|
| **Compile**, after Stop | once per recording | adds meaning: a good name, which typed values change each time, a date pattern in a file name, good questions | works when `.env` has the Nebius key and model; without it, code builds the skill alone |
| **`data.ai` step**, during a run | once per run, capped at 3 calls | choosing by meaning when no simple rule can | only if you said yes to its cost question after Stop |
| **Fallback**, when a step fails | only on failure | the page was redesigned, a pop-up appeared, a dialog changed | planned, not built |

**Tasks that don't need AI** (code alone handles them):
- filling the same form;
- clicking the same buttons;
- "the newest invoice in Downloads";
- "today's row in the sheet";
- the same Mac app menus.

**Tasks that need AI once, at compile:**
- "38 hours": the same every week, or ask each time?
- "2026-09 invoice.pdf" should become this month's date.
- Naming the skill and describing it.
- Suggesting "run this when a new invoice lands in Downloads".

**Tasks that need AI on every run:**
- "Move the invoice that looks overdue."
- "File this email under the right client."
- "Pick the cheapest option in this list."
- "Write a one-line summary into the sheet."

**Tasks that need the fallback (planned):**
- the website renamed "Submit" to "Send";
- a cookie banner covers the page;
- a Mac app shows a new "What's new" window first.

## 8. What may change later

**More helpers.** Today the daemon hears from web pages (the extension), Mac apps (Task Player.app) and files (the watcher). That list isn't final. Each of these would plug into the same daemon and write to the same trace (none is built):
- Safari: Edge, Arc and Brave are Chromium-based, so the same extension could run there;
- the clipboard between apps;
- Terminal commands, which are left out today for privacy;
- screen pixels, for apps that give no accessibility information.

**One desktop app.** Today there are three programs, because that was fastest to build:
- the daemon: the engine, in a terminal;
- Task Player.app: the button and the hands for Mac apps;
- the Chrome extension.

The final desktop app is the superset you install once:
- the daemon's code runs inside it as its engine;
- the Swift code stays as a small helper inside it, for Accessibility;
- windows replace the terminal: skills, questions, a file picker, run logs, approve and deny.

The extension stays separate, because Chrome only runs extensions installed in Chrome; it connects to the app the way it connects to the daemon now.

**Still to check:** whether macOS shows the Accessibility permission under the app's name when the helper sits inside the app.

