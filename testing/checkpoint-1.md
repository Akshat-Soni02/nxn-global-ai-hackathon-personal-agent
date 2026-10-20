# Checkpoint 1: does capture record what Plan 2 will build on?

Two short recordings on your Mac, with the new extension and Shadow.app. I read what they produced before any Phase 2
code is written. About 10 minutes.

## Setup (once)
1. `git switch feat/record-v2 && corepack pnpm install && corepack pnpm build`
2. Chrome → `chrome://extensions` → Shadow → reload (the ↻ icon). It now also loads `clipboard-hook.js`.
3. `corepack pnpm setup:mac`, then System Settings → Privacy & Security → Accessibility: turn Shadow off and on.
   Screen Recording and Microphone: allowed. If macOS asks for Screen Recording again (the rebuilt app is a new
   app to it), allow it, then **quit and reopen Shadow.app**: macOS only applies that permission after a relaunch,
   and until then every picture fails.
4. Restart the daemon: `launchctl kickstart -k gui/$(id -u)/com.shadow.daemon` (or stop it and run `corepack pnpm daemon`).
5. `corepack pnpm fixtures` in a terminal (serves http://localhost:5173).
6. A 10-second throwaway recording with Screen on: Record, click a Finder window, click a Chrome page, Stop. Its folder
   (`~/Library/Application Support/Shadow/recordings/<newest>/shots.jsonl`) should show `"outcome":"taken"` lines.
   If they say `deleted` or `no-tools`, step 3 hasn't taken: quit and reopen Shadow.app once more.
7. A test Google Sheet with a header row (Date, Item, Amount) and two filled rows, where **the same amount appears in
   both rows** (e.g. 1,234).

The Record screen should now show a folded "Private words (optional)" line under the goal box. If it shows "Pictures
can't be read right now", step 3 didn't take: tell me.

## Recording A: a sheet, a form, two tabs (Screen + Voice on)
Goal: "Copy today's amount from my sheet into the expense form".
1. Tab 1: the test sheet (opened before you press Record).
2. Record. Click the Amount cell of the **second** row; double-click a word in another cell; then click the Amount
   cell again and press ⌘C.
3. Open tab 2: http://localhost:5173/paste-form.html. Switch tabs back and forth three times without doing anything.
4. In tab 2: click Amount, ⌘V, click Save.
5. Tab 1: click the first empty cell of column A and type today's date like "19 Oct". Press Enter.
6. Say while doing it: "I always take today's row" and "the date is today".
7. Stop. Answer any question by clicking its first option. (Enter doesn't send an answer yet: that is Phase 4.)

## Recording B: Gmail (Screen on)
Goal: "Note the newest email's subject".
1. Record. In Gmail, open the newest email in a test label.
2. Drag-select its subject and press ⌘C.
3. Click on the email's header area (not a button).
4. Go back, select a throwaway email, press `e` (archive).
5. Stop.

## Then
`mkdir -p ~/shadow-tests && cp -R ~/Library/Application\ Support/Shadow/recordings ~/shadow-tests/checkpoint-1`
and tell me the two goals. (These stay on your Mac; nothing goes into git.)

## What I check before Phase 2
| Fact | Where | Pass |
|---|---|---|
| `select_text` for the double-click and the drag-selection, no container click after them | trace.jsonl | |
| Copy's target is the selected element; `via: keyboard` | trace.jsonl | |
| `effect` after each click; the header click reads `changed: none` in Gmail | trace.jsonl | |
| `list` on the email row (index 0) | trace.jsonl | |
| `cell` on the sheet click, the copy (B3-style ref, right row despite the duplicate amount) and the typed date | trace.jsonl | |
| `tab_open preexisting` for tab 1 before its first event; switches recorded; `window_focus` if you switched windows | trace.jsonl | |
| `e` recorded as a key; nothing recorded while typing the date | trace.jsonl | |
| every event that should have a picture has a line in shots.jsonl | shots.jsonl | |
| screen.jsonl lines have boxes and tabId | screen.jsonl | |
| no Shadow permission prompt in the trace | trace.jsonl | |

## Results, 20 Oct: part 1, a test browser (no login)
Claude in Chrome was not connected, so part 1 ran in a separate test setup that can't touch your Chrome or data: Chrome
for Testing with a copy of the extension (version 0.0.1, then 0.0.2 after the fixes), its own daemon (`SHADOW_HOME` and
`SHADOW_SOCKET` in the job's scratch folder, Shadow.app not started, only a scratch folder watched), driven by
Playwright. Public pages only: Wikipedia's GDP table and the paste form (A'), YC's job board (C), GitHub's VS Code
repo (D), Google's public sample sheet "Class Data" (F). Copies in `~/shadow-tests/checkpoint-1/test-browser/`.

| Fact | Result |
|---|---|
| `select_text` for a double-click and a drag-selection; no click after them | ✓ (the double-click's *first* click is still recorded just before it: Plan 2 merges it) |
| copy's target is the selected element; `via` | ✓ keyboard (Wikipedia cell, YC job title, sheet cells); ✓ button (GitHub's Copy URL, through the page hook) |
| `effect` after each click | ✓ none / expanded (GitHub's Code menu); **fixed**: a "Saved" status line read as none |
| `list` on rows and cards | ✓ YC card 0 and 1 of 20; **fixed**: a link in a table cell was item 0 of the row's 4 cells, paragraphs were a list |
| `cell` on sheet clicks and copies | ✓ B8 "Female" on "Class Data", and its copy kept row 8 though B2 holds "Female" too; Name Box, formula bar and tab ids right on a live sheet. **Fixed**: drawn clicks carried a list place from Sheets' panes |
| tabs: `tab_open preexisting`, opener, switches, closes | ✓ |
| single keys, and no keylogging | ✓ `k`, `g`, `i` recorded; "hello" typed outside a field: nothing. **Fixed**: Escape on a menu's button was dropped |
| shot ledger | ✓ a line per picture: taken / skipped tab-hidden / deleted (1 of 26: the OCR tool failed without saying why) |
| `screen.jsonl` boxes and tabId | ✓ |
| Shadow's own prompts, Move to Trash, Screen Recording at Record | not checked: Swift, needs your `pnpm setup:mac` |
| Gmail churn, typing a date into a sheet | not checked: needs your signed-in Chrome (part 2) |

A cell click reads `changed: small`: that is Sheets moving its selection border (40 attribute changes on
`.range-border`), not an announcement; no status or alert area changes on a cell click.

Also fixed: names borrowed from far away (a paragraph named "Table", the page "Contents"; only controls borrow a name
now), page-made clicks (GitHub's `g i` clicks the Issues tab itself: now `synthetic: true`), link shapes (`fK*gxxbq`
is now `*`), and a url check the model wrote as a regex (replay failed on the right page). Commits 2754463, 4ec5c1e,
e2bdf00.

**For Plan 2** (seen live, not capture bugs): a click that opens a new tab has effect none and no picture (the tab
is hidden 25 ms later): pair it with `tab_open` and use the tab's last picture; single-page navigations can land 780 ms
after the click; back is recorded as a typed address; two clicks under 700 ms apart share an effect window; the
double-click's first click; `synthetic` clicks are dropped once keys become steps.

**For Plan 3 and Akshat** (seen in replay): steps after a click that opened a new tab run in the old tab
(`step.tab`); a nameless "heading is visible" check can't tell headings apart; the recorded job title was clicked
though a newer job was first (list item, not literal text); an approval on a plain link click; repair stops at an
approval step; workflows saved before e2bdf00 may still hold regex url checks (the player could read them
leniently). Real-model spend: $0.28 of $5 (ledger).
