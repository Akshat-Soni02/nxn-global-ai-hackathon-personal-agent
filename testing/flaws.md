# Flaws

> Everything that is wrong with Shadow, sorted by product section, so each section can be fixed on its own and
> then tested again. Started 17 Oct 2026, on `main` at `eae9d40`. Results from the
> [real-world tests](real-world-tests.md) get added here, each with the test row that found it (e.g. "test 3, row
> 3.6").

**How an entry reads:** what goes wrong · the mechanism, in the code · an example · the fix · which tests run into it.
**Severity:** **P0** breaks the task or loses data · **P1** wrong or missing result, with a workaround ·
**P2** quality.

**Section codes** (the same as in the tests): **R** Record · **D** Design agent · **Q** Questions · **E** Editor ·
**W** Walk through · **P** Run · **I** Inbox and approvals · **T** Triggers · **X** Repair · **M** Memory.

## Known before testing

These four were found by reading the code, before any test was run.

| ID | Flaw | Sections | Severity | Fixed by |
|---|---|---|---|---|
| [K1](#k1-shadow-cant-write-into-a-google-sheet) | Shadow can't write into a Google Sheet | R, P | P0 | Edit a document |
| [K2](#k2-typing-in-notes-overwrites-the-whole-note) | Typing in Notes (any Mac text area) overwrites the whole note | R, P | P0 (loses data) | Edit a document |
| [K3](#k3-finder-deletes-move-to-trash-arent-recorded) | Finder deletes (Move to Trash) aren't recorded | R | P1 | Pair Finder's action with the file event |
| [K4](#k4-run-now-and-walk-through-pass-no-inputs) | Run now and Walk through pass no inputs | P, W | P1 | "This run needs" sheet |

**"Edit a document" fixes K1 and K2, not all four.** K1 and K2 share one root: the place you write is a position
inside existing content, not a box of its own. K3 is about what the recorder can see; K4 is about the window not
asking for values. Each of those has its own small fix, below.

---

### K1 Shadow can't write into a Google Sheet

- **Sections:** R (record), P (run) · **Severity:** P0 · **Tests:** 9 (row 9.8), 11 (row 11.16), and any task that ends in a sheet.
- **What goes wrong:** a recorded "type into a cell" replays into whichever cell happens to be selected, or nowhere.
- **Mechanism:**
  - Sheets draws its cells on a canvas, so a click on B3 has no element. The extension marks it `drawn`
    (`apps/extension/src/capture.ts:171-175`), and normalising drops it, since nothing can be replayed from it
    (`packages/recorder/src/normalise.ts:324-331`). What is left is "type `€75` into Sheets' editing box": one
    hidden box that moves to the selected cell. The cell itself is lost.
  - On replay, the matcher finds that editing box and types wherever the selection is.
  - Coordinates aren't an option, by design (`docs/design.md:527`, "Matching, never coordinates"): the replay
    window is 1280×800, the sheet scrolls, and next week has more rows, so a remembered (x, y) lands on the
    wrong cell without anyone noticing.
  - Reading works only because it goes around the canvas, through the sheet's CSV export
    (`packages/player/src/web/executor.ts:237-246`). There is no such way in for writing. The Sheets API needs a
    Google sign-in and works for Google only.
- **Example:** the YC task (Akshat's report, R3). `B3`, `C3`, `D3`, `A3` were typed, the cell clicks were dropped,
  and the run would type into the selected cell.
- **Fix:** [Edit a document](#fix-1-edit-a-document).

### K2 Typing in Notes overwrites the whole note

- **Sections:** R, P · **Severity:** P0 (it deletes what you added by hand) · **Tests:** 2 (row 2.12), 7 (7.8),
  10 (10.7).
- **What goes wrong:** a run replaces the note with the text it had while you recorded, instead of adding a line.
- **Mechanism:**
  - Recording: when you leave the field, the Mac app reads the field's **whole** value
    (`apps/mac/Sources/Recorder.swift:262-263`). A note is a single text area, so the value is the whole note.
    Over 2,000 characters it stores no value at all (`long: true`), and pasted text is never stored.
  - Replay: the whole value is set back (`apps/mac/Sources/Player.swift:118-124`). If the app refuses that, the
    fallback is "select all, then type", which also replaces everything.
- **Example:**

  | | The note holds |
  |---|---|
  | Before recording | `12 Oct: 3 assigned` |
  | Recorded value (you added a line) | `12 Oct: 3 assigned\n17 Oct: 4 assigned` |
  | You add a line by hand | `…\n20 Oct: call Akshat` |
  | Monday's run | `12 Oct: 3 assigned\n17 Oct: 4 assigned`: your 20 Oct line is **gone**, and there's no new line |

- **Fix:** [Edit a document](#fix-1-edit-a-document).

### K3 Finder deletes (Move to Trash) aren't recorded

- **Sections:** R · **Severity:** P1 · **Tests:** 4 (row 4.2).
- **What goes wrong:** you drag a file to the Trash while recording, and the workflow has no step for it.
- **Mechanism:**
  - Finder clicks are never recorded: Finder is on the Mac recorder's skip list. Files are watched instead
    (`apps/daemon/src/fs-watch.ts`). macOS file events only say "something changed at this path", so the
    watcher reduces them to *appeared* / *vanished*, and pairs them into moves and renames.
  - A file that vanished with nothing appearing is a delete, and deletes are dropped on purpose
    (`fs-watch.ts:39-41`). Apps delete files all day without you (saves through a temporary copy, replaced
    downloads, iCloud freeing space), so treating every vanish as a delete would invent the most dangerous step.
  - Move to Trash really is a move into `~/.Trash`, but that half never arrives:
    - the watcher skips hidden names (`.Trash`);
    - macOS guards the Trash: `ls ~/.Trash` gave "Operation not permitted" (measured 17 Oct from a terminal; not
      yet checked as the daemon).
- **Example:** test 4 drags `old.dmg` to the Trash; the trace shows nothing for it.
- **Fix:** [Pair Finder's action with the file event](#fix-2-pair-finders-action-with-the-file-event).

### K4 Run now and Walk through pass no inputs

- **Sections:** P, W · **Severity:** P1 (triggers still work) · **Tests:** 2 (rows 2.7, 2.8), and every workflow
  with an input that has no default.
- **What goes wrong:** the run stops before step 1 with "input … has no value".
- **Mechanism:**
  - An input is a value that can change on each run (a file, a date, a search word), declared on the start
    step, with an optional default or find rule.
  - It is filled in this order: given by whoever started the run → else the file find rule → else the
    default → else an error (`packages/player/src/node/inputs.ts:55-81`).
  - A folder trigger gives the file. A schedule needs a default (Go live checks this). But the window's
    **Run now** sends only `{ id }` (`apps/ui/src/screens/Workflow.tsx`, `session.call("start", { id })`), and
    so does **Walk through**, although the API accepts `inputs` (`apps/daemon/src/api.ts:39-45`).
- **Example:** test 2's workflow has the input `file`, filled by the folder trigger and with no default. Run now →
  "input file has no value".
- **Fix:** ["This run needs" sheet](#fix-3-this-run-needs-sheet).

---

## Fixes

| Fix | Fixes | Size (rough) |
|---|---|---|
| [1. Edit a document](#fix-1-edit-a-document) | K1, K2 | 2–3 days (the screen path) |
| [2. Pair Finder's action with the file event](#fix-2-pair-finders-action-with-the-file-event) | K3 | about 1 day |
| [3. "This run needs" sheet](#fix-3-this-run-needs-sheet) | K4 | half a day |

### Fix 1 Edit a document

A new kind of step that stores **what changed in the document** ("added a row to *Ycomb jobs*: Company=Noloco,
…", "added a line at the end of *Weekly*"), not "typed into this box".

- **Record:** read the document when you start typing and again when you stop; the difference is the change
  (sheet: 3 rows → 4 rows = "row added"; note: `A\nB` → `A\nB\nC` = "line added at the end").
- **Design agent:** sees that change and writes `{{company}}`, `{{today}}` on clear columns. The tree shows one
  step, "Add a row to Ycomb jobs".
- **Run:**
  1. Read the document.
  2. Code finds the place (the first empty row, the column under the header; the end of the text).
  3. Move there with the keyboard: a "go to cell" box where there is one, or ⌘↑ then arrow keys; ⌘↓ for text.
  4. Type.
  5. Read again to check: if the value isn't there, fail clearly.
- **Why it's general:** it needs only a way to read (export, Accessibility text, or ⌘A ⌘C), the keyboard, and a
  second read. A new app is at most a row in a table (how to read it, which key goes to the start or end), not
  new code.
- **Later, same step:** how the change is made can be swapped per app without changing any workflow. A connector
  when one is connected: AppleScript for Notes and Reminders (the player can already run it,
  `packages/player/src/node/script-channel.ts:18-26`), MCP or an app's API (Google Sheets first). The screen path
  above is used otherwise. The connector must be limited to the documents the recording touched.

### Fix 2 Pair Finder's action with the file event

- **Record:** keep ignoring Finder clicks, but record Finder's **menu picks and shortcuts** (File › Move to
  Trash, ⌘⌫, a drop on the Dock's Trash) with the names of the selected items, through Accessibility as for
  other apps.
- **Normalise:** "Move to Trash on `old.dmg`" + "`old.dmg` vanished within 1 s" = a Trash step. No Trash access
  is needed, and an app's own deletes still never become steps (you didn't press anything).
- **Run:** the Trash step already exists and waits for your approval (`packages/core/src/guard.ts:32`). It should
  move the file through macOS's own "move to Trash" call from Shadow.app rather than a plain move into
  `~/.Trash`, because of the same guard (reasoned, not measured).

### Fix 3 "This run needs" sheet

- **Run now** and **Walk through** open a small sheet listing every input that nothing will fill: no default, no
  find rule, not from a trigger.
  - Pre-filled with the last run's value or the recorded example.
  - A file picker for files.
- The API already takes `inputs`, so this is a window change only.
- The design agent should also give a default wherever the recorded value is a sensible one.

---

## Found by the tests

*(Added as results come in: under each section, the flaw, the test row that found it, and what happened.)*

### R Record

### D Design agent

### Q Questions

### E Editor

### W Walk through

### P Run

### I Inbox and approvals

### T Triggers

### X Repair

### M Memory
