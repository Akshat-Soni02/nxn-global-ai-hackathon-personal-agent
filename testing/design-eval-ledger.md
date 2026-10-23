# Design eval ledger (real model, Record v2; $5 in all)

| When | Recording | Model | Cost | Passed |
|---|---|---|---|---|
| 2026-10-20 | cp1 A' Wikipedia → paste form (daemon Stop, design v1, test browser) | nemotron-3-super | $0.0652 | n/a (capture check) |
| 2026-10-20 | cp1 C YC jobs → top job title (daemon Stop, design v1, test browser) | nemotron-3-super | $0.0232 | n/a (capture check) |
| 2026-10-20 | cp1 D GitHub issues (daemon Stop, design v1, test browser) | nemotron-3-super | $0.0604 | n/a (capture check) |
| 2026-10-20 | cp1 F public sample sheet: two cell copies (daemon Stop, design v1, test browser) | nemotron-3-super | $0.0613 | n/a (capture check) |
| 2026-10-20 | cp1 C replay: repair agent on the regex url check (escalated, out of turns) | nemotron-3-super | $0.0360 | n/a (found the url_matches bug) |
| 2026-10-20 | cp1 C replay v2: repair agent after the new-tab check failed (escalated at approval) | nemotron-3-super | $0.0380 | n/a (found new-tab + literal-target issues) |
| 2026-10-20 | cp1 part 2 A: real Sheet + form, your Chrome (daemon Stop, design v1) | nemotron-3-super | $0.0246 | n/a (capture check) |
| 2026-10-20 | cp1 part 2 B: Gmail promotions, your Chrome (daemon Stop, design v1) | nemotron-3-super | $0.0506 | n/a (capture check) |
| 2026-10-20 | cp2 live captions: 5 pictures (GLM-5.3-Flash) + design v1 on Stop, test browser | glm-5.3-flash + nemotron-3-super | $0.0741 | captions ✓ (one cut short) |
| 2026-10-20T10:54:14.786Z | kpi-email-to-sheet | nvidia/nemotron-3-super-120b-a12b | $0.0373 | 3/7 |
| 2026-10-20T10:55:19.651Z | timesheet | nvidia/nemotron-3-super-120b-a12b | $0.0228 | 5/5 |
| 2026-10-20T10:58:40.457Z | yc-top-job | nvidia/nemotron-3-super-120b-a12b | $0.1235 | 3/5 |
| 2026-10-20T10:59:11.969Z | playstore-to-chat | nvidia/nemotron-3-super-120b-a12b | $0.0122 | 5/6 |
| 2026-10-23 | cp4 A Hacker News top 3 → notes (daemon Stop, design v2, test browser, test run live) | nemotron-3-super | $0.0528 | 3/5 checks; doesn't run (s2) |
| 2026-10-23 | cp4 B YouTube newest video → notes (Pictures on: captions on the same meter) | nemotron-3-super + glm-5.3-flash | $0.1221 | 4/4 checks; doesn't run (s9) |
| 2026-10-23 | cp4 C x-rates USD→INR → notes (ran out of calls, kept) | nemotron-3-super | $0.1513 | 6/6 checks; doesn't run (s10) |
| 2026-10-23 | cp4 D Wikipedia PDF → Reading (file moves not captured: watch folder under ~/.claude) | nemotron-3-super | $0.0949 | 1/4 checks; not run |
| 2026-10-23 | cp4 D2 same, watch folder in ~/shadow-tests (ran out of calls, kept) | nemotron-3-super | $0.1409 | 3/4 checks; fails before step 1 |
| 2026-10-23 | cp4 E Excalidraw note (canvas probe; Pictures on) | nemotron-3-super + glm-5.3-flash | $0.0598 | 3/4 checks; fails before step 1 |
| 2026-10-23 | cp4 Run now of A, B, C: replay's repair agent on each failure (B repaired to v2) | nemotron-3-super | $0.1499 | n/a (none ran through) |
| 2026-10-23T11:11:08.730Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.1799 | 1/6 |
| 2026-10-23T11:12:09.208Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.0408 | 5/5 |
| 2026-10-23T11:13:27.389Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.0653 | 6/7 |
| 2026-10-23T11:16:07.072Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.1344 | 3/5 |
| 2026-10-23T11:17:32.685Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.0713 | 3/5 |
| 2026-10-23T11:23:16.706Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.1903 | 2/6 |
| 2026-10-23T11:26:25.218Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.1595 | 4/5 |
| 2026-10-23T11:27:11.112Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.0316 | 7/7 |
| 2026-10-23T11:30:53.861Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.1497 | 4/5 |
| 2026-10-23T11:32:04.337Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.0600 | 5/5 |
| 2026-10-23 | cp4 live A re-record (ext 0.0.5, scratch daemon, round-2 code): ran out of 40 calls, kept the plain list; Run now succeeded (plain list, no AI steps) | nemotron-3-super | $0.1793 | runs; not the task (manual, fixed places, no skip rule) |
| 2026-10-23T11:43:56.596Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.0801 | 5/6 |
| 2026-10-23T11:46:24.753Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.1451 | 5/5 |
| 2026-10-23T11:48:23.916Z | recording | nvidia/nemotron-3-super-120b-a12b | $0.0718 | 5/5 |
| 2026-10-23 | cp5 live B re-record (round-3 code, Pictures on): designed in 26 calls; Run now succeeded, AI step picked the newest video | nemotron-3-super + glm-5.3-flash | $0.0705 + captions (est. under $0.01) | does the task |
| 2026-10-23 | cp5 live C re-record (7e59721): designed in 36 calls but saved a read of { role: "cell" } (ambiguous); Run now failed at s2, replay's repair ran out of turns | nemotron-3-super | $0.1416 + repair $0.0497 | does not run |
| 2026-10-23 | cp5 live C again (306e724): designed in 16 calls; Run now succeeded and saved USD to INR 94.907545, 23 Oct, USD | nemotron-3-super | $0.0547 | does the task |
| 2026-10-23 | cp5 live D (306e724; two earlier tries lost to a test-browser crash, nothing designed): out of 40 calls, a broken draft kept (stale check, tabless read); Run now failed at s2, repair ran out of turns | nemotron-3-super | $0.1779 + repair about $0.08 | does not run |
| 2026-10-23 | cp5 live D again (45e0ebe): ran out of calls putting answers in, draft kept; Run now: the AI step took the image caption as the title, and the download find looked once (1 ms) and failed | nemotron-3-super | $0.1509 | does not run |
| 2026-10-23 | cp5 live D again (f89a0e9): out of calls on 15 no-op changes to a page-open step; the recorded steps were kept and Run now succeeded (download found after waiting), but that is the recording: fixed article, fixed name | nemotron-3-super | $0.1848 | runs; not the task |
| 2026-10-23 | cp5 live D again (4674a5c): designed in 27 calls with the right shape (read the Main Page, AI picks the title, PDF, wait, rename, move); Run now: the AI step picked the image caption, so no PDF | nemotron-3-super | $0.1053 | does not run |
| 2026-10-23 | cp5 live D last try (389bf90): out of 40 calls re-adding the same whole-page read (the outline showed it as on element "?"); the recorded steps were kept and Run now succeeded, but that is the recording | nemotron-3-super | $0.1634 | runs; not the task |
| 2026-10-23 | cp5 live E (edd1241, Pictures on; 2 captions timed out): designed in 15 calls, test run passed; Run now failed at s4 (typing on the canvas: target not found), repair ran out of turns. Also: my script ran D's workflow once by mistake while E compiled (no AI steps, repair nothing_to_do, $0) | nemotron-3-super + glm-5.3-flash | $0.0409 + captions and repair $0.1072 | does not run |
| 2026-10-23 | cp5 live A (edd1241): the agent removed every save, said the page couldn't be read, and was saved past the gate (refused twice) with only three page opens; Run now did nothing. Fixed after in e64161d (the recorded steps are kept instead) | nemotron-3-super | $0.0389 | does not do the task |
