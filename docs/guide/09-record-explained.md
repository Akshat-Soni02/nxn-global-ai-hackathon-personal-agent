# 09 · Record, explained and built

> **After the merge with Akshat's replay (3 Oct):** some contract details below changed: select writes `{option}`, type writes `{text, clear}`, the golden test now checks against `skills/real/`. See [10](10-merge-and-hot-edges.md) for the current contract and the hot edges.

**Part A** answers the questions you asked, briefly. **Part B** is what was built to make record work end to end, and why each piece is built that way. **Part C** covers how to run it and what's still open.

---

## Part A · Your questions

### Mac events: how are they captured? Is it the macOS AX API?

> *"what bout the mac events, how is it handled ? is there a mac api used as it was mentioned AX in the code base or something else."*

- **v1 captures Mac *files*, not Mac *clicks*.** The daemon watches folders through **FSEvents**, the macOS file-change API. Node's `fs.watch(dir, { recursive: true })` uses it on macOS. It records files that were created, moved or renamed while you record (`design.md:84`).
- **AX** is the macOS Accessibility API, the one VoiceOver uses. Capturing clicks in native apps needs:
  - an AX observer plus a keyboard/mouse event tap,
  - in a small native helper (Swift),
  - with the Accessibility permission granted in System Settings.

  That is **post-v1** (`design.md:27`, `:85`). In the code, `ax` is only a channel *name* (`skill.ts:6`). Nothing implements it.
- **Why files first:** most "Mac steps" in real tasks are file steps: download → rename → move → upload. Those replay without any UI (the `fs` channel), so they're cheap and reliable to replay.

### Doing a task that uses both Mac and browser: how does it all get captured?

> *"how i use both mac and browser based tasks then how the instructions or events gets captured by the script ? does the content script only for browser or mac events as well"*

- **The content script only sees web pages.** It's injected into each page and frame, and can't see Finder or the filesystem.
- **Mac events come from the daemon.** Both streams land in **one trace file**, ordered by time (`at`), so one recording can mix them (`design.md:72`):

```
you click "Download" in Chrome   → content script   → click        ┐
Chrome finishes the download     → ext. background  → download     │  one trace, ordered by `at`
you rename it in Finder          → daemon (FSEvents) → fs_rename   │  traces/<session>.jsonl
you upload it on another site    → content script   → click + file ┘
```

### The dark box in the architecture map: what does it do?

It's the **skill file, version 1**, drawn as real JSON. It doesn't run anything. It is the *output* of record and the *input* of replay, and the only thing the two halves share.

- "No x/y anywhere" means each element is stored by meaning: role, name, label, nearby heading, plus backup selectors.
- "Learn-back saves version 2" means that when replay fixes a broken step, the fix is written as a *new file* next to v1.

### "Plain code copies the locators": what does the locator do there?

> *(image 8, the compile box)* *"what does the locator do over here"*

A **locator** is the `target` of a step: how replay will find the element again (`skill.ts:20-29`).

- The **model never writes a locator.** It only writes the words: intents, inputs, checks, approvals and questions.
- **Code** then copies the element description recorded at click time into the step (`toLocator`, in `packages/recorder/src/locator.ts`).

The reason is that a model retyping `//section[h2='Documents']//input[@type='file']` will occasionally get one character wrong. A wrong selector fails silently at replay; a copied one can't be wrong.

### When is the drill called? Every time, or like a notification?

- **Once per recording**: right after compile, before v1 is saved. And **only if** the compiler has questions.
- **Never during replays.** If replay gets stuck at run time, that's a different thing: "ask" on failure, a `waiting_user` run state (`design.md:181`).
- **Today** the questions appear in the daemon's terminal. Pressing Enter takes the default. In the desktop app it becomes a notification card ("2 questions about *Upload invoice*").

### What does memory do in this product?

Memory is a small local database: SQLite, at `…/TaskPlayer/memory.db`.

| Who writes | What | Who reads it, and when |
|---|---|---|
| the drill | your durable answers ("invoices always arrive in ~/Downloads") | the **next compile**, so it doesn't ask again |
| replay (later) | values pulled off pages; site notes ("cookie banner first") | later steps and runs, the agent fallback |

Memory never stores secrets (`design.md:174`).

### Skill versions: when is a new one made, where is it stored, and which one is used?

- **Stored at:** `~/Library/Application Support/TaskPlayer/skills/<id>/v1.json`, `v2.json`, …
- **A new version is made when:**
  - you record the same skill again (the drill asks: "new version or new skill?"), or
  - replay's learn-back fixes a step and you approve it (`design.md:153`).
- **A version is never overwritten.** The file is created with exclusive mode, so if it already exists the save fails rather than replacing it.
- **Which one is used:** the **highest version number**. Older versions stay as fallbacks and history.

### Is this how record flows? (your sketch)

Yes. The "session id + … + …" that the service worker adds is:

```
{ ...event from the page,   // what you did and the element, by meaning
  sessionId,                 // which recording
  tabId, frameId, url }      // which tab and frame it came from (from `sender`, background.ts)
```

After the native host it continues: daemon → `traces/<sessionId>.jsonl` → on **stop**: normalise → compile (AI) → drill → `skills/<id>/vN.json`.

### How does the content script get into Chrome? Why listeners? What instead of ESM?

- **Injection:**
  - The manifest's `content_scripts` entry tells Chrome to inject `content.js` into **every page and every frame**, at `document_start` (`manifest.json:11-18`). You don't call anything.
  - One gap: tabs that were already open *before* the extension was installed or reloaded don't have it. So at `record.start`, the background now injects it into them with `chrome.scripting.executeScript`.
- **Why listeners:** a page doesn't report what you do. A listener is the only way to be told "a click just happened on *this* element". They run in the **capture phase**, so a page that stops events can't hide them.
- **Why not ESM:** Chrome loads content scripts as **classic scripts**, not modules. The old build emitted ES-module syntax (an `export`), which a classic script can't parse, so the file never ran. The fix is to bundle `content.js` as an **IIFE**: one self-contained function with no `import` or `export`. The background script can stay a module, because the manifest declares it as one (`"type": "module"`).

### Auth: sessions, cookies, tokens

> *(Sprint 1 sheet)* *"Interface to reliably pull token/cookie from user's browser live · if not found fallback to input from user · APIs to handle state capturing of token"*

**Nothing has to be pulled.** Replay runs *inside* your own logged-in Chrome, so every page already carries your cookies and session. That's the whole point of the extension design ([08](08-faq.md#do-we-need-to-pull-cookies-or-tokens-from-the-users-browser)).

| Need | How |
|---|---|
| Passwords during **record** | **Never recorded.** The content script sends `secret: true` with no value; the skill gets a `secret` input (`skill.ts:43`) |
| Logging in during an **unattended run** | The secret input is filled from the **macOS Keychain** at run time (`design.md:191`). Replay side |
| Session expired, no saved password | Run → `waiting_user` (`design.md:181`) → "log in to X, then resume". Replay side |
| 2FA / OTP / CAPTCHA | Pause and ask. Never automated |
| A site with an API instead of a UI | Only then would a token matter: store it as a `secret` input in the Keychain. Still no cookie scraping |

---

## Part B · What was built, and why this way

Record now runs end to end:

```
page ── content script ──record.event──▶ background (+ tab, frame, url) ──▶ helper ──▶ daemon
                                                                                     │
           Finder / Downloads ── FSEvents (daemon) ─────────────────────────────────▶├─ traces/<session>.jsonl
                                                                                     │
stop ─▶ normalise (code) ─▶ skeleton (code) ─▶ compile (Nemotron) ─▶ drill (you) ─▶ skills/<id>/vN.json
                                                        ▲                  │
                                                        └──── memory.db ◀──┘
```

### The pieces

| # | Piece | File | What it does | Why this way |
|---|---|---|---|---|
| 1 | **Trace format** | `packages/core/src/trace.ts`, `messages.ts` | 14 named event kinds; `record.event` uses exactly these fields | A typo'd kind is now rejected at the daemon (tested), instead of silently confusing the compiler |
| 2 | **Build fix** | `apps/extension/build.mjs` | `content.js` is built as an IIFE; the background stays ESM | Content scripts are classic scripts. **Measured:** the old build never ran; the new one loads in Chrome |
| 3 | **Describe an element** | `apps/extension/src/describe.ts` | role, name, label, nearby heading, attributes, CSS + XPath | Role and name use Chrome's rules, with one override: a file input is a `button`, which **measured** as Chrome's answer. A selector is kept only if it finds the same element again (echo). The XPath hangs off the section heading, which is the one selector that survived `upload-drifted.html` |
| 4 | **Capture** | `apps/extension/src/capture.ts` | listeners in the capture phase; describes on `pointerdown`, sends on `click` | <ul><li>Describing early beats pages that re-render on click.</li><li>Typing becomes one value, and it's sent *before* Enter.</li><li>Passwords and OTP codes never leave the page.</li><li>A picked file is recorded by name only.</li><li>Core is imported as types only, so zod stays out of every page: `content.js` is 43 KB</li></ul> |
| 5 | **Background hooks** | `apps/extension/src/background.ts` | adds tab/frame/url from `sender`; records navigations, tabs and finished downloads; injects the content script into tabs opened before install | Only the background knows which tab and frame an event came from. A download's path is what links a web step to a later file step |
| 6 | **Trace store** | `apps/daemon/src/trace-store.ts` | appends one JSON line per event | Append-only: a crash loses at most one line, and the trace can be recompiled later (`compile <session>`) |
| 7 | **Mac files** | `apps/daemon/src/fs-watch.ts` | FSEvents on `~/Downloads` and `~/Desktop` (set with `TASKPLAYER_WATCH_DIRS`) → create, move, rename | Matches by inode to tell a move from delete+create. Ignores `.crdownload`, `.DS_Store` and dotfiles. A macOS privacy block is logged loudly instead of failing silently |
| 8 | **Normalise** | `packages/recorder/src/normalise.ts` | rules only, no AI | <ul><li>Many keystrokes become one value.</li><li>Click + file pick become one `upload`.</li><li>A focus click is dropped.</li><li>A navigation caused by a click becomes that click's check.</li><li>A starting page is added.</li><li>Values likely to change are flagged.</li></ul>Stable input means testable output, and fewer tokens |
| 9 | **Skeleton + locator** | `skeleton.ts`, `locator.ts` | code writes every channel, action, target and recorded value | A complete, valid skill even with no model. Risky buttons (`Submit`, `Pay`, …) get `requires_approval`. Paths become `~/…` |
| 10 | **Compile (AI)** | `packages/recorder/src/compile.ts` | Nemotron adds intents, inputs, checks, approvals, triggers and questions, **by step id** | <ul><li>The model can't write targets, channels or actions.</li><li>It can add an approval, never remove one.</li><li>A `navigate` can't leave the recorded site.</li><li>Every `{{inputs.X}}` must be declared.</li><li>Failures go back to the model with the errors, at most 3 tries.</li><li>`<think>` blocks and code fences are stripped.</li><li>If the model is down or never valid, the skeleton is saved, so the recording is never lost</li></ul> |
| 11 | **Drill** | `packages/recorder/src/drill.ts` | asks once; writes each answer at its path; re-validates | Answers can't touch `target`, `channel` or `action`. Lasting answers go to memory |
| 12 | **Memory** | `packages/memory/src/sqlite.ts` | SQLite + full-text search via Node's built-in `node:sqlite` | No native module to compile. Each word is quoted, so any text is a safe query |
| 13 | **Skill store** | `apps/daemon/src/skill-store.ts` | `skills/<id>/vN.json`, written with `wx`, so a file is never overwritten | The highest version is the active one. If the id is already taken, the drill asks "next version or new skill?" |
| 14 | **Daemon** | `daemon.ts` (hooks), `record.ts`, `main.ts` | `stop` → compile → drill → save. Also loads `.env` | Commands: `record`, `stop`, `compile <session>`, `skills`, `traces`, `status` |

**Owner note:** `daemon.ts`, `background.ts` and `messages.ts` are Akshat's. They only got thin hooks, and three of the changes need his review:
- `record.event` is now the `TraceEvent` shape;
- `stopRecording()` is now `async` and returns the session id;
- `background.ts` has the new `record()` helper and injects the content script into existing tabs.

### How it was checked

| Check | Result |
|---|---|
| `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | all pass. **41 tests**: the 12 that already existed, plus 29 new |
| **Golden test**: recording of `upload.html` → compile, with a scripted model answer → compared with `skills/examples/upload-invoice.json` | same actions, target (role, name, near, fallbacks), args, inputs and success; Submit needs approval |
| **Real Chrome** (headless, throwaway profile): built `content.js` injected into the fixtures, driven with real mouse and keyboard input over CDP; the file picked via `DOM.setFileInputFiles` | <ul><li>Loads.</li><li>Every recorded role and name matches Chrome's accessibility tree.</li><li>The selectors equal the example's fallbacks.</li><li>It **found a bug**: Enter in a form also fires a click on "Save draft", which would replay as a double submit. Now fixed in capture, with a backstop in normalise</li></ul> |
| Those real events → a live daemon socket → stop | saved `upload-invoice v1` (3 steps) and `timesheet v1` (4 steps) |
| `main.ts` with temp folders | starts, records, stops, lists commands |

**Not checked yet, and needs you:**
- **A live Nemotron call.** There's no `.env`. Fill `NEBIUS_BASE_URL`, `NEBIUS_API_KEY` and `NEMOTRON_MODEL`. If the endpoint rejects `response_format`, the client retries without it.
- **The whole loop in your own Chrome over native messaging.**
  - The Chrome test stubbed `chrome.runtime`.
  - The background hooks (navigation, tabs, downloads, injection into existing tabs) typecheck but haven't run in a real extension yet.
- **FSEvents on your real `~/Downloads` and `~/Desktop`.** It was tested on a temp folder. macOS may ask your terminal for folder access the first time.

## Part C · Run it, and what's left

```bash
corepack enable                 # once: gives you pnpm
pnpm install && pnpm build
pnpm setup:native-host          # once: lets Chrome start the helper
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist   (reload it after every build)
cp .env.example .env            # optional: fill NEBIUS_* to compile with Nemotron
pnpm fixtures                   # optional: test pages on http://localhost:5173
pnpm daemon                     # type: record → do the task in Chrome → stop → answer → skills
```

Files land in `~/Library/Application Support/TaskPlayer/`: `traces/`, `skills/` and `memory.db`.

**Still open (decisions, not bugs):**
- **How long to keep traces.** Today they're kept forever.
- **Which Nemotron model ID** to use for compile.
- **The role of a number field.** `skills/examples/log-weekly-hours.json:31` says `textbox`, but Chrome (and now the recorder) says `spinbutton`. Agree with Akshat which one the matcher should treat as equal.

**Out of scope here, on purpose:**
- AX / native-app clicks (post-v1);
- dry run (needs the player);
- describing a task in words (natural language);
- learn-back;
- everything in replay.

**The diagrams are now behind the code.** In `architecture-map` and `how-it-works`:
- the content script, capture, trace store, normalise, compile, drill, memory and skill store are now **BUILT**;
- the content script is no longer BROKEN;
- replay hasn't changed.

They haven't been redrawn yet.
