# 07 · How to proceed: the rest of Sprint 2, and the Sheet6 tracker

> **Superseded (Oct 8, 2026).** This note describes the flat-skill flow from before the workflow pivot (describe + record with screenshots and voice → editable workflow tree → self-correcting replay). It is kept as history; the current design is [docs/design.md](../design.md).

> *"How should i proceed and in sheet the task is divided for the current sprint, make the simple task tracker about real work actions in worksheet 6."*

## The short answer

**Sprint 2 exit criterion (proposed for today's DSU):** a real recording of `fixtures/pages/upload.html` compiles into a skill that Akshat's player runs on that page. Then the same skill is run on `upload-drifted.html` and the first failing step is logged.

That is the sheet's split, made testable:

- *"[Rushil] capture → process → extract"*;
- *"[Akshat] take the saved info → play that task"*.

Five working days are left, **Thu 1 Oct to Mon 5 Oct** (the sprint ends on a Monday; the dossier's "Sun 5 Oct" used 2025's calendar). Your path is about 30 hours. That's tight, so the cut list below matters.

## Why this order

Each item is blocked by the one above it. The order isn't a preference:

```
R-01 install    ─┐
R-02 build fix  ─┼─► R-05 describeElement ─► R-06 capture ─┐
R-04 trace type ─┘                                         ├─► R-09 record real traces ─► R-10 normalise ─► R-11 compile ─► J-02 E2E
                   R-07 tab/frame context ─────────────────┤                                                  ▲
                   R-08 trace-store ───────────────────────┘                                                  │
R-03 Nebius checks ───────────────────────────────────────────────────────────────────────────────────────────┘
```

Three choices in that graph aren't obvious:

- **The trace type comes first, before any capture code.** Two people write against it: you produce it, and Akshat's daemon persists it. A contract agreed on Thursday saves a rewrite on Sunday.
- **Record real traces *before* writing the normaliser.** The normaliser's tests need real input. Rules written from imagination miss what real pages do, such as the click that comes before every file pick.
- **Compile is last because it consumes everything.** The Nebius checks run on day 1 anyway, so a missing model ID or broken JSON mode is known four days before it would block you.

## Decisions to take at today's DSU (Thu 1 Oct, 5 pm)

| # | Decision | Options | Why now |
|---|---|---|---|
| 1 | Where Nemotron runs, and which IDs | Token Factory per-token **or** own Nebius Serverless endpoint; one large model (compile) + one small (recovery) | The code, readme and sheet disagree ([06](06-processing-and-learning.md#model-choice-one-decision-three-sources-that-disagree)); R-11 needs it |
| 2 | Sign off `TraceEvent` | [05 §Stage 2](05-context-layer.md#stage-2--trace) as proposed, or amended | Blocks R-06, R-08 and the daemon side |
| 3 | Who fixes `build.mjs` | you (it blocks you) or Akshat (he owns the extension shell) | Nothing in `content.ts` runs until it's fixed (**measured**) |
| 4 | Roles: equivalence or exact match | matcher treats `textbox`/`spinbutton`/`searchbox` as one, **or** fix `log-weekly-hours.json:31` | Measured mismatch; affects both your descriptors and his matcher |
| 5 | Template grammar | `{{inputs.x}}`, `{{inputs.x.name}}`, `{{today}}`: who resolves them, what's allowed | Used in all three examples, implemented nowhere |
| 6 | Exit criterion | the one above | So "done" means the same thing to both of you on Monday |
| 7 | Sprint 1 "Auth Management" | drop cookie pulling; keep a "logged in?" check + Keychain secrets | Removes a task that the architecture made unnecessary ([08](08-faq.md#do-we-need-to-pull-cookies-or-tokens-from-the-users-browser)) |

## Your days

| Day | Do | Done when |
|---|---|---|
| **Thu 1 Oct** | R-01 install · R-02 build fix · R-03 Nebius checks · R-04 trace type → DSU | 12 tests green; content script loads on a fixture; `docs/nebius.md`; `TraceEvent` agreed |
| **Fri 2 Oct** | R-05 `describeElement`, checked against Chrome's roles on all three fixtures · start R-06 (click + file) | Descriptors match the roles and names in the [04](04-capture-without-coordinates.md) measurements |
| **Sat 3 Oct** | finish R-06 (type, select, submit, redaction, echo) · R-07 sender context · R-08 trace-store · R-09 record two real traces | `fixtures/traces/upload.jsonl` and `timesheet.jsonl` committed; every line parses as `TraceEvent` |
| **Sun 4 Oct** | R-10 normaliser + tests · start R-11 compiler | upload trace → 3 normalised steps |
| **Mon 5 Oct** | finish R-11 · diff against `skills/examples/upload-invoice.json` · J-02 with Akshat | compiled skill replays on `upload.html`; drifted run's failing step logged |

**If you fall behind, cut in this order:**

1. R-12 drill (→ Sprint 3).
2. The timesheet trace (keep only upload).
3. Background navigation events beyond the first `navigate`.
4. Echo verification.

Never cut R-02, R-04 or R-11. Without them there is no Sprint 2 result.

## Sprint 3 preview (Tue 6 – Mon 12 Oct), so Sprint 2 doesn't paint you into a corner

- **Drill + memory (you):** questions in, answers saved as `fact`/`preference`. Milestone 5's test: the next compile doesn't ask again (`design.md:209`).
- **Natural-language intake (you):** the same `compile`, grounded at dry run ([05](05-context-layer.md#the-other-intake-describing-a-task-in-words)).
- **Matcher rungs 4–5 + learn-back (Akshat):** on `upload-drifted.html`, using a DOM-built outline that lists hidden file inputs ([06](06-processing-and-learning.md#what-is-unusual-here-a-correction-to-the-dossier)).
- **Triggers:** `folder_watch` on `~/Downloads` runs `upload-invoice` end to end. That is milestone 6 (`design.md:210`).

---

## The tracker (worksheet 6)

The same rows are in [`sheet6-sprint2-tracker.tsv`](sheet6-sprint2-tracker.tsv). Open it, select all, copy, and paste into cell A1 of Sheet6: tab-separated text pastes into separate columns. I have **not** written to the shared sheet myself.

Changes from the dossier's version:

- real weekdays;
- work the repo already contains is marked **Done**;
- tasks use the repo's names (`Skill`, `describeElement`, `run.step`);
- the two measured bugs and the template gap are added.

| ID | Task | Owner | Depends on | Est. h | Target | Done when | Status |
|---|---|---|---|---|---|---|---|
| D-01 | Monorepo scaffold: pnpm workspaces, CI, Biome, MIT | Akshat | – | – | Wed 30 Sep | CI runs lint/typecheck/test/build | **Done** |
| D-02 | `Skill` schema + 3 example skills | Both | – | – | Wed 30 Sep | Examples validate | **Done** |
| D-03 | Native messaging bridge: daemon socket, native-host shim, installer | Akshat | – | – | Wed 30 Sep | `daemon.test.ts` passes | **Done** |
| D-04 | Daemon-owned record sessions (`record` / `stop` / `status`) | Akshat | D-03 | – | Wed 30 Sep | `record.start` reaches the extension | **Done** |
| D-05 | Nemotron client `chat()` | Both | – | – | Wed 30 Sep | Compiles; never called yet | **Done** (untested) |
| D-06 | Fixture pages incl. drifted redesign | Both | – | – | Wed 30 Sep | `pnpm fixtures` serves them | **Done** |
| J-01 | DSU decisions: model endpoint + IDs, `TraceEvent`, template grammar, role equivalence, exit criterion | Both | – | 0.5 | Thu 1 Oct | Written in the sheet | To do |
| R-01 | Fix local install: delete `package-lock.json`, `corepack enable`, `pnpm install` | Rushil | – | 0.5 | Thu 1 Oct | `pnpm test`: 12 green | To do |
| R-02 | Build content script as IIFE; drop `export` from `content.ts` | Rushil (Akshat reviews) | R-01 | 1 | Thu 1 Oct | Loaded unpacked, no SyntaxError on a fixture page | To do |
| R-03 | Nebius checks: list Nemotron IDs, JSON mode, image input → `docs/nebius.md` | Rushil | – | 1.5 | Thu 1 Oct | IDs and sample responses written down | To do |
| R-04 | `TraceEvent` schema in `packages/core/src/trace.ts`; `record.event.event` → enum | Rushil (Akshat reviews) | – | 2 | Thu 1 Oct | Merged; both sides import it | To do |
| R-05 | `describeElement(el)` in `apps/extension/src/describe.ts` | Rushil (joint) | R-02 | 5 | Fri 2 Oct | Role and name match Chrome on all 3 fixtures; selectors unique | To do |
| R-06 | Content-script capture: click, type (coalesced), select/check, file, submit/Enter; redaction; cheap echo | Rushil | R-04, R-05 | 5 | Sat 3 Oct | Recording `upload.html` → navigate, click, file, click at the daemon; no secrets | To do |
| R-07 | Background: `tabId`/`frameId`/`url` from `sender`; `webNavigation` events | Rushil (Akshat reviews) | R-04 | 1.5 | Sat 3 Oct | Every event carries tab and frame | To do |
| R-08 | Daemon `trace-store.ts`: append `record.event` to `traces/<sessionId>.jsonl` | Rushil (Akshat reviews) | R-04 | 1.5 | Sat 3 Oct | File exists after `stop`; every line parses | To do |
| R-09 | Record real traces of `upload.html` and `timesheet.html` → `fixtures/traces/` | Rushil | R-06, R-07, R-08 | 1 | Sat 3 Oct | 2 JSONL files committed | To do |
| R-10 | Normaliser `packages/recorder/src/trace.ts` + unit tests | Rushil | R-09 | 4 | Sun 4 Oct | Upload trace → 3 steps | To do |
| R-11 | Compiler v0 `packages/recorder/src/compile.ts`: model writes intents/inputs/checks, code splices locators, `Skill.safeParse` retry ≤ 2 | Rushil | R-03, R-10 | 5 | Mon 5 Oct | Valid skill from the real trace; diff vs `upload-invoice.json` reviewed | To do |
| R-12 | Drill v0: print questions, read stdin, patch skill | Rushil | R-11 | 2 | Mon 5 Oct | One answer changes the skill | Stretch |
| A-01 | `run.step` handler: `chrome.debugger` attach; navigate, click, type, select, upload via `DOM.setFileInputFiles` | Akshat | – | 6 | Fri 2 Oct | Hand-written `upload-invoice.json` runs on `upload.html` | To do |
| A-02 | Matcher v0, rungs 1–3, using `describeElement`; role equivalence | Akshat | R-05 | 5 | Sat 3 Oct | Resolves every example target on its fixture | To do |
| A-03 | Checks: `url_matches`, `text_visible`, `element_visible`, polling with timeout | Akshat | A-01 | 3 | Sat 3 Oct | One fixture test per check | To do |
| A-04 | Daemon run loop + `run <file>` command; `{{…}}` template resolution | Akshat | A-01, A-02, A-03, J-01 | 4 | Sun 4 Oct | `run skills/examples/upload-invoice.json` succeeds | To do |
| A-05 | Reconnect with `chrome.alarms` instead of `setTimeout` backoff | Akshat | – | 1 | Sun 4 Oct | Daemon restart → reconnect within ~30 s with no page load | To do |
| J-02 | E2E: record → compile → replay on `upload.html`; then run on `upload-drifted.html` and log the first failing step + rung | Both | R-11, A-04 | 2 | Mon 5 Oct | Pass on v1; drifted failure logged | To do |
| J-03 | Update the Sprints tab, answer Sheet4 (Playwright: no; trigger: local daemon), plan Sprint 3 | Both | J-02 | 0.5 | Mon 5 Oct | Sheet updated | To do |
