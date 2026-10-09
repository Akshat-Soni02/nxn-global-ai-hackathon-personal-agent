# 01 · Status today, and design vs dossier vs code

> **Superseded (Oct 8, 2026).** This note describes the flat-skill flow from before the workflow pivot (describe + record with screenshots and voice → editable workflow tree → self-correcting replay). It is kept as history; the current design is [docs/design.md](../design.md).

## Q1 · What exists today?

> *"understand the codebase end-to-end. explain whats the current thing/status"*

### The short answer

Commit `351a7ea` (30 Sep) has three things:

- **The contract**: the `Skill` zod schema and three example skills.
- **The pipe**: daemon ⇄ Unix socket ⇄ native host ⇄ Chrome extension, with record start/stop wired through it. **From code.** Daemon-socket tests exist (`daemon.test.ts`) but did not run in this checkout ([below](#measured-the-test-suite-in-this-checkout)). The real Chrome hop was not exercised here.
- **The empty rooms**: `packages/recorder`, `packages/player` and `packages/memory` are comment-only or interface-only, and the content script captures nothing.

**The plumbing is built; nothing that touches a web page exists yet.**

### The repo in one table

| Component | File | State | Evidence |
|---|---|---|---|
| Skill schema (the contract) | `packages/core/src/skill.ts` | ✅ built; tests exist, **not run here** (zod missing under npm) | Test validates the 3 example skills (`skill.test.ts:9`) |
| Element descriptor type | `packages/core/src/descriptor.ts` | 🟡 type only | `describeElement` is a TODO at `descriptor.ts:15` |
| Extension⇄daemon messages | `packages/core/src/messages.ts` | ✅ built | `hello`, `ping`, `record.start/stop/event`, `run.step/step_result` |
| Length-prefixed framing | `packages/ipc/src/framing.ts` | ✅ built, **tests passed here** | Split-chunk and 1 MB tests (`framing.test.ts:5`, `:20`) |
| Socket path (macOS 103-byte limit) | `packages/ipc/src/paths.ts` | ✅ built, **test passed here** | `paths.ts:10`, `framing.test.ts:26` |
| Daemon socket server | `apps/daemon/src/server.ts` | ✅ built; tests exist, **not run here** | Stale-socket cleanup `server.ts:19-22`; double start refused (`daemon.test.ts:58`) |
| Daemon core: recording sessions | `apps/daemon/src/daemon.ts` | 🟡 sessions work; events are dropped | `record.event` only logs: `daemon.ts:50-53` |
| Daemon UI | `apps/daemon/src/main.ts` | 🟡 stdin commands `record`, `stop`, `status` | `main.ts:12-18` |
| Native host shim | `apps/native-host/src/main.ts` | ✅ built | Pipes stdin⇄socket; replies `daemon.offline` if the daemon is down (`:20-26`) |
| Host installer | `scripts/install-native-host.ts` | ✅ built (macOS paths only) | `:14` |
| Extension service worker | `apps/extension/src/background.ts` | 🟡 connects, relays record start/stop | `run.step` is a TODO: `:48-50` |
| Content script (capture) | `apps/extension/src/content.ts` | 🔴 no listeners, **and the build output will not load** (see below) | `:2-3` TODO; `:18` `export` |
| LLM client | `packages/llm/src/index.ts` | ✅ written, never called, never tested | `chat()` `:26`; text-only messages `:13` |
| Memory | `packages/memory/src/index.ts` | 🟡 interface only | SQLite+FTS5 TODO `:22` |
| Recorder | `packages/recorder/src/index.ts` | ⬜ comment listing planned modules | `capture/`, `trace.ts`, `compile.ts`, `drill.ts` |
| Player | `packages/player/src/index.ts` | ⬜ comment listing planned modules | `run.ts`, `match.ts`, `channels/`, `agent.ts`, `learnback.ts` |
| Test pages | `fixtures/pages/*.html` | ✅ | `upload.html`, `upload-drifted.html` (a "redesign"), `timesheet.html` |
| Example skills | `skills/examples/*.json` | ✅ validate; ⚠ one would not replay (see below) | |

### Traced: what actually happens today when you type `record`

The only flow that runs end to end. Following it is the fastest way to learn the codebase, because every hop is a real file:

```
you type "record" in the daemon terminal
 └─ main.ts:14            daemon.startRecording()
     └─ daemon.ts:68      sessionId ??= randomUUID()          ← the daemon owns the session
     └─ daemon.ts:70      broadcast {type:"record.start", sessionId}
         └─ server.ts:26  socket.write(encode(message))       ← 4-byte length + JSON
             └─ native-host/main.ts:17   socket.pipe(process.stdout)   ← bytes forwarded unparsed
                 └─ Chrome native messaging → extension port
                     └─ background.ts:42  case "record.start": setRecording(sessionId)
                         └─ background.ts:61  chrome.tabs.sendMessage(tab.id, {type:"recording", sessionId})
                             └─ content.ts:8   sessionId = message.sessionId
                                 └─ … nothing. content.ts:2 "TODO(recorder): add listeners"
```

The return path is wired up but unused. A content script would call `chrome.runtime.sendMessage({type:"record.event", …})`. `background.ts:69` adds the `sessionId` and posts it to the port. The daemon parses it with `Message.safeParse` (`daemon.ts:33`) and then only logs it (`daemon.ts:52`).

Two details in this trace are deliberate:

- **An extension that connects mid-session joins the recording.** `daemon.ts:45` sends `record.start` on `hello`. A test covers this (`daemon.test.ts:44`).
- **A malformed event is dropped silently.** If your content script forgets `id` or `at`, `safeParse` fails and the daemon logs `invalid message` (`daemon.ts:34-36`). Nothing reaches the extension. Read the daemon's stderr when an event "doesn't arrive".

### Measured: the test suite in this checkout

```
$ npx vitest run
 ❯ apps/daemon/src/daemon.test.ts (0 test)
 ❯ packages/core/src/skill.test.ts (0 test)
 FAIL  apps/daemon/src/daemon.test.ts  Error: Cannot find package '@taskplayer/ipc'
 FAIL  packages/core/src/skill.test.ts Error: Cannot find package 'zod'
 Test Files  2 failed | 1 passed (3)
      Tests  3 passed (3)
```

**Why:** this checkout was installed with **npm** (an untracked `package-lock.json` is present, and `pnpm` is not on the PATH). npm does not understand the `workspace:*` protocol (`apps/daemon/package.json:16`), so `@taskplayer/*` links and `zod` were never installed. CI uses pnpm (`.github/workflows/ci.yml:18`). The code is not broken; the install is. Fix it yourself:

```sh
rm package-lock.json && rm -rf node_modules
corepack enable          # ships with Node 22; provides pnpm@10.15.1 from package.json
pnpm install
pnpm test                # expect 3 files, 12 tests
```

(I tried a pnpm install on a scratch copy, and it was denied, so "12 green" is **reasoned**, not measured. Twelve is the number of tests in the three files: `skill.test.ts` has 3 generated from `skills/examples/` plus 3 more, and `framing.test.ts` and `daemon.test.ts` have 3 each.)

### Found while reading: four problems, with evidence

**1 · The content script build cannot load in Chrome.** *(Measured.)* `apps/extension/build.mjs:13` bundles every entry as `format: "esm"`. `content.ts:18` has `export function isRecording`. Manifest content scripts (`manifest.json:11-18`) run as **classic** scripts, which have no `export`. I bundled `content.ts` the same way `build.mjs` does, then parsed the output as a classic script:

```
16	export {
17	  isRecording
18	};
--- parse as classic script:
FAILS: SyntaxError: Unexpected token 'export'
```

The V8 classic-script parse is a proxy. I did not load it in Chrome itself. But the consequence is direct: the script throws on every page, so **no recording listener you add to `content.ts` would ever run.** The fix is two lines:

- build the `content` entry with `format: "iife"`. The background entry stays `esm`, because `manifest.json:9` declares `"type": "module"`.
- drop the `export`.

This is the first task on your path ([07](07-how-to-proceed.md)).

**2 · One example skill would fail on the page it was written for.** *(Measured.)* Chrome's accessibility snapshot of `fixtures/pages/timesheet.html`:

```yaml
- combobox "Project" [ref=f2e5]
- spinbutton "Hours" [ref=f2e7]        ← <input type="number">
- button "Save draft" [ref=f2e8]
```

`skills/examples/log-weekly-hours.json:31` says `"role": "textbox", "label": "Hours"`. A matcher that requires an exact role would find nothing. The schema test still passes, because *validates* does not mean *replays*. Two lessons:

- the recorder must take roles from the browser, never guess them.
- Akshat's matcher should treat `textbox`, `spinbutton` and `searchbox` as equivalent, or the example must be fixed. Raise this as a joint decision.

**3 · The extension may not reconnect "within a minute".** *(Reasoned, plus Doc-verified.)* `background.ts:27` schedules the reconnect with `setTimeout`, with backoff up to 60 s (`:7`). Chrome's lifecycle doc says:

> **Doc-verified:** the worker stops *"after 30 seconds of inactivity. Receiving an event or calling an extension API resets this timer."*

The same doc lists what keeps the worker alive, and timers are not on the list:

- Chrome 105+: `connectNative`.
- Chrome 118+: debugger sessions.
- Chrome 116+: WebSockets.

So once the daemon is down and the port has closed, a 32 s or 64 s timer can die with the worker. In practice the worker restarts on the next page load, because `content.ts:11` messages it and `background.ts:74` calls `connectDaemon()` at top level. The real behaviour is therefore "reconnects on the next page load", not the readme's "within a minute" (`readme.md:132`). Chrome's recommended tool is `chrome.alarms` (30 s minimum since Chrome 120). This is Akshat's file, so it goes on the tracker as a replay task.

**4 · macOS only.** *(From code.)* The repo is tied to macOS in three places:

- the socket lives under `~/Library/Application Support` (`paths.ts:4`);
- the host manifest is written to the macOS Chrome directory (`install-native-host.ts:14`);
- the transport is a Unix socket.

Sheet4 wants *"download the chrome extention tho/desktop app (mac & windows)"*. Windows would need a named pipe and a registry key for the host manifest. That is fine to defer, but it is not free.

---

## Q2 · Design vs dossier vs code: are they the same?

> *"as per the architecture sketched and what my study provided, are they same ? rely on the codebase findings."*

### The short answer

**Same architecture, different names, one wrong premise.**

All three agree on the shape:

- an extension in the user's real Chrome using `chrome.debugger`;
- a local daemon over native messaging;
- a semantic skill/plan as the record↔replay contract;
- deterministic replay first, LLM only on failure;
- no Playwright;
- no coordinates;
- Mac Accessibility post-v1.

The dossier was written as if the repo were empty. It says *"a single commit containing only a `readme.md`"*. That was true of commit `6c9e0f4` and stopped being true the same day (30 Sep). Of its 18 Sprint 2 tasks:

- 1 is done (S2-01);
- 1 is half done (S2-00: the skill schema, but no trace schema);
- about 3 are partly covered (S2-02, S2-05, S2-06);
- the bridge it planned for Sprint 3 already exists.

Some of its names don't match the code.

### Name mapping: dossier word → repo word

| Dossier says | Repo has | Note |
|---|---|---|
| plan, `nxn.plan/1.0` | **skill**, `Skill` in `packages/core/src/skill.ts:86` | `design.md:14`: *"earlier drafts called these plans"* |
| `nxn.trace/0.1` | **nothing yet**; only the `record.event` message (`messages.ts:29-37`) | Your first contract to write ([05](05-context-layer.md)) |
| `packages/schema`, JSON Schema + Ajv | `packages/core`, **zod** | zod gives TS types and runtime validation from one definition. Keep zod |
| `LocatorBundle` (16 fields) | `Locator` (`skill.ts:20`) + `ElementDescriptor` (`descriptor.ts:5`) | Placeholder, test id and id go in `Locator.attrs`; neighbourhood becomes `near` |
| postconditions `post` | `check` (and `wait` for preconditions) | `skill.ts:32-40` |
| R0–R6 fallback ladder | per-step loop steps 2–9 | `design.md:141-151`; same idea, different numbering |
| heal, `plan.patch` | **learn-back**, new skill `version` | `design.md:153` |
| `com.nxn.daemon` | `com.taskplayer.daemon` | `messages.ts:9` |
| Vite/CRXJS | esbuild | `apps/extension/build.mjs` |
| Record button in the extension popup | **the daemon owns the session** | Commit `55fd9fb` *"update record activation from extention to deamon"* |
| plan runner (S2-13, "manual trigger from popup") | **daemon runs the loop**, extension executes one `run.step` at a time | `messages.ts:40`; `player/index.ts:5` |
| hosted "Acme portal" sandbox | `fixtures/pages/` served on localhost | Already includes a drifted redesign |

### Where they genuinely differ (decisions, not renames)

| Topic | design.md / code | Sheet | Dossier | What to do |
|---|---|---|---|---|
| **Where Nemotron runs** | *"our own Nebius Serverless endpoint"* (`readme.md:4`, `design.md:192`, `.env.example:1`) | *"nebius token factory with a mix of nemotron ultra, super and nano"* | Token Factory, publicly served models | **Decide at DSU.** Both are OpenAI-compatible, so `llm/index.ts` doesn't care. A dedicated endpoint costs GPU-hours; Token Factory is billed per token |
| **Which model for what** | one `NEMOTRON_MODEL` env var (`llm/index.ts:19`) | *"Ultra for learning, Nano for replay, Super for edge cases"* | Super compiles, Nano/Lightning heals | Add a per-call `model` option; you need at least two models |
| **Images / video into the model** | `ChatMessage.content: string` (`llm/index.ts:13`): **the client cannot send an image at all** | inputs include "screen recording, images" | Token Factory Nemotrons are text-only (**dossier claim**; reportedly HTTP 400) | Day-1 test: send one `image_url` part and record the response |
| **Who starts recording** | daemon (`daemon.ts:67`) | — | extension | Code wins. The daemon also needs filesystem events, which the extension cannot see |
| **Where the replay loop lives** | daemon → `run.step` per step | — | extension-side runner | Code wins. The daemon owns the LLM key (`llm/index.ts:2-3`) and the fs channel |
| **Success checks** | `url_matches`, `text_visible`, `element_visible`, `file_exists` | — | adds `networkResponse`, `downloadCompleted`, `elementGone`, `valueEquals` | Add `download_completed` additively when the first download task appears |
| **Sensitive steps** | `requires_approval: boolean` (`skill.ts:67`) | — | `sensitive: none\|secret\|external-write\|irreversible` | Boolean is enough for v1. Secrets are already an `Input.type` (`skill.ts:43`) |
| **Demo URL** | open question (`design.md:235`) | — | hosted sandbox + dashboard | Host `fixtures/pages` as the sandbox. Nearly free ([07](07-how-to-proceed.md)) |
| **Sprint 1 "Auth Management"** | not in design: replay runs *inside* the logged-in Chrome | *"Interface to reliably pull token/cookie from user's browser live"* | "Cookie management needed: almost none" | **Drop cookie pulling.** See [08 FAQ](08-faq.md#do-we-need-to-pull-cookies-or-tokens-from-the-users-browser) |

### Dossier claims that are wrong against the repo or the calendar

| Claim | Reality | Evidence |
|---|---|---|
| "The GitHub repo has a single commit containing only a `readme.md`" | 3 commits, 66 tracked files, a monorepo scaffold, schema, bridge, tests | `git log --stat`, `git ls-files` |
| Day names in its tracker ("Tue 30 Sep", "Wed 1 Oct", "Sun 5 Oct") | 30 Sep 2026 is a **Wed**, 1 Oct a **Thu**, 5 Oct a **Mon** | **Measured** with `date`; it used 2025's calendar |
| S2-01 "Monorepo scaffold" is to-do | Done | `pnpm-workspace.yaml`, `apps/*`, `packages/*` |
| S2-00 "freeze `nxn.plan` in `packages/schema` with Ajv" | Done as zod `Skill`, with 3 examples | `skill.ts`, `skills/examples/` |
| Native messaging is Sprint 3 work | Done in Sprint 2 | `apps/native-host`, `install-native-host.ts`, `daemon.test.ts` |
| Heal rung R4 "Nemotron over pruned AX snapshot" finds the element | On the repo's own drift fixture, **the hidden file input is absent from Chrome's AX tree** | **Measured**, [06](06-processing-and-learning.md#traced-replaying-upload-invoice-on-the-redesigned-page) |

### Dossier ideas worth adopting (all additive to the code)

1. **Echo verification at record time.** Right after capturing a click, resolve the descriptor you just built and check it finds the same element. This catches recorder bugs during the demo instead of during the next replay. ([04](04-capture-without-coordinates.md#echo-verification))
2. **Deterministic noise rules before any LLM call.** For example: drop clicks with no DOM change, navigation, network or focus within 1.5 s, and merge focus→type→blur. ([05](05-context-layer.md#stage-3--normalise))
3. **A per-site "logged in?" precondition taken from the recording.** For example: a "Sign out" button is visible. This replaces Sprint 1's cookie inspection.
4. **Hosted sandbox for the demo URL**, built from `fixtures/pages`.
5. **Locator history on a step**, so a heal can be reviewed and reverted. Today this is planned as "old locator kept as fallback" (`design.md:153`).

### The dossier's Sprint 2 tracker vs what the repo already has

| Dossier ID | Task | Repo status |
|---|---|---|
| S2-00 | Freeze schemas | **Skill done**; **trace not started** |
| S2-01 | Monorepo scaffold | **Done** |
| S2-02 | Hosted "Acme portal" | Partly done: `fixtures/pages`, local only |
| S2-03 | Nebius key check | Not started |
| S2-04 | Content-script listeners | Not started, and blocked by the build bug above |
| S2-05 | Locator module | Type exists (`descriptor.ts`); `describeElement` not started |
| S2-06 | Trace assembler | Messages exist; persistence is a TODO (`daemon.ts:51`) |
| S2-07 | Redaction | Not started; the rule is in `design.md:109` |
| S2-08 | Pre-pass | Not started |
| S2-09 | Super compile v0 | `chat()` exists; compiler not started |
| S2-10 | CDP actuator | Not started (`background.ts:49`) |
| S2-11 | Resolver R1–R2 | Not started (planned `player/match.ts`) |
| S2-12 | Postcondition engine | Not started |
| S2-13 | Plan runner | Not started (planned `player/run.ts`) |
| S2-14 | Drive upload spike | Not started; `fixtures/pages/upload.html` is the safer target |
| S2-15 | Echo verification | Not started |
| S2-16 | End-to-end | Not started |
| S2-17 | Sheet update | This guide |

The corrected tracker, with today's real dates, is in [07](07-how-to-proceed.md).
