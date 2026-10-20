# Record and the design agent, section by section (Record v2): how each part is built now, and what still breaks

**Why this file.** [`section-study.md`](section-study.md) showed that the failures came from how some parts were
designed, not from a few loose ends. Branch `feat/record-v2` (PR #14) rebuilt those parts. This file goes through
the same sections again, as they are built now: the fundamental issues (§0), Record (R1–R10) and the design agent
(D1–D8). For each one:
- **What it does:** its flow, from input to output.
- **Logic and rules:** the decisions in the code.
- **Edge cases handled:** situations the code was written for.
- **Not handled:** limits by design.
- **Problems seen:** every failure from the reports and checks that traces to this section, and where it stands.

Replay and recovery (P, X) are not covered here; they are as in `section-study.md`, plus the few hooks record needed
(§0.4). What changed, commit by commit, is in [`record-v2-changes.md`](record-v2-changes.md). Code is as of
`feat/record-v2` at `16f313f` (Oct 20).

**What moved since `section-study.md`:**
- **R8** is now the one timeline and the evidence package the agent reads (`evidence.json`).
- **The design agent's sections follow its stages:** D2 is the task model, which replaces `label_steps`; D5, the safe
  test run, is new; so the old D5–D7 are now D6–D8.

**Sources for "problems seen":**
- **[1]** [`first-real-recording-yc-to-sheets.md`](first-real-recording-yc-to-sheets.md), Oct 14, YC → sheet
- **[2]** [`second-recording-yc-to-sheet.md`](second-recording-yc-to-sheet.md), Oct 15, YC → sheet again
- **[3]** [`oct19-two-recordings.md`](oct19-two-recordings.md), Oct 19: A, KPI email → sheet; B, Play Store → Chat
- **[4]** [`../testing/checkpoint-1.md`](../testing/checkpoint-1.md), Oct 20: the new capture checked live, in a test browser and in Rushil's Chrome (Sheets, Gmail)
- **[5]** [`../testing/checkpoint-2.md`](../testing/checkpoint-2.md), Oct 20: the evidence built from real recordings
- **[6]** [`../testing/checkpoint-3.md`](../testing/checkpoint-3.md), Oct 20: design agent v2 on the real model, four test recordings
- **[7]** the final code review of Plan 3, Oct 20 (its fixes: `7fc3bf8`..`77ebde9`)
- **[8]** the exploration of the code on Oct 19, in the spec ([`2026-10-19-record-v2-design.md`](../docs/superpowers/specs/2026-10-19-record-v2-design.md)): problems no report saw, numbered H1–H24

**Status marks:**
- **fixed (live):** seen working in a real recording or run;
- **fixed (tests):** built and tested, not yet seen live;
- **partly;**
- **open:** with its number in [`record-v2-changes.md` § Failures to fix](record-v2-changes.md#failures-to-fix), F1–F13.

---

## 0. The fundamental issues, now

The new shape:
1. **Capture** records facts completely.
2. **Code** works out everything it can know for certain, and prepares the generalisations.
3. **The agent** decides only what you meant.
4. **Code** checks the result.
5. **You** review it.

| # | Was (`section-study.md` §0) | Now | Where it stands |
|---|---|---|---|
| 1 | **A step is remembered by things that don't come back:** container text, Google's per-session ids, no list position, no sheet cell | Selections are their own event, so they are no longer container clicks. Google ids are dropped and link addresses kept. List position and the sheet cell are recorded. Nameless links get a name (§R1, §R10) | **partly**: capture fixed (live [4]). The replay matcher still doesn't use text, `near` or list position (F8, Akshat) |
| 2 | **Generalising is left to one model, with unreliable tools** | Code finds the patterns and prepares the change (proposals). The agent writes down what the task is, then accepts proposals by id with tools that forgive syntax slips (§R10, D2, D3) | **partly**: real runs [6]: timesheet and Play Store right; KPI built no loop (F2); YC lost half its calls to tool syntax (F3) |
| 3 | **Nothing checks that the result does the task** | A finish gate in code (D7), a safe test run in the automation window (D5), "nothing to do" for a run that did nothing, and a review with Looks right before Go live | **partly**: built and tested. The gate checks structure, not meaning (F2, F5), and takes the model's word on frequency (F1) |
| 4 | **Replay has no timeouts and one tab** | Every DevTools call times out (15 s, 30 s to navigate), and a hang counts as an environment problem. Steps can name the tab they run in | Timeouts **fixed (tests)**. Tabs **partly**: a run waiting for approval closes its named tabs (F6); the rule for steps without a tab is open (F7) |
| 5 | **What the agents did can't be reconstructed** | The model's reasoning, rejected calls' input, the full prompt, the task model, every change with its reason, the test report and the transcript are kept in `design.json` (D8) | **fixed (live)** [6] |

**What's left is judgement.** Code now catches structural mistakes: lost work, invented checks, missing approvals,
unvisited sites. What it can't catch is a model that misreads the task: "every month" written down as "by hand", or
"the newest email" built as "this email". Those are F1 and F2.

---

# Record

```
Record ─► capture, facts only: R1 web · R2 tabs · R3 Mac apps · R4 files · R5 pictures · R7 voice
Stop   ─► R6 read and mask the pictures  ║  R7 transcribe          (at the same time)
       ─► R9 normalise: events → steps; noise removed and listed (x1, x2…)
       ─► R10 first draft (code) + classes, data flow, proposals (p1, p2…)
       ─► R8 evidence.json: one timeline + everything above, ≤ 24k tokens
       ─► the design agent (D1–D8)
```

## R1 · Web capture (the extension's content script)

**What it does.** As before:
- `content.ts` runs `startCapture` (`capture.ts`) in every page and frame, in the capture phase;
- the background adds the tab, frame, id and session;
- the daemon appends to `recordings/<session>/trace.jsonl`.

**New:** each event now also carries:
- what it did (`effect`);
- where it sits in a list (`list`);
- its sheet cell (`cell`);
- the page's own address at that moment.

**What is recorded, per DOM event**

| DOM event | Trace event | Now |
|---|---|---|
| `pointerdown` → `click` | `click` | Described at `pointerdown`, sent at `click`. It carries a click id (`cid`), the click point, `list` and, when true, `drawn`, `newTab`, `synthetic` (the page clicked it, not you) |
| middle click (`auxclick`), ⌘/Ctrl-click | `click` with `newTab` | **new** |
| a drag of 10 px or more, or a double or triple click, that leaves text selected | **`select_text`** | **new.** It holds the selected text and is never taken from a secret field. The click the browser fires after it isn't recorded |
| `input` / `change` / `focusout` | `type` | One per field, with its final value. Sent on change, focusout, Enter, Escape, Tab or a shortcut. An unchanged value isn't sent again |
| `change` on `<select>` / checkbox / file input | `select` / `check` / `file` | As before. A file never has a path |
| `keydown` | `key` | Enter and Escape as before, **plus shortcuts and single keys** (rules below) |
| `paste` | `paste`, then `type` with `pasted: true` | The pasted value is never stored |
| `copy` | `copy` | **New:** `via` keyboard, menu or button. At most 2,000 characters. In a sheet, its row comes from the cell |
| a page's own Copy button (`navigator.clipboard.writeText`) | `copy` `via: "button"` | **new:** a small script in the page reports it (`clipboard-hook.ts`) |
| pointer drag / HTML5 drag, `submit`, `drop` | `drag` / `submit` / `drop` | As before. A drag's `to` is the nearest named drop area |
| 700 ms after a click, Enter or ⌘Enter | **`effect`** `{of: cid}` | **new:** what the action did (below) |
| background: page loads, route changes, downloads | `navigate` (with `transition`, `back`) / `download` | `back` is **new** |

**Logic and rules**
- **What a click did** (`effect.ts`):
  - **How long:** the page is watched for 700 ms after the click (from `pointerdown`).
  - **What counts:** only changes **near the target**: inside its dialog, main, article, section, list item, row or form, or in a live region.
  - **The page's own churn is subtracted.** Changes in the 700 ms *before* the click are counted, and only the extra changes count. Gmail re-renders all the time.
  - **`changed`:**
    - `large`: more than 25 extra changes;
    - `small`: more than 2, or a new status or alert line;
    - otherwise `none`.
  - **`navigated`:** the address changed.
  - **`expanded`:** `aria-expanded` or `<details>` went from closed to open.
  - **`opened`:** a dialog, menu or listbox was added.
  - **`emptied`:** the field had text and is now blank. This is how an Enter that sends a chat message is told apart.
- **List position** (`describe.ts`):
  - **The rule:** a click or copy inside one of **3 or more siblings of the same shape** records `list {container, index, count, itemText}`.
  - **How far up:** at most 6 levels.
  - **Never items:** table cells, paragraphs, spans, headings, labels, page sections.
  - **Shape:**
    - list roles (listitem, row, article, option…) compare tag and role only. Gmail adds a hover class to the row under the pointer, and comparing classes broke it;
    - other elements compare tag, stable classes and role.
- **Names for nameless controls:**
  - **When:** only for controls (link, button, tab, option…) whose accessible name is empty.
  - **Where the name comes from, in order:**
    1. the title;
    2. an image's alt text;
    3. a heading inside;
    4. a heading in its card, up to 3 levels up;
    5. its own text;
    6. the last part of its address.
  - **Stored as** `seenAs` and `seenFrom`, at most 80 characters.
- **Generated ids (`GENERATED`)**, dropped wherever they appear: 4+ digits, 8+ hex characters, React's `:r1:`, **Google's `:1g` and `19fml5:17`** (new), and the ember, react, mui, radix and headlessui prefixes.
  - **Where it's applied:** attributes, id and name selectors, and the classes used for list shapes. Not aria-labels or test ids.
  - **A link's `href` is kept** (up to 300 characters), with `hrefShape`: every word with a digit in it becomes `*`.
- **Keys** (`keys.ts`). **Never a keylogger:**
  - **A shortcut:** ⌘, Ctrl or Option held. Shift alone doesn't count. A character typed with Option is typing, not a shortcut. ⌘ or Ctrl plus A, C, V, X, Z or Y isn't a step.
  - **A single key** (Gmail's `e` to archive): a printable key with no modifier, pressed outside any field.
    - Each one is held for 1 s.
    - A third key within that second means you're typing: all of them are dropped, and the typing window grows by 1 s with each key.
    - None at all are recorded on Google Sheets, Docs or Slides, which draw their own text.
  - **Not recorded:**
    - Tab, ever;
    - Enter on a button or link (it fires a click), in a textarea, or Shift+Enter in a field.
- **Google Sheets** (`adapters/google-sheets.ts`). A sheet is a page under `docs.google.com/spreadsheets/d/`.
  - **What's read:**
    - the Name Box (`#t-name-box`), which gives the cell, for example `B3`;
    - the formula bar (`#t-formula-bar-input`), which gives the value, at most 500 characters;
    - the active sheet tab's name.
  - **When:**
    - 150 ms after a click on a cell, so the Name Box has updated;
    - on the first input into a field;
    - on a paste;
    - on a copy.
  - **A copy's row:** the sheet's CSV export (≤ 500,000 characters) gives the header and the row, and the row is taken **from the cell**, not from "the first cell with the same text".
- **The page's address** is `location.href` at the moment of the event. The background's `sender.url`, which in single-page apps stays at the first address, is only a fallback.
- **Click point:**
  - **What's kept:** x, y, the device pixel ratio and the element's box, top frame only.
  - **Evidence only:** it picks the screen words around the click (§R8). Locators never use positions.
- **Secrets:** as before, `isSecret` covers inputs only: password, card or one-time-code autocomplete, or a name like `pass|otp|cvv|secret|token|pin`.
  - **New:** no `select_text` from a secret field.
  - **New:** shortcuts pressed in a secret field are dropped.
  - **New:** a Copy-button copy from a secret field is dropped.

**Edge cases handled**
- Gmail's background re-rendering: a click on an email's header reads `none` [4].
- Gmail's hover class on the row under the pointer (`99a0bf7`) [4].
- The same word in two sheet cells: a copy of B8 "Female" kept row 8, though B2 also holds "Female" [4].
- Clicks the page makes itself (GitHub's `g i` clicks the Issues tab): marked `synthetic`.
- Escape on a menu's button [4].
- As before: re-rendering pages, implicit submit by Enter, label → control, shadow roots.

**Not handled**
- **Keys:** Shift plus a printable key outside a field (`?`, `#`) is never recorded.
- **Middle click:** it has no click point, no effect watch and no sheet cell.
- **Not events at all:** right clicks, hover and scrolling.
- **`back`:** it also marks Forward, and a single-page app's own history changes never set it.
- **Effect blind spots:**
  - a menu shown by toggling an attribute (not added) isn't "opened";
  - only closed → open expansions count;
  - the first action on a page has no "before" to compare with.
- **Secrets:** a textarea or a rich-text editor is never treated as secret.
- **Pasted fields:** a field that was pasted into and then edited is still sent without a value.
- **Multi-select:** it records its first chosen option only.
- **Shadow roots:** no XPath is built inside them.
- **Copy buttons:** the hook covers `writeText`, not `clipboard.write`.
- **Google Sheets:** the element ids were checked live once [4], and Google can change them.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Clicks made to **select text before copying** became steps on containers | [2] R1, [3A] | **fixed (live)** [4]: `select_text` (`01fa7cd`). With the copy it becomes one read step (§R9) |
| A **link with no name** recorded as `link:''` | [2] R2 | **fixed (live)** [4]: the YC card is named from its heading (`75884dc`) |
| **Sheet cell clicks** had no target | [2] R3, [3A] | **fixed (live)** [4]: clicks, typing, pastes and copies carry their cell (`54696a6`, `4ec5c1e`) |
| **Stale page address** in single-page apps | [3B] R1 | **fixed (tests)** (`ad0dc07`): Play Console not recorded again |
| What a click did wasn't recorded | [8] | **fixed (live)** [4] (`b6740ee`) |
| Shortcuts and single keys lost (H16) | [8] | **fixed (live)** [4]: `k`, `g`, `i` recorded; "hello" typed outside a field recorded nothing (`6394b10`) |
| A page's own Copy button lost (H15) | [8] | **fixed (live)** [4]: GitHub (`ab77c72`) |
| ⌘-click and middle-click lost (H17) | [8] | **fixed (tests)** |
| Found live: Gmail's hovered row wasn't part of its list; a "Saved" status line read as no change; a link in a table cell was "item 0 of 4 cells"; paragraphs counted as a list; names borrowed from far away ("Table", "Contents") | [4] | **fixed (live)** [4] (`99a0bf7`, `2754463`, `4ec5c1e`, `e2bdf00`) |

**Where:** `apps/extension/src/capture.ts`, `describe.ts`, `effect.ts`, `keys.ts`, `clipboard-hook.ts`, `content.ts`,
`background.ts`, `adapters/google-sheets.ts`; `packages/core/src/trace.ts`, `descriptor.ts`.

---

## R2 · Tab capture

**What it does.** The background records:
- **At Record:** every open tab is noted (address, title, opener, window), but not recorded yet.
- **`tab_open` with `preexisting: true`** for a tab that was open before Record. It's sent just before that tab's first
  event, so only tabs you used appear. **New.**
- **`tab_open`** for a new tab (address, opener), **`tab_close`**, and **`tab_switch`** (with its address).
- **`window_focus`** when you move to another Chrome window, with that window's active tab. **New.**
- **`navigate`** for each page load and route change.

**Logic and rules**
- **Automation tabs** (replay's own) are left out entirely:
  - every event from a tab in replay's tab map is dropped, even its close;
  - no Shadow button, no script and no picture in them.
- **Tab names come later, in code (§R8):**
  - from the page: "KPI Sheet", "Gmail", at most 40 characters;
  - two tabs with the same name are numbered.
- **What counts as a switch is decided in §R9:**
  - switches with nothing done between them become noise;
  - a switch followed by an action becomes "go to tab X".
- **Replay side, built for record:**
  - a workflow step may name its tab (`step.tab`), and the automation window keeps one tab per name (`tab-map.ts`);
  - code doesn't name tabs on recorded steps; the agent does (D3).

**Not handled**
- A tab opened during the recording gets no title, only its address.
- After the extension's background restarts, it doesn't know the automation tabs until it reloads its tab map. Events
  from them can be recorded in between.
- A tab moved to another window, or replaced by Chrome (prerender), isn't followed.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Switches weren't recorded | [2] R4 | fixed before this branch (PR #13); seen in [3A] (×10), [3B] (×2) |
| Switching Chrome windows not recorded (H18) | [8] | **fixed (tests)** (`ad0dc07`) |
| A tab open before Record had no known address | [8] | **fixed (live)** [4] (`a2c8081`) |
| Replay rebuilt every switch by reloading the page | [2], [3] | **partly:** named tabs are built. A run waiting for approval closes them (F6). The rule for a step with no tab is open (F7) |
| After a click that opened a new tab, replay ran the next steps in the old tab | [4] | **partly:** the click is linked to its tab (`opensTab`, §R9); replay uses it only if the agent names the tab |

**Where:** `apps/extension/src/background.ts`, `tab-registry.ts`, `replay.ts`, `tab-map.ts`; `packages/recorder/src/evidence/tabs.ts`.

---

## R3 · Mac-app capture (Shadow.app, Accessibility)

**What it does.** As before:
- passive global monitors between `record.start` and `record.stop`;
- `app_activate`, `app_click` (**new:** `button: "right"` for a right click), `app_type`, `app_key` and `app_menu`.

**Logic and rules**
- **Accessibility:**
  - **needed:** without it, nothing is recorded;
  - each call times out after 0.5 s;
  - Electron apps are asked to expose their controls (`AXManualAccessibility`).
- **Never recorded (`neverRecorded`):**
  - password managers, `SecurityAgent`, `loginwindow`;
  - **new:** macOS's own prompts, `universalAccessAuthWarn` and `UserNotificationCenter`;
  - terminals, Finder (its files come from §R4) and Chrome (the extension records it);
  - Shadow itself.
- **System Settings (new):** a click is dropped when its window title contains "Privacy".
- **Clicks:**
  - the click goes to the nearest actionable ancestor, up to 6 levels up;
  - a click that only opens a menu-bar menu is skipped; the chosen item is the step (`app_menu`, with its path).
- **Keys** (characters are never recorded):
  - **always `app_key`:** shortcuts with ⌘, Ctrl or Option (plus Shift), and Return, Escape, Up, Down, PageUp, PageDown;
  - **inside a field:**
    - ⌘V marks the field as pasted, so its value isn't kept;
    - ⌘A, C, X and Z aren't steps;
    - Delete, Left, Right, Home and End are typing;
    - Tab only ends the typing.
- **Typing:**
  - the field's value is read 50 ms after each key, and the last read wins;
  - `AXSecureTextField` is never read;
  - a value over 2,000 characters is marked `long`.
- **Move to Trash (new):**
  - Finder's "Move to Trash" menu item becomes `app_menu`, and ⌘⌫ in Finder becomes `app_key`;
  - §R9 pairs either with the file that vanished.
- **Permissions:**
  - Accessibility is checked every 2 s; if it changes mid-recording, the recorder restarts;
  - at Record, Shadow.app asks for Screen Recording if Pictures is on and it isn't granted yet. It doesn't check the
    answer.

**Not handled**
- **System Settings:** the Privacy skip covers clicks only. Keys, typing and app switches in it are still recorded.
- **Languages:** "Privacy" and "Move to Trash" are matched in English only.
- **Trash:** the toolbar's Trash button, dragging to the Dock's Trash and ⌥⌘⌫ (delete at once) aren't recorded.
- **Nameless elements:**
  - nameless windows, groups, scroll areas, split groups, layout areas, menu bars and unknowns are dropped in §R9 without
    a noise line;
  - other nameless ones (a Numbers cell) are kept with only their role, path and nearby text.
- **No permission check at Record:**
  - `record-control.ts` checks none itself;
  - the Record screen only warns when Pictures is on and pictures can't be read;
  - Accessibility is shown in Health.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Numbers clicks recorded as nameless `AXScrollArea` | [3B] R3 | **open** (F11): captions describe them when Pictures is on |
| **Shadow's own permission prompt and System Settings recorded as steps** | [3B] trace 16–30 | **fixed (tests)** (`0c38bf6`): needs your `pnpm setup:mac` to see live |
| "Permissions are checked when you press Record" (spec 1.13) | spec | **partly:** Shadow.app asks for Screen Recording at Record, and the Record screen warns when pictures can't be read |

**Where:** `apps/mac/Sources/Recorder.swift`, `AX.swift`, `main.swift`; `apps/daemon/src/record-control.ts`.

---

## R4 · File capture (the daemon's folder watcher)

**What it does.** As before:
- `fs-watch.ts` watches your home folder recursively (or `SHADOW_WATCH_DIRS`);
- it batches what it sees, 700 ms after things go quiet;
- it classifies each batch into `fs_create`, `fs_move`, `fs_rename` and, **new**, `fs_remove`.

Downloads come from the extension. A picked or dropped file is found on disk by `locate-file.ts`.

**Logic and rules**
- **Temporary files:** a file that appeared and vanished in one batch is ignored.
- **Move or rename:**
  - a vanished file and a new one are paired by inode or name: in the same folder it's a rename, elsewhere a move;
  - a file never seen before is a rename only if its folder has exactly one unpaired vanish and no other new file.
- **A vanish with no pair** is `fs_remove` (new).
- **Move to Trash (new):**
  - an `fs_remove` within 5 s after Finder's Move to Trash (§R3) becomes a move to `~/.Trash/<name>`, marked `trashed`;
  - it always needs your approval (`guard.ts`).
- **Ignored:**
  - hidden files, `.crdownload`, `.part`, `.tmp` and `.swp`;
  - `node_modules`;
  - `~/Library`, except cloud folders;
  - Shadow's own data folder;
  - content changes, and a file rewritten in place (same inode).
- **Finding a picked file** (`locate-file.ts`):
  1. Spotlight, for 5 s;
  2. then a walk 3 levels deep, up to 20,000 entries;
  3. it must have the same name and size; the closest date wins.

**Not handled**
- **Inodes:** files that existed before Record are known only in the watched folders' top level. Deeper ones pair by name
  only.
- **Moves:** a move between two watched folders isn't paired.
- **Folders:** creating, moving or renaming a folder isn't a step.
- **Trash pairing:**
  - after a Move to Trash, every file that vanishes within 5 s counts as trashed, even one removed another way;
  - Trash on an external drive isn't recorded.
- **Other deletions:** a file deleted without Move to Trash (by an app or a terminal) is neither a step nor listed as left
  out.
- **Content edits.**

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Deletions weren't recorded (K3) | [8] | **fixed (tests)** (`0c38bf6`): needs `pnpm setup:mac` |
| [3B]'s download, file arrival and drop | [3B] | ✅ captured correctly (unchanged) |

**Where:** `apps/daemon/src/fs-watch.ts`, `locate-file.ts`; `packages/recorder/src/normalise.ts` (Trash pairing);
`packages/core/src/guard.ts`.

---

## R5 · Screenshots: capture

**What it does.** With Screen on, a picture is taken after a click, type, select, check, file, drop, submit, key, copy
or navigate, and, **new**, after `select_text` and `tab_switch`.
- **Web:**
  - the visible tab, as a JPEG at quality 60;
  - taken 400 ms after the event, or 1.2 s after a navigation or tab switch.
- **Mac apps:** Shadow.app pictures the front window (never its own), at most one every 0.7 s.

**Logic and rules**
- **A queue instead of "the newest replaces the waiting one"** (`shot-queue.ts`, new):
  - up to 3 pictures wait;
  - when the queue is full, the least telling one is dropped, oldest first; it can be the new one;
  - **how telling:** copy and select_text, then click, type, select and check, then file, drop, submit and key, then
    navigate and tab switch;
  - pictures are taken oldest first, at least 600 ms apart.
- **A click that opens a tab** is pictured through that tab's `tab_switch`, when it shows.
- **The ledger (new), `shots.jsonl`.** Every web event that should get a picture gets a line:
  - `taken`;
  - or skipped, with why:
    - `private`: a secret event, or a password field has focus;
    - `tab-hidden`: the tab isn't in front;
    - `rate-limit`: dropped from the full queue;
    - `error`: the capture failed;
    - `stopped`: still waiting at Stop;
  - the daemon adds `no-tools` (Shadow.app can't read pictures, so the file is deleted) and `deleted` (reading or masking
    failed).
- **Fields blacked out at capture:**
  - which: password fields, card fields (`autocomplete="cc-…"`) and anything marked `data-shadow-private`;
  - only fields in view, at most 50, top frame only.
- **The Record screen warns before recording** when Shadow.app can't read or mask pictures (`screenReady`, §R6).
- **Storage:** pictures are saved as `shots/<event>.jpg`, readable only by you (0600).

**Not handled**
- **No ledger line for:**
  - an automation tab;
  - no open session or no Screen consent;
  - any Mac picture skipped or failed.
- **No picture for:** paste, drag, tab open or close, window focus and downloads.
- **Black-out gaps:**
  - none in iframes;
  - boxes are measured at the event, but the picture is taken 400–1,200 ms later, so a field that moved isn't covered;
  - fewer fields are blacked out than `isSecret` covers: no one-time codes and no names like `token`.
- **Only the visible part** of the tab is pictured.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Every picture discarded (binary detection) | pre-[1] | fixed (Oct 14) |
| A burst of events lost pictures: the newest replaced the waiting one (H14) | [8] | **fixed (live)** [4] (`c820e9a`) |
| **Pictures lost silently**: one log line, "screenshots aren't taken" | [8] | **fixed (live)** [4]: a ledger line per event (`c820e9a`, `c9f6248`) |
| A click that opens a new tab had no picture (the tab hides 25 ms later) | [4] | **fixed (tests)**: pictured on the new tab's switch |

**Where:** `apps/extension/src/background.ts`, `shot-queue.ts`, `shot.ts`; `apps/daemon/src/screen.ts`;
`packages/core/src/messages.ts`; `apps/mac/Sources/main.swift`.

---

## R6 · Screenshots: reading and masking

**What it does.** For each picture, `apps/daemon/src/screen.ts`, one at a time:
1. saves it to `shots/<event>.jpg`. If Shadow.app can't read pictures, it deletes it and writes `no-tools`;
2. runs `Shadow --ocr` (Apple Vision, up to 120 s), which gives lines with boxes;
3. masks the lines (`mask.ts`) with your Never and **Private words** and the patterns;
4. runs `Shadow --redact` (up to 60 s), which blacks out masked lines and the fields from §R5 in place, with 4 px to
   spare;
5. appends a row to `screen.jsonl`: the event, when the picture was taken, the tab, and **each line with its box**, up
   to **8,000 characters** per picture. It was 2,000, with no boxes;
6. writes `taken`, or `deleted` with why, to the ledger.

Only `screen.jsonl` (and captions, §R8) reaches a model.

**Logic and rules (masking, in order)**
1. **Never and Private words:** 3+ characters, whole words.
   - **Private words (new):** an optional folded line under the goal box, at most 30 words.
   - **Why:** the form has no Never field before recording any more, so this keeps masking your own words.
2. Emails.
3. JWTs and known key prefixes (`sk-`, `ghp_`, `xox…`, `AKIA…`, `AIza…`).
4. Any mixed letter-digit run of 32+ characters.
5. IBANs.
6. Card numbers (Luhn-checked).
7. Phone numbers.

- **No unmasked pictures:** a picture that can't be read or masked is deleted, never kept unmasked.
- **`screenReady`:** Shadow.app's binary can read and black out pictures. It's worked out once, when the daemon starts.
- **Masked again later:** everything the agent reads is masked again (D1).

**Not handled**
- **`screenReady` isn't checked again:** after Shadow.app is fixed, the daemon must restart.
- **Mac pictures:** no fields are blacked out, only masked lines.
- **Words that aren't masked:**
  - Private words shorter than 3 characters;
  - words whose edge isn't a letter or digit (`C++`, `@team`).
- **Private words** aren't filled in again on the next recording.
- **Late pictures:** ones arriving more than 500 ms after Stop are dropped.
- **Free text:** names, addresses and other private details aren't masked; only the patterns and your words are.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Words cut to a few lines; the lower part of long pages lost (H20) | [8] | **fixed (live)** [4], [5]: boxes, 8,000 characters (`c9f6248`) |
| Words "near the click" picked by text match | [8] | **fixed (live)** [5]: picked by position (§R8, `4357d2f`) |
| No Never field on the new Record form | spec decision | **fixed (tests)**: Private words (`c9f6248`) |
| Masking held in every recording (an email masked in [3A]) | [3] | ✅ |

**Where:** `apps/daemon/src/screen.ts`, `main.ts`; `packages/recorder/src/mask.ts`; `apps/ui/src/screens/Record.tsx`
(Private words); `apps/mac/Sources/Screen.swift`.

---

## R7 · Narration: recording and transcription

**What it does.** As before:
- Shadow.app records `voice.m4a`;
- after Stop, `Shadow --transcribe` (SpeechAnalyzer, on the Mac, up to 300 s) gives timed segments;
- the segments are masked and written to `transcript.jsonl` (0600).

**New:**
- transcription runs **at the same time** as picture reading (`main.ts`), so Stop is faster;
- a transcript that already exists is reused.

**Not handled.** As before: older macOS, languages without a model, crosstalk. Mishearings reach the agent as said.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Stop was slow: transcription waited for the pictures | [8] | **fixed (tests)** (`c9f6248`) |
| Narration silently skipped (binary detection) | pre-[1] | fixed |
| Mishearings ("tickets resort") | [3A] | accept |

**Where:** `apps/mac/Sources/Voice.swift`; `apps/daemon/src/voice.ts`, `main.ts`.

---

## R8 · Alignment: one timeline, and what the agent reads (`evidence.json`)

**What it does.** It replaces `narration.ts`'s two lists (`narrationOf`, `notesByStep`); both are now used only by tests.
- **`buildEvidence`** writes `evidence.json` in the recording folder: the design agent's only input.
- **`evidenceText`** turns it into the text stage 1 reads (D1).

It holds:
- the goal, the switches and the tabs (each tab's name, its first address, and whether it was open before Record);
- **one timeline:**
  - in time order, `mm:ss` from the start;
  - **step lines in the draft's own ids:** `s5 [tab] class: what`;
  - what you said (up to 300 characters a line);
  - left-out steps, with their x ids;
- for each step:
  - its pictures;
  - the words near the click;
  - what appeared after it;
  - its caption;
- the data flow, the proposals and the left-out steps (§R9, §R10).

From the KPI test recording (`pnpm evidence fixtures/recordings/kpi-email-to-sheet`, no model):
```
00:13  said: "I always take the newest one, and never one I already did."
00:15  s4 [mail.google.com] reveal: click div "Print allIn new windowDaily KPIs - w/c 19 Oct"
        weak target: found only by its text: a list item or a read is safer
00:16  s5 [mail.google.com] read: copy "Daily KPIs - w/c 19 Oct" from heading "Daily KPIs - w/c 19 Oct"
00:19  (left out x1) clicked the drawn grid: a click on a drawn grid: its cell goes with the copy or typing after it
00:21  s6 [docs.google.com] go: open docs.google.com/spreadsheets/d/SHEET-ID/edit#gid=0
00:21  s7 [docs.google.com] act: type (the copied text) into textbox ""
...
p1 date: s12 types "19 Oct", the day it was recorded: {{today|D MMM}} next time [change ready]
Where values go: s5 → s7 pasted "Daily KPIs - w/c 19 Oct"; s9 → s11 pasted "4,928"
```

**Logic and rules**
- **One set of ids everywhere:** the timeline, proposals, questions and the agent's tools all use s1, s2… (H12).
- **Pictures go to steps by event id,** using the time the picture was **taken**, not the event's time.
  - **Before:** the previous picture of the same tab. When there is none, the step's own first picture.
  - **After:** its own.
- **Words near the click:**
  - lines within 150 px of the click point, nearest first, at most 6, each at most 120 characters;
  - with no click point, lines that match the target's name.
- **What appeared:**
  - lines in "after" that weren't in "before", at most 12;
  - never Shadow's own Stop pill, never a fully blacked-out line;
  - **only these may become checks** (D7).
- **Captions**, only with Pictures on and a picture model set:
  - the "before" picture (else "after"), cropped to 900×600 around the click;
  - asked in at most 40 words what was acted on;
  - kept to 200 characters;
  - cached by picture and question;
  - counted on the design's budget (D8).
- **Size cap: 24k tokens** (characters ÷ 4). When it's over, the evidence is cut in levels, in this order:
  1. reveal steps lose their nearby words and caption;
  2. every step loses its nearby words;
  3. every step loses its caption;
  4. "appeared" is cut to 3 lines;
  5. go and reveal steps lose "appeared".

  The timeline, proposals, data flow and weak-target notes are never cut.
- **Untrusted:** what appeared, the nearby words and captions are wrapped in `<untrusted_data>`.
- **Masked:** tab names, step texts, left-out steps, data-flow values, proposals, what you said and the timeline.

**Not handled**
- **Mac steps** accept pictures from any tab, since they have no tab.
- **Scrolling:** lines that only came into view by scrolling count as "appeared" [5]. They're harmless as check text
  but make the evidence longer.
- **Crop files** are deleted only when the daemon next starts.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| "said over steps 4–5" counted different numbers than the draft the agent edits (H12) | [8] | **fixed (live)** [5] (`dfcf082`) |
| Screen words landed on the wrong step (1 s of grace) (H13) | [8] | **fixed (live)** [5] (`e642724`) |
| Pictures ordered by event, not when taken: "Saved amount" appeared on the typing step | [5] | **fixed (live)** (`e642724`) |
| A caption guessed an outcome ("nothing was saved") | [5] | **fixed (live)** (`9ed8752`): it describes what was acted on |
| A caption came back cut ("This is a"): 400-token cap with a reasoning model | [5] | **open** (Akshat, `vision.ts`) |

**Where:** `packages/recorder/src/evidence/evidence.ts`, `timeline.ts`, `screens.ts`, `captions.ts`, `tabs.ts`;
`apps/daemon/src/describe.ts`.

---

## R9 · Normalise: events → steps by what they did

**What it does.** `normaliseAll` (`normalise.ts`) sorts the trace and folds events into steps.
- **New:** it returns `{ steps, noise }`. What isn't a step is **listed with a reason**, not dropped silently.
- Then, as before, it runs `addStartingPage` and `followTabs`.

Each step now also keeps:
- `effect`, `list`, `cell` and its click point (from §R1);
- `opensTab`, `back`, `sends` and `trashed`;
- `modifiers` for a key.

**Logic and rules**
- **Merges** (as before):
  - a navigation within 3 s of a click or Enter belongs to it;
  - redirects and reloads fold into the navigation;
  - the same target clicked within 600 ms is one click;
  - a button click within 100 ms of Enter is the Enter;
  - a focus click is absorbed into the typing.
- **A click and the tab it opened:** a tab opened within 2 s, naming this tab as its opener (`opensTab`).
- **Keys** become `press` steps only for Enter, Escape and shortcuts, with their modifiers.
- **Sends:** an Enter that emptied its field, or ⌘/Ctrl+Enter, marks `sends`. It isn't a send in Google's editors, where
  Enter only moves to the next cell.
- **Read:** a selection plus a copy within 10 s is **one read step** on the copied element.
- **Move to Trash pairing:** see §R4.
- **Noise:** each piece gets an id (x1, x2…) and one of these reasons, word for word:
  - `selected`: "selected text but didn't copy it";
  - `quiet`: "changed nothing on the page, and nothing was copied from it";
  - `switched`: "switched to a tab and away again without doing anything there";
  - `afterKeys`: "the page clicked it after the keys you pressed";
  - `byPage`: "the page's own code clicked it, not you";
  - `drawn`: "a click on a drawn grid: its cell goes with the copy or typing after it";
  - `focus`: "only put the cursor in a field: the typing after it is the step";
  - `nameless`: "nothing to find it by again".
- **When a click is *not* quiet.** Any one of these keeps it:
  - its effect changed something or navigated;
  - it navigated, submitted, checked, opened a tab or produced a file;
  - its role acts (button, link, tab…);
  - a short name (≤ 20 characters) holds an action word;
  - the next step came within 700 ms, too soon to tell.
- **What the agent can put back:** only drawn, quiet, focus and nameless noise (`restore`, D3).

**Not handled**
- **Still dropped with no noise line:**
  - pages replay can't open (`chrome://`);
  - a copy from a secret field;
  - keys that aren't Enter, Escape or a shortcut;
  - a drop with no files;
  - file removals without a Move to Trash;
  - nameless Mac containers.
- **Clicks made to read** (expanding an email) stay steps. They're classed `reveal`, and the agent decides.
- **Repeats** that differ by one step aren't found (§R10).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| **Selection clicks before a copy kept as steps** | [2] R1, [3A] | **fixed (live)** [5] (`9b64352`) |
| Noise kept: double clicks, clicks on sections, 14 repeated navigations | [1] | **fixed (live)** [5]: removed and listed (`9b64352`, `8996923`) |
| Clicks to read kept as steps | study R9 | **partly:** classed `reveal`; the agent decides |
| No "go to cell" before typing in a sheet | [2] R3, [3A] | **partly:** the cell is recorded; replay can't write to a cell yet (F9) |
| Repetition not recognised | study R9 | **partly:** proposed in §R10, but not when the groups differ [5] |
| The Drive detour kept | [1], [2] R5 | **fixed (tests):** an "open directly" proposal |
| Back recorded as a typed address; page clicks after keys became steps | [4] | **fixed (tests):** `back`; `afterKeys` noise |

**Where:** `packages/recorder/src/normalise.ts`.

---

## R10 · The first draft and the proposals (code)

**What it does.** Two parts, both code only:
1. **`compile`** turns the steps into the first draft: targets, values, checks, approvals and code's questions
   (`skeleton.ts`, `locator.ts`, `approvals.ts`). **The old model path in `compile.ts` is removed**: it returns
   `model: "none"`.
2. **`buildEvidence`** then:
   - classes each step;
   - finds where values go;
   - prepares the **proposals**: the generalisations, each with its evidence and the change ready to apply.

**Code proposes, the agent decides, code checks.** No proposal is applied by code.

**Classes** (`classes.ts`):
- **`go`:** a navigation, an app opened, or a click or key that navigated or opened a tab. A link click with no recorded
  effect also counts.
- **`act`:** a submit, a check, a send, any key, or a click on a button-like role.
- **`reveal`:** a click that expanded or opened something, or any other click.
- **`read`:** a copy.

**Data flow** (`flow.ts`):
- `pasted`: a copy, then a paste;
- `typed`: copied text typed again (3+ characters);
- `used`: a read value used later.

**Proposals** (`proposals.ts`), found in this order:

| Proposal | Found when | The change it prepares |
|---|---|---|
| `date` | A typed or pasted value equals the recording day, the day before, or the week's Monday, in one of 17 formats | `{{today\|D MMM}}`, `{{today-1}}` or `{{week_start}}`, in the format you typed |
| `open_directly` | 2+ go steps ending on a page used later, with a known address; never swallowing a pick from a list | "open <page>" in place of the chain |
| `list_item` | A click or copy on item k of a content list: 3+ items, not page chrome, list text 20+ characters | "item k" / "the first" / by its text |
| `repeat` | Groups of up to 6 steps with the same shape, differing only by item, row or value | a loop; the body is the first group |
| `next_empty_row` | A sheet write on the first empty row | **a note only** (`runnable: false`): replay can't write there yet (F9) |
| `all_files` | Several files of the same pattern used | `pick: all` |
| `constant` | Said or written as fixed ("always NX-202"), 2–40 characters | keep it literal, no question |

**Logic and rules (the draft)**
- **Targets** (`locator.ts`), as before:
  - role, name, label, text, nearby heading, attributes, and echo-verified fallbacks;
  - **new:** Google's per-session ids are gone (§R1);
  - **new:** a nameless click that remains is marked **"weak target"** for the agent.
- **A link that went where it points** becomes "open that address", as before.
- **Code's questions:**
  - **the kinds:**
    - `row-`: which row (today's, or always this one);
    - `paste-`;
    - `file-`: ask me each time / the newest / always this file;
    - `app-text-`;
    - `dir-`: where files arrive;
  - questions the form already answers are dropped (`FORM_PATHS`);
  - **new:** questions the recording answers are answered by code (`answers.ts`) and never reach you (H2).
- **Approvals by code** (`requireApprovals`):
  - **which steps:** words like send, submit, pay, delete or post; **`sends`** (new); ⌘Delete in Finder and moves to the
    Trash (new); anything matching Never;
  - **uploads aren't gated:** the click that sends the form is;
  - **when:** after every change the agent makes, too (D4).

**Not handled**
- **Link addresses:**
  - an address with 4+ digits is dropped from the target's attributes (`GENERATED`);
  - the locator doesn't use the kept `href`, and `hrefShape` is never read.
- **⌘Enter in Google Docs or Sheets** still needs approval, although it isn't a send there.
- **Drawn clicks:** a step after one gets only a warning (`drawnBefore`).
- **A repeat whose groups differ by one step** isn't proposed. In KPI, open email → copy → sheet → paste happens twice,
  but the groups differ [5].
- **F13, the file question ("You used X. Next time, which file?").** Two faults in `answers.ts`, found while writing
  this file:
  - **"the newest" is answered "ask me each time".** The check reads each option's stored value as well as its label,
    and the "ask me each time" value also holds `pick: "newest"`, so it matches first.
  - **"all the reports" never answers it.** No option says "all". With one file recorded (your Play Store re-record:
    one report), the question is still asked, with no "all of them" to pick. With several files there is no question
    at all, which is why the Play Store test recording passed [6].

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Text-only container targets: unmatchable | [2] P1, [3A] s5 | **partly:** far fewer (selections aren't clicks); the rest are marked "weak target" |
| **Per-session ids stored** (`id: 19fml5:17`) | [3A] s2 | **fixed (live)** [4] (`75884dc`) |
| The top job became a fixed URL | [2] R2 | **partly:** the list position is recorded and proposed; replay can't find by list position yet (F8) |
| Typed dates stayed literal (`15 Oct`) | [1], [2] R6 | **fixed (live)** [6]: KPI and Play Store used today's date (`191716a`, `dfcf593`) |
| **Enter that sends a chat message wasn't outward** | [3B] | **fixed (tests)** (`6eb059e`, `2f562be`, `9ad36b0`) |
| A design could save a recording as the next version of another workflow (H1) | [8] | **fixed (tests)** (`bb754f0`) |
| Answers about steps inside loops failed; questions had no context (H3, H5) | [8] | **fixed (tests)** (`7462c47`) |
| "Open directly" offered wrongly (the inbox; GitHub issue 334285); page chrome proposed as a list | [5] | **fixed (live)** (`e642724`) |
| "Which file next time?" asked after "all the reports" (H2) | [3B] | **partly:** not asked when several files were used [6]; still asked when one was (F13) |
| The KPI pattern isn't proposed as a repeat | [5] | **open:** part of F2 |
| **"The newest" answered "ask me each time"; "all" can't answer the file question** | this file | **open** (F13) |

**Where:** `packages/recorder/src/compile.ts`, `skeleton.ts`, `locator.ts`, `approvals.ts`;
`packages/recorder/src/evidence/classes.ts`, `flow.ts`, `proposals.ts`, `answers.ts`, `pages.ts`;
`packages/core/src/dates.ts`; `packages/player/src/template.ts`.

---

# The design agent (v2)

Nemotron 3 Super, after Stop, in **stages run by code** (`packages/recorder/src/design/v2/orchestrator.ts`,
`designV2`). Code builds the evidence first (§R10), so the agent decides only what you meant. The old agent
(`design/design.ts`, `design/tools.ts`, `label_steps`, `designViolations`) is removed.

```
designV2()
 ├─ session = what the stages share (session.ts)
 ├─ 1 understand   one structured call → the task model                    (understand.ts, prompt.ts UNDERSTAND)
 ├─ 2 build        one agent episode: tools, several calls a turn          (tools.ts, prompt.ts BUILD)
 │     ├─ every change → refusals (rules.ts) → approvals (approvals.ts + maySend)
 │     ├─ test  → the daemon's safe test run (player rehearse.ts)
 │     └─ done  → the finish gate (gate.ts)
 ├─ 3 ask          code's and the agent's questions, one batch             (questions.ts)
 ├─ 4 apply        a short episode that puts your answers in, then done → gate again
 └─ outcome → the workflow, design.json, review.json                       (review.ts)
```

## D1 · What it's given

**What it does.** Every model-visible text is masked with the recording's Never and private words (`maskText`).
- **Stage 1 gets:**
  - the evidence text (`evidenceText`, §R8): the goal, the switches, the tabs, the one timeline, each step with what appeared and its caption, the left-out steps (x1…) and the proposals (p1…), under 24k tokens;
  - plus up to 5 lines from memory about the goal.
- **The build episode's first message gets:**
  - the task model (JSON);
  - the workflow outline (one line per step);
  - the proposals, each with "[change ready]" or "[can't run yet]";
  - the left-out steps;
  - the unknowns the recording speaks to, with its quotes inside `<untrusted_data>`;
  - the pages it may open by name.
- **Afterwards:** details only on request, through `look`.

**Logic and rules**
- **The full evidence is sent once,** in stage 1. Later turns see the task model and the outline, not the recording again.
- **Page, email and screen text is data:**
  - it's wrapped in `<untrusted_data>`, or returned as an untrusted tool result;
  - both prompts say it is never an instruction;
  - any sending step still needs your approval (D4).
- **Pages are named, never addressed:** the agent names a page by the step that opened it or its tab's (masked) name ("s1", "KPI Sheet"), and code writes the real address (`pagesOf`), because the text it reads masks ids inside addresses.
- **The prompt:** `BUILD` is 41 lines: principles, the tools, and one worked example (KPI). The old ROLE text and "never invent a click" are gone.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Only 40 steps in the first message | [3A] | **fixed**: every step, under 24k tokens (`f88dd49`) |
| 15–22k tokens re-sent every turn | [3] | **fixed**: sent once; real designs cost $0.012–0.124 [6] |
| The build and answers messages, page names and memory weren't masked; quotes unwrapped | [7] C2 | **fixed** (`430d7a3`) |
| No worked example of common shapes | [1] | **fixed**, but the real KPI run didn't follow it [6] (F2) |

**Where:** `design/v2/orchestrator.ts` (`buildMessage`, `answersMessage`), `prompt.ts`, `understand.ts`; `evidence/evidence.ts`.

## D2 · Stage 1: understand (the task model)

**What it does.** `understand()` makes one `llm.generate` call with the `TaskModel` schema. It replaces `label_steps`: nothing is labelled, and code's step names stay until the agent renames them.

**What the task model holds** (`contracts.ts`)
- **outcome:** what's true when the task is done.
- **cadence:** `manual | schedule | folder`, with a cron or folder and the quote it came from.
- **values:** every value the recording shows, and where it comes from next time: `constant | input | today | from_step | list_item | computed`, with evidence.
- **rules:** every rule you said or wrote, quoted, and where.
- **proposals:** accept or reject each, with a reason.
- **unknowns:** what the evidence can't answer, with options and a default.

**Logic and rules**
- **Retries:** two attempts (`understand.ts:29`), and the model client retries a bad schema once itself, so at most 4 calls.
- **Without a task model there is no design:** the plain list is kept, with "it couldn't understand the task" (D7).
- **Unknowns are sorted:**
  - one the recording speaks to (`evidenceView.about`) goes back to the agent with the quotes;
  - the rest are queued as questions (D6).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Invented checks, literal values (`label_steps`) | [2] D3, [3] D4 | **removed** with the stage; checks are judged by the gate (D7) |
| **Cadence written as "manual" while quoting "every day" / "every month"** | [6] KPI, Play Store | **open** (F1) |
| The email subject taken as a typed value, not "the newest in the list" | [6] KPI | **open** (F2) |

**Where:** `design/v2/understand.ts`, `prompt.ts` (`UNDERSTAND`), `contracts.ts` (`TaskModel`).

## D3 · The tools, and how forgiving they are

**What it does.** `designToolsV2(session)` gives 17 tools:
- **proposals:** `accept`, `reject`;
- **steps:** `remove`, `restore`, `add`, `change`, `move`;
- **structure:** `loop`, `branch`, `ai_step`;
- **start:** `trigger`, `input`;
- **look and ask:** `look`, `ask`;
- **finish:** `test`, `done`;
- **`edit`:** only says which tools to use.

Five old names answer as aliases: `wrap_in_loop`, `wrap_in_branch`, `add_llm_step`, `ask_user` and `finish`. A turn may hold up to 8 calls, run in order (`callsPerTurn: 8`).

**Logic and rules (forgiveness)**
- **Parsing:** a field sent as a JSON string is parsed (`unstring`, through `Tool.prepare`).
- **Writing a step:** a step is written by what it does (`{ do: "click" | "type" | "open" | "read_all" | "find_files" … }`) or as `channel.action`, and code fills in its type, channel and action.
- **Targets:** `{ like: "s3" }` copies a recorded target. `{ role, name }` is a new target, marked "unverified" until the test run finds it.
- **Wrong input:**
  - an unknown id is answered with the real ids;
  - a loop with no steps says "loop needs the steps to repeat";
  - removing every step says a workflow keeps one;
  - a wrong verb lists the right ones.
- **Every change carries a `why`,** kept for the review.
- **New ids never reuse a recorded step's id** (`38e0180`).
- **`change` with a tab** keeps the call's other changes (`20cf02a`).

**What one call goes through** (`apply` in `tools.ts`)
1. Apply the edit (core's `applyEdits`).
2. Run the refusals (D4).
3. Add approvals (`requireApprovals`, plus `maySend` for what it added or changed).
4. Keep the why, and mark new targets unverified.
5. Return the outline. The result is masked, then sent.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| `ask_user` with its own `id`: every question lost | [3A] | **fixed**: `ask` takes the question; code numbers it |
| `edits` sent as a JSON string | [3A], [3B] | **fixed** (parsed) |
| `wrap_in_branch` as an edit op; steps without type or channel | [3A], [3B] | **fixed** (`do`, aliases) |
| An empty loop instead of `wrap_in_loop` | [3B] | **fixed** |
| `save_as` on an inserted step ignored | [3B] | **fixed** |
| `describe_step_screenshot` never called | [2], [3] | **removed**: code captions pictures before the agent starts (§R8) |
| **YC: 20 of 40 calls refused:**<br>- ids as one string `"s2, s3"`;<br>- a removal blocked by a later `{{var}}`, without saying which step to change;<br>- `add {do: "ai_step"}`;<br>- an AI step's output type as a word;<br>- `{{s6}}` (a step id) as a variable | [6] YC | **open** (F3) |

**Where:** `design/v2/tools.ts`, `session.ts`, `outline.ts`; `packages/agent/src/{agent,tool}.ts`.

## D4 · The rules: refuse only harm

**What it does.** `refusals(original, draft, facts)` (`rules.ts`) runs on every change. A refused change leaves the draft as it was and tells the agent why. Everything else is allowed, kept with its reason, and shown in the review (`changeNotes`).

**Refused**
- **Your words:** changing the goal, or a Frequency you set before recording (`whenFixed`).
- **Approvals:** turning one off on a step that had it.
- **Scripts:** script or shell steps.
- **Sites:** opening a site no step of the recording reached. An address built from a value must start with a visited site.
- **Files:**
  - files, uploads (`file`, `files`), inputs and watched folders outside the folders the recording touched (`recordedFolders`), with dates written out and symlinks followed;
  - globs that climb out of their folder.
- **Paths from untrusted values:** a file path built from an AI step's answer or page text. Only inputs, files a find step found, loop items over those, and dates may build a path.
- **Hidden values:** a `███` copied back from the masked text.
- **Never:** anything matching your Never words.

**Added by code, always** (`requireApprovals`, `maySend`)
- **By the control's words:** approval on every step that sends, pays, deletes or posts.
- **By the key:**
  - ⌘/Ctrl+Enter and ⌘Return;
  - an Enter that emptied a chat box when recorded;
  - an Enter or Return without Shift the agent adds;
  - typed text with a new line.
- **By copying:** any step that copies a recorded step that needed approval.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Nothing kept the work (B removed all 20 steps) | [3B] | **fixed** by the gate (D7) |
| New clicks weren't allowed, so nothing could be rebuilt | [3B] | **fixed**: the agent may add clicks; new targets are unverified |
| A send could be removed and re-added without approval | [7] C3 | **fixed** (`2b6b15d`) |
| Uploads and watched folders not checked against recorded folders | [7] C4 | **fixed** (`2b6b15d`) |
| A `{{variable}}` inside a path is checked only when designed, not when run | [7] | **open** (F10, player) |

**Where:** `design/v2/rules.ts`, `places.ts`; `packages/recorder/src/approvals.ts`; `packages/core/src/guard.ts`.

## D5 · The safe test run

**What it does.**
- **When it runs:** when the agent calls `test`, and once more on its own before `done` if the workflow changed since. At most 3 per design.
- **Where:** the daemon queues it with the runs (`service.exclusive`), then runs the workflow as a walk-through in the automation window (`rehearse` → `runSkillOn` with `walk` and `highlight`).
- **Its report:** per step `done | failed | found | not_found | not_reached`, and how the run ended.

**What is done for real** (`rehearsalChoice`, `packages/player/src/rehearse.ts`)
- **Reads:** open, wait, extract, find and read files, pick a row, open an app.
- **Clicks that only go somewhere:** on a link, tab or menu item, only when its control is the one recorded, unchanged, and its recorded effect went somewhere or opened something.
- **AI steps:** up to 3.

**Only outlined, never done**
- **Typing and uploads:** any typing or upload.
- **Approvals and sends:** anything needing approval or outward.
- **Buttons:** every button that isn't an expander.
- **Acting words:** any control named with an action word (archive, delete, mark, send, save, accept, decline, join, resolve…).
- **Changed or invented controls:** a link the agent added, or a recorded control it changed.

**Before it starts:** it says what it will do and only outline, and names side effects of reading: "Opening 1 email will mark it as read".

**Not run:** without Chrome (or without Shadow.app, for Mac steps) it says "not run" before trying (`notRunWhy`). The gate then asks nothing about the test, and the review says "not tested".

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Nothing tested the result before saving | [3B] | **fixed (tests)**: not yet run live (checkpoint 3, step 2) |
| Chrome not connected → a 30 s wait and a "failed" step the agent then "fixed" | [7] I1 | **fixed** (`feec1cc`) |
| Links the agent invented were clicked for real | [7] I10 | **fixed** (`546d010`) |
| It shared the window with a scheduled run | [7] I7 | **fixed** (`77ebde9`) |
| A step with no tab runs in the first tab while highlights look in the last one used | [7] I6 | **open** (F7, Akshat) |

**Where:** `packages/player/src/rehearse.ts`; `apps/daemon/src/rehearse.ts`, `main.ts`, `service.ts` (`exclusive`).

## D6 · Questions: one batch

**What it does.** After the build:
1. Code's questions still open are added to the agent's queued ones. A question is still open only if the place its answer goes is unchanged (`openCodeQuestions`, `slotOf`).
2. All of them go to the Record screen at once (`askBatch`), each next to its step.
3. Code writes its answers in, and the agent puts its own in during a short second episode.

**Logic and rules**
- **The evidence check comes first:**
  - code answers "which file" and "which row" from what you said (`answerFromEvidence`);
  - the agent's `ask` is shown the recording's quotes first, and must ask again with `confirm` to go ahead.
- **One per thing it changes:** the agent's question is dropped when code asks about the same step. "start" holds many places, so a start question never silences another.
- **At most 5:** the rest take their defaults and the review lists them under "Not asked".
- **An empty answer ("You decide") takes the default,** never an empty value.
- **Only this recording's questions** appear on the Record screen. Enter sends.
- **If the design stops before asking,** code's questions go to the drill afterwards (`pending`).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| Questions lost to the `id` misuse | [3A] | **fixed** |
| Code's questions dropped when a design stopped early | [7] I2 | **fixed** (`fdaa488`) |
| De-duplication dropped whole kinds of question; skipped ones neither defaulted nor listed | [7] I9 | **fixed** (`fdaa488`) |
| **Asked what the recording already answered** (it overrode the evidence check with `confirm`) | [6] KPI, YC | **open** (F4) |
| Code answers "which file next time?" with "ask me each time" after "the newest", and can't answer it from "all the reports" | this file (§R10) | **open** (F13) |
| A question waits for ever | [2] D2 | **open** (F12) |

**Where:** `design/v2/questions.ts`, `orchestrator.ts`; `evidence/answers.ts`; `apps/ui/src/questions.ts`, `screens/Record.tsx`, `Inbox.tsx`.

## D7 · The finish gate, the review, and never losing a recording

**What it does.** The gate (`gate.ts`) is wired into the `done` tool and decides when a design is done.

**It refuses `done` while**
- **Your work is gone:** a write or send you showed is gone and unexplained. If none of your shown work is left, it is refused whatever reason was given (`lostWork`).
- **A rule is unbuilt:** a quoted rule is neither built by steps that exist nor explained (`not_built`).
- **A check can't work:**
  - it is empty;
  - it holds a hidden value;
  - it looks for text on a drawn page (Sheets, Docs);
  - it looks for text that never appeared on screen.
- **A test failure is unexplained.**
- **An unattended run can't start:** it can't fill its inputs.
- **The frequency doesn't match:** it runs by hand though the task model says otherwise.
- **No page is opened first** in a web workflow.

**After two refusals** (`MAX_DONE_REFUSALS = 2`), it finishes with what's left as **gaps**, shown in the review.

**Never losing a recording:** these each keep the last valid draft, or the plain list if that draft lost your shown work:
- no task model;
- a budget used up;
- an error;
- unreadable evidence;
- a stop.

**The review** (`review.ts`, beside the versions in `skills/<id>/review.json`)
- **What it shows:**
  - a badge per change (Added, Changed, Removed, Moved, Not tested) with its reason;
  - "What you said → what was built";
  - Not tested;
  - Not asked;
  - Still to check (the gaps);
  - how it was made (the feed's lines).
- **What it holds back:** Go live, and schedules, wait for **Looks right**, even when a later version (a Frequency change, an edit) was saved on top. Run now works.

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| `finish` accepted a workflow that no longer did the task (B: one `fs.find`) | [3B] | **fixed** (gate) |
| Every stated rule unbuilt, accepted | [3A] | **partly**: the gate checks the named steps exist, not what they do (F2) |
| Summaries describing changes never made | [1]–[3] | **fixed**: the review is built by code from the real changes |
| A stopped draft could keep a workflow with your work removed | [7] I3 | **fixed** (`fdaa488`) |
| Schedules ran an unreviewed design; a later version lifted the wait | [7] I8 | **fixed** (`feec1cc`) |
| **The gate takes the task model's word on how often it runs** | [6] KPI, Play Store | **open** (F1) |
| A removed step that opened the sheet left a paste on the Gmail page; the gate doesn't check pages | [6] KPI | **open** (F5) |

**Where:** `design/v2/gate.ts`, `review.ts`, `orchestrator.ts`; `apps/daemon/src/review-store.ts`, `service.ts`, `triggers.ts`; `apps/ui/src/screens/Workflow.tsx`.

## D8 · Budget, cost and record-keeping

**Logic.**
- **One budget for the whole design:** $0.25 and 40 model calls on one meter, picture captions included (`budget.ts`). Each stage gets what's left, and a design needs at least 2 calls left to start.
- **The transcript:** replies keep the model's reasoning; rejected calls keep their input.
- **`design.json` keeps:**
  - the full system prompt and the task model;
  - every decision and change note with its reason;
  - the test report, the questions and answers, the gaps;
  - the usage and the whole transcript.
- **The feed:** the Record screen shows each stage and tool call in plain words (`progress.ts`).

**Problems seen**

| Problem | Where | Status |
|---|---|---|
| The model's reasoning not kept | [1]–[3] | **fixed** (`7703b73`) |
| An invalid call's input not stored | [1], [3] | **fixed** (`702954a`) |
| Vision calls not metered | docs | **fixed**: metered and cached (`775ea37`); captions on the design's budget |
| Near the $0.10 cap | [3] | **fixed**: real designs cost $0.012–0.124 [6] |
| The test run's AI calls are counted on the daemon's meter, not the design's | [7] | **open** (minor) |
| Stage 1 can make 4 calls, and isn't checked against the cost left | [7] | **open** (minor) |

**Where:** `design/v2/budget.ts`, `progress.ts`, `orchestrator.ts`; `packages/agent/src/agent.ts`; `packages/llm/src/{client,vision,usage}.ts`; `apps/daemon/src/record.ts` (`keepDesign`).

---

## Appendix: problems by section, open only

F-numbers are in [`record-v2-changes.md` § Failures to fix](record-v2-changes.md#failures-to-fix). "Akshat" marks the
replay side.

| Section | Open problems |
|---|---|
| §0 fundamentals | the model's judgement: how often it runs (F1), "the newest" not built (F2); replay doesn't use list position or text (F8, Akshat) |
| R1 web capture | Shift + a key outside fields; a middle click has no point or effect; no right click, hover or scroll; a textarea or rich-text editor is never secret; Sheets ids checked live once |
| R2 tabs | named tabs closed while a run waits for approval (F6, Akshat); a step with no tab (F7, Akshat); new tabs have no title; automation tabs unknown after the background restarts |
| R3 Mac-app capture | nameless elements such as Numbers cells (F11); the Privacy skip covers clicks only; "Privacy" and "Move to Trash" in English only; no permission check when you press Record |
| R4 files | any file vanishing within 5 s of a Move to Trash counts as trashed; other deletions are neither steps nor listed; folders; moves between watched folders |
| R5 pictures: capture | no ledger line for Mac skips or automation tabs; nothing blacked out in iframes; boxes measured before the picture is taken |
| R6 pictures: reading | `screenReady` checked once, at daemon start; Mac pictures get no field boxes; Private words under 3 characters or with symbols |
| R8 timeline | a caption cut short by the 400-token cap (Akshat); scrolled-in lines count as appeared; Mac steps accept any tab's pictures |
| R9 normalise | some drops have no noise line; reading clicks stay steps (classed `reveal`); no writing to a cell (F9, Akshat) |
| R10 first draft | a repeat whose groups differ isn't proposed (F2); the locator ignores `href` and list position (F8, Akshat); ⌘Enter in Google editors needs approval; the file question answered wrongly from the recording (F13) |
| D1 given | the worked example wasn't followed on KPI (F2) |
| D2 understand | cadence written as "manual" while quoting "every day" (F1); a subject taken as typed, not "the newest" (F2) |
| D3 tools | YC: 20 of 40 calls refused for syntax (F3) |
| D4 rules | a `{{variable}}` in a file path is checked only when designed (F10, Akshat) |
| D5 test run | not yet run live; a step with no tab (F7, Akshat) |
| D6 questions | re-asks what the recording answered (F4); no timeout (F12); the wrong file answer (F13) |
| D7 finish gate | takes the model's word on how often it runs (F1); checks that a rule's steps exist, not what they do (F2); doesn't check which page a write runs on (F5) |
| D8 budget | the test run's AI calls count on the daemon's meter; stage 1 can make 4 calls |
