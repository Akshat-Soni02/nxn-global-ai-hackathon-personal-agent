# Checkpoint 1: does capture record what Plan 2 will build on?

Two short recordings on your Mac, with the new extension and Shadow.app. I read what they produced before any Phase 2
code is written. About 10 minutes.

## Setup (once)
1. `git switch feat/record-v2 && corepack pnpm install && corepack pnpm build`
2. Chrome → `chrome://extensions` → Shadow → reload (the ↻ icon). It now also loads `clipboard-hook.js`.
3. `corepack pnpm setup:mac`, then System Settings → Privacy & Security → Accessibility: turn Shadow off and on.
   Screen Recording and Microphone: allowed.
4. Restart the daemon: `launchctl kickstart -k gui/$(id -u)/com.shadow.daemon` (or stop it and run `corepack pnpm daemon`).
5. `corepack pnpm fixtures` in a terminal (serves http://localhost:5173).
6. A test Google Sheet with a header row (Date, Item, Amount) and two filled rows, where **the same amount appears in
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
7. Stop. Answer any question with Enter.

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
