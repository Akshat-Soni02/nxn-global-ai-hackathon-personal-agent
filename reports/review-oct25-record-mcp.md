# Review, Oct 25: is record in sync with connected apps, and what is still broken

> Written 25 Oct 2026 after PR #18 (Shadow managed: sign-in, shadow-api, `mcp` steps). Branch for the work below:
> `feat/record-mcp` (from `feat/mcp`). Each item says **what is there now**, **what goes wrong**, and **the change**.
> Status marks: ☐ planned · ◐ in progress · ☑ done (with the commit). If this session ends mid-way, this page is the
> hand-over: pick up the first ☐.

## 0. The short version

- **Record is not in sync with connected apps.** PR #18 lets a *workflow* call an app (an `mcp` step) and lets the
  *player* run it, but the **design agent never offers it**: it doesn't know which apps are connected, has no tool to
  add an app step, isn't told when one would be better, and the drill can't ask "use Google Sheets directly?". A user
  can only get an `mcp` step by editing the JSON.
- **Two things in PR #18 would break as soon as it is used from record:**
  1. The safe test run (`apps/daemon/src/rehearse.ts`) calls `runSkillOn` without `tools`, and the new preflight
     (`prepareMcpSteps`) fails any workflow with an `mcp` step: "sign in to Shadow first", even when signed in.
  2. `finalOf` (design v2) calls `requireApprovals` without the read-only tools, so every app step asks for approval,
     even a read.
- **Replay still has the faults the reports leave to me** (F6–F10, the walk log, "has no value yet" in the test run).
  The biggest is **F8: the matcher ignores `text`, `label` and `near`**, so a control known only by its text or its
  place near a label can't be found, and two "Save" buttons are always ambiguous.
- Rushil's record-v3 (merged as #17, nothing newer on any branch) fixed most of F1–F61; what is open is listed in §3.

## 1. The connected-app flow during record (the main change)

What the user asked for, and how it will work:

> The design agent should suggest an app step (MCP) during the drill when it is more reliable, easier and more easily
> repeated than clicking through the page. The question itself carries the button to sign in and connect; finishing
> that in the browser lets the agent go on. The user can also say no to that connector, and then the agent designs it
> the classic way.

### 1.1 What code decides (not the model)

| # | Change | Where | Status |
|---|---|---|---|
| C1 | **Which recorded steps an app could do.** By the pages the steps worked in: `docs.google.com/spreadsheets` → Google Sheets, `docs.google.com/document` → Google Docs, `mail.google.com` → Gmail, `drive.google.com` → Google Drive, `calendar.google.com` → Google Calendar, `*.slack.com` → Slack, `notion.so` → Notion, `github.com` → GitHub. Only steps that *write or read data* (type, paste, click a cell, read) count, not opening the page. A "connector chance" = { toolkit, name, steps[], why }. | new `packages/recorder/src/design/v2/connectors.ts` | ☑ |
| C2 | **Ask once, before planning**, one question per chance, only when Shadow's service is configured: *"You wrote into Google Sheets by clicking cells. Shadow can write to it directly, which keeps working when the sheet's layout changes. Use Google Sheets directly?"* Options: **Connect Google Sheets** (recommended) / **Keep clicking the page**. Asked right after stage 1 (understand), since the answer changes how everything is built; not in the end batch. | orchestrator stage 1½ | ☑ |
| C3 | **The question carries the button.** `Question.connect = { toolkit, name, signedIn, connected }`. The inbox card and the Record screen show **Sign in** (if not signed in) and **Connect Google Sheets**, which open the browser; the daemon watches the connection and **answers the question itself** ("connected") when it turns ACTIVE, so the design goes on without another click. **Keep clicking** answers "classic". Already connected: no question, it is used. | `daemon/types.ts`, `service.ts` (`ask` gives the item id), `record.ts` (the watcher), UI `Inbox.tsx` / `Record.tsx` | ☑ |
| C4 | **"No" is remembered**: a declined toolkit is saved (config.json `connectors.declined`), not asked again; Settings → Connected apps shows "Not used in new workflows: ask again". | `settings.ts`, UI | ☑ |
| C5 | **Approval from hints at save**: `finalOf` gets the read-only tools, so a read runs without asking and a write asks. | orchestrator `finalOf` | ☑ |

### 1.2 What the agent gets

| # | Change | Where | Status |
|---|---|---|---|
| A1 | **The tools of the connected app**, in the build message: name, one line each, read-only or not (from `mcpTools.list()`, filtered to the chance's toolkit, at most 40), and which recorded steps they can replace. | `buildMessage` | ☑ |
| A2 | **A look at one tool's arguments**: `look { app_tool: "GOOGLESHEETS_BATCH_UPDATE" }` returns its input schema (masked like every look). | `tools.ts` look | ☑ |
| A3 | **Adding an app step**: `add { do: "app", tool, arguments, save_as? }` makes `{ channel: "mcp", action: "call", args: { tool, arguments } }`; refused when the tool isn't offered, or its `arguments` miss a required field. The recorded UI steps it replaces are removed with a why (`remove`), as today. | `tools.ts` add, `rules.ts` | ☑ |
| A4 | **The instruction**, in BUILD and PLAN: *"When the user connected an app, write to it and read from it with one app step instead of the clicks into its page: it doesn't depend on the page's layout. Find the spreadsheet id, sheet name and range from the page's address and what was typed (the recording shows them). Keep the clicks only for what the app's tools can't do. The user said no to an app: build it the classic way, never ask again."* Plus a worked line in the KPI example. | `prompt.ts` | ☑ |
| A5 | **The test run**: a read-only app step runs for real (it only reads), a writing one is outlined like a click that acts. The final check never writes to an app. | `packages/player/src/rehearse.ts` (`rehearsalChoice`), `daemon/rehearse.ts` passes `tools` | ☑ |
| A6 | **The review** names app steps in plain words ("Writes the row to Google Sheets, directly") and shows "asks first" from the hints. | `review.ts` / UI `WorkflowTree.tsx` | ☐ |

### 1.3 Plumbing

| # | Change | Where | Status |
|---|---|---|---|
| P1 | `finishRecording` gets `connectors` (the account's view, `connectedApps`, `connectApp`, the MCP tools) from main.ts; the design gets them through `DesignV2Options.connectors`. Without a service (no `SHADOW_API_URL`) or a developer `.env` key with no service: no chance is offered and nothing changes. | `daemon/record.ts`, `main.ts`, orchestrator | ☑ |
| P2 | **Fix: the test run passes `tools`** to `runSkillOn` (else the preflight fails every app step). | `daemon/rehearse.ts` | ☑ |
| P3 | Tests: connectors.ts (hosts → toolkits, which steps), the question with a fake prompter (connected → app tools in the message; declined → none), `add do: app` (made / refused), the test run's choice, the watcher answering the item. | recorder + daemon tests | ☑ |

## 2. Replay (mine, from the reports)

| # | What goes wrong now | The change | Status |
|---|---|---|---|
| R1 (F8) | `web/match.ts` scores only role+name, attrs and fallback selectors; `text`, `label` and `near` are written by the recorder and **never read** (its own header says "Not yet used"). A control whose name changed but whose text or label didn't is lost; two same-named buttons are always ambiguous. | Add three signals: **text** (the element's own text, like name similarity), **label** (the `<label for>` / `aria-labelledby` text, through the AX name of the labelled control's label), and **near** (candidates ranked by DOM distance to an element matching the near text; used as the tie-break that lifts one of two ambiguous candidates past `MIN_MARGIN`). Weights normalised as today. | ☐ |
| R2 | The walk-through logs `highlighted: false` for every step answered from the inbox (`run.ts` ~329): the resumed leg doesn't know the first leg highlighted it. | Keep `highlighted` in the walk answer (`Answer { kind: "walk", choice, highlighted? }`), filled from the waiting item, logged as it was. | ☐ |
| R3 | In the test run, a step that uses a file this run would download fails with "has no value yet": `runLeaf` resolves `{{…}}` before the walk decides to skip it. | Resolve after the walk's choice; a skipped step is never resolved (the highlight uses the step as written). | ☐ |
| R4 (F6) | A run waiting for an OK loses its named tabs (the extension forgets tab names when the leg ends). | To check first: whether record-v3's tab work fixed it (`tab` in skill.ts, the extension's per-name tabs). If not: keep the name→tab map per run id until the run ends, not per leg. | ☐ check |
| R5 (F10) | A file path with `{{…}}` is checked only when designed. | Check resolved `fs.*` paths before the step (exists for `from`, folder writable for `to`), failing with the path. | ☐ check |
| R6 | DevTools hang: a step with a role, when the automation window isn't in front (seen Oct 19). | To check if still there; if so, bring the target tab forward before `Accessibility.queryAXTree`. | ☐ check |

## 3. Record, still open (Rushil's area; listed so nothing is lost)

From `record-v2-whats-fixed.md` "Still open": variance between designs of the same task (3 of 6 right), rules' steps
taken on the agent's word, day-2 and Mac recordings not yet run, canvas apps (E, F22: needs a connector, so §1 helps:
a Google Sheets *canvas* becomes an app step), F19 list places, F29 loose "already answered", F11–F15, picture captions
timing out at 90 s. **§1 changes Rushil's design agent**: he should review the prompt and tools changes (A1–A4).

## 4. Order of work

1. P2, C5 (the two breakages) — small, first.
2. C1 connectors.ts + tests.
3. A2, A3 (tools) + A4 (prompt) + A1 (message) + A5 (test run).
4. C2–C3 (the question with the button, the watcher, UI), P1 wiring, C4.
5. R2, R3 (small replay fixes), then R1 (matcher), then the checks R4–R6.
6. Docs: design.md (§ "3. Understand", the drill), docs/agents/design-agent.md, cloud-architecture.md "Recording →
   workflow".

## 5. Log

- 25 Oct: PR #18 raised (feat/mcp → main). This review written.
- 25 Oct: §1 built (all but A6): `design/v2/connectors.ts` (apps by page, document ids written `<id:s4>` and filled by
  code), the stage before planning (`usableApps`), `add { do: "app" }`, `look { app_tool }`, the prompt, the gate
  counting an app step as kept work, approvals from read-only tools, the test run (reads done, writes outlined, never
  in the final check), the daemon's question with Sign in / Connect (answered by the daemon when connected,
  `daemon/connectors.ts`), "offer it again" in Settings. Tests: 9 recorder, 2 daemon; 725 in all pass.
