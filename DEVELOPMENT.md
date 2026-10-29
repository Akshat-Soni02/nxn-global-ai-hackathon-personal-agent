# Running Shadow from the repository

For developers and judges who want the code running. To use Shadow, download the app instead: [Get Shadow](README.md#get-shadow). Shipping it (the service, the `.dmg`, the site) is in [`DEPLOY.md`](DEPLOY.md).

- [Quick start](#quick-start): three ways in, from free and offline to the whole product
- [Running from the repository](#running-from-the-repository): full setup, running it, and [troubleshooting](#troubleshooting)
- [Reference](#reference): terminal commands, the daemon's API, development, repository guide

## Quick start

**You need:**
- macOS 14 or later, Node 22 or later, and Google Chrome.
- pnpm 10. Node ships it: run `corepack enable pnpm` once.
- The Xcode command line tools, only for Shadow.app (`xcode-select --install`).
- A Nebius Token Factory API key, for anything that calls a model. Get one at [tokenfactory.nebius.com](https://tokenfactory.nebius.com): your project → API keys.

```sh
git clone https://github.com/Akshat-Soni02/nxn-global-ai-hackathon-personal-agent.git
cd nxn-global-ai-hackathon-personal-agent
corepack enable pnpm
pnpm install
```

### A · Free and offline: no key, about 2 minutes

```sh
pnpm test                                         # about 1,000 tests; no network and no model (a scripted fake model)
pnpm design:eval fixtures/recordings/yc-top-job   # one real recording turned into a workflow by code alone (fake model)
```

The second command shows each stage of [the pipeline](README.md#how-it-works) on a real recording:
- the 11 recorded events become 5 steps;
- the evidence package is built;
- the workflow is saved in a scratch folder;
- the checks from the recording's `expect.json` print as ✓ or ✗.

Nothing in the repository changes.

### B · With your key: watch Nemotron design a workflow (cents)

```sh
cp .env.example .env                                         # put your Token Factory key in NEBIUS_API_KEY
pnpm llm:check                                               # one small call per model: answers, json_schema, tool calls, images (< $0.01)
pnpm design:eval fixtures/recordings/yc-top-job --real       # says what it may spend, and stops
pnpm design:eval fixtures/recordings/yc-top-job --real --yes # Nemotron 3 Super designs it (at most $0.25)
```

**What the run does.** Nemotron 3 Super reads the recording, writes what the task is, plans the workflow, then writes, tests and corrects it with tools. A critic reviews it before it is saved.

**Recordings to try.** `fixtures/recordings/` has four: `yc-top-job`, `kpi-email-to-sheet`, `timesheet` and `playstore-to-chat`. In our runs a design cost between $0.01 and $0.20. Add `--model <id>` to try another Token Factory model.

**The spending cap.** Each real run adds a row to [`testing/design-eval-ledger.md`](testing/design-eval-ledger.md). The script refuses to run once that file adds up to $10; it already holds about $7 of our own runs.

### C · The whole product: record, run, repair

```sh
pnpm build                  # the extension, the native host, the window and the website
pnpm setup:mac              # builds Shadow.app: menu bar, Record button, Mac-app recording
pnpm setup:native-host      # lets Chrome talk to the daemon
```

Then add the extension to Chrome:
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Press **Load unpacked** and pick `apps/extension/dist`.
3. In the extension's **Details**, turn on **Allow access to file URLs**.

Then start Shadow:

```sh
pnpm daemon                 # Shadow starts; open the window from the menu bar
```

Press **Record**, do a task in Chrome, then press **Stop**. Answer Shadow's questions, then press **Run now** on the workflow's page.

To write to Google Sheets, Gmail and other apps, also run `pnpm api` (it needs `COMPOSIO_API_KEY`). Every step is in [Running from the repository](#running-from-the-repository), and [`docs/product.md`](docs/product.md) shows the window screen by screen.

## Running from the repository

> These steps run the **current code**. The packaged app is built by `pnpm package` ([Deployment guide](README.md#deployment-guide)).

**Prerequisites:** see [Quick start](#quick-start).

### 1. Install and check

```sh
pnpm install
cp .env.example .env        # your own Token Factory key (direct, no caps), or SHADOW_API_URL to use shadow-api
pnpm llm:check              # checks each model profile with that key: answers, json_schema, tool calls, images (< $0.01)
pnpm build                  # the extension, the native host, the window and the website
```

`.env` keys (names only; [`.env.example`](.env.example) explains each one):

| Key | Read by | For |
| --- | --- | --- |
| `NEBIUS_API_KEY` | the daemon, `pnpm api` | Token Factory. Set in the daemon, it serves model calls directly, with no caps. |
| `SHADOW_API_URL` | the daemon | `http://localhost:8080` with `pnpm api`. Needed for connected apps. |
| `COMPOSIO_API_KEY` | `pnpm api` | Connecting apps (Google Sheets, Gmail…) through Composio |
| `SHADOW_MODEL_FAST` / `_SMART` / `_VISION` | the daemon | Optional: swap a profile's model |
| `SHADOW_AI_MAX_CALLS_PER_RUN`, `SHADOW_AI_MAX_INPUT_CHARS` | the daemon | Optional: the AI-step limits per run (default: 3 calls) |

### 2. Set up once

1. **Shadow.app.** `pnpm setup:mac` builds `apps/mac/build/Shadow.app`, and the daemon starts it. The app is rebuilt only when its sources change. Without it, a Record button appears inside Chrome pages instead, and the form's questions come to the Inbox.
2. **Chrome.**
   1. Run `pnpm setup:native-host` to register the shim with Chrome (`--uninstall` removes it).
   2. In `chrome://extensions`, turn on Developer mode, press **Load unpacked** and pick `apps/extension/dist`.
   3. In the extension's Details, turn on **Allow access to file URLs**.

   The manifest's `key` pins the extension ID to `eloljjdiofhdlhoankjbhfeihjankikk`, the only one the host allows.
3. **Mac apps** (optional). Turn on Shadow in System Settings → Privacy & Security → Accessibility. While recording, right-click the red button → **Allow Mac apps** takes you there. Without this permission, web pages and files are still recorded, but Mac apps are not.
4. **Notifications.** Allow them when Shadow asks.

### 3. Run it

```sh
pnpm daemon                 # in a terminal you can see
```

**With connected apps** (Google Sheets, Gmail…), run `shadow-api` beside the daemon. `pnpm daemon` does not start it:

```sh
pnpm api                    # terminal 1: shadow-api on :8080; memory store, dev sign-in, no quotas
pnpm daemon                 # terminal 2, with SHADOW_API_URL=http://localhost:8080 in .env
```

Then go to **Settings → Sign in** (the local page takes any email), and **Apps → Connect**. With the memory store, you must sign in again after `pnpm api` restarts. Details are in [`apps/api/README.md`](apps/api/README.md).

**Where Shadow shows up:**
- **The menu bar:** how many things wait for you, Record, health, the next run, and a warning when the daemon is down.
- **The red Record button**, while a recording is in progress.
- **The window:** **Open Shadow** in the menu bar opens it, and the terminal prints a link to open it in a browser.

**Keep it running without a terminal** (optional): `pnpm setup:daemon` starts the daemon at login. Only one daemon runs at a time, so run `pnpm setup:daemon --uninstall` before `pnpm daemon`. Logs are in `~/Library/Logs/Shadow`.

### 4. Record a task

1. Press the round **Record** button, **Record a task** in the menu bar, or **Record** in the window.
2. Fill in the short form (the goal, how often it should run) and press **Start recording**.
3. Do the task in Chrome, Finder or any Mac app, then press **Stop**.
4. Shadow turns the recording into a workflow and asks its questions next to the draft, or in the **Inbox**. The saved workflow appears under **Workflows**.
5. Finder is recorded by what it does to files (moves, renames), not by its clicks.

Every recording becomes its own workflow, with a readable id such as `upload-invoice-k3f9q2`. The one exception is **Record again** on a workflow's page: that recording becomes the workflow's next version.

### 5. Look at it, change it, run it

- **Edit** on a workflow's page opens a draft beside it. **Walk through** runs it one step at a time. **Test** runs the safe test and marks each node.
- **Run now**, or `run <id>` in the terminal. Web steps run in a separate, unfocused 1280×800 Chrome window. If the task used a file, it first asks which file to use this time.
- **Go live** with a **Frequency**: every hour, every day at…, weekdays at…, every week, every month, when a file appears in a folder, or a custom schedule. **Pause** and **Resume** are next to it.
- **What waits for you** (an approval, a question, a failure only you can fix) is in the **Inbox**, with a notification. It waits as long as needed, even across a restart.
- **Runs** shows every run step by step, with repairs and model cost. **Roll back** undoes the latest version.

### Troubleshooting

| What you see | What to do |
| --- | --- |
| The extension doesn't connect, or the window says Chrome runs an old copy of it | Reload it in `chrome://extensions`. Chrome keeps the old worker while the version number is unchanged. |
| An upload step fails with "Not allowed" | Turn on **Allow access to file URLs** in the extension's Details |
| Mac apps stop being recorded after a rebuild | Turn Shadow off and on in Accessibility. If that doesn't work, run `tccutil reset Accessibility com.shadow.mac` (the app is signed ad hoc, so the permission belongs to one build). |
| Apps says you're signed out after restarting `pnpm api` | The memory store forgets sign-ins: sign in again in Settings |
| A run stops with "this run already made 3 model calls" | Raise `SHADOW_AI_MAX_CALLS_PER_RUN` in `.env` and restart the daemon |
| `pnpm design:eval --real` refuses to run | The ledger adds up to more than $10. Each real run adds a row to `testing/design-eval-ledger.md`. |
| The window doesn't open after a restart | The daemon picks a new address at every start: use the link it prints, or **Open Shadow** in the menu bar |

After `git pull`, run `pnpm install && pnpm build` again. Also run `pnpm setup:mac` if `apps/mac` changed, then reload the extension.

The daemon keeps its data in `~/Library/Application Support/Shadow`. Set `SHADOW_HOME` to use another folder.

## Reference

<details>
<summary><b>Terminal commands</b></summary>

<br>

`pnpm daemon` takes these commands:
- recording: `record`, `stop`, `compile <session>`;
- running: `run <skill-id | skill.json> [name=value … | path]`;
- the inbox: `inbox`, `approve`, `deny`, `resume`, `skip`, `cancel [run-id]`;
- workflows: `rollback <skill-id>`, `live <skill-id>`, `pause <skill-id>`, `resume-workflow <skill-id>`;
- lists: `runs`, `skills`, `traces`, `status`.

To answer a question, type the answer.

</details>

<details>
<summary><b>The daemon's API</b></summary>

<br>

The window, the menu bar and the terminal all use one API. It is available on two channels:
- the Unix socket, `~/Library/Application Support/Shadow/daemon.sock`, with `api.call` messages;
- local HTTP, whose port and token are in `~/Library/Application Support/Shadow/api.json` (readable only by you).

```sh
PORT=$(node -p "require(process.env.HOME+'/Library/Application Support/Shadow/api.json').port")
TOKEN=$(node -p "require(process.env.HOME+'/Library/Application Support/Shadow/api.json').token")
curl -s -X POST http://127.0.0.1:$PORT/api/inbox -H "Authorization: Bearer $TOKEN" -d '{"open":true}'
curl -s -X POST http://127.0.0.1:$PORT/api/answer -H "Authorization: Bearer $TOKEN" -d '{"itemId":"<id>","answer":"approve"}'
```

The methods are listed in `apps/daemon/src/api.ts`. A few need a note:
- `start` takes a saved workflow's id, never a file path.
- `recordCancel` with a `sessionId` cancels one of several recordings being turned into workflows.
- `connectApp` takes `fields` for an app connected with your own key.
- `chat` changes a workflow from a sentence.
- `test` runs the safe test of the whole workflow, or of one `block`.
- `secrets` and `setSecret` handle a workflow's secret inputs: they say whether each is set, never its value.

The full list, by area:

| Area | Methods |
| --- | --- |
| Workflows and runs | `workflows`, `workflow`, `runs`, `run`, `inbox`, `usage`, `health`, `start`, `walk`, `answer`, `cancel`, `rollback`, `state`, `goLive`, `review`, `looksRight`, `pause`, `resume`, `setTrigger` |
| The draft | `draft`, `editDraft`, `tidyDraft`, `undoDraft`, `redoDraft`, `discardDraft`, `publishDraft` |
| Recording | `recording`, `recordStart`, `recordStop`, `recordDiscard`, `recordCancel` |
| Settings and account | `settings`, `setApiKey`, `setConsent`, `checkModel`, `memory`, `forget`, `setupChrome`, `signIn`, `signOut`, `accountUsage` |
| Connected apps | `connectedApps`, `connectApp`, `appKeyFields`, `disconnectApp`, `appTools`, `checkApp`, `offerAppAgain` |
| On the workflow's page | `chat`, `test`, `secrets`, `setSecret` |

`GET /api/events?token=…` streams changes.

</details>

<details>
<summary><b>Development</b></summary>

<br>

```sh
pnpm test                   # all tests (vitest)
pnpm typecheck              # every package
pnpm lint                   # Biome; `pnpm format` to auto-fix
pnpm ui                     # rebuilds the window on change (reload it)
pnpm extension              # rebuilds the extension on change (reload it in chrome://extensions)
pnpm daemon:dev             # the daemon in watch mode
pnpm design:eval <recording folder> [--real --yes]   # design a recording; fake model unless --real

pnpm fixtures               # serves fixtures/pages on http://localhost:5173
pnpm seed:sandbox           # creates ~/ShadowTest with sample files for skills/real (--reset to start over)
pnpm snapshot:pages         # re-downloads the real pages into fixtures/snapshots
pnpm --filter @shadow/website dev   # the product site on http://localhost:3000 (Next.js)
```

**Replay without the daemon.** `pnpm replay` runs a workflow in its own debug-port Chrome, with no extension needed. It shares the player code with the daemon. The five workflows in [`skills/real`](skills/real/README.md) replayed end to end this way on 9 Oct.

```sh
pnpm seed:sandbox                                        # once: sample files in ~/ShadowTest
pnpm replay skills/real/fill-web-form.json               # --yes approves gated steps; --headless, --no-scripts, --no-repair, --keep-open
pnpm fixtures                                            # repair on drifted pages: point the drift skill's URL at one of them, then
pnpm replay fixtures/pages/drift/drift-skill.json --yes --input invoice=<a pdf>
```

Before every commit, `pnpm test && pnpm lint && pnpm typecheck` must pass; CI also runs `pnpm build`. Conventions are in [`CLAUDE.md`](CLAUDE.md).

</details>

<details>
<summary><b>Repository guide</b></summary>

<br>

A TypeScript monorepo (pnpm workspaces), plus the Swift app. The extension, the daemon and the window share one language, so they share the same schema and types.

```
.
├── packages/
│   ├── core/          # JOINT   workflow schema and checker, edit operations, repair guard, capability briefing, messages
│   ├── llm/           # JOINT   every model call to Nebius Token Factory: client, profiles (fast, smart, vision), structured output, usage
│   ├── agent/         # JOINT   the agent runtime: loop, tools, guard, budgets, transcript
│   ├── memory/        # JOINT   persistent memory (SQLite, full-text search)
│   ├── ipc/           # JOINT   length-prefixed framing (native messaging + daemon socket), data, log and bundle paths
│   ├── recorder/      # RECORD  normalise → skeleton → compile, evidence, the design agent (v2), masking
│   └── player/        # REPLAY  the workflow interpreter, matcher, channels (web, files, scripts, data, AI steps), repair
├── apps/
│   ├── api/           # shadow-api: device sign-in, the model relay, the per-user MCP endpoint over Composio, quotas
│   ├── daemon/        # the always-on daemon: runs, walks, inbox, API (socket + HTTP), triggers, store, recordings, drafts, settings
│   ├── ui/            # the window (React): inbox, workflows, editor, runs, versions, Record, Apps, Settings
│   ├── mac/           # Shadow.app (Swift): menu bar, window, notifications, the Record button, first run, Mac-app capture and replay
│   ├── extension/     # Chrome MV3 extension: background worker (native port, chrome.debugger), content script
│   ├── native-host/   # the shim Chrome starts: pipes native messaging <-> the daemon's Unix socket
│   └── website/       # the product site (Next.js static export), on GitHub Pages
├── skills/real/       # replay test workflows against real sites
├── fixtures/          # local test pages (with drifted redesigns for repair), page snapshots, recordings for design:eval
├── scripts/           # deploy/ (api, app, ci), fixture server, installers, Mac app build, package (.dmg) and release, llm check, design eval
├── docs/              # design.md, product.md, questions.md, design-ui.md, examples.md, cloud-architecture.md, guide/
├── reports/           # dated studies and plans; changes.md is the status of the whole product
├── testing/           # checkpoint write-ups and design-eval-ledger.md (the real-model spend)
├── CLAUDE.md          # the pipeline map, commands and conventions for whoever changes the code
└── .github/           # CI (lint, typecheck, test, build)
```

| Area | Owner | Rule |
| --- | --- | --- |
| `packages/core`, `llm`, `agent`, `memory`, `ipc`, `apps/ui`, `skills/` | Both | Changes need a review from both sides; the workflow schema is the contract |
| `packages/recorder`, recording code in `apps/extension/src/content.ts` | Record | |
| `packages/player`, replay code in `apps/extension/src/background.ts`, `apps/daemon`, `apps/native-host` | Replay | |

</details>
