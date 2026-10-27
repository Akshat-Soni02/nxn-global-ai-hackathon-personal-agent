# Checkpoint 7: the audit's Phase 2 fixes, checked for real (27 Oct)

**What this is.** The fixes of `reports/changes.md` §5 were each written test-first. This file is the other half: what
happened when they met the real model, real Composio, real Google apps and a real Chrome. Spend: $0.0003 (ledger, last
row). Nothing here is in git except this record; the test sheet, test doc and daemon data are Rushil's.

**Where:** Rushil's own daemon (`pnpm daemon` on `main` + the Phase 2 commits, signed in to a local `pnpm api`) for the
app checks; the isolated test daemon and Chrome for Testing (`~/shadow-tests/checkpoint-6/kit/`) for the page checks.

## Results

| # | Check | How | Result |
|---|---|---|---|
| 1 | App steps write and read back (Sheets, Docs) | A workflow of four `mcp.call` steps, Run now: write a cell and a doc line (each asks first), read both back | ✔ The sheet read back `["shadow-check","<today>"]` from `Sheet1!A1:B1`; the doc read back `shadow-check <today>`. Both writes waited for an OK. $0 |
| 2 | A drawn-grid step is stopped before it runs (A1, A2) | A workflow that navigates to the test sheet and types into its grid (`drawn: true`), Run now with Sheets connected | ✔ The run stopped before step 1 (no events, no browser, no model, $0) with "needs an app: step s2 works in a drawn area of Google Sheets, which replay can't reach: this workflow should use the app's own tool, not the page (Edit it, or record it again)" |
| 3 | JS dialogs (A5) | A page that raises `alert`, `confirm` and `prompt` (`fixtures/pages/dialogs.html`), three workflows, real Chrome, extension reloaded | ✔ alert: accepted, run succeeded. confirm in a step nobody approved: stopped with `the page asked "Delete 3 items?" (confirm) and nothing says what to answer…`. confirm in an approved step: asked for the OK, then accepted, the page showed `confirm: true`. $0 |
| 4 | Day 2 of A, B, C, D (Phase 5) | Run now of each saved workflow from the kit, real model for their AI steps | ✔ all four did their task; see below. $0.0003 |

**Day 2, each result against its live source:**
- **D** (Wikipedia's featured article as a PDF): saved `27 Oct - 1986 New York Mets season.pdf`; Wikipedia's featured
  article for the day was the same. No AI step.
- **A** (top 3 Hacker News stories): the three titles and points equal the front page read directly (718, 501, 28).
- **C** (USD to INR): 95.0157 saved; x-rates showed 94.9754 when checked ten minutes later (0.04% apart).
- **B** (newest video of the Google for Developers channel): it saved the first video the test browser's page listed
  ("Introducing Genie 4", 1.5K). A plain `curl` of the same page listed another video first, so this one could not be
  confirmed independently.

## What the checks taught (not bugs in the product)

- **Chrome keeps an extension's service worker script until the extension is reloaded.** The test Chrome ran the
  24 Oct worker for hours after `apps/extension/dist` was rebuilt, because the version in `manifest.json` did not change:
  every dialog run behaved as if the fix did not exist. Reload from `chrome://extensions` (or
  `chrome.runtime.reload()`), then confirm `chrome.debugger.onEvent.hasListeners()`. A fix to the extension is not
  checked until that is true.
- **Playwright answers dialogs itself.** Under it, an alert is dismissed before the extension can answer, so the
  Playwright-driven test browser proves nothing about dialogs. Use a plainly launched Chrome for Testing.
- **Stale tabs from earlier runs** (a `dialogs.html` left open) made a click hang until closed. Start such a check with
  one tab.

## Not checked, and why

- **Repair adding an app step (A3) on a real failing page step.** The preflight stops every `drawn` step first, so the
  repair path is reached only by an ordinary page step that fails inside a page an app covers. That needs Rushil's
  signed-in Chrome (the test browser is not signed in to Google) and about $0.10. Covered by tests only, so far.
- **Designing a recording of a Sheets task with Sheets connected (R5.5 / the YC re-design).** The YC recording is not
  on this machine. It needs one short new recording of a task in the test sheet, then about $0.13.
- **Popup windows, Save-as, permission asks, print preview and Mac-app sheets (A5 remainder).** Not built.
