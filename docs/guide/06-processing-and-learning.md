# 06 · Processing with models, and what "learning the new UI" means

## Q1 · Processing the input with a model

> *"processing the input using some ml model back of the hood , extracting metadata from the screenrecording basically its instructions that can be replayable"*

### The short answer

- **The metadata is not extracted by a model.** The content script reads it straight from the DOM at each event: role, name, label, nearby heading, selectors ([04](04-capture-without-coordinates.md)).
- **The model's job is judgement, not sensing.** It turns those facts into *instructions*: what each step is for, which values should vary next time, what success looks like, which steps need your approval.

Nemotron runs at two moments: **compile**, once per task you teach, and **recovery**, only when a replay step fails. A clean replay makes **zero** model calls (`design.md:132`).

### The perspective that makes it simple

**The sensors produce facts; the model produces meaning.** If you ask a model to *see* (pixels → "which button?"), every run depends on it, and it can be wrong every time. If you let the DOM do the seeing and ask the model only to *interpret* a list of facts, you call it once, check its output against a schema, and run the result for free from then on.

### Every model call in the system

| Moment | What goes in | What comes out | Which model (to decide) | How often | Code |
|---|---|---|---|---|---|
| **Compile** | normalised steps (descriptors, values, URLs), memory notes, the action vocabulary from `skill.ts:11-17` | `{ skill, questions }`, validated by `Skill.safeParse`, with up to 2 retries | the large one (sheet: Ultra; dossier: Super) | once per teach | ⬜ `recorder/compile.ts` ([05](05-context-layer.md#stage-4--compile)) |
| **Drill update** | the draft skill + your answers | patched skill | same | once per teach | ⬜ `recorder/drill.ts` |
| **Agent fallback** | step `intent`, the stored locator, relevant memory, an outline of the *current* page | a target on this page (or a short action list) | the small one (sheet: Nano) | only after the deterministic ladder fails | ⬜ `player/agent.ts` |
| **Clean replay** | — | — | **none** | every run | — |
| **Learn-back** | — | skill version N+1 | **none**: it copies the verified fix | after a verified fix | ⬜ `player/learnback.ts` |

### What the model is allowed to see

From `design.md:185-194`. These are rules, not suggestions, because pages are untrusted input:

- **Page text is data, never instructions.** The agent *"may only return targets and actions for the current step's `intent`; it cannot add steps, change URLs outside the skill's domains, or read other tabs"* (`design.md:190`).
- **No secrets, ever.** Passwords are redacted in the content script ([04](04-capture-without-coordinates.md#4--redact-at-the-source)) and become `Input.type: "secret"`, resolved from the Keychain at run time (`design.md:191`).
- **Small outlines.** *"Snapshots are cut to the area around the target, with input values and password fields removed"* (`design.md:193`).

### Model choice: one decision, three sources that disagree

| Source | Says |
|---|---|
| `readme.md:4`, `design.md:192`, `.env.example:1` | Nemotron on *"our own Nebius Serverless endpoint"* |
| Sheet (Idea tab) | *"nebius token factory with a mix of nemotron ultra, super and nano"*; *"Ultra for learning, Nano for replay, Super for edge cases"* |
| Dossier | Token Factory; Super compiles, Nano or Lightning heals. Model IDs and prices are listed there (**dossier claim, unchecked**) |
| Code (`llm/index.ts:16-24`) | **one** `NEMOTRON_MODEL` for every call, and `content: string`, so no images |

What doesn't depend on the decision: the client speaks the OpenAI chat-completions format, so both kinds of endpoint work by changing `NEBIUS_BASE_URL`. What does: you need **two** models (large for compile, small for recovery), so `chat()` needs a per-call `model`.

**Day-1 checks** (about 30 minutes; write the results into the repo so nobody has to repeat them):

```sh
set -a; source .env; set +a
# 1. Which Nemotron IDs does this endpoint actually serve?
curl -s "$NEBIUS_BASE_URL/models" -H "Authorization: Bearer $NEBIUS_API_KEY" | jq -r '.data[].id' | grep -i nemotron
# 2. Does JSON mode work for the model you'll compile with?  (llm/index.ts:38 sends response_format json_object)
curl -s "$NEBIUS_BASE_URL/chat/completions" -H "Authorization: Bearer $NEBIUS_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"'"$NEMOTRON_MODEL"'","response_format":{"type":"json_object"},"messages":[{"role":"user","content":"Return {\"ok\":true} as JSON."}]}' | jq .
# 3. Does it accept an image part? (expect an error if text-only: the dossier says HTTP 400)
```

**Cost** (dossier estimates, prices unchecked): one compile ≈ $0.012, one recovery ≈ $0.0004. One structural fact matters more than any price, and it comes from the design: **cost grows with how often pages change, not with how often you run.**

---

## Q2 · When the UI changes, does the model learn it?

> *"if the ui gets changes the model learns it and automatically understands or maps to the instructions (updated)"*

### The short answer

**Nothing gets trained, and the model remembers nothing between calls.** When the page changes, three things happen, in order:

1. **Replay tries cheaper signals first.** Most drift is absorbed by the fallbacks recorded at teach time, with no model call.
2. **If they all fail, the model picks the element** on the current page, given the step's `intent` and the old description.
3. **If the step's check then passes, learn-back writes skill version N+1** with the new locator, and the old one is kept as a fallback (`design.md:153`). The next run is deterministic again.

"The system learned the new UI" means the **skill file** changed.

### The perspective that makes it simple

**The skill file is the memory; the model is stateless.** Every Nemotron call starts from zero. Anything the system "knows" next time is something we wrote down: a locator in the skill, or a site note in memory.

### Why it has to be this way

Training per user and per site looks tempting. Four constraints rule it out:

- **One example per change.** A redesign gives you one failure. That isn't enough data to train on, but it's plenty to *write down*.
- **The fix is needed during this run.** Training happens later; the user's task is happening now.
- **Auditability.** A diff of a JSON locator (`"name": "Submit"` → `"Submit invoice"`) is reviewable and revertible. A change to model weights is neither.
- **Cost.** Calling the model only on failure makes cost proportional to drift. Training would make it proportional to users × sites.

Once you add "the user can see and undo what changed", writing to the skill is the only design left.

### The ladder replay climbs for each step

This combines `design.md:141-151` with the dossier's R0–R6. It's cheapest first, and the model appears only on rung 5:

| Rung | Try | Uses a model? |
|---|---|---|
| 0 | **Wait** for the precondition: element present and enabled, URL, network idle (`step.wait`) | no |
| 1 | **Role + accessible name**, exact | no |
| 2 | **Label, or `near` heading** narrows the candidates | no |
| 3 | **Fallback selectors** in stored order: CSS, then XPath | no |
| 4 | **Fuzzy**: same role, similar name, same nearby heading. Accept only *one clear winner* above a threshold (open question, `design.md:237`) | no |
| 5 | **Agent**: Nemotron chooses from a numbered outline of the current page, or says none | **yes** |
| 6 | **Ask the user**, showing where it stopped (`design.md:151`) | no |

### Traced: replaying `upload-invoice` on the redesigned page

`skills/examples/upload-invoice.json` was written for `upload.html`. Here it is replayed against `upload-drifted.html`. Page facts are **measured** (accessibility snapshot plus DOM queries); ladder behaviour is **reasoned**, since the matcher isn't built yet.

The accessibility outline Chrome produces for the drifted page:

```yaml
- dialog "Cookies" [ref=e2]:
    - button "Accept" [ref=e3]
- main [ref=e4]:
    - complementary [ref=e5]:
        - navigation [ref=e6]: Home · Billing · Documents
    - generic [ref=e7]:
        - heading "Documents" [level=2] [ref=e8]
        - generic [ref=e9]:
            - text: Drop your invoice here or
            - generic [ref=e10]: Browse files
        - button "Submit invoice" [ref=e11]
```

| Step | Stored target | Rung 1 | Rung 3 | Rung 4 | Result | Model calls |
|---|---|---|---|---|---|---|
| `s1` navigate | — | — | — | — | Check `url_matches: "/upload"` passes | 0 |
| `s2` upload | `button "Upload invoice"`, near `Documents` | ❌ no such node: the file input is `hidden`, so it is **absent from the outline above** | CSS `input[type=file][name=invoice]` → **0**; XPath `//section[h2='Documents']//input[@type='file']` → **1** ✅ | — | `DOM.setFileInputFiles` on the hidden node; check "file name visible" passes (`upload-drifted.html:22-25`) | 0 |
| `s3` click | `button "Submit"` | ❌ buttons are `"Accept"` and `"Submit invoice"` | no fallbacks stored | ✅ `"Submit invoice"` has the same role, contains "Submit", and is under heading `Documents`. `"Accept"` sits in `dialog "Cookies"`: one clear winner | `requires_approval: true` (`upload-invoice.json:42`), so it pauses: *"Matched 'Submit invoice' (was 'Submit'). Approve?"* Then skill success `"Upload complete"` (`upload-drifted.html:27`) | 0 (rung 5 only if fuzzy were ambiguous) |

Then learn-back proposes:

```diff
  { "id": "upload-invoice",
-   "version": 1,
+   "version": 2,
    …
    { "id": "s3", "action": "click",
-     "target": { "role": "button", "name": "Submit" },
+     "target": { "role": "button", "name": "Submit invoice", "near": "Documents",
+                 "fallbacks": ["…selectors from describeElement(matched)…"] },
+     // the v1 name "Submit" is kept as a fallback: the redesign may be rolled back
```

**Run 2 on the same page: rung 1 on every step, zero model calls.** That is the whole of "the model learned the new UI".

### What is unusual here: a correction to the dossier

The dossier's rung R4 is *"Nemotron Nano/Lightning over pruned AX snapshot"*. Look at the outline above, which is exactly that snapshot. **The file input step `s2` needs isn't in it.** Hidden inputs aren't in Chrome's accessibility tree.

If the XPath had also died, an agent given only this outline would have no correct answer. It could only pick `generic "Browse files"`, the label. Clicking that opens the native file dialog, which replay can't drive.

So the outline handed to the agent must be built from the **DOM**, using our own `describeElement` over candidates. It must **always list `input[type=file]` nodes, even hidden ones**. This came out of the repo's own fixture, not from theory, and it is why that fixture exists.

### Learn-back, mechanically

| Question | Answer | Source |
|---|---|---|
| When does it fire? | After a fix that **passed its check**. An unverified fix is never written | `design.md:153` |
| What can it change? | `target` only: never `action`, `args`, URLs or `intent` | `design.md:190` (same rule as the agent) |
| Where does the version live? | `Skill.version` (`skill.ts:88`). Keep v1 on disk; never overwrite | ⬜ storage layout not decided. Proposal: `skills/<id>/v1.json`, `v2.json`, … |
| Who approves? | You, the first time; *"later, small locator fixes can be applied automatically"* | `design.md:153`; threshold open (`design.md:237`) |
| What gets logged? | Rung, score, the old and new target | `run.step_result.matchScore` already exists (`messages.ts:47`) |
| What goes to memory? | Things like "this portal shows a cookie banner first" | `site_note` (`memory/index.ts:4`) |

### Learn-back is not the correction loop

The sheet's scope has *"Correction loop so a task done wrong can be corrected next time."* That is a different mechanism, with a different trigger:

| | Learn-back | Correction |
|---|---|---|
| Trigger | a step **failed** to match or check, then a fix **passed** | the run **succeeded** but did the wrong thing (wrong file, wrong folder) |
| Who notices | replay, automatically | **you**, because no check failed |
| What changes | *where*: a `target` | *what*: an `input` resolver, a step, a check |
| How | copy the verified fix | re-drill (*"use the PDF, not the CSV"*) → compile a patch → v+1 |

The design names only the first. The second needs a "that was wrong" entry point, from the run report, that sends the skill back through drill. That's Sprint 3–4.

### What "the model learns" is NOT

- **Not fine-tuning.** No weights change, ever.
- **Not the model remembering.** Each call is stateless; the skill and memory carry everything.
- **Not silent on risky steps.** A healed `requires_approval` step still asks.
- **Not free to rewrite the task.** It can only re-point the *target* of the current step.
