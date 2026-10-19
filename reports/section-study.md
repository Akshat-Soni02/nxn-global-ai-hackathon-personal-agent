# Record and replay, section by section: how each part is built, and what broke in it

**Why this file.** Three rounds of real recordings showed that the failures aren't a few loose ends. They come from how some parts are designed. This file goes through record and replay one self-contained section at a time. For each one:
- **What it does:** its flow, from input to output.
- **Logic and rules:** the decisions in the code.
- **Edge cases handled:** situations the code was written for.
- **Not handled:** limits by design.
- **Problems seen:** every failure in the reports that traces to this section.

Section names follow [`test-plan-record-replay.md`](test-plan-record-replay.md). Code is as of `main` at `b602e73` (Oct 18).

**Sources for "problems seen":**
- **[1]** [`first-real-recording-yc-to-sheets.md`](first-real-recording-yc-to-sheets.md), Oct 14, YC → sheet
- **[2]** [`second-recording-yc-to-sheet.md`](second-recording-yc-to-sheet.md), Oct 15, YC → sheet again
- **[3]** [`oct19-two-recordings.md`](oct19-two-recordings.md), Oct 19: A, KPI email → sheet; B, Play Store → Chat

Status marks on problems: **fixed** (since that report), **open**.

---

## 0. The fundamental issues, in one page

Five design choices account for almost every failure:

1. **A recorded step is remembered by things that don't come back.**
   - **Clicks on non-controls:** when you click something that isn't a control (to read, or to select text), the recorder stores the element's *whole text*. The matcher doesn't use text at all (§P3), so those steps can never be found.
   - **Generated IDs:** Google's per-session IDs (`:1g`, `19fml5:17`) are kept as if stable.
   - **No position:** a link's place in a list ("the top job") isn't stored.
   - **No cell:** a sheet cell has no element at all.
   - **Result:** a large share of recorded steps are unreplayable from the moment they're saved (§R1, §R10, §P3).
2. **The workflow is a replay of clicks; generalising it is left entirely to one model.**
   - **No code-side generalisation:** nothing in code turns "the first row of this list", "today's date" or "the next empty row" into a rule.
   - **One agent, unreliable tools:** the design agent is the only route from "what I did" to "what I meant". It fails more on tool syntax than on understanding: questions lost to a misused `id`, edits sent as a string, `wrap_in_loop` never found (§D3).
   - **Result:** most workflows stay literal (§R9, §D).
3. **Nothing checks that the result does the task.**
   - **Agent side:** `finish` accepts any workflow that parses, including one step that finds a file [3B]. Its success checks are invented or absent.
   - **Replay side:** "evidence" for a repair is "the next target is visible".
   - **Result:** false successes [3B], and a wrong fix saved as a new version ("Print all", [3A]) (§D6, §P7, §X3).
4. **Replay talks to Chrome with no timeouts, in one tab, while recordings use several.**
   - **Hangs:** DevTools calls can hang for 35–50 s, seen in three runs (§P9).
   - **One tab:** a multi-tab recording has to be flattened into one tab (§R2, §P2).
5. **What the agents did can't be fully reconstructed.**
   - **Not kept:** no reasoning, no input for rejected calls (and, until PR #13, no prompt).
   - **Result:** debugging a bad design means guessing (§D7).

Everything below is the detail.

---

# Record

## R1 · Web capture (the extension's content script)

**What it does.** `apps/extension/src/content.ts` is injected into every page and frame at `document_start`. While a recording session is open it runs `startCapture` (`capture.ts`), which listens on the document in the **capture phase**. A page that stops propagation can't hide an event. Each event goes to the background worker, which adds the tab, frame, id and session and sends it to the daemon (`background.ts`, `record`). The daemon appends it to `recordings/<session>/trace.jsonl`.

**What is recorded, per DOM event**

| DOM event | Trace event | Notes |
|---|---|---|
| `pointerdown` → `click` | `click` | The element is described at `pointerdown`, before the page can re-render, and sent at `click`. The *actionable ancestor* is used (a click on a `<span>` inside a button is a click on the button; a `<label>` is its control) |
| `pointerdown` + `pointerup` ≥ 10 px apart | `drag` (pointer drag) | Not when text is selected, not from fields, a canvas or a range input |
| `dragstart` + `drop` | `drag` (HTML5) | |
| `input` / `change` / `focusout` | `type` | Many keystrokes → one event with the field's **final value**. Never per key |
| `change` on `<select>` | `select` | The visible label |
| `change` on a checkbox/radio | `check` | |
| `change` on a file input | `file` | Name, size, type, date. **Never the path** (pages don't get it) |
| `keydown` Enter / Escape | `key` | Not Tab (only moves focus); not Enter in a textarea (newline); not on clickables (fires a click) |
| `paste` | `paste`, then `type` with `pasted: true` | The pasted value is **never stored**; it comes from the copy before it |
| `copy` (bubble phase, after the page's own handler) | `copy` | Clipboard text (or the selection), max 2,000 characters. In a Google Sheet, the sheet's CSV is fetched and the copied cell's row and header are attached (`context`) |
| `submit` | `submit` | |
| `drop` with files | `drop` | Files dragged in from Finder |

**Logic and rules**
- **Secrets:**
  - a field is secret when it's `type=password`, has an `autocomplete` of password, one-time code or card, or a `name` matching `pass|otp|cvv|cvc|secret|token|pin`;
  - a secret's value is never sent (`secret: true`);
  - a copy out of a secret field records that it happened, never what was copied.
- **Duplicates suppressed:**
  - a click within 100 ms after Enter in a form (the browser's implicit submit);
  - a second click on the same element within 100 ms (a label clicking its control);
  - the click the browser fires after a pointer drag.
- **Drawn areas:** a click on a `<canvas>`, or on an element ≥ 200×200 px with no role, name or text, is marked `drawn: true`. It isn't replayable by element; it's context for what follows.
- **Shadow DOM:** `change` and `submit` don't cross shadow roots, so every shadow root you interact with gets those listeners too.
- **Shadow's own button** (`data-shadow-ui`) is never recorded.
- **Orphaned copies:** after an extension reload, the old content script stops itself.

**Edge cases handled**
- Re-rendering pages: the element is described at `pointerdown`.
- Single-page route changes: the background records `onHistoryStateUpdated` as `navigate`.
- Implicit form submit by Enter.
- Label → control.
- Pointer drags vs HTML5 drags.
- Drag libraries that move the dragged element along with the pointer.
- Google Sheets copies: the row context comes from the export.
- Content scripts in tabs opened before the extension loaded (injected by the background).

**Not handled (by design today)**
- **No "what I meant" for a click on a non-control.** If no actionable ancestor exists, the raw element (often a big `<div>`) is described, and its text becomes the target.
- **Hover, scroll and focus changes** aren't events.
- **Typing that doesn't fire `input`** (some canvas editors).
- **The page address on an event is the background's `sender.url`**, which in single-page apps stays at the address the page first loaded.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Clicks made to **select text before copying** become clicks on containers (`"EventualBuilding the AI data engine…"`, `"Print allIn new window…"`, `"Hi All,"`). Every one is a step replay can't find (§P3) | [2] R1, [3A] R9 | open |
| A **link with no accessible name** (the top YC job card) is recorded `link:''` | [2] R2 | open |
| **Clicks on Google Sheets cells** (canvas) have no target; the cell is known only from the editor's label afterwards (`B3`) | [2] R3, [3A] | open |
| **Stale page address in a single-page app:** clicks on Play Console's `/download` page are labelled `/app-list` | [3B] R1 | open |
| Repeated `navigate` events when switching tabs (14 identical in 20 s) | [1] issue 6 | partly fixed (normalise merges reloads; §R9) |

**Where:** `apps/extension/src/capture.ts`, `describe.ts`, `content.ts`, `background.ts` (`record`, webNavigation listeners).

---

## R2 · Tab capture

**What it does.** The background worker records:
- `tab_open` (`tabs.onCreated`), with the opener tab;
- `tab_close` (`tabs.onRemoved`);
- **`tab_switch`** (`tabs.onActivated`, added in PR #13), with the tab's current address;
- `navigate` on every top-frame page load and single-page route change, tagged with its tab id.

**Logic and rules**
- Events from **the automation tab** (replay's own window) are dropped, so a replay running during a recording never records itself.
- A switch is recorded only while a session is open; if the tab can't be read, the switch is still recorded without an address.
- Replay is single-tab, so §R9 (`followTabs`) uses the tab ids to rebuild the order of pages.

**Edge cases handled.** A tab opened by a click (`openerTabId`); a tab closed mid-recording.

**Not handled**
- **Windows:** a switch between Chrome *windows* isn't a tab activation, so it isn't recorded.
- **New tabs:** a tab's own page loads are recorded, but what you did *before* switching to a new tab isn't tied to it.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Switches weren't recorded; replay put the sheet's typing on the company page | [2] R4 | **fixed** (PR #13: `tab_switch` + `followTabs`); seen working in [3A] (×10) and [3B] (×2) |

**Where:** `apps/extension/src/background.ts`; `packages/core/src/trace.ts`.

---

## R3 · Mac-app capture (Shadow.app, Accessibility)

**What it does.** `apps/mac/Sources/Recorder.swift` adds NSEvent **global monitors** at `record.start` and removes them at `record.stop`. For each click it hit-tests the Accessibility tree and records `app_click` with the AX element (role, title, description, identifier, window, app). It also records:
- `app_activate` when you switch apps;
- `app_type` with a text field's **final value**, read when you leave it;
- `app_key` for shortcuts, Return, Escape and arrow keys;
- `app_menu` for a menu item chosen.

**Logic and rules (safety by construction)**
- **Monitors are passive:** they see a copy of each event and can't block or change it.
- **No keystroke log:** characters are never recorded, only the field's value afterwards.
- **Passwords:** `AXSecureTextField` is never read (it becomes a secret input); macOS also stops delivering keys to monitors while a password field has focus.
- **Apps never recorded:** password managers, terminals, **Chrome** (the extension records it), **Finder** (recorded from the disk as file steps, §R4), and Shadow itself.
- A value over 2,000 characters isn't kept.
- `AXUIElementSetMessagingTimeout` is 0.5 s, so a hung app can't stall the recorder.
- Finder folders outside your home folder are reported so the daemon watches them too.

**Edge cases handled.** Opening a menu (the chosen item is the step, not the menu click); pastes into a field; editing shortcuts inside a field (⌘A/C/X/Z aren't steps).

**Not handled**
- **Controls with no AX name** (scroll areas, canvases, cells in Numbers) give nameless elements; normalise drops unnamed containers (§R9).
- **macOS's own prompts are recorded:** the Screen Recording request (`universalAccessAuthWarn`) and System Settings aren't on the skip list.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Numbers clicks recorded as nameless `AXScrollArea` | [3B] R3 | open (dropped later as containers, so nothing replays: the CSV check is lost) |
| **Shadow's own permission prompt and System Settings recorded as task steps** | [3B] trace 16–30 | open |

**Where:** `apps/mac/Sources/Recorder.swift`, `AX.swift`.

---

## R4 · File capture (the daemon's folder watcher)

**What it does.** `apps/daemon/src/fs-watch.ts` watches your **whole home folder** recursively (FSEvents through Node's `fs.watch`; `SHADOW_WATCH_DIRS` can narrow it). FSEvents only says "something happened here", so each report becomes an *observation* (appeared / vanished). A short settled batch of observations is classified into `fs_create`, `fs_move` or `fs_rename`. Downloads come from the extension (`download`, with the final path). A picked or dropped file's path is found afterwards by `locate-file.ts`: Spotlight first, then a bounded walk, by name and size, closest date.

**Logic and rules**
- **Move or rename:** a file that vanished in one place and appeared in another, matched by inode or name, was moved; in the same folder, renamed.
- **Deletions aren't steps.** A move to the Trash is a delete.
- **Temporary files are ignored:** appeared and vanished in one batch, in-progress downloads (`.crdownload`), swap files, `.DS_Store`, hidden files, `node_modules`, caches.
- **Library is skipped,** except cloud folders (Google Drive, OneDrive, Dropbox, iCloud).
- **Guarded folders:** Desktop, Documents and Downloads are asked for once, at daemon start; folders macOS refuses are reported once, not per file.
- A file rewritten in place (same inode) isn't a move.

**Edge cases handled.** Renames of files never seen before; external drives (watched once a Finder window shows them); downloads linked to the step that caused them (`produces`).

**Not handled.** Content edits; deletions as steps; folders outside the watched roots that Finder never showed.

**Problems seen.** None so far: [3B]'s download, file arrival and drop were all captured correctly.

**Where:** `apps/daemon/src/fs-watch.ts`, `locate-file.ts`.

---

## R5 · Screenshots: capture

**What it does.** With the **Screen** consent, after each `click / type / select / check / file / drop / submit / key / copy / navigate`:
- **Web:** the background takes a picture of the visible tab (`captureVisibleTab`), 400 ms after the event (1.2 s after a navigation) so the page has reacted.
- **Mac apps:** Shadow.app captures the window.

Pictures go to `screen.ts` (§R6) and are saved as `shots/<event>.jpg`.

**Logic and rules**
- **Rate:** about two a second at most (Chrome's limit); a newer event replaces a picture still waiting.
- **When there's no picture:**
  - while a password field has focus;
  - for an event carrying a secret value;
  - for an inactive tab;
  - for the automation tab.
- **Pre-masked areas:** password and card fields (and anything marked `data-shadow-private`) are sent as boxes to black out (`shot.ts`), top frame only.

**Edge cases handled.** Fast bursts of events; the window being moved or closed (the picture is skipped, with a warning).

**Not handled.** Pictures of iframes' own coordinates; pictures for events with no visible change.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| **Every screenshot discarded:** the daemon decided Shadow.app couldn't mask (it searched the binary for `--redact`, which Swift stores inside machine code) | pre-[1] | **fixed** (`--capabilities` line, PR on Oct 14) |
| Stale extension (not reloaded after a rebuild): no pictures sent | pre-[1] | user step (reload in `chrome://extensions`) |

**Where:** `apps/extension/src/background.ts` (`queueShot`, `takeShot`), `shot.ts`; `apps/mac/Sources/Screen.swift`.

---

## R6 · Screenshots: reading and masking

**What it does.** For each picture, `apps/daemon/src/screen.ts`:
1. runs `Shadow --ocr` (Apple Vision, on the Mac), giving lines with boxes;
2. runs `maskLines` (`packages/recorder/src/mask.ts`) with the recording's Never words;
3. runs `Shadow --redact`, which paints black boxes **in place** over masked lines and the pre-masked fields;
4. appends the masked words (≤ 2,000 characters per picture) to `screen.jsonl`.

**Only `screen.jsonl` reaches a model.**

**Logic and rules (masking, in order)**
1. The user's **Never** words (≥ 3 characters, whole words).
2. **Emails.**
3. **Tokens:** JWTs and known key prefixes (OpenAI/Stripe `sk-`, GitHub `ghp_`, Slack `xox…`, AWS `AKIA…`, Google `AIza…`), plus any mixed letter-digit run of 32+ characters.
4. **IBANs.**
5. **Card numbers:** 13–19 digits, **Luhn-checked**.
6. **Phone numbers:** 9–15 digits with the usual separators; dates like `2026-10-19` are kept.

**Masking is conservative on purpose:** a harmless number masked costs a little context; a missed card leaks it. **A picture that can't be read or masked is deleted,** never kept unmasked.

**Edge cases handled.** Pictures arriving after Stop (the reader waits until all are done); Shadow.app missing (pictures are dropped with a log line).

**Not handled.** Names, addresses and free-text private details (only the listed patterns and Never words); text drawn in images that OCR misreads.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Masking held in every recording: an email address masked in [3A]; only lone `@` icons in [3B] | [3] R6 | ✅ |
| The words sent per step were page chrome (menus, headers), burying the narration | [2] | **fixed** (`d5156be`: lines around the acted-on control) |

**Where:** `apps/daemon/src/screen.ts`, `mac-binary.ts`; `packages/recorder/src/mask.ts`; `apps/mac/Sources/Screen.swift`.

---

## R7 · Narration: recording and transcription

**What it does.**
1. With the **Microphone** consent, Shadow.app records `voice.m4a` in the recording folder and notes when it started on the daemon's clock (`voice.json`).
2. After Stop, the daemon runs `Shadow --transcribe` (macOS 26 SpeechAnalyzer, on the Mac), giving timed segments.
3. The segments are masked like screen words.
4. They're written to `transcript.jsonl` on the recording's clock.

**Logic and rules.**
- **The audio never leaves the Mac;** only the masked text does.
- **Unusable narration is skipped**, with a log line: no start time, or a binary without the transcribe mode.

**Not handled.** Older macOS (SpeechAnalyzer needs 26), languages without a downloaded model, crosstalk.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Narration silently skipped (the same binary-detection bug as R5) | pre-[1] | **fixed** |
| Mishearings ("tickets resort", "Viacom Jobs"), not harmful to meaning | [3A] | accept |

**Where:** `apps/mac/Sources/Voice.swift`, `apps/daemon/src/voice.ts`.

---

## R8 · Narration: alignment with the steps

**What it does.** `packages/recorder/src/narration.ts`:
- **`narrationOf`** lists every spoken piece, in order, with the steps it was said over ("step 4", "steps 4–7", "before step 1").
- **`notesByStep`** attaches each screenshot's words to the step it was taken after.

The design agent gets the narration as its own list **before** the steps, whole, whatever the recording's length.

**Logic and rules**
- A moment belongs to the last step that started before it, **with 1 s of grace** (people talk as they click).
- A narration piece spans from its start to its end (`until`).
- **Only real actions are marked:** a page opened again that the recording had already been on (switching back to a tab) isn't an anchor, so "said over steps 4–5" points at something you did.
- Spoken words are never repeated as notes on single steps.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Narration attached to one step each, so whole-task sentences landed on whatever step was last | [1] issue 11 | **fixed** (`76e9d40`: its own list, with ranges) |
| Narration didn't reach both model calls whole | [1] | **fixed** (`57b79b8`) |

**Where:** `packages/recorder/src/narration.ts`.

---

## R9 · Normalise: events → steps by meaning

**What it does.** `packages/recorder/src/normalise.ts` sorts the trace by time and folds events into steps (`NormalisedStep`): `navigate`, `click`, `type`, `select`, `press`, `upload`, `drag`, `copy`, `fs_move`, `fs_rename`, and the Mac-app kinds. Each step keeps the trace event ids it came from.

**Logic and rules**
- **Navigation:**
  - pages replay can't open (`chrome://`, other extensions) aren't steps;
  - a navigation within 3 s after a click or Enter, with a `link` or `form_submit` transition, belongs to that click (`navigatesTo`);
  - redirects and reloads within 3 s fold into the previous navigate.
- **Clicks:**
  - the same element clicked again within 600 ms is one click;
  - a button click within 100 ms after Enter is the Enter;
  - clicks "on nothing" (no role, name, text or label) are dropped;
  - **drawn clicks** (canvas) are dropped, and counted on the next step as `drawnBefore`.
- **Typing:**
  - consecutive types into the same field merge (the last value wins);
  - a focus click on that field just before is absorbed;
  - **a pasted value isn't stored:** it points at the last copy (`fromCopy`).
- **Copies:** absorb the click just before them **only if** it was drawn, or on the *same element* within 10 s.
- **Uploads:** absorb the clicks that opened the macOS file dialog (the file input, a `<label>`, the page's script clicking it, the button you pressed). Replay sets the file directly, so none of those clicks replay.
- **Others:**
  - `check` merges into its click;
  - `submit` marks the click or Enter before it (`submits`);
  - downloads and created files mark the step before them (`produces`).
- **Mac apps:**
  - an `app_open` is inserted when the recording moves into an app;
  - **unnamed AX containers are dropped**;
  - double presses merge;
  - a focus click before typing is absorbed.
- **After the pass:**
  - **`addStartingPage`:** if the first step isn't a navigate, the page it happened on is opened first;
  - **`followTabs`** (PR #13): when an action happens **in another tab, on another page** than replay would be on, that page is opened first. Same-tab address changes (maps, single-page apps) aren't switches.

**Edge cases handled.** Double clicks, label clicks, implicit submit, focus clicks, file dialogs opened by script, drawn apps, tab switching, a recording starting mid-page, reloads.

**Not handled (by design today)**
- **A click that selected text in a *different* element than the copy** (clicking the heading area, then copying the name) stays a click. This is the source of most container steps.
- **Clicks to read** (expand an email, open a summary) are kept as steps.
- **Sheet cells:** no step selects the cell before typing.
- **Repetition isn't recognised:** five identical copy/paste pairs are five step groups (left to the design agent).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| **Selection clicks before a copy kept as steps** (the failing step in [2], and A's s5 in [3]) | [2] R1, [3A] | open |
| Noise kept: double clicks as two clicks, clicks on whole sections, 14 repeated navigations | [1] issue 6 | partly fixed (double clicks, reloads) |
| **Sheet typing goes to whichever cell is selected:** canvas clicks dropped, no "go to cell" | [2] R3, [3A] (writes to row 1) | open |
| The Drive detour (Recent → icon → cell → link) kept, although the sheet's address is in the trace | [1] issue 5, [2] R5 | partly fixed (the agent may now turn a click into "open the page it opened"; rarely does) |
| One-tab replay of a multi-tab recording | [2] R4 | **fixed** (`followTabs`) |

**Where:** `packages/recorder/src/normalise.ts`.

---

## R10 · The first draft: targets, values, questions, approvals (code)

**What it does.** `packages/recorder/src/skeleton.ts` turns each normalised step into one or more workflow steps (`s1, s2…`), with channel, action, **target** (`toLocator`, `locator.ts`), recorded values, checks and approvals. `compile.ts` adds the form's goal, names the workflow, and collects the questions code can't decide.

**Logic and rules**
- **Targets.** `toLocator` turns an element description into a locator:
  - `role`, `name`, `label` (if different), `text` (if different), `near` (the section heading), `attrs` (id, name, type, placeholder, aria-label, title, href, test ids);
  - `fallbacks` = a CSS selector (ranked: test id > hand-written id > name+type > aria-label > a short structural path) and an anchored XPath (`//section[h2='Documents']//input`);
  - **echo-verified:** only selectors that resolve back to exactly this element are kept;
  - inside a shadow root only role, name and text are kept (selectors can't cross it).
- **Generated values are dropped** (`GENERATED`): 4+ digit runs, 8+ hex characters, React-style `:r…:`, `ember-`/`react-`/`mui-`… prefixes.
- **A link click that went where its `href` points** becomes `navigate` to that address (`linkDestination`), not a click.
- **Checks:** a step that led to a page gets `url_matches` on the page's path, cut before parts that change per visit (map positions, `data=`, coordinates, long generated ids).
- **Copies:**
  - **normal page:** the copy becomes `web.extract` → `copied_N`;
  - **Google Sheet:** it becomes "read the rows" + `data.pick` for the copied cell's row, and if a column holds the recording day's date, the question *"the row whose Date is that day's date, or always this row?"*.
- **Pastes** become `web.type` of `{{copied_N}}`.
- **Uploads** become a **file input** with a rule: where such files arrive and which pattern (`invoice-*.pdf`), plus a question "which file next time?".
- **Approval by code** (`requireApprovals`, `approvals.ts`):
  - every click or key whose control's words match `send|submit|pay|delete|post|share|confirm|…`;
  - a move to the Trash;
  - anything matching Never.
  - Uploads are *not* gated: the upload only hands the file to the page, and the click that sends it is the step that needs approval.
- **Paths are made portable:** `/Users/<you>/…` → `~/…`.

**Edge cases handled.** Map URLs that change per visit; Google Sheets copies by row rule; ambiguous US/EU dates (`10/3/2026` kept as both); files found on disk after a pick or drop; shadow roots.

**Not handled**
- **Container targets are stored as text-only locators,** which the matcher can't use (§P3).
- **Google-style generated ids pass the `GENERATED` filter** (`:1g`, `19fml5:17`).
- **A link's position in a list isn't stored,** so a nameless "top item" click becomes a fixed URL.
- **Typed dates stay literal** (`15 Oct`): code doesn't recognise a typed date as "today".

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Text-only container targets: unmatchable | [2] P1 (s3), [3A] s5 | open |
| **Per-session ids stored as attributes** (`id: 19fml5:17`): the step failed next run | [3A] s2 | open (the ladder happened to fix it) |
| The top job became `navigate /companies/eventual` (fixed URL) | [2] R2 | open |
| `{{today}}` not used for a typed date | [1], [2] R6 | open (left to the agent) |
| **Enter that sends a chat message isn't outward** (target "History is on", no submit) | [3B] | open |
| Code's questions duplicated what the form said | [1] issue 3 | **fixed** (`cd27d49`, and the evidence check in PR #13) |

**Where:** `packages/recorder/src/skeleton.ts`, `locator.ts`, `compile.ts`, `approvals.ts`; `apps/extension/src/describe.ts`.

---

# The design agent

Nemotron 3 Super in a loop with tools, after Stop. It's the **only** place where a recording is generalised. Full reference: [`docs/agents/design-agent.md`](../docs/agents/design-agent.md) (written against an earlier commit; the differences are noted here).

## D1 · What it's given

**Logic.** The system prompt is the ROLE text, the labelling rules (`label_steps`), the capability briefing and the loop's rules. The first message has:
- the description (goal only since PR #13, with "frequency: not given before recording: set it from what they said");
- **the whole narration with step ranges**;
- **the recording view for steps 1–40** (screen words shortened around the acted-on control, nameless steps marked);
- the plain draft outline;
- open questions.

`design.json` keeps the prompt (since `9889f80`).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Only 40 steps in the first message: A's steps 41–52 never seen unless asked | [3A] D1 | open |
| ~15–22k input tokens re-sent every turn: 246k for 11 turns | [3] D10 | open |
| No "Available now" in its briefing; no worked examples of common shapes in the briefing | [1] | partly (the ROLE now describes "list → pick → loop") |

## D2 · `label_steps` (its first move)

**Logic.** Offered once, first. It labels every step (intent, args, checks, approvals, `save_as`, timeouts, AI steps) and the task (id, intent, inputs, success) by the labelling rules. The result **becomes the baseline** the rules compare against. Its questions join the open ones.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| **Invented checks:** `success: "Job entry added to sheet"` (never visible: fails any run); `text_visible: ""`; text checks on canvas cells | [2] D3 | open |
| Many checks left `{}` | [3] D2 | open (harmless) |
| Values left literal (dates, company URLs, week numbers) | [2] D1, [3] D4 | open |
| Its changes weren't counted in `edits` | [2] D1 | **fixed** (the history now comes from comparing the plain list with the result) |

## D3 · The tools, and how they fail it

**Logic.** 13 tools:
- **look:** `read_description`, `read_recording`, `workflow`, `describe_step_screenshot`, `recall`, `validate`
- **edit:** `label_steps`, `edit`, `wrap_in_loop`, `wrap_in_branch`, `add_llm_step`
- **ask:** `ask_user`
- **finish:** `finish`

How they behave:
- **`edit`:** keeps each valid operation when a batch isn't valid together (PR #13); loops and branches stay all-or-nothing.
- **`ask_user`:** shows recorded evidence first for model-written questions (PR #13).
- **Schemas are strict:** a wrong shape is an `invalid` turn with a terse error.

**Problems seen** (the biggest cluster)

| Problem | Where | Status |
|---|---|---|
| **`ask_user` with its own `id`** → "No open question X"; all three of A's questions lost, none reached you | [3A] turns 2, 4, 8 | open |
| **`edits` sent as a JSON string** → invalid, repeated 2–3× | [3A] 5–7, [3B] 14–15 | open |
| **`wrap_in_branch` used as an edit op**, and inserted steps without `type` / `channel` / `action` | [3A] 10, [3B] 4 | open |
| **An empty loop inserted** (`steps: []`) instead of `wrap_in_loop`, four times; the error doesn't mention `wrap_in_loop` | [3B] 6, 7, 12 | open |
| `save_as` on an inserted step ignored (only `label_steps` turns it into an output) | [3B] 5 | open |
| One `edit` capped at 30 operations: a batch refused, then re-sent cut in half, removing 30 steps | [1] issue 1 | **fixed** (cap 100, partial edits) |
| **`describe_step_screenshot` never called,** though nameless steps were marked (8 in A, 2 in B) | [2] D5, [3] | open (better: describe them in code before the first turn) |
| `read_recording` never called when the first message was cut | [3A] | open |

## D4 · The rules (`designViolations`)

**Logic, since PR #13:**
- **Never changes:** the goal (and how often it runs, when fixed).
- **Targets:** only recorded ones, never changed; a recorded click may become "open the page *it* opened".
- **New steps only read:** `fs.find`, `fs.read`, `data.pick`, `web.extract`, `web.wait_for`, a navigate to a visited site.
- **Files:** only in folders the recording touched; globs can't climb out.
- **Never added:** script steps.
- **Approvals** can't be switched off.
- **The first page** must still be opened.
- **Recorded steps may be removed or replaced** (the user reviews).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| **No rule kept the work:** B removed all 20 recorded steps; with new clicks not allowed, nothing could be rebuilt | [3B] D6, D8 | open: needs a `finish` check (D6) |
| No rule kept the work: [1] removed 30 of 35 | [1] issue 1 | fixed with a ban, then re-opened when the ban was dropped (PR #13) |
| Sites limited to recorded navigate steps (a page reached by a click couldn't be opened directly) | [1] issue 5 | **fixed** (`6d36349`) |

## D5 · Questions and the drill

**Logic.**
- **During:** `ask_user`, ≤ 5 questions, each naming the step its answer changes. Model-written questions first get the evidence check (PR #13).
- **After:** leftover open questions go to the drill, only where the agent left the answer's place untouched.
- **For unattended runs:** a default for each input with none.
- **Applying answers:** `applyAnswer` writes them at their `appliesTo` path; an answer about a new input creates it (`712d68d`).
- **Waiting:** questions wait in the inbox with no time limit.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Questions the form or narration already answered | [1] issue 3 | **fixed** (`cd27d49` + evidence check) |
| Answers that couldn't be applied (a new input) | [1] issue 4 | **fixed** (`712d68d`) |
| Asked for the sheet URL that the recording held; the answer unused; blocked the save for 7.7 min | [2] D2 | partly fixed (evidence check; no timeout yet) |
| All of the agent's own questions dropped by the `id` misuse | [3A] | open (D3) |

## D6 · Finish, honesty and the history

**Logic.**
- `finish` is refused only while `checks` report a problem: unattended inputs without defaults, and, since PR #13, "they said *daily* but it runs by hand".
- The history note is built from **what really changed** (comparing the plain list with the result, PR #13).
- The agent's own sentence is kept as `claimed` in `design.json`.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Summaries describing changes never made | [1], [2], [3] | **fixed for the history** (real changes); `claimed` still false in all three |
| **`finish` accepted a workflow that no longer does the task** (B: one `fs.find`) | [3B] | open |
| `finish` accepted with every stated rule unbuilt (A: 1 of 5 rules) | [3A] D4 | open |
| How often it runs, from "every day" | [3A] | ✅ working (PR #13) |

## D7 · Budget, cost, record-keeping

**Logic.** 16 turns, $0.10, no live actions, no time limit. The transcript records each call, result, refusal and invalid call. `design.json` keeps `claimed`, `changes`, `edits`, `usage` and the prompt.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| `thought` always empty: the model's reasoning isn't kept | [1], [2], [3] | open |
| **An invalid call's input isn't stored** (what A turns 5–7 tried is unknown) | [1], [3] | open |
| Near the cost cap in both [3] recordings ($0.085–0.086) | [3] | watch |
| Vision calls and (formerly) compile calls not metered | docs | open |

---

# Replay

## P1 · Start: inputs and the automation window

**What it does.**
- **Inputs** (`packages/player/src/node/inputs.ts`): a value given by the caller wins, then a file resolver (newest / all files matching the rule, checked against `accept` and size), then the default. Every value is checked against its type.
- **The automation window:** the extension opens (or reuses) **one dedicated automation window** and attaches `chrome.debugger` to it at the run's first step, bringing it to the front then (`replay.ts`). It detaches at `run.end`.

**Not handled.** Secret inputs from the Keychain (`TODO(player)` in `inputs.ts`).

**Problems seen.** None directly. The window is brought forward only at attach, which matters for P9.

## P2 · Navigation and tabs

**What it does.** `web.navigate` opens the URL with `Page.navigate` and waits for the load (`readyState` and the navigation's origin). Replay is **one tab**. Tab switches recorded in the trace become "open that page again" steps (§R9 `followTabs`), which reload the page.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| A paste ran on the wrong page because of one-tab replay | [2] R4 | **fixed** (`followTabs`) |
| Reloading the sheet before each paste loses the selected cell (a side effect of `followTabs`) | design | open (another reason for a "go to cell" step) |

## P3 · Finding targets (the matcher)

**What it does.** `packages/player/src/web/match.ts` scores every candidate on the page against the stored locator on three signals:

| Signal | Weight | How |
|---|---|---|
| Role + accessible name | 0.45 | Chrome's accessibility tree (`Accessibility.queryAXTree` by role, equivalent roles grouped), name similarity |
| Stored attributes | 0.25 | `[k="v"]` selectors; the share of attributes that match |
| Fallback selectors | 0.30 | each CSS/XPath fallback; the first weighted fully, later ones 0.7 |

Each candidate's score is divided by the weights *available* for that locator. The best is **found** at ≥ **0.5** and ≥ **0.15** ahead of the second; otherwise **ambiguous** or **none**. Matching polls until the step's timeout (10 s by default).

**Not used, by the code's own note:** `near`, `text`, `label`, frames, shadow roots.

**Consequences**
- **A locator with only `text`** (a container click) has nothing to score, so it's **never found** (it polls until timeout).
- **Two controls with the same role and name** (the YC logo link and title link, both "Eventual") **tie**, and `near` / `href` can't break the tie.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Container text targets never found | [2] P1, [3A] s5 | open |
| Same-name controls ambiguous (reproduced headless) | [2] P2 | open |
| Per-session id in `attrs` lowered the score below 0.5 (0.45) | [3A] s2 | open |

## P4 · Actions

**What it does.** `executor.ts`: optional `wait`, then match, then act like a person, then verify. Per action:
- **click:** scroll into view, check the point isn't covered (hit test), move, press, release;
- **type:** focus, optionally select all, **key by key** (so widgets that react to keyup stay in sync), then read the field back;
- **select:** the visible option;
- **press:** key down/up;
- **upload:** `DOM.setFileInputFiles` (no native dialog);
- **drag:** to the target's drop zone;
- **extract:**
  - text;
  - all matches through the first fallback;
  - a table's rows;
  - **a Google Sheet's rows** (its CSV export, with your cookies).

Mac-app steps go to Shadow.app's AX player (press, set value, menu, keys).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| No action to write to "the next empty row" of a sheet; writes go to a fixed cell | [1] issue 7, [2] R3, [3A] | open |
| `extract { source: google_sheet }` exists but no workflow used it to read what's already there | [1], [3A] turn 10 | open (agent tooling) |

## P5 · Variables, data and LLM steps

**What it does.**
- **References:** `{{name}}`, `{{name.field}}`, `{{today}}` are resolved before each step.
- **`data.pick`:** a rule over rows, no model; dates compare as dates (`{{today}}` matches `10/19/2026`).
- **LLM steps** (`llm-step.ts`): the fast profile, structured output of the step's type.
  - Capped at **3 calls per run** and 20k characters of input.
  - Cached by run date, instruction, type and data.

**Problems seen.** None directly; no recording has yet produced an LLM step that ran.

## P6 · Loops and branches

**What it does.**
- **Loops:** `max_items` (default 100), `on_item_fail: stop | skip`.
- **Branches:** conditions on variables.
- A resumed run goes back into the loop item it was in.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| No recorded workflow has produced a loop yet (all attempts failed in the design agent) | [1], [2], [3] | open (D3) |
| `on_item_fail: skip` never skips while recovery is on | docs | open |

## P7 · Checks, waits, success

**What it does.** `checks.ts`:
- `url_matches`: substring of `location.href`;
- `text_visible`: `document.body.innerText` contains it;
- `element_visible`: matched and has a box;
- polled until the timeout.

A step's `wait` must hold first; its `check` must hold after. The workflow's `success` checks run at the end.

**Not handled**
- **Text drawn on a canvas** isn't in `innerText`.
- **An empty `text_visible`** always holds.
- **A workflow with no success check succeeds whenever no step failed**, even if nothing was done.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Invented `success` text that never appears | [2] D3 | open |
| **"Succeeded" in 3 ms with nothing done** | [3B] | open |

## P8 · Approvals

**What it does.**
- **Before the step:** a step with `requires_approval` asks first; in the daemon the run then **waits** in the inbox.
- **During a repair try:** approval is forced on outward steps, and **nobody can answer during a try**.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Enter that posts a chat message isn't flagged as outward | [3B] | open |
| A repaired outward step (Submit) can't be proven, because tries can't get approval | docs | open |
| Typing into another site's document never needs approval | [1] issue 7 | open (decision) |

## P9 · The connection to Chrome (DevTools calls)

**What it does.**
- **The channel:** the daemon sends `run.step` / `page.op` / `run.check` to the extension, which runs them in the automation tab through `chrome.debugger` (`replay.ts` → `executor.ts` / `inspect.ts`).
- **Daemon timeouts:** `run.step` gets 3× the step's timeout + 20 s (50 s by default); `page.op` 50 s.
- **Since PR #13:** a stopped run lets go of the tab at once.

**Not handled: no timeout on a single DevTools call.** `cdp.send` waits for ever. If Chrome doesn't answer, the step holds until the daemon gives up.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| **Steps with a role hang** ("extension did not answer"), while the repair agent's page operations answer in ms. Seen with the automation window behind another window (the inbox [2]; a print window [3A]). Not reproducible headless | [2] X1, [3A] s7 | **open: the top replay fix** |

---

# Recovery

## X1 · Classify (no model)

**What it does.** `packages/player/src/repair/classify.ts`, first match wins:

| Class | When |
|---|---|
| transient | HTTP ≥ 500; network errors, timeouts, 429 |
| environment | login page or 401/403; Shadow.app not running; Accessibility not allowed; extension not connected; folder permission |
| nothing_to_do | `fs.find` found nothing |
| data | an LLM or data step failed; "should be / no row where / not a list" |
| drift | a web/ax step with "target not found / ambiguous / covered by / not visible / precondition…", or a failed check |
| unknown | anything else; goes straight to the agent, **skipping the ladder** |

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| A step that was never meaningful (a container click) is classed as **drift**, so it gets "repaired" | [3A] s5 | open |
| "extension did not answer" is `unknown` (it's the hang) | [3A] s7 | open |

## X2 · The cheap ladder (no model)

**What it does.** `ladder.ts` tries two rungs; each fix is tried on the live page for one step and kept only with evidence (X3):

| Rung | When it applies | What it does |
|---|---|---|
| Wait longer | the target wasn't there at all | double the timeout (at least 20 s) |
| Fuzzy match | web steps | retarget to the best visible candidate by name, if it scores ≥ 0.6 and leads the next by ≥ 0.2 |

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Fixed s2 (the per-session id) correctly | [3A] | ✅ |
| **Retargeted a container click onto "Print all" and committed it as v3** (the name was a prefix of the container's text) | [3A] s5 | **open, dangerous** |

## X3 · Trying a fix, and what counts as evidence

**What it does.** `verify.ts` (`tryDraft`): runs the draft on the live page from a step, for N steps, approvals forced on outward steps. **Evidence**, in order:
1. the last step's own `check` passed;
2. the last action was self-verifying (type, select, upload, extract, navigate);
3. the next step's `wait` holds, or its target is visible.

A click that didn't throw isn't evidence.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| "The next step's target is visible" was true after clicking **Print all**: evidence for a wrong fix | [3A] | open |
| A try may start after the failed step | docs | open |
| A waiting approval counted as one | docs | **fixed** (Oct 13) |

## X4 · The repair agent

**What it does.**
- **Model:** Nemotron 3 Super, given the **failure report**: step, error, match score, page signals, controls named like the target, page outline, last run events, site notes, workflow.
- **Tools:** up to 20: look (`page_outline`, `find`, `inspect`, `workflow`, `wait`, `describe_screen`, `recall`), probe (`click_safe`, `press`, `scroll`, `go_back`, `navigate`), edit (`retarget`, `edit`), `try_steps`, finish (`resolve`, `commit`, `escalate`), `note`.
- **Budget:** 12 turns, ≤ $0.10, 20 live actions; 2 episodes and $0.25 per run leg.
- **Commit:** only after a try with evidence.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Every try hung (P9); ran out of turns with the right idea | [2] X1, [3A] | open (P9) |
| `navigate` refused ("not a site this workflow uses (none)") after the design agent removed every navigate | [1] issue 8 | partly fixed (design must keep the first page) |
| Kept trying to fix a step that shouldn't exist, instead of saying "this workflow is wrong" | [2] X2 | open |
| Reasoning not kept; failure report rebuilt only once | docs | open |

## X5 · The repair rules (`repairViolations`, the guard)

**What it does.**
- **Never changed:** the trigger, the description, the user's values (args), LLM instructions, loops, asks, approvals.
- **No new** outward steps (except a confirm right after an outward step, with approval).
- **No scripts.**
- **No sites** beyond the workflow's navigate hosts.
- **Probes** may not act outward or on Never words.

**Problems seen.** None in the three reports beyond X4's site refusal.

## X6 · What the run does with the outcome

**What it does.**

| Outcome | What happens |
|---|---|
| commit | saved **at once** as the next version (`by: debug`); resume after the tried steps |
| transient | retried after 30 s, then 120 s |
| environment or escalate | the run waits in the inbox (retry / skip / stop) |
| data | fails |
| nothing_to_do | ends as nothing to do |

The run page now lists the repair's steps in plain words (PR #13), and a Stop button ends a running run (PR #13).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| **A wrong ladder fix saved without review** (v3, "Print all") | [3A] | open: review, or a stricter ladder |
| Per-run repair limits reset after every wait | docs | open |

---

## Appendix: problems by section, open only

| Section | Open problems |
|---|---|
| R1 web capture | selection clicks → containers; nameless links; canvas cells; stale page address in single-page apps |
| R3 Mac-app capture | nameless AX elements; macOS prompts recorded |
| R9 normalise | selection clicks kept; reading clicks kept; no "go to cell"; repetition not recognised |
| R10 first draft | text-only targets; Google ids kept; list position lost; typed dates literal; Enter-to-send not outward |
| D1 given | 40-step cut; tokens re-sent |
| D2 `label_steps` | invented checks; literal values |
| D3 tools | `id` misuse; edits as a string; wrap ops in `edit`; missing `type`; empty loop; `save_as`; screenshots unused |
| D4 rules | the work can be removed |
| D5 questions | no timeout |
| D6 finish | accepts a workflow that doesn't do the task |
| D7 record-keeping | no reasoning; invalid inputs not kept |
| P3 matcher | text and near unused; ties unbreakable; generated ids |
| P4 actions | no "append row" |
| P7 checks | false success; canvas text |
| P8 approvals | chat send not outward; outward repairs unprovable |
| P9 DevTools | no per-call timeout; window not in front |
| X1 classify | meaningless steps classed as drift; the hang classed unknown |
| X2 ladder | fuzzy match onto a prefix of container text |
| X3 evidence | "next target visible" proves too little |
| X4 repair agent | doesn't say "the workflow is wrong" |
| X6 outcome | commits without review |
