## The project is based of the following concept:
Its an smart automation layer but works for any kind of task we generally do at work. to setup a task you show it how its done (by a screen recording(stretch goal) or in natural language where it might drill you if it has any questions) then it smartly manages the task. The smart layer supports - understand a new task so later on system can replay it, decision making for any common occuring situations (like layout drifts), context gathering while doing the task etc. Its an always on system which differentiates it and make it fully autonomous

Built for the Personal AI track of the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/): an always-on, private assistant with persistent memory and reusable skills, running on an NVIDIA Nemotron model served from our own Nebius Serverless endpoint.

## How it works

Design doc: [`docs/design.md`](docs/design.md) (snapshot) · [live doc](https://claude.ai/code/artifact/bb2b5b8e-9038-4eed-af7c-e9067173767a) (team only)

![Architecture](docs/architecture.png)

```
Menu-bar daemon (always on: triggers, skill store, memory, LLM layer, run log, recording sessions)
   ├── Mac actuator ── fs / AppleScript / Shortcuts first, Accessibility (AX) post-v1
   └── Unix socket
         ↕
       native-host shim (Chrome launches it; forwards bytes only)
         ↕ native messaging
       Chrome extension ── content script (record) + chrome.debugger (replay)
```

Why the shim: Chrome launches a *fresh* process for every native messaging connection, so it cannot attach to the always-on daemon directly. Only the extension can open the connection, so it connects on startup, keeps the port open and reconnects with backoff.

Record and replay are two modes over the **same channels**. Record writes a **skill**; replay reads it. The skill format (`packages/core/src/skill.ts`) is the contract between the two, and changes to it are agreed by both sides.

### Record

Turns one demonstration (or a natural-language description) into a parameterised skill.

1. **Capture**: the user presses Record (the floating desktop button of Task Player.app; without it, the button Chrome shows on every page, or the extension's toolbar icon). The **daemon owns the session**: it watches the filesystem itself and tells the extension to capture web events if Chrome is running. A Mac-only task never needs Chrome; a mixed task becomes one trace ordered by timestamp.
2. **Trace**: sensors write timestamped events, each with a snapshot of its target.
   - Web pages: extension content script (click, input, change, submit, key presses, file-input change, navigation, frame/shadow-DOM path).
   - Tabs and windows: extension background worker (`chrome.tabs`, `chrome.webNavigation`, `chrome.downloads`).
   - Filesystem: daemon (FSEvents): files created, moved, renamed.
   - Mac apps: Task Player.app (`apps/mac`) through the Accessibility API: the AX element under each click, a field's final value, shortcuts and menu paths; never raw coordinates or keystrokes (docs/guide/11-mac-apps.md).
   - Natural language: daemon chat UI, instead of or alongside a trace.
3. **Target snapshot** per event: role + accessible name, visible text/label/placeholder/`aria-*`/`id`/`data-testid`, nearby context (section heading, label), ranked fallback selectors (CSS, XPath), frame and shadow-root path, a cropped element screenshot, the URL.
4. **Compile**: an LLM turns the trace into a skill, reading memory for known facts first:
   - collapses noise (keystrokes → one `type` step, drops stray clicks),
   - extracts parameters ("newest PDF in ~/Downloads", not a fixed path),
   - picks the best channel per step (a Finder drag becomes a filesystem move),
   - adds waits and success checks,
   - marks risky steps (submit, pay, send, delete) as requiring approval.
5. **Drill**: the compiler asks clarifying questions about anything ambiguous and saves durable answers to memory.
6. **Dry run**: replay highlights each target without acting; the user confirms and the skill is saved.

Record must never store coordinates as the primary locator, never record password values (they become secret inputs), and never emit an action the replayer does not support.

### Replay

Executes a skill through the cheapest channel that works, with no LLM call unless a step fails.

**Channel preference**: API / CLI / filesystem / AppleScript → web via extension (`chrome.debugger`) → native app via AX (post-v1) → screenshot + vision model (last resort).

**Per-step loop**

1. **Resolve inputs**: fill `{{inputs.*}}` (e.g. find the newest matching file).
2. **Wait**: poll the precondition (element present and enabled, network idle, URL matches) with a timeout.
3. **Match deterministically**: score candidates by role + name → label / nearby text → fallback selectors; accept one clear winner above a threshold.
4. **Approve**: pause for the user if the step requires approval.
5. **Act**: trusted CDP input (`Input.dispatchMouseEvent`, `Input.insertText`); uploads via `DOM.setFileInputFiles` so no native Open dialog appears.
6. **Verify**: check the postcondition.
7. **Retry**: re-observe (dismiss known banners, wait longer) up to `on_fail.retries`.
8. **Agent fallback**: send the LLM the step's intent, the stored target snapshot, relevant memory and the current page; it returns a new target or short action sequence, which goes through act + verify.
9. **Escalate**: if the agent fails, pause and ask the user, showing where it stopped.

**Learn-back**: when an agent fix passes verification, propose a new skill version with the updated locator (old one kept as fallback). This is how drift handling improves over time.

**Background**: web runs in a dedicated, minimisable Chrome window. Steps that need the foreground (AX, vision) are grouped into a short "taking over" session with a notification first.

**Run log**: every step's channel, matched target, match score, action, check result, retries and agent calls.

### Memory

A local store (SQLite in the daemon) of facts, preferences, run context and site notes. The compiler and the agent read it; drill answers, `extract` steps and learn-back write to it. Never stores secrets.

## Repository Guide

TypeScript monorepo (pnpm workspaces). One language so the extension and the daemon share the same schema, descriptor and matcher code.

```
.
├── packages/
│   ├── core/          # JOINT   skill schema (zod), element descriptor, extension↔daemon messages
│   ├── llm/           # JOINT   Nemotron client for our Nebius Serverless endpoint (OpenAI-compatible)
│   ├── memory/        # JOINT   persistent memory store (interface now, SQLite later)
│   ├── ipc/           # JOINT   length-prefixed framing (native messaging + daemon socket), socket path
│   ├── recorder/      # RECORD  trace normaliser, compiler, drill questions
│   └── player/        # REPLAY  step loop, matcher, channels, agent fallback, learn-back
├── apps/
│   ├── extension/     # Chrome MV3 extension: background worker (native port, chrome.debugger), content script
│   ├── native-host/   # shim Chrome launches: pipes native messaging <-> the daemon's Unix socket
│   └── daemon/        # always-on Node daemon: socket server, recording sessions, skill store, triggers, fs/script channels
├── skills/real/       # 5 replay test skills against real sites (see skills/real/README.md)
├── fixtures/
│   ├── pages/         # local test pages, including a "drifted" redesign
│   └── snapshots/     # saved copies of the real pages; tests check every locator against them
├── scripts/           # fixture server, native host installer, sandbox seeder, page snapshots
├── docs/              # design doc snapshot, architecture diagram, research notes
└── .github/           # CI (lint, typecheck, test, build) and CODEOWNERS template
```

**Who touches what**

| Area | Owner | Rule |
| --- | --- | --- |
| `packages/core`, `packages/llm`, `packages/memory`, `packages/ipc`, `skills/` | Both | Changes need a review from both sides; the skill schema is the contract |
| `packages/recorder`, recording code in `apps/extension/src/content.ts` | Record | |
| `packages/player`, replay code in `apps/extension/src/background.ts`, `apps/daemon`, `apps/native-host` | Replay | |

Workspace packages are consumed as TypeScript source (no build step); only the extension and the native host are bundled (esbuild).

## Running Guide

**Prerequisites**: macOS, Node 22+, pnpm 10 (Node ships it through corepack: run `corepack enable pnpm` once), Google Chrome, and for Mac apps the Xcode command line tools (`swiftc`; `xcode-select --install`).

```sh
pnpm install
cp .env.example .env        # fill in the Nebius endpoint, API key and Nemotron model

pnpm test                   # schema, framing and daemon socket tests
pnpm typecheck
pnpm lint                   # Biome; `pnpm format` to auto-fix

pnpm fixtures               # serves fixtures/pages on http://localhost:5173
pnpm seed:sandbox           # creates ~/TaskPlayerTest with sample files for skills/real (--reset to start over)
pnpm snapshot:pages         # re-downloads the real pages into fixtures/snapshots
pnpm extension              # builds apps/extension/dist in watch mode
pnpm daemon                 # runs the daemon (daemon:dev = watch mode, but it also reads Enter); type record, stop (compiles the recording; answer its questions), run <skill-id | skill.json>, approve, deny, skills, traces, status
```

**Replay a skill**

```sh
pnpm seed:sandbox                                        # once: sample files in ~/TaskPlayerTest
pnpm replay skills/real/fill-web-form.json               # dev runner: separate Chrome profile, no extension needed
pnpm replay skills/real/upload-test-file.json --yes      # --yes approves gated steps; --headless, --no-scripts, --keep-open
```

`pnpm replay` launches its own debug-port Chrome (profile in `~/Library/Application Support/TaskPlayer/dev-chrome`). The production path is the daemon: type `run skills/real/<skill>.json` in `pnpm daemon`, and web steps run in an automation window of your own Chrome through the extension. Both paths share the player code, and every daemon run is logged to `~/Library/Application Support/TaskPlayer/runs/<runId>.jsonl`.

**Connect Chrome to the daemon** (once per machine):

1. `pnpm setup:native-host` builds the shim and registers it with Chrome (`--uninstall` to remove). It writes `~/Library/Application Support/TaskPlayer/native-host` and `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.taskplayer.daemon.json`.
2. Open `chrome://extensions`, enable Developer mode, click "Load unpacked" and pick `apps/extension/dist`. The manifest's `key` pins the extension ID to `eloljjdiofhdlhoankjbhfeihjankikk`, which is the only origin the host allows. Then open the extension's Details and turn on **Allow access to file URLs**: without it Chrome refuses to hand local files to a page, so upload steps fail with "Not allowed".
3. Run `pnpm daemon`. The extension reconnects within a minute, or immediately if you reload it. `status` in the daemon shows connected extensions.

**Record Mac apps and get the desktop button** (once):

1. `pnpm setup:mac` builds `apps/mac/build/Task Player.app` (rebuilt only when its sources change). `pnpm daemon` starts it; it quits when the daemon does.
2. Right-click the floating button → **Allow Mac apps**: macOS asks, then turn on Task Player in System Settings → Privacy & Security → Accessibility. The permission goes to Task Player only, never to your terminal. After a rebuild, turn it off and on again (the app is signed ad hoc, so the permission is tied to that build).
   Without it, web pages and files are still recorded; Mac apps are not. If turning it off and on doesn't take after a rebuild, run `tccutil reset Accessibility com.taskplayer.mac` and allow it again.
   Finder is recorded by what it does to files (moves, renames), not by its clicks. File moves anywhere in your home folder are recorded with no setup (macOS asks once for Desktop, Documents and Downloads when the daemon starts); a folder outside it, such as an external drive, is added when a Finder window shows it.

**Record and replay** (each time):

1. `pnpm daemon` in a terminal you can see (not `daemon:dev`: its watch mode also reads Enter, which drill answers need).
2. Press the round **record button** at the bottom right of your screen (Task Player.app, above every app; drag it anywhere). Do the task in Chrome, Finder or any Mac app, then press **Stop**. Without Task Player.app, the same button appears inside Chrome pages instead, and the extension's toolbar icon does the same.
3. The daemon compiles the recording and asks its questions **in the terminal** (Enter takes the default); the button says when one is waiting, then shows the saved skill's id.
4. If the task used a file (an upload, a file you moved), `run <id>` first asks **which file** to use this time: Enter takes the suggestion (the newest file like the one you recorded), or type a path, or drag any file from Finder into the terminal window. Or give it with the command: `run <id> ~/Desktop/new.jpeg` (type `run <id> ` and drag the file in). When you stop a recording you can instead choose "the newest of its kind" or "always this file", and then it doesn't ask. Every file is checked before the first step runs: it must exist, not be empty, and be a kind the step takes (the page's own file-field rule, else the kind you recorded with: a photo means any image). A wrong file is explained and asked for again; given with the command, it stops the run.
5. Every recording is saved as its own skill with its own id, a readable name plus a random tag (`upload-invoice-k3f9q2`), even when you record the same task again, so recordings never overwrite or mix with each other. `skills` lists them; `run` takes the whole id or just its start when only one skill matches (`run upload-invoice`). A skill saved before ids got their tag (`timesheet`) still runs by its exact name, and the daemon then lists any newer recordings of it. Versions of one skill (`v2`, `v3`) are kept for fixes to that skill.
6. `run <id>` in the terminal replays it in a separate 1280×800 Chrome window that comes to the front when the run starts, so you can watch it (Chrome shows its "started debugging this browser" bar while it runs; your own tabs aren't touched). Click back into the terminal to type `approve`. Steps that submit wait for `approve`. Each step prints ✓ or ✗.

After `git pull`, run `pnpm build` again and reload the extension in `chrome://extensions`.

The daemon listens on `~/Library/Application Support/TaskPlayer/daemon.sock`. Override it with `TASKPLAYER_SOCKET`, keeping the path at 103 bytes or less (a macOS limit for Unix sockets).

## Deployed Link
<!-- populate later -->

## Deployment Guide
<!-- populate later -->

## License

[MIT](LICENSE)
