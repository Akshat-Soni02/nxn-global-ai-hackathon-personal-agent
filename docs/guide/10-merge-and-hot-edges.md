# 10 · Record meets replay, and the hot edges

> Written 3 Oct 2026, on branch `feat/record-replay-merge`. Nothing committed yet. My pre-merge work is kept as a backup in `git stash list` ("record half 2026-10-03").

**Akshat's replay engine** (`origin/main`, 2 commits) and **my record half** now share one skill file that both sides agree on:
- skills recorded by my content script and compiled by my recorder are **replayed by his player**;
- each case was **checked end to end in headless Chrome**: record → daemon → skill → his `runSkill` / `executeWebStep` → the page's own result text.

## The merge

| What | How it was resolved |
|---|---|
| Same IIFE fix to `build.mjs` in both | his |
| `messages.ts` | his `run.step / run.check / run.end` + my trace-shaped `record.event` |
| `daemon.ts` | his `request / notify / waitForExtension` + my recording, trace and async `stopRecording` |
| `main.ts` | one input line router: a drill answer, then `approve`/`deny`, then commands. `run` takes a skill id (latest version in the skill store) or a path |
| `background.ts` | merged by git: his reconnect alarm and replay handlers; my recording hooks. **New:** the automation tab is never recorded, so a replay can't record itself |
| `skills/examples/` (deleted by him) | my golden test now checks recorder output against his `skills/real/upload-test-file.json`, on his saved snapshot of that page |

## The contract: what record writes = what replay reads

| Action | Args record writes | Change |
|---|---|---|
| `select` | `{ option }`, the visible label | was `{ value }`, which his executor never reads |
| `type` | `{ text, clear: true }` | without `clear` the text would be appended to what's there |
| `upload` | `{ file: "{{inputs.x}}" }` | target may be the input, the button that opens it, or a drop zone |
| `drag` (new) | `{ to: Locator }` | code copies both ends from the recording; the model can't change them |
| `extract` | `{ source: "google_sheet" }` or a target | new: read a sheet's rows |
| `data.pick` (new) | `{ from, where, column }` | a rule; no model at run time |
| `data.ai` (new) | `{ instruction, from, output }` | one capped model call per run; only with your OK |

Also:
- **Templates:** `{{vars.x}}` is allowed only after the step that has `save_as: x`.
- **Defaults:** a typed value the model turns into an input keeps what you typed as its `default`.
- **Approval:** a form submit gets approval, as in his skills.
- **Shadow DOM:** an element inside a shadow root keeps only role and name in its locator. His matcher looks selectors up from the document, so stored selectors could never match and would only lower the score.

## The hot edges

| Edge | Recorded as | Replayed by | Checked |
|---|---|---|---|
| **File dragged from Finder** | `drop` with name, size and date; the daemon finds the path (Spotlight, then a walk of the usual folders) → `upload` | his upload: the file input if there is one, else the files are dropped (`Input.dispatchDragEvent`) | `upload-dropzone.html` ✓ |
| **"Select files" opens a hidden input** (the YouTube pattern) | the click + the page's own `input.click()` + the pick = one `upload` (never replayed as clicks: that would open the macOS dialog in your Chrome) | the input in the button's dialog, or the only one on the page | `upload-dialog.html` ✓ |
| **Uploader in a shadow root** | `change` events don't leave shadow roots, so capture also listens on every root you touch | file-input search through shadow roots (pierced DOM) | `upload-shadow.html` ✓ |
| **Drag inside a page** | `drag` (source, landing area, HTML5 or pointer) | HTML5 drag events in the page for `draggable` sources; a trusted press, moves and release otherwise | `kanban.html`, both boards ✓ |
| **Copy → paste** | `copy` (copied text, up to 2 KB) → `extract` + `save_as`; the paste becomes `type {{vars.x}}`. **Pasted text is never stored** | the saved value | jsdom ✓ |
| **Drawn apps** (Sheets, Figma, maps) | a click with no element is flagged `drawn` and not replayed; if no copy explains it, compile reports it | — | jsdom ✓ |
| **Google Sheets, "today's row"** | on copy, the sheet's export gives the header and the copied row (one row only, never stored in the skill) → read rows + `data.pick`; the drill offers "the row whose Date is that day's date" | `extract { source: "google_sheet" }` (export fetched by the extension's background: your cookies, no CORS) → the rule picks today's row | fake sheet ✓ |

## AI: where the model is called, and the limits

| When | Calls | Limit |
|---|---|---|
| compile, after `stop` | 1 per recording (up to 3 if it must fix its JSON) | — |
| drill | 0 | — |
| a replay with rules only | **0** | — |
| `data.ai` step | 1 per run per step | `TASKPLAYER_AI_MAX_CALLS_PER_RUN` (3), `TASKPLAYER_AI_MAX_INPUT_CHARS` (20 000), answers cached by question + data |
| Akshat's agent fallback (planned) | per failed step | his to set |

**How compile decides:**
- It writes a **rule** whenever one fits (`where: { Date: "{{today}}" }`).
- It asks for a per-run AI step only with a **reason**.
- Every per-run AI step becomes a **drill question showing its token estimate**, plus the price if `NEMOTRON_PRICE_PER_MTOK` is set; no made-up prices.
- That question offers the recorded rule as the free alternative.

**The prompt now has examples of when to ask:**
- which file;
- a value that may change;
- which row;
- approval for irreversible steps;
- an unexplained drawn click.

**And of when not to:** anything the recording already proves, memory's answers, selectors, style.

## Akshat's files I changed

- `executor.ts`: upload fallbacks (dialog/page/shadow search, drop), sheet and table extract, `drag`, the file-access error message.
- `file-input.ts` (new).
- `run.ts` + `types.ts`: the `data` channel.
- `node/data-channel.ts`, `web/csv.ts` (new).
- `runner.ts`: `data` passed through.
- `replay.ts`: `isAutomationTab`, background `fetchText`.
- `skill.ts`: `drag` and `data` added, args table.
- `scripts/serve-fixtures.mjs`: the fake sheet's export.

All of these need his review.

## One finding that also affects his existing uploads

**What breaks:** through the extension, Chrome answers `DOM.setFileInputFiles` with **"Not allowed"** unless the extension has **"Allow access to file URLs"** turned on in `chrome://extensions`. The rule is Chromium's `allow_file_access_` check, which uses `MayReadLocalFiles`.

**Why tests don't catch it:** `pnpm replay`'s debug-port Chrome is trusted and never hits this.

**What changed:** the readme's setup steps now include the toggle, and the executor's error names it.

## Not verified: needs your Chrome, your login, or a key

- the real extension path over native messaging (the harness stubbed `chrome.runtime`);
- your real YouTube Studio and Google Sheet (the export's redirect, cookies from the background worker);
- a live Nemotron compile or `data.ai` call (no `.env`);
- Spotlight finding files on your disk (tests use a temp folder).

## Run it

```bash
pnpm install && pnpm build && pnpm setup:native-host
# chrome://extensions → Load unpacked → apps/extension/dist → Details → "Allow access to file URLs"
pnpm daemon
#   record → do the task in Chrome → stop → answer the questions → "replay it with: run <id>"
#   run <id> → approve
```
