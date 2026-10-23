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
