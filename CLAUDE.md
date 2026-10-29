# Shadow

Shadow learns a work task from watching you do it once, runs it for you, and repairs it when a site changes. A TypeScript
pnpm monorepo plus a Swift app (macOS). Product overview: `README.md`; first-time use: `docs/product.md`; every design
decision with its date: `docs/design.md`. Running it: `DEVELOPMENT.md`; the Nemotron / Token Factory notes: the README; feedback on them: `FEEDBACK.md`.

## The pipeline (where to look)

Record → workflow, then replay and repair. Each stage has one owner file; fix a problem in the stage that owns it.

| Stage | What it does | Where |
|---|---|---|
| Capture | page, Mac-app and file events | `apps/extension/src/content.ts`, `apps/mac`, `apps/daemon/src/fs-watch.ts` |
| Normalise → skeleton → compile | events become steps; code only, no model | `packages/recorder/src/{normalise,skeleton,compile,locator}.ts` |
| Evidence | what the recording shows: pages, tabs, proposals, answers | `packages/recorder/src/evidence/` |
| Design agent (v2, file mode) | model + tools turns the skeleton into the workflow; gate (`gate.ts`) and critic (`critic.ts`) check it | `packages/recorder/src/design/v2/` |
| Save | blocks (named groups of steps), review, versions | `packages/recorder/src/blocks.ts`, `apps/daemon/src/record.ts` |
| Replay | the interpreter and its channels (web through the extension and CDP, files, scripts, data, LLM, app steps) | `packages/player/src/run.ts`, `web/`, `node/` |
| Repair | classify the failure, ladder of cheap fixes, then the repair agent; verify; guard | `packages/player/src/repair/`, `packages/core/src/guard.ts` |
| Connected apps | per-user MCP tools over Composio, through shadow-api | `apps/api`, `apps/daemon/src/{account,mcp-tools}.ts`, `design/v2/connectors.ts` |
| Window | React UI served by the daemon | `apps/ui/src` (`review.ts`, `runlog.ts`, `WorkflowTree.tsx`, `NodePanel.tsx`) |

The workflow schema (`packages/core/src/skill.ts`) is the contract between record and replay.

## Commands

```sh
pnpm install              # Node 22+, pnpm 10 (corepack enable pnpm)
pnpm test                 # vitest, all packages
pnpm lint                 # Biome (2 spaces, width 120, double quotes); pnpm format fixes
pnpm typecheck            # every package
pnpm daemon               # the daemon (reads the root .env); does NOT start shadow-api
pnpm api                  # shadow-api on :8080 (memory store, dev sign-in, no quotas), keys from the root .env
pnpm ui | pnpm extension  # rebuild the window / the extension on change
pnpm design:eval <recording folder> [--real --yes]   # design a recording; fake model unless --real (try fixtures/recordings/yc-top-job)
                          # --apps <tools.json> gives it connected apps' tools; --answers <design.json> reuses the user's answers
```

`pnpm build` builds the extension, native host, window and website (CI runs it). While developing, prefer the filtered
builds (`pnpm --filter @shadow/ui build`, `pnpm --filter @shadow/extension build`). A rebuilt extension does nothing until
it is reloaded in `chrome://extensions` (Chrome keeps the old worker script while the version is unchanged), and the
window needs a fresh `pnpm daemon` address. `pnpm setup:mac` builds Shadow.app;
`pnpm setup:native-host` registers the shim with your real Chrome profile: neither belongs in a quick check.

## Run it locally with connected apps

Two processes. `pnpm api` first (the MCP endpoint for Composio is `/v1/tools/mcp` in shadow-api), then `pnpm daemon`.
Root `.env` (copy `.env.example`): `NEBIUS_API_KEY`, `COMPOSIO_API_KEY` (read by `pnpm api`), `SHADOW_API_URL=http://localhost:8080`
(read by the daemon). Then Settings → Sign in (the local page takes any email) and Apps → Connect. With the memory
store a restart of `pnpm api` forgets the sign-in. Details: `apps/api/README.md`.

## Conventions

- Workspace packages are TypeScript source with no build step; tests sit next to the code (`*.test.ts`).
- Comments say why, in plain words, and carry the decision or the bug they came from. Match the density of the file you
  edit. Names: what a thing is, not how it is made.
- Fix in the stage that owns the problem, with the fewest lines. No per-app hard-coding: apps are rows of data
  (`APPS` in `connectors.ts`), not code paths.
- Code decides what code can decide; a model call is for judgement. Replay is deterministic and makes no model call
  unless an LLM step needs one or a step fails. A run allows `SHADOW_AI_MAX_CALLS_PER_RUN` AI steps (default 3), and the
  design gate counts a workflow's AI calls against it: a value a reference (`{{x.0}}`, `{{row.1}}`) or a loop's `first: N`
  reaches is never an AI step.
- Every bug fix starts with a test that fails first. A scripted model (`fakeLlm`, `packages/llm/src/fake.ts`) and
  scratch data directories keep tests free and offline. A fix is proven by a real run, not only by the test.
- Verify before asserting: open the file, run the command, then say it. Cite `file:line`.

## Ownership and review

Record side (`packages/recorder`, `apps/extension/src/content.ts`) and replay side (`packages/player`,
`apps/daemon`, `apps/extension/src/background.ts`, connected apps) have one owner each; `packages/core`, `llm`, `agent`,
`memory`, `ipc`, `apps/ui` and `skills/` need a review from both. A PR that touches the other side's area says so in its
description, listing those files.

## Which document is the truth

- `reports/changes.md`: the status of the whole product (done, partly done, not started, bugs, what can fail while
  running, the older reports reconciled). Start here.
- `reports/plan-oct26-workflow-revamp.md`: the blocks revamp, item by item (R1–R7).
- `docs/design.md` status table: design vs code. `docs/cloud-architecture.md`: shadow-api, sign-in, quotas.
- Other files in `reports/` are dated studies; each carries a status line pointing back to `changes.md`.

## Money and privacy

- Real model calls cost money and the key must last through judging. Tests never call it. A real run is announced with
  its estimated cost first and written in `testing/design-eval-ledger.md` (the cap, $10, is enforced in
  `scripts/design-eval.ts` by adding up the ledger). A Run now of a failing workflow starts the paid repair agent: count it.
- Never read or print `.env` values; talk about key names. Never commit a real recording, document id, email or key:
  tests use made-up ones. Passwords are never recorded; secrets never go into prompts or logs.
- Connected apps: only what a step writes or reads goes to the app; writes in tests go to a test sheet or test doc the
  owner names, never a real one.

## Before every commit

`pnpm test && pnpm lint && pnpm typecheck` all pass (CI also runs `pnpm build`). Short conventional subject
(`fix(replay): …`) plus 2-4 bullets of what shipped. Do not leave `reports/changes.md` stale: change its row in the same
commit that changes the behaviour.
