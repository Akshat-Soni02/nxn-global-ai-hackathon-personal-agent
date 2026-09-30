## The project is based of the following concept:
Its an smart automation layer but works for any kind of task we generally do at work. to setup a task you show it how its done (by a screen recording(stretch goal) or in natural language where it might drill you if it has any questions) then it smartly manages the task. The smart layer supports - understand a new task so later on system can replay it, decision making for any common occuring situations (like layout drifts), context gathering while doing the task etc. Its an always on system which differentiates it and make it fully autonomous

Built for the Personal AI track of the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/): an always-on, private assistant with persistent memory and reusable skills, running on an NVIDIA Nemotron model served from our own Nebius Serverless endpoint.

## How it works

Design doc: [`docs/design.md`](docs/design.md) (snapshot) · [live doc](https://claude.ai/code/artifact/bb2b5b8e-9038-4eed-af7c-e9067173767a) (team only)

![Architecture](docs/architecture.png)

```
Menu-bar daemon (triggers, skill store, memory, LLM layer, run log)
   ├── Chrome extension ── content script (record) + chrome.debugger (replay)
   │        ↕ native messaging
   └── Mac actuator ── fs / AppleScript / Shortcuts first, Accessibility (AX) post-v1
```

Record and replay are two modes over the **same channels**. Record writes a **skill**; replay reads it. The skill format (`packages/core/src/skill.ts`) is the contract between the two, and changes to it are agreed by both sides.

### Record

Turns one demonstration (or a natural-language description) into a parameterised skill.

1. **Capture**: the user presses Record and does the task in their own Chrome and on their Mac.
2. **Trace**: sensors write timestamped events, each with a snapshot of its target.
   - Web pages: extension content script (click, input, change, submit, key presses, file-input change, navigation, frame/shadow-DOM path).
   - Tabs and windows: extension background worker (`chrome.tabs`, `chrome.webNavigation`, `chrome.downloads`).
   - Filesystem: daemon (FSEvents): files created, moved, renamed.
   - Native apps (post-v1): daemon (AX observer + event tap), bound to the AX element, never raw coordinates.
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
│   ├── recorder/      # RECORD  trace normaliser, compiler, drill questions
│   └── player/        # REPLAY  step loop, matcher, channels, agent fallback, learn-back
├── apps/
│   ├── extension/     # Chrome MV3 extension: background worker (native port, chrome.debugger), content script
│   └── daemon/        # Node daemon: native messaging host, skill store, triggers, fs/script channels, run log
├── skills/examples/   # hand-written skills; the schema tests validate every file here
├── fixtures/pages/    # local test pages, including a "drifted" redesign, for replay tests
├── scripts/           # dev helpers (fixture server)
├── docs/              # design doc snapshot, architecture diagram, research notes
└── .github/           # CI (lint, typecheck, test, build) and CODEOWNERS template
```

**Who touches what**

| Area | Owner | Rule |
| --- | --- | --- |
| `packages/core`, `packages/llm`, `packages/memory`, `skills/` | Both | Changes need a review from both sides; the skill schema is the contract |
| `packages/recorder`, recording code in `apps/extension/src/content.ts` | Record | |
| `packages/player`, replay code in `apps/extension/src/background.ts`, `apps/daemon` | Replay | |

Workspace packages are consumed as TypeScript source (no build step); only the extension is bundled (esbuild).

## Running Guide

**Prerequisites**: macOS, Node 22+, pnpm 10, Google Chrome.

```sh
pnpm install
cp .env.example .env        # fill in the Nebius endpoint, API key and Nemotron model

pnpm test                   # schema + framing tests
pnpm typecheck
pnpm lint                   # Biome; `pnpm format` to auto-fix

pnpm fixtures               # serves fixtures/pages on http://localhost:5173
pnpm extension              # builds apps/extension/dist in watch mode
pnpm daemon                 # runs the daemon in watch mode
```

**Load the extension**: open `chrome://extensions`, enable Developer mode, click "Load unpacked" and pick `apps/extension/dist`.

**Connect extension ↔ daemon**: Chrome starts the daemon itself through a native messaging host manifest. Installing that manifest is not scripted yet (TODO in milestone 0). Until then, the daemon's framing can be exercised by the tests in `apps/daemon/src/native-messaging.test.ts`.

## Deployed Link
<!-- populate later -->

## Deployment Guide
<!-- populate later -->

## License

[MIT](LICENSE)
