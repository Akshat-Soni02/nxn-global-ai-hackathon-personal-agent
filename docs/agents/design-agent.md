# The design agent

**Job:** turn one recording into the workflow the user meant. The input is a flat replay of what they did, plus their own words (the description form) and what they said and saw while doing it. The output is a workflow tree in which:
- values that change become **inputs**,
- repeated work becomes a **loop**,
- "only if" becomes a **branch**,
- reading or judging becomes an **llm step**.

The agent asks the user only what it can't tell.

It runs once per recording, right after **Stop**, in the daemon. It's Nemotron 3 Super in the shared loop ([README](README.md) §2) with 13 tools of its own and a set of rules (`designViolations`) checked inside its edit tools.

> **Since 15 Oct (evening): one AI reads the recording.** The separate first-draft call is gone from the daemon. Code builds the plain step list; the design agent labels it as its first move (`label_steps`, the same labels and merge rules as §2, see `labelRules`, `labelDraft` in `compile.ts`), then restructures, and is the only AI that writes questions. Before labelling, every other edit and `ask_user` is refused with "label the steps first". `compile()` still has its one-call path for tests, unused by the daemon.

> **Updated 15 Oct 2026** after the first real recording (`reports/first-real-recording-yc-to-sheets.md`): the narration reaches both model calls whole; questions the form or narration answer are closed, never asked; answers about new inputs create them; recorded writes can't be removed and at most half the recorded steps can; a click may become "open this page"; every page the recording reached counts as visited; edits take up to 100 operations; `design.json` keeps the prompt. §15 marks what is fixed.

Code: `packages/recorder/src/design/design.ts` (prompt, entry point), `packages/recorder/src/design/tools.ts` (tools, rules, views), called from `apps/daemon/src/record.ts` (`finishRecording`).

---

## 1. Where it sits: from Stop to a saved workflow

`finishRecording(sessionId)` in `apps/daemon/src/record.ts`:

| # | Stage | Model? | What happens |
|---|---|---|---|
| 1 | Read the trace | — | `recordings/<session>/trace.jsonl`. Picked or dropped files are located on disk (`locateFiles`) |
| 2 | **Normalise** | — | `normalise(trace)` → `NormalisedStep[]`: events by meaning (click, type, copy, paste, navigate, upload, app_press, …) with targets, values, URLs, "led to", copied sheet context |
| 3 | Read the form | — | `description.json` → `form = { description: { goal, changes, constants, never }, when }`. Recordings before Oct 13 have none |
| 4 | **The plain step list** | — | `compile(steps, { form })` with **no model** (since 15 Oct): the skeleton by code, plus the questions code knows it can't decide (where files arrive, a pasted value, which sheet row). §2 now describes the labelling the agent does as its first move |
| 5 | Pick the id | — | New: `newSkillId` (name + random tag). **Record again** (`form.again`): the existing workflow's id and name |
| 6 | **The design agent** | the agent | §3–§9. Only when a model is configured. **The one AI that reads the recording**: its first move, `label_steps`, labels the plain list (what the one-call compile used to do); then it restructures and is the only AI that asks |
| 7 | Remember answers | — | Answers to questions that carry `remember` go to memory (§11) |
| 8 | Keep the transcript | — | `recordings/<session>/design.json` (§12) |
| 9 | **Drill** what's left | — | The questions the agent didn't ask (`pending`), asked one by one in the inbox and applied with `applyAnswer` (§10) |
| 10 | Fill for unattended runs | — | For a schedule or folder trigger: asks a default for every input that has none (`fillForUnattended`) |
| 11 | **Approvals** | — | `requireApprovals`: every outward step and every step matching Never gets `requires_approval: true`, whatever came before |
| 12 | History note and save | — | `skills/<id>/v<N>.json`, history `{ by: "record", summary: "Recorded; <agent summary>" }` (or "Recorded again; …" as the next version) |

If the agent doesn't finish (out of turns or money, an error), **its last valid draft** is saved: every change it made passed the schema and the rules, and the answers already given are in it. If it changed nothing (or there is no model), the plain step list is saved.

---

## 2. Its starting point: the first draft (compile)

`packages/recorder/src/compile.ts`, `compile(steps, { chat, form, memory, pricePerMTok })`.

### 2.1 What code builds (the skeleton)
`skeletonOf(steps)` turns each normalised step into one or more workflow steps (`s1, s2, …`), with targets, channels, actions and recorded values. It also records `idsByStep` (which skill steps each recorded step became) and a few code questions. With a form, the description and Frequency are copied in as written, and the workflow is named after the goal (cut at 60 characters).

### 2.2 What the model is sent
- **System:** `systemPrompt()`. Its rules:
  - never output targets, selectors, channels or actions;
  - write intents as outcomes;
  - values that change become inputs (with types and `resolve` for files);
  - `check` / `success` / `requires_approval` (add, never remove);
  - exact args per action; `save_as`; `when`;
  - "Ask, don't guess", with `appliesTo` paths, at most 5 questions, none that memory answers;
  - copies from a sheet become `data.pick` rules, `ai` only when no rule can express the choice;
  - examples of when to ask and when not to.
- **User**: JSON with:
  - `description`, `frequency` (when there's a form)
  - `narration` (since 15 Oct, when there was any): `[{ during: "before step 1" | "step 4" | "steps 4-7", said }]`, all of it, in order (`narrationOf`, `packages/recorder/src/narration.ts`). The system prompt says it is the rule and the recording one example
  - `steps`: `stepsForModel`, i.e. per recorded step `{ ids, did, page, element {role,name,label,near}, app, menu, keys, dropped_on, value (≤200 chars, secrets hidden), checked, file, path, to, led_to, produced, likely_changes, copied, sheet {header,row,column}, pasted_from_copy }`
  - `skeleton`: the draft **without targets**
  - `memory`: up to 8 memory entries matching the recording's names, files, hosts, apps

### 2.3 What the model may return (`Annotations`)
```ts
{ id?, intent?, inputs?: Record<name, Input>, when?: Trigger[], success?: Check[],
  steps: [{ id, intent?, args?, check?, wait?, requires_approval?, ai?: { instruction, output, reason },
            save_as?, timeout_ms? (≤600000), on_fail?: { retries? (0–5), fallback?: "agent" | "ask" } }],
  questions: Question[] (≤ 8) }
```

### 2.4 How it's merged (`merge`)
- `id`, `intent` (also becomes name and goal, then **overwritten by the form** if there is one), `inputs` added, `when` (then **overwritten by the form**), `success`.
- Per step: intent, check, wait, on_fail, timeout; `save_as` → `output` with the type the action produces; `requires_approval` only **added**.
- Args are merged, except:
  - a drag's `to`;
  - a Mac step's app, path, key, modifiers and button;
  - a navigate `url` on another origin;
  - typed text that already uses an input (secrets).
- A recorded value replaced by `{{input}}` becomes that input's `default` (not for file and secret inputs).

The result is checked with the `Skill` schema; problems go back to the model (`That JSON was rejected: … Return the corrected JSON object only.`), up to 3 attempts. After that, the skeleton is kept.

### 2.5 Where the first draft's questions come from
1. **Cost questions**: a `data.pick` step the model marked `ai` becomes "keep the AI step (about N tokens, $X a run) or use the recorded rule?". `appliesTo: steps.<id>`; each option carries a whole step.
2. **The model's own** `questions`, minus those whose `appliesTo` starts with `steps.start.when` or `description` (the form decides those).
3. **Code questions** not already asked: "Where do files like X arrive?" for file inputs (`remember: "fact"`).
4. Without a form: "Describe this task in one sentence".

Duplicates are filtered by code **only by `appliesTo` path**. Since 15 Oct the compile prompt also says never to ask what the description or the narration states (make it an input's default), and a question that still slips through can be **closed** by the design agent with a quote of the user's words (§7, `close_question`), so it is never asked.

### 2.6 Cost
One call on `smart` with `json: true`. **It isn't metered** (`compileChat` passes no meter), so it shows in neither the design budget nor the daemon's spend.

---

## 3. When the agent runs

- After every recording that produced at least one step, when a model is configured (`.env` or Keychain key).
- Also for **Record again** (the result becomes the existing workflow's next version).
- Not at run time, not for repairs, not in a walk-through.

---

## 4. Inputs (`DesignOptions`)

| Field | From | Notes |
|---|---|---|
| `llm` | the daemon's client | `smart` profile |
| `skill` | the compiled first draft, id assigned | The agent's `original`: every rule compares against it |
| `questions` | compile's questions | Become `pending` |
| `steps` | `normalise(trace)` | The recording by meaning |
| `form` | `description.json` | Optional |
| `notes` | `readNotes(dataDir, session)` | `screen.jsonl` (masked words per screenshot, kind `screen`) and `transcript.jsonl` (narration, kind `said`), on the recording's clock |
| `memory` | `memory.db` | `search` only |
| `prompter` | the daemon's inbox (`service.ask`) | Shows the question with the draft and the step marked |
| `checks` | `unattendedGaps` | §8.3 |
| `describeScreen` | `describer.describeMasked` | Only if the form allowed **Pictures**, a model is configured, and the step has a kept screenshot |
| `budget`, `protocol`, `meter`, `signal`, `onEvent` | tests / daemon | Defaults in §9 |

---

## 5. The prompt

### 5.1 System = ROLE + briefing + loop rules

`ROLE` (`packages/recorder/src/design/design.ts`; rewritten 15 Oct), in short:

> - The first message has the description, what they said, the recording and the draft.
> - **The description and what they said are the rule; the recording is one example of it.** "The top 5", "skip the ones already in my sheet", "only remote ones", "if there are fewer, take what there is" are rules.
> - Values that change become inputs or earlier outputs; a typed date is usually `{{today}}`.
> - Repeated work, or work shown once but said to be done for several, becomes a loop; "only if" a branch; reading, picking, classifying an llm step.
> - A common shape: read a list (`web.extract`) → pick the items with an llm step → a loop whose body is the recorded steps for one item.
> - Controls come only from the recording. **Steps that type, paste, select or upload what they showed are the work itself: move or wrap them, never remove them.**
> - Never change the description or the Frequency; never turn approval off.
> - **Never ask what the description or what they said already answers**: close such an open question with `close_question`, quoting their words. Ask only what is left (≤ 5); an answer that comes back `not_applied` is the agent's to put in.
> - `describe_screen` before asking, when the words near a step don't say what a control was for.
> - Keep step ids; an edit is all or nothing, so a big change goes in a few calls, each valid on its own; fix `still_to_fix` before `finish`.

Then `briefing({ edits: true })` ([README](README.md) §4; **without** "Available now"), then the loop's "How you work".

### 5.2 Task (`taskOf`)
```
# The description
{"goal": …, "changes": […], "constants": […], "never": […], "frequency": [...]}     (or: "None was filled in: …")

# What they said while doing it (in order, with the recorded steps it was said over)   (since 15 Oct: all of it)
<untrusted_data>
- [before step 1] I take like top 5 latest ones
- [steps 4-7] I try to avoid taking those which are already in my sheet
</untrusted_data>

# The recording (by meaning; screen words shortened here, read_recording shows any part in full)
<untrusted_data>
[ { n, ids, did, page, element, …, notes: ["said: …", "on screen: <≤300 chars> | (as before)"] }, … ]   steps 1–40
… and N more steps                                                                   (when > 40)
</untrusted_data>

# The draft
<outline>

# Open questions from the first draft
- <id>: <text> (options: a / b) [default: x]                                         (or: "None.")
```

Steps past 40 are only reachable with `read_recording`, but since 15 Oct the narration section is never cut, so what was said about them is in the first message.

### 5.3 How notes attach to steps (`packages/recorder/src/narration.ts`)
- `notesByStep`: each note goes with the **last step that started at or before the note's time + 1 s** (people talk as they click), or with step 1 when it came before any step. A screenshot's words are attached to the step after which it was taken.
- `narrationOf` (since 15 Oct): each narration piece also gets the **span** of steps from where it started to where it ended (`until`, kept by `readNotes`), or `before step 1`. That is the "What they said" section, so a sentence about the whole task is no longer stuck on one step.

### 5.4 The outline format (`outlineOf`)
```
start  trigger  when: manual  inputs: count (number) = 5; sheet_url (text) from {"…"}
  s1  web.navigate  "Open www.ycombinator.com/jobs"  args {"url":"…"}
  l1  loop "Each new job"  for each job in {{jobs}} (max 50, stop on a failing item)
    s5  web.click  "Open the company"  on link "Numeral"
  ai1  llm  "Pick 5 new jobs"  reads {{jobs}}, {{existing}}  → picked (list of object)
  b1  if {"left":…}  "Only remote"
  s9  web.type  "Paste the name"  on combobox "A2"  args {"text":"{{copied_1}}"}  [approval]
```
Args are clipped to 160 characters. Targets show `role "name|label|text|?"`.

---

## 6. Session state (`DesignSession`)

| Field | Meaning |
|---|---|
| `original` | The compiled draft. Every target, site and approval rule is relative to it |
| `folders` | `recordedFolders`: folders of files picked, dropped, moved, downloaded, produced; input `resolve.dir`s; folder-trigger dirs; `fs` steps' `dir`s. All expanded (`~`, absolute, symlinks followed) |
| `pages` | `recordedPages` (15 Oct): every page the recording was on or a click led to: the sites a step may open |
| `closed` | Open questions closed with a quote of the user's words (15 Oct): never asked |
| `draft` | The current draft. Changes only through `change()` and `ask_user`'s applied answers |
| `form`, `steps`, `idsByStep`, `notes` | As given |
| `pending` | First-draft questions not asked yet |
| `answered` | `{ question, answer }` for every question asked (open or the agent's own) |
| `asked`, `maxQuestions` | Count and limit (5) |
| `edits` | Every `EditInput` kept, in order. **Answers applied by `ask_user` are not in it** |
| `prompter`, `memory`, `checks`, `describe` | As given |

---

## 7. Tools

13 tools. None are `probe` or `try`: the agent never touches a live page.

**`close_question`** (15 Oct) `{ id, quote }`: closes an open first-draft question the description or what was said already answers. The quote must be at least three words and appear in the form or the narration (case, punctuation and spacing ignored), else: *"… is not in the description or what they said: quote their exact words, or ask the question instead."* A closed question is never put to the user, by the agent or the drill.

### Look

| Tool | Input | Output | Notes |
|---|---|---|---|
| `read_description` | `{}` | the form's description + `frequency`, or "No form was filled in…" | |
| `read_recording` | `{ from?: int ≥1, to?: int ≥1 }` | `recordingView(from, to)`: `[{ n, ids, did, page, element, …, notes? }]` | **untrusted**. Defaults to all steps. Clipped at 12,000 characters by the loop |
| `workflow` | `{ step?: string }` | the outline, or one step as JSON, or `No step X` | |
| `describe_screen` | `{ step: int ≥1 }` (the **recorded** step number `n`, not a skill id) | the vision model's description | **untrusted**. "No pictures: the user did not allow pictures to be sent." without consent; "Couldn't describe it: …" when the step has no kept picture |
| `recall` | `{ query: string }` | up to 8 memory texts, any workflow | "No memory." / "Nothing remembered about that." |
| `validate` | `{}` | `{ ok, problems: checks(draft), open_questions: [{id,text}] }` | `problems` are only `unattendedGaps` (§8.3) |

### Edit
All edits go through `change(edits)`: `applyEdits` (README §5), then `designViolations` (§8). Either is all-or-nothing.

| Tool | Input | What it does |
|---|---|---|
| `edit` | `{ edits: object[] }` (**1–100**, was 30 until 15 Oct) | Raw edit operations |
| `wrap_in_loop` | `{ steps: id[] (≥1), over: "{{list}}", item: { name, type }, intent, on_item_fail?: stop\|skip }` | Inserts `l<N>` before the first step, then moves each listed step into it. `max_items` comes from the schema default |
| `wrap_in_branch` | `{ steps: id[], if: Condition, intent, otherwise?: id[] }` | Inserts `b<N>` before the first step, moves `steps` into it and `otherwise` into its `else` |
| `add_llm_step` | `{ after: id, intent, instruction, inputs: string[] (≥1), output: { name, type } }` | Inserts `ai<N>` (llm step, `requires_approval: false`) after `after` |

Results:
- **Kept:** `{ ok: true, workflow: <outline>, still_to_fix: checks(draft) }`
- **Bad edit:** `{ ok: false, problems: [...] }` (from `applyEdits`: schema, references, positions)
- **Against the rules:** `{ ok: false, refused: [...] }` (from `designViolations`)

### Ask (the drill)

`ask_user` `{ id?, question?, options?: string[] (≤6), default?, step? }`:
1. If 5 questions were already asked: *"You have asked 5 questions: decide the rest yourself, or finish."*
2. With an `id`: it must be in `pending`, else *"No open question X. Open: …"*. Without one, a new question `design-<n>` is built from `question`, `options` and `default`.
3. Empty text: *"Give the question, or the id of an open question."*
4. Asks the user through the inbox, **with no time limit**. An empty answer takes the default.
5. **Own question:** returns `{ answer }`. The agent must apply it with edits itself.
6. **Open question:** removed from `pending`. Then:
   - no `appliesTo`, or an empty answer → `{ answer }`;
   - otherwise `applyAnswer` (§10.2), then `designViolations`. Failure → `{ answer, not_applied: <reason> }`; success → `{ answer, applied: true, workflow }`.

Since 15 Oct a `not_applied` result also says *"the user answered this: put it into the workflow yourself with an edit"*, and answers about a new input no longer fail (§10.2). Kept edits also list the `open_questions` still pending, as a reminder.

### Finish
`finish` `{ summary: string (1–300) }`: refuses with `{ refused: "not finished yet", problems }` while `checks(draft)` isn't empty; otherwise ends the episode with `{ summary }`. **The summary isn't compared with what was actually done.**

---

## 8. Guardrails

### 8.1 `designViolations(original, draft, form, folders)`

Checked on every `change()` and every applied answer. Each rule and its exact message:

| Rule | Message |
|---|---|
| With a form, the trigger's `when` can't change | the Frequency is the user's (they chose it on the form): it can't change |
| With a form, the description can't change | the description is the user's (their own words on the form): it can't change |
| A changed or new input's `resolve.dir`, or a default that looks like a path (`~…`, `/…`), must be inside a recorded folder | `<name>`: an input may only point at folders the recording touched (…), not X |
| A **new** action must be read-only: `fs.find, fs.read, data.pick, web.extract, web.wait_for, web.navigate` | `<id>`: a new X step would do something the user didn't show. Only steps that read (…) can be added; ask the user to show the rest |
| A **recorded** step keeps its `channel.action` (replacing it under its id with an llm step or a loop counts as a change), except a recorded `web.click` or `web.press` may become a `web.navigate` to **the page that step opened** (15 Oct), never one that submitted a form, sends or needs approval | `<id>`: a recorded step keeps its kind of action (it was X) |
| A recorded **write** (`web.type, select, upload, drag`, `ax.set_value`, `fs.move, copy, rename, write`) is never removed, unless it repeats a step kept inside a loop (same action on the same control: the second item shown) (15 Oct) | `<id>`: it types what the user showed (…), which is the work itself: move it or wrap it in a loop or branch, never remove it |
| At most half the recorded actions (at least 2) may be removed; repeats kept in a loop don't count (15 Oct) | N of the M recorded steps would be gone (at most K): keep what the user showed, and ask them before dropping more |
| A workflow whose first web step opened a page must still open one first (15 Oct: runs start on a blank window) | `<id>`: runs start on a blank window, so the workflow must still open a page first (…) |
| A new or changed `fs` step's `dir`, `path`, `from`, `to` must be inside a recorded folder (a whole-string `{{reference}}` is allowed) | `<id>`: it may only look in folders the recording touched (…), not X |
| A new or changed `fs` glob can't climb (absolute, `~`, `..`) | `<id>`: its glob (X) must stay inside its folder |
| Every target must be one the recording had (by exact locator) | `<id>`: its target is not one you recorded… ask them |
| A recorded step's target can't change | `<id>`: its target can't change (it is what the user clicked) |
| No new `script` step | `<id>`: script steps can't be added |
| A new or changed `navigate` URL must be on an origin the recording visited: a navigate step in the first draft, or (15 Oct) **any page the recording was on or a click led to** (a `file://` page must match exactly) | `<id>`: it may only open a site the recording visited (…) |
| A step that needed approval can't be removed | `<id>`: a step that needs approval can't be removed |
| Approval can't be turned off | `<id>`: approval can't be turned off |

### 8.2 What is **not** checked
- **Removing recorded clicks and page loads**, up to half the recorded actions (writes and approval steps never). Fixed 15 Oct: before, the agent could delete every action the user showed.
- **Args** of recorded steps can change freely (e.g. typed text), except fs paths.
- **llm steps, loops and branches** have no rules: any instruction, any inputs, any condition.
- A llm step's output used later as a **file path** or **URL** isn't checked (a run-time path is invisible here; see `docs/guide/14-shadow-end-to-end.md` §7 item 5).
- ~~Sites the user reached by clicking don't count as visited~~ and ~~changing a click into a navigate is refused~~: both fixed 15 Oct (§8.1). The repair agent's own allowed sites are still only navigate steps (repair-agent.md §16, item 1: Akshat's).
- **The summary** passed to `finish`.

### 8.3 The `checks` (`unattendedGaps`)
`goLiveProblems(draft)` filtered to `input "<name>" has no default and no way to be found…`, excluding secret inputs. It applies only when the trigger is a **schedule or folder_watch**. **For a manual workflow it's always empty**, so `validate.ok` is always `true`, `still_to_fix` is always `[]`, and `finish` is never refused.

### 8.4 Size limits
- `edit`: 1–100 operations (30 until 15 Oct: a bigger call was refused, and the model re-sent only the first 30, which were all removals; see `reports/first-real-recording-yc-to-sheets.md`, issue 1).
- `wrap_in_loop` / `wrap_in_branch` build their own operations (1 insert + 1 move per step), so wrapping 30+ steps hits no cap.
- `ask_user`: 5 questions, ≤ 6 options each.
- `finish` summary: ≤ 300 characters.

---

## 9. Budget and runtime settings

| Setting | Value | Where |
|---|---|---|
| Profile | `smart` (Nemotron 3 Super, thinking on, 8,192 output tokens incl. reasoning, temp 0, 180 s) | `design.ts`, `catalog.ts` |
| Turns | 16 | `DESIGN_BUDGET` |
| Cost | $0.10 (vision calls not counted) | `DESIGN_BUDGET` |
| Live actions | 0 | `DESIGN_BUDGET` |
| Time | none: a question can wait for ever | |
| Guard | none | |
| Working memory | last 4 tool results whole, older ones cut to 400 characters | loop default |
| Tool result cap | 12,000 characters | loop default |
| Protocol | native tools; JSON actions if the API refuses tools | loop default |

---

## 10. Questions and answers

### 10.1 The three places a question can be asked
1. **During the agent**, via `ask_user` (≤ 5): the first draft's open questions by id, or its own.
2. **After the agent** (`drill`): every question still `pending` and still relevant (`stillOpen`: a question about a step or trigger input the agent removed is dropped).
3. **For unattended runs** (`fillForUnattended`): a default for each input that has none, when the Frequency is a schedule or folder.

All three go to the inbox as `question` items with options and default. The design agent's also carry the draft and the step to mark.

### 10.2 How an answer is written (`applyAnswer`, `drill.ts`)
- `appliesTo` is a dot path. `steps.<id>` or `steps.<n>` (by position: `steps.0` is the trigger) selects a step. Keys `target, channel, action, version` are refused.
- `steps.<id>` alone with an option whose value is an object: **replaces the whole step** (the cost question).
- Otherwise it walks the path, **creating empty objects** for missing keys, and sets the last key to `valueFor(answer)`:
  - an option chosen by number or label → its `value`;
  - else, if the current value is a boolean → yes/true/ok/sure;
  - a number → `Number(answer)`;
  - text starting with `[` or `{` → parsed JSON;
  - else the text.
- The skill is re-parsed. Errors come back as `path: message`.

**Fixed 15 Oct:** a question that points at an input (`steps.0.inputs.count`, `steps.start.inputs.count`, with or without `.default`) now sets that input's `default`, typed as the input is; an input that doesn't exist yet is **created**, typed from the answer (`"5"` → `{ type: number, default: 5 }`, `"Yes"` → boolean, else text). Before, the raw answer was written where an `Input` object is required and always failed (*"expected object, received string"*).

### 10.3 Waiting
`service.ask` creates an inbox item and waits on a promise with **no timeout**. If the daemon restarts, open questions are marked `{ expired: "the daemon restarted" }`, and that design run is gone with the process (the recording folder is still there for 24 h; `compile <session>` can redo it).

---

## 11. Memory

| | |
|---|---|
| Reads | `recall(query)` → `memory.search(query, { limit: 8 })` across **all** workflows. The first-draft compile also puts up to 8 matching entries in its prompt |
| Writes | After the agent: `remember()` stores `"<question text> <answer>"` as `fact` / `preference` for each answered question that has `remember` set (only first-draft questions can; the agent's own never do). After the drill: the same for drill answers |
| Never written | What the agent learned, the narration, the screen words, the final design |

---

## 12. What is kept

`recordings/<session>/design.json` (mode 0600; deleted with the recording 24 h after saving):

```json
{
  "summary": "…",          // or "kept": "<reason>" when it didn't finish
  "edits": [ … ],           // session.edits (answers applied by ask_user are not here)
  "turns": 8,
  "usage": { "calls", "input", "output", "costUsd" },
  "closed": [ { "id", "text", "quote" } ],   // since 15 Oct
  "prompt": { "system", "task" },          // since 15 Oct: what it was told (the loop's own rules not included)
  "transcript": [ AgentEvent, … ]
}
```

The daemon log gets `design agent: <summary> (<turns> turns, $<cost>)` or `design agent: <reason>; keeping the first draft`. The saved workflow's history gets `Recorded; <summary>`.

**Not kept:** the model's reasoning, the input of a refused (`invalid`) edit (shared `packages/agent` code), and the first-draft compile's prompt and reply.

---

## 13. Outcomes

```ts
type DesignOutcome = { skill, pending: Question[], answered, episode? } & (
  | { kind: "designed"; summary; edits }   // finish was called
  | { kind: "kept"; reason }                // out of turns/cost, error, aborted, or no model
);
```

- **designed**: `skill = session.draft`; `pending` is filtered by `stillOpen`.
- **kept**: `skill =` the compiled draft with every already-given answer re-applied (`applyAnswer`; failures skipped); `pending` unchanged. Reasons: `it ran out of turns|cost`, `it failed: <error>`, `it was stopped`.

---

## 14. Tests (`packages/recorder/src/design/design.test.ts`)

With a scripted model:
- reads, edits, asks on the step, finishes with what it changed
- is refused anything outside the rules, and the draft is left as it was
- builds a loop over files and an llm step from the recorded steps (replayed in headless Chrome)
- may finish only once the checks pass
- tells the agent after every edit what still stops the workflow
- describes a recorded step's masked picture when asked, as data; says there are no pictures without consent
- keeps the first draft, with the answers already given, when it runs out of turns
- lets the user's own fields and approvals through unchanged, and nothing else
- keeps file steps, inputs and local pages inside what the recording touched, however the path is written
- puts what was said next to the step it was said over
- drops a first-draft question about an input the agent removed
- (15 Oct) gives the narration whole, before the recording, with the steps each piece spans; lets the first draft hear it too
- (15 Oct) closes a question the narration already answers by quoting it, refuses a quote nobody said, and never asks it
- (15 Oct) keeps what the user showed: no recorded write removed, at most half the steps; a click may open a page the recording reached
- (15 Oct, `recorder.test.ts`) creates the input an answer is about, typed from the answer (the three answers lost in the YC run)

Plus `apps/daemon/src/e2e.test.ts` (form → events → compile → design agent on a scripted model).

**Not tested:** a real model (every prompt change above is proven only by a real re-recording); a recording longer than 40 steps; a manual workflow's `finish` with nothing designed.

---

## 15. Known weaknesses: where to improve

From the code above and the first real recording (`reports/first-real-recording-yc-to-sheets.md`).

### Rules that let bad results through
1. *(Fixed 15 Oct: writes never removed, at most half the steps.)* **No limit on removing recorded steps** (§8.2). Fix: refuse removing steps that write (type, paste, upload, outward) unless replaced, or cap removals and ask beyond.
2. **The `checks` are empty for manual workflows** (§8.3), so nothing structural is checked before `finish`. Add design-time checks:
   - the workflow starts by opening a page (or a file step);
   - every recorded write still happens;
   - no recorded example value (a date, a name) is still typed literally when the description says it changes.
3. **`finish` summary unchecked.** Build the history note from `session.edits`, and keep the model's sentence as a comment.

### Rules that block good results
4. *(Fixed 15 Oct, design side.)* **Visited sites** = only first-draft navigate steps. Use every URL the trace navigated to (including pages reached by a click), so "open the sheet directly" is possible.
5. *(Fixed 15 Oct.)* **Kind of action is fixed.** Allow `web.click` → `web.navigate` when the click led to a stable URL (the trace has it).
6. *(Fixed 15 Oct: 100.)* **30 operations per edit.** Raise it, or add `replace_range` / `rebuild` operations so a restructure isn't 30+ single ops that get cut in half.

### Questions
7. *(Fixed 15 Oct.)* **Answers to new-input questions never apply** (§10.2). Create the input (`{ type: <from the answer>, default }`) when the path names one that doesn't exist, and return `not_applied` as an error the agent must resolve before `finish`.
8. *(Fixed 15 Oct: both prompts, and close_question with a checked quote; proven only by a real re-recording.)* **Duplicate questions** (§2.5). Tell both prompts not to ask what the form or narration says, and filter by meaning: the agent quotes the line that leaves it open, or doesn't ask.
9. **No timeout on questions** (§10.3). Fall back to the default after N minutes, and survive a daemon restart.

### What the agent sees
10. *(Narration fixed 15 Oct; screen words past step 40 still only via read_recording.)* **Only steps 1–40 are in the first message.** Always include every note (said and seen), even when steps are shortened.
11. *(Partly 15 Oct: the list → pick → loop shape is in the ROLE.)* **The briefing has no "Available now"** and no worked examples of the common shapes ("list → pick N new → loop → write a row"). A few examples would make better use of the existing tools.
12. *(Fixed 15 Oct: the narration section with step spans.)* **Notes attach to one step** (§5.3). A sentence about the whole task ("do this for 5 a day") lands on whatever step was last; consider a separate "what was said overall" section.

### Capabilities
13. **No "append a row" action.** Writes go to fixed cells (`A2`), so a daily run overwrites the same row. `web.extract { source: "google_sheet" }` can read rows, but nothing writes the next empty one.
14. **Typing into another site's document isn't outward** ([README](README.md) §6), so a sheet write never needs approval by default.

### Observability and cost
15. *(System and task kept since 15 Oct; reasoning and refused inputs still not.)* Keep the system and task messages, the reasoning, and the input of refused calls in `design.json` (README §10).
16. Meter the compile call and vision calls (README §3.4).
