# 02 · The product, the architecture, record vs replay, the folders

> *"Break down the project idea and execution along with the folder structure."*

## The product in one paragraph

From the sheet's Idea tab:

> *"A personal AI agent that you teach how to do a task once and it then runs that task autonomously on a schedule, using your own browser and apps, with the AI brain powered by Nemotron on Nebius."*

Three words in that sentence decide the whole architecture:

- **"your own browser"** forces an extension. A separately launched browser has none of your logins. ([03](03-tools-chrome-electron-openai.md))
- **"on a schedule"** forces an always-on process outside Chrome. An extension's worker dies after 30 s idle and cannot start Chrome.
- **"once"** forces a *compiled, parameterised* artefact. One demonstration has to generalise to next month's file, next week's hours and a slightly redesigned page.

## The sheet's scope, mapped onto the code

The Idea tab lists seven scope items and five layers. Each one, located:

| Sheet scope item | Lives in | Status |
|---|---|---|
| "Understanding user given context to replay as task in future" | **context layer** = `packages/recorder` + capture in `apps/extension/src/content.ts` | ⬜ [05](05-context-layer.md) |
| "Replaying and managing tasks states" | `packages/player` (step loop) + daemon run lifecycle (`design.md:181`) | ⬜ |
| "Context gathering in any point of time to support a task [gather from user or from internet]" | `extract` action (`skill.ts:12`), `on_fail.fallback: "ask"` (`skill.ts:72`), Tavily (not in code) | ⬜ |
| "Report back to user on completion" | run log + notifications (`design.md:161`, `:183`) | ⬜ |
| "User tokens/cookie management to support automations" | **dissolved**: replay runs inside the logged-in Chrome; secrets are `Input.type: "secret"` (`skill.ts:43`) | see [08](08-faq.md#do-we-need-to-pull-cookies-or-tokens-from-the-users-browser) |
| "Correction loop so a task done wrong can be corrected next time" | learn-back (`design.md:153`), skill `version` (`skill.ts:88`) | ⬜ [06](06-processing-and-learning.md) |
| "audit flow" | run log (`design.md:161`, `:196`) | ⬜ |

| Sheet "high level" layer | Code |
|---|---|
| auth management | none needed as a layer; a per-site "logged in?" check plus keychain secrets |
| task management layer [status, triggering, scheduling, deferring] | daemon: `Trigger` (`skill.ts:50`), run lifecycle (`design.md:181`) — ⬜ |
| context layer [multi-format inputs, drilling while intake] | `packages/recorder` (`capture/`, `trace.ts`, `compile.ts`, `drill.ts`) + `packages/memory` — **your part** |
| task player | `packages/player` + `run.step` handler in `apps/extension/src/background.ts:48` — Akshat |
| user interface layer [drilling to user, reporting back] | today: daemon stdin (`main.ts:12`); later a menu bar or Electron shell ([03](03-tools-chrome-electron-openai.md#q2--electron-desktop-app-or-chrome-extension)) |

---

## Q · Record vs replay

> *"explain the difference between record and replay"*

### The short answer

**Record is a compiler and replay is an interpreter, over the same channels.**

- Record watches you do the task once and writes a **skill**: a JSON program of steps, each saying *what* to touch (a locator), *what* to do (an action) and *how* to know it worked (a check).
- Replay reads that skill and performs each step through the same channel it was recorded on.

They never talk to each other directly. The skill file is the only thing that passes between them. `skill.ts:1-2`: *"The skill format: the only contract between record and replay. Record writes skills, replay reads them."*

### The perspective that makes it simple

**Record and replay do the same I/O, in opposite directions.** Both deal in the same tuple, *(target, action, value, check)*:

```
Record:  you act      →  sensors   (content script, tab events, FSEvents)  →  trace  →  compile  →  skill
Replay:  skill        →  actuators (chrome.debugger CDP, fs, AppleScript)  →  your Chrome + Mac
```

Anything else about them follows from that symmetry. **What you record must be something replay can resolve.**

- Record a DOM element's role and name, and replay can find it again by role and name.
- Record pixels, and replay can only ever use pixels.

The Cursor chat said it this way (`docs/research/cursor-chat-task-replay.md:210`): *"Recording uses them with the microphone on; replay uses them with the speaker on."*

### The three artefacts

| Artefact | Kind | Written by | Read by | Mutable? |
|---|---|---|---|---|
| **trace** | file: raw evidence, one event per line | content script + background worker + daemon FSEvents, during a demo | the compiler | never; it is the audit evidence, and you can recompile it later with a better model |
| **skill** | file: the contract | the compiler (or a human: `skills/examples/`) | the player | versioned: a fix becomes `version: 2`, and v1 is kept |
| **run log** | file: append-only | the player, every run | you, the agent fallback, debugging | append-only |

### Traced: one control, record to replay

Take step `s2` of `skills/examples/upload-invoice.json` on `fixtures/pages/upload.html`.

**Record side** (planned code, **reasoned**):

1. You click `<input type="file" name="invoice">` inside `<label>Upload invoice …</label>` (`upload.html:7`).
2. The OS file dialog opens. The page sees nothing while it is open.
3. You pick `invoice-0923.pdf`. The input fires `change`. The content script sees `input.files[0].name === "invoice-0923.pdf"`. The browser never reveals the full path to the page.
4. The content script describes the element. **Measured:** Chrome's accessibility snapshot shows this input as `button "Upload invoice"` under `heading "Documents"`.
5. The trace gets one `change` event with that descriptor and the file *name*.
6. The compiler turns "a file called `invoice-0923.pdf`" into an input with a resolver: `{dir: "~/Downloads", glob: "invoice-*.pdf", pick: "newest"}`. The drill confirms the folder with you.

**The skill that results** (this is the real file, `upload-invoice.json:22-34`):

```json
{
  "id": "s2", "intent": "Attach the invoice", "channel": "web", "action": "upload",
  "target": {
    "role": "button", "name": "Upload invoice", "near": "Documents",
    "fallbacks": ["input[type=file][name=invoice]", "//section[h2='Documents']//input[@type='file']"]
  },
  "args": { "file": "{{inputs.invoice}}" },
  "check": { "text_visible": "{{inputs.invoice.name}}" }
}
```

**Replay side** (planned code, per `design.md:141-151`):

1. Resolve `{{inputs.invoice}}`: the newest `invoice-*.pdf` in Downloads, giving an absolute path.
2. Find the element. Try role+name first, then near, then each fallback.
3. Act: CDP `DOM.setFileInputFiles({ backendNodeId, files: [path] })`. No click and no OS dialog.
4. Check: wait until the text `invoice-0923.pdf` is visible. On `upload.html` the page script writes it into `#chosen` (`upload.html:15`).

Notice what the two sides did *not* share. Record saw a click plus an OS dialog plus a `change` event. Replay does a single CDP call. **The skill stores the intent and the target, not the gestures.** That is why the compiler sits between the two.

### What record and replay are NOT

- **Not two different stacks.** Both use the extension for the web and the daemon for files. Picking Playwright for one and the extension for the other would break the symmetry ([03](03-tools-chrome-electron-openai.md)).
- **Not a macro tape.** A macro replays gestures. The skill replays intents against freshly located targets.
- **Not an LLM agent loop.** Replay calls Nemotron only when a step fails its deterministic match or check (`design.md:132`). A clean run makes zero model calls.

---

## The architecture: three processes, one file format

![Architecture](../architecture.png)

`design.md:32`: *"the daemon owns skills, memory, triggers and the LLM; the extension and the Mac actuator only observe (record) and act (replay)."*

| Process | Why it must exist | What breaks without it |
|---|---|---|
| **Extension** (service worker + content scripts) | It is the only code inside the user's real Chrome profile ([03](03-tools-chrome-electron-openai.md)) | No logins and no cookies, so most real tasks fail |
| **Daemon** (always-on Node) | It survives Chrome closing, holds the API key, sees the filesystem, runs schedules | The 30 s service-worker death; no fs tasks; the API key ends up shipped in the extension |
| **Native host shim** | Chrome *launches* a fresh process per `connectNative` call, so it cannot connect to an already-running daemon | The extension cannot reach the daemon at all |

### Why the shim, mechanically

Chrome's native messaging works like this: the extension calls `chrome.runtime.connectNative("com.taskplayer.daemon")`. Chrome looks up the host manifest that `install-native-host.ts:32-38` wrote, **spawns** the program at its `path`, and talks to it over that process's stdin and stdout.

That spawned process is new every time. It cannot *be* the always-on daemon, which was started earlier by you or at login. So the spawned program is a ~30-line pipe (`native-host/main.ts`):

```ts
const socket = connect(path);                 // :11  the daemon's Unix socket
socket.once("connect", () => {
  process.stdin.pipe(socket);                 // :16  Chrome → daemon
  socket.pipe(process.stdout);                // :17  daemon → Chrome
});
```

It doesn't parse anything. That works because the daemon's socket uses **the same framing as Chrome**: a 4-byte little-endian length followed by UTF-8 JSON (`framing.ts:1-3`). So bytes can be forwarded unchanged.

Three properties follow:

- **Only the extension can open the connection.** So it connects on startup and keeps the port open (`background.ts:18-31`).
- **An open native port keeps the service worker alive.** Doc-verified: Chrome 105+, via `connectNative`. The port is the keepalive as well as the pipe.
- **If the daemon is down, the shim says so and exits.** It sends `{type:"daemon.offline"}` (`native-host/main.ts:24`), and the extension retries.

---

## Folder structure, annotated

Status: ✅ built and tested · 🟡 partial or stub · ⬜ planned · 🔴 broken. Ownership comes from `readme.md:101-107` and the Sprint 2 split in the sheet.

```
.
├── packages/                      shared TypeScript, consumed as source (no build step)
│   ├── core/            JOINT     ★ the contract
│   │   └── src/
│   │       ├── skill.ts           ✅ Skill, Step, Locator, Check, Input, Trigger + ACTIONS per channel
│   │       ├── descriptor.ts      🟡 ElementDescriptor type; describeElement() is TODO
│   │       ├── messages.ts        ✅ every extension⇄daemon message (zod discriminated union)
│   │       └── skill.test.ts      ✅ validates skills/examples/*, defaults, refinements
│   ├── ipc/             JOINT     ✅ framing.ts (length-prefix, 1 MB cap), paths.ts (socket path)
│   ├── llm/             JOINT     ✅ chat() for an OpenAI-compatible endpoint; text-only messages
│   ├── memory/          JOINT     🟡 MemoryStore interface; SQLite + FTS5 is TODO
│   ├── recorder/        RUSHIL    ⬜ capture/ · trace.ts · compile.ts · drill.ts        ← your Sprint 2
│   └── player/          AKSHAT    ⬜ run.ts · match.ts · channels/ · agent.ts · learnback.ts
├── apps/
│   ├── extension/                 Chrome MV3, bundled by esbuild into dist/
│   │   ├── manifest.json          ✅ key pins ID eloljjdi…; permissions incl. debugger, nativeMessaging
│   │   ├── build.mjs              🔴 bundles content.ts as ESM; content scripts must be classic
│   │   └── src/
│   │       ├── background.ts AKSHAT 🟡 native port + record relay; run.step TODO
│   │       └── content.ts   RUSHIL  🟡 knows if a session is active; no listeners yet
│   ├── native-host/     AKSHAT    ✅ the shim
│   └── daemon/          AKSHAT    🟡 socket server ✅, sessions ✅, trace persistence TODO, runs TODO
├── skills/examples/     JOINT     ✅ upload-invoice, log-weekly-hours (⚠ role), tidy-screenshots
├── fixtures/pages/                ✅ upload.html, upload-drifted.html, timesheet.html   (pnpm fixtures)
├── scripts/                       ✅ serve-fixtures.mjs, install-native-host.ts
├── docs/                          design.md, architecture.png, research/, guide/ (this)
└── .github/                       CI: lint, typecheck, test, build (pnpm)
```

### Where your Sprint 2 code will go (proposed)

```
packages/core/src/trace.ts             NEW  JOINT   TraceEvent zod schema (the compiler's input contract)
apps/extension/src/describe.ts         NEW  JOINT   describeElement(el), used by recorder AND player
apps/extension/src/content.ts          EDIT RUSHIL  capture-phase listeners → record.event
apps/extension/build.mjs               EDIT JOINT   content entry → format "iife"
apps/daemon/src/trace-store.ts         NEW  JOINT   append record.event to traces/<sessionId>.jsonl
packages/recorder/src/trace.ts         NEW  RUSHIL  normalise(): drop noise, merge keystrokes, segment
packages/recorder/src/compile.ts       NEW  RUSHIL  normalised trace → Skill via chat() + Skill.safeParse
packages/recorder/src/drill.ts         NEW  RUSHIL  questions[] → answers (stdin first) → skill + memory
fixtures/traces/*.jsonl                NEW  RUSHIL  real recorded traces, used as compiler test inputs
```

"JOINT" means the file is shared: `readme.md:105` says core changes need a review from both sides. `describe.ts` is joint because `descriptor.ts:15-16` says *"Both the recorder (on the clicked element) and the player (on each candidate) call it."*

### Execution: how the pieces arrive over the sprints

| Sprint | Dates (real weekdays) | Outcome |
|---|---|---|
| 1 | Tue 22 Sep – Mon 28 Sep | Architecture. Sheet: "full carryover" |
| **2** | **Tue 29 Sep – Mon 5 Oct** | Scaffold + bridge (done). **Record a real trace → compile a skill → Akshat replays it on `upload.html`** |
| 3 | Tue 6 – Mon 12 Oct | Drill + memory, matcher fallbacks + agent + learn-back on `upload-drifted.html`, triggers |
| 4 | Tue 13 – Mon 19 Oct | Run log, reports, hosted sandbox + demo URL, optional Electron shell |
| 5 | Tue 20 – Thu 22 Oct | Freeze, bug-bash, video |
| — | Fri 23 – Thu 29 Oct | Eval, then submission (sheet). Deadline Fri 30 Oct |
