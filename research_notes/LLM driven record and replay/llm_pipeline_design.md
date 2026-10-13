# LLM-assisted record → compile → replay pipeline for Task Player

Notes written 7 Oct 2026. Scope: where a text or vision LLM should sit around record, normalise/compile and replay; whether the skill should be built by code + AI or by AI alone; and the trade-offs. Every claim cites a source. Local code is cited by absolute path; web sources by URL.

Labels used below:
- **[measured]**: a number from an experiment, benchmark or test.
- **[vendor]**: a claim by the maker of the product, not independently checked.
- **[projected]**: a claim the authors did not measure.
- **[opinion]**: my inference or a design suggestion, not a measured fact.

Repo state checked: `main` at 957370e, plus uncommitted edits to `skeleton.ts`, `recorder.test.ts`, `replay.ts` and `readme.md`. Saved skills were read without changing them, from `~/Library/Application Support/TaskPlayer/skills/`.

---

## Q1. Screenshot capture per event (browser and Mac): APIs, limits, timing, storage, privacy

### Takeaway
- **In Chrome:** use `chrome.tabs.captureVisibleTab` during recording. It works with the existing `<all_urls>` permission and needs no debugger bar. Crop it with the element rect from the content script. Plan around its limit of 2 calls per second and the "before" timing race.
- **During replay:** CDP `Page.captureScreenshot` with `clip` is the better tool, because `chrome.debugger` is already attached in the automation window.
- **On the Mac:** use ScreenCaptureKit's `SCScreenshotManager` with a single-window filter. `CGWindowListCreateImage` has been deprecated since macOS 14. This needs a second permission (Screen Recording), which macOS Sequoia re-asks for monthly.
- **Privacy:** redact by rect at capture time and send crops, not full frames. Consider DOM snapshots (rrweb-style, with masking) as a cheaper, more redactable complement to pixels.

### Cited Findings
**Current design rule (repo)**
- **The privacy rule as designed.**
  - "Data leaving the Mac: only when compiling a skill or recovering a failed step. Snapshots are cut to the area around the target, with input values and password fields removed."
  - The design's target snapshot list includes "A small cropped screenshot of the element and the URL at that moment".
  - The design lists "Screen-recording video as the source of truth for a skill" as out of scope for v1 ("may come back later as a teaching aid").
  - — [docs/design.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/design.md)

**Chrome: `chrome.tabs.captureVisibleTab`**
- It "Captures the visible area of the currently active tab in the specified window." It needs `<all_urls>` or `activeTab`.
- Sensitive pages (chrome: pages, other extensions' pages, data: URLs) "can only be captured with the activeTab permission".
- `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2` (Chrome 92+): "captureVisibleTab is expensive and should not be called too often."
- — [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- Real extensions hit "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota" in practice. — [UI.Vision forum](https://forum.ui.vision/t/error-this-requeste-exceeds-the-max-capture-visible-tab-calls-per-second-quota/8024)
- The extension already declares `"host_permissions": ["<all_urls>"]` and `"debugger"`, `"tabs"`, `"scripting"`. — [manifest.json](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/apps/extension/manifest.json)

**Chrome: CDP**
- `Page.captureScreenshot` params:
  - `format` jpeg|png|webp
  - `quality` (jpeg only)
  - `clip: Viewport {x, y, width, height, scale}` in device-independent pixels
  - `fromSurface`, `captureBeyondViewport`, `optimizeForSpeed` (experimental)
- `Page.startScreencast` has `format`, `quality`, `maxWidth`, `maxHeight`, `everyNthFrame`, `maxFramesInFlight`.
- — [Page.pdl, ChromeDevTools/devtools-protocol](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl)
- `chrome.debugger` "Shows a 'debugging this browser' bar while attached". The design limits it: "the extension attaches `chrome.debugger` only to tabs in the automation window, and only during a run." — [docs/design.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/design.md)

**Hover is a known blind spot of recorders**
- "the **Recorder** doesn't automatically capture `hover` events because this pollutes the recording and not all such events are useful." A `hover` step can only be added by hand ("Add step before" → type `hover` → pick a selector). The supported step types include `hover`, `scroll` and `waitForElement`. — [DevTools Recorder reference](https://developer.chrome.com/docs/devtools/recorder/reference)

**macOS**
- "CGWindowListCreateImage is deprecated since Sonoma" (macOS 14). In the same thread, a developer reports that calling the async `SCScreenshotManager` replacement on mouse-movement events "causes significant lag". — [Apple Developer Forums thread 740493](https://developer.apple.com/forums/thread/740493)
- That it is *unavailable* when building against macOS 15 comes only from search-result summaries of build-failure tickets, which I did not open. Treat it as likely but unverified.
- The `SCScreenshotManager` class is macOS 14.0+. Its methods:
  - `captureImage(contentFilter:configuration:)` returning a `CGImage`
  - `captureSampleBuffer(…)`
  - `captureImage(in: CGRect)`: the method's own page says **macOS 15.2+**. It "returns an image containing the contents of the rectangle in points, specified in display space". — [Apple docs: captureImage(in:)](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager/captureimage(in:completionhandler:))
- A single window is captured with `SCContentFilter(desktopIndependentWindow:)`. Screen Recording permission is required.
- — [Apple docs: SCScreenshotManager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager)
- In macOS Sequoia, ScreenCaptureKit apps get a recurring prompt: "[App] is requesting to bypass the system private window picker and directly access your screen…", answered with "Allow For One Month". It was changed from weekly to monthly, and there is no re-prompt on every reboot. Apple has not documented how to get the "Persistent Content Capture entitlement" that avoids it. — [9to5Mac, Aug 2024](https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/)
- Task Player.app today uses `NSEvent.addGlobalMonitorForEvents` + the Accessibility API only. "Screen pixels, for apps that give no accessibility information" is listed as a future helper. — [docs/guide/12-how-it-works-simply.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/guide/12-how-it-works-simply.md)

**DOM snapshots as a privacy-friendly complement**
- rrweb records a full DOM snapshot, then incremental mutations. Privacy options:
  - `maskInputOptions` (default `{ password: true }`)
  - `maskAllInputs` (default false)
  - `maskTextClass`/`maskTextSelector`
  - `blockClass`/`blockSelector` (shown as placeholders on replay)
  - `ignoreClass`, `maskInputFn`, `maskTextFn`
- — [rrweb guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md)

**Vision grounding needs structure too**
- SeeAct found "set-of-mark prompting turns out to be not effective for web agents, and the best grounding strategy… leverages both the HTML structure and visuals". — [arXiv 2401.01614](https://arxiv.org/abs/2401.01614)
- Set-of-Mark overlays alphanumeric marks/boxes on image regions to ground a model's answers. — [arXiv 2310.11441](https://arxiv.org/abs/2310.11441)

### Inferences
**Per-event evidence bundle** [opinion]. Add it to the trace next to `target`, and fill the existing `crop` slot:
```jsonc
{ "id": "e42", "event": "click", "target": { /* ElementDescriptor */ },
  "frames": { "pre": "frames/e42-pre.jpg", "post": "frames/e42-post.jpg", "crop": "frames/e42-crop.png" },
  "rect": { "x": 412, "y": 318, "w": 96, "h": 32, "dpr": 2 },
  "viewport": { "w": 1440, "h": 900, "scrollY": 1200 },
  "context": { "landmark": "main", "heading": "Search results", "list": { "index": 0, "size": 20, "itemRole": "listitem" },
               "siblings": [{ "role": "link", "name": "…" }] },
  "revealed_by": { "event": "hover", "target": { "role": "link", "name": "Akcent - Stay with Me" }, "dwell_ms": 640 },
  "visible_500ms_before": false,
  "redactions": [{ "x": 0, "y": 600, "w": 300, "h": 40, "why": "password" }] }
```

**Timing in Chrome** [opinion]
- `captureVisibleTab` is called from the service worker after a message hop. A truly "before click" frame is therefore racy: some UIs act on `pointerdown`.
- Reliable recipe, within 2 calls/s:
  - **Rolling pre-frame.** Capture when the pointer dwells about 300 ms on an interactive element (`pointerover` + timer), throttled to ≤1/s. This frame shows the hover state. It is exactly the evidence failure (1) lacks.
  - **Post-frame.** Capture when the page settles (no DOM mutations for about 400 ms, or `webNavigation.onCompleted`).
  - **Skip** frames for keystroke and typing events. The final value is enough.
  - **Priority queue:** post-frame of a click > pre-frame > others. Drop rather than block.
- **Crop** in the service worker with `OffscreenCanvas`/`createImageBitmap`. Use the rect × `devicePixelRatio` that the content script measured at the event.

**Hover capture is a code change, not an LLM change** [opinion]. DevTools skips hover because it "pollutes the recording", so filter by dwell and by whether the hover revealed the later target. Do not record every hover.
- In the content script, keep a short ring buffer of `pointerover`/`mouseenter` on elements with dwell >250 ms. Use a `MutationObserver` to note elements that become visible.
- At click time, check whether the target existed and was visible about 500 ms before. If it wasn't, attach the hovered ancestor as `revealed_by`.
- On replay that becomes a hover precondition. This needs a schema change: `web.hover` or `wait: { hover: Locator }`.

**During replay**, use CDP `Page.captureScreenshot { format: "jpeg", quality: 60, clip }`. The debugger is already attached, so it adds no bar and no 2/s quota. [opinion]

**On the Mac** [opinion]
- On `app_click`, read the AX element's `AXPosition`/`AXSize`. Capture its window with `SCScreenshotManager` + `desktopIndependentWindow`, then crop.
- The global event monitor receives copies after the event, so treat Mac frames as "after" frames.
- Make Screen Recording optional. Degrade the way the Accessibility amber dot already does. Explain the monthly Sequoia re-prompt in onboarding.

**Privacy** [opinion]
- Redact before writing to disk: black out rects of `input[type=password]`, `autocomplete=cc-*|one-time-code`, AX `AXSecureTextField`, and fields marked secret. Pad the rects, because the page can move between the measurement and the capture.
- Send the LLM crops plus a downscaled context frame, not raw frames. That keeps to the design's "cut to the area around the target" rule.
- Keep full frames local, for the user's own review only.
- An rrweb-style masked DOM snapshot, or just the AX outline, gives the model "what was on screen" as text. That is cheaper and more redactable than pixels. Use pixels for canvas-drawn apps (Sheets cells, Maps) and for visual-only cues.

**Storage** [opinion, not measured]
- Downscaled JPEG frames (≤1280 px wide, q≈60) plus PNG crops are likely about 100–300 KB per event. A 30-event recording is then about 5–10 MB.
- Measure on real recordings before fixing limits. Delete frames when the skill is deleted.

### Gaps
- No source gives a measured latency for `captureVisibleTab` (time from call to pixels). I could not quantify how often a "pre" frame already shows the post-click state.
- I found no official statement that `captureVisibleTab` works while the window is minimised or occluded. The docs only say "active tab in the specified window".
- I did not verify Apple's exact Screen Recording behaviour on macOS 26/27 (this machine runs Darwin 27). The monthly-prompt source is from the Sequoia (15) betas.
- Frame sizes are estimates. No source measured them.

---

## Q2. Compiling with a multimodal LLM: what to send, output format, schema enforcement, repair, keeping replay deterministic

### Takeaway
Keep the current contract: code owns facts, the model owns meaning, and zod plus a repair loop decides. Feed the model far richer evidence than today, in two stages:
1. A **vision pass per step**: before/after crop plus context, giving a structured caption.
2. One **text pass over the whole trajectory**: the user's stated goal, the captions, the skeleton and memory, giving `Annotations`.

Extend the skill with semantic fields (`why`, `target_description`, a selection rule, preconditions, a natural-language expected outcome). These help replay recover without making the clean path depend on the model.

Use schema-constrained decoding and few-shot trajectory exemplars. Then validate semantically against the recording itself.

### Cited Findings
#### Current code (grounding)
- **The skeleton is built by code.** It fixes channel, action, target and every recorded value. The header says the model "can only add meaning on top: it can never invent a selector or an action" and that the skeleton "is also a complete, valid skill on its own, which is what gets saved when no model is configured". — [skeleton.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/skeleton.ts)
- **What the model may return.** The schema is `Annotations`: id, intent, inputs, triggers, success, and per-step intent/args/check/wait/requires_approval/ai/save_as/timeout_ms/on_fail, plus at most 8 questions. "Targets, channels and actions are deliberately absent."
  - The answer is merged by step id and checked with the same zod `Skill` schema plus `templateProblems`.
  - The errors are sent back to the model, for at most 3 attempts.
  - If it never passes, the skeleton is saved instead.
  - — [compile.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/compile.ts)
- **What the model sees (`forModel`).** It gets: `did` (kind), `page` (url), `element` {role, name, label, near}, app, menu, keys, dropped_on, `value` (first 200 chars, never secrets), checked, file name, path/to, `led_to`, `produced`, `likely_changes`, and copied text with a sheet header and row.
  - There is no screenshot or crop.
  - There is no DOM or AX context beyond role/name/label/near: no siblings, no list position, no page outline.
  - There is no statement of the user's goal.
  - There is no hover, scroll or dwell.
  - There is no record of what was on screen before the event.
  - — [compile.ts `forModel`](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/compile.ts)
- **The compile system prompt already asks for the right things.** It wants step intents that say "what it achieves ('Attach the invoice'), not how ('click the button')". It turns values into inputs, adds checks and approvals, and follows "Ask, don't guess" with at most 5 questions. — [compile.ts `systemPrompt`](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/compile.ts)
- **With no model, intents are templates.**
  - The template forms are `Click ${what}`, `Type into ${what}`, `Open ${short(url)}`.
  - The warning in that case reads "No model configured (NEBIUS_* in .env), so the skill was built by code only."
  - — [skeleton.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/skeleton.ts); [compile.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/compile.ts)

#### External sources
- **Constrained JSON in vLLM.** Through the OpenAI-compatible API, use `response_format: {"type": "json_schema", "json_schema": {...}}` or `extra_body: {"structured_outputs": {"json": schema}}` (this replaces the deprecated `guided_json`). Backends: xgrammar/guidance, `auto` by default. The docs do not say whether it works with multimodal models. — [vLLM structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs.html)
- **Nemotron 3 Nano Omni 30B-A3B Reasoning** [vendor]
  - Released 28 Apr 2026. 31B total / about 3B active, Mamba2-Transformer hybrid MoE.
  - Inputs: video, audio, image, text. 256k context.
  - The serving example sets `limit_mm_per_prompt` to **1 image per prompt**.
  - Video in MP4 up to 2 min.
  - "Reasoning mode is on by default", toggled with `enable_thinking`.
  - Supports tool calling and JSON output.
  - Vendor-reported OSWorld 47.4%.
  - Runs on vLLM, SGLang, TRT-LLM, llama.cpp, Ollama.
  - — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16)
- **NVIDIA Nemotron Nano 12B v2 VL** [vendor]
  - Released 28 Oct 2025, 12.6B.
  - **Up to 4 images per request**; 12 tiles of 512×512, up to 2048×1536. 128K context.
  - Aimed at document intelligence: OCRBench 85.6, DocVQA 94.39.
  - "No ScreenSpot or GUI grounding benchmarks mentioned."
  - — [HF model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-Nano-12B-v2-VL-BF16)
- **ECLAIR (Wornow et al., 2024)** [measured]
  - Multimodal FMs reached "93% accuracy on a workflow understanding task".
  - From "solely… a natural language description of a workflow", end-to-end completion was 40%.
  - RPA case studies: "unreliable execution (60% initial accuracy)", with 12–18 month set-up.
  - Open challenges named: "human-AI collaboration, validation, and self-improvement".
  - — [arXiv 2405.03710](https://arxiv.org/abs/2405.03710)
- **Synapse (ICLR 2024)** [measured]
  - "State abstraction" filters irrelevant page content, and "trajectory-as-exemplar" prompting uses whole abstracted trajectories as few-shot.
  - MiniWoB++: 99.2% average success with 48 demonstrations.
  - Mind2Web: 56% relative step-success improvement.
  - — [arXiv 2306.07863](https://arxiv.org/abs/2306.07863)
- **Agent Workflow Memory (2024)** [measured]: inducing reusable workflows from past trajectories improved relative success by 24.6% (Mind2Web) and 51.1% (WebArena). — [arXiv 2409.07429](https://arxiv.org/abs/2409.07429)
- **AgentRR (Record & Replay for LLM agents, 2025)** [projected; "no quantitative results"]
  - Records "the state of the environment at each step" and "the operations that cause state transitions".
  - Abstracts them into **low-level experiences** (scripts/API calls: fast, but "limited generalization") and **high-level experiences** (state + next-step descriptions, instantiated by an LLM).
  - **Check functions** act as a trusted computing base for "Execution Flow Integrity, State Preconditions, Data/Parameter Constraints, and Safety Invariants".
  - When low-level replay fails, it falls back to high-level.
  - — [arXiv 2505.17716](https://arxiv.org/html/2505.17716v1)
- **browser-use/workflow-use**
  - "an LLM converts these recordings into deterministic scripts with variables". Generation can also start from a natural-language task.
  - "deterministic workflows with variables which fallback to Browser Use if a step fails".
  - Its own roadmap says "improve LLM fallback when step fails (currently really bad)". Self-healing that "updates the workflow file" is still planned.
  - "very early development… don't recommend using this in production."
  - — [workflow-use README](https://cdn.jsdelivr.net/gh/browser-use/workflow-use@main/README.md); [GitHub](https://github.com/browser-use/workflow-use)
  - Conflict: a third-party summary ([sourcepulse](https://www.sourcepulse.org/projects/2513677), seen only as a search snippet) claims "10x faster, ~90% cheaper than Browser Use". The current [README](https://cdn.jsdelivr.net/gh/browser-use/workflow-use@main/README.md) and [GitHub page](https://github.com/browser-use/workflow-use) make no speed or cost claim. Do not repeat the number.
- **The repo design already plans** compile → drill (questions) → dry run ("Replay highlights each target without acting; the user confirms"). — [docs/design.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/design.md)

### Inferences
**Two-stage compile** [opinion]. This fits the Nemotron image limits: Omni 1/prompt in the example config, Nano VL 4/request.

**Stage A: caption each step** (vision model, run in parallel, one call per non-trivial step).
- Input: the pre and post crops stitched side by side into one image, a downscaled context frame, and the step's DOM/AX context (landmark, heading, list index/size, siblings).
- Output schema:
  ```jsonc
  { "step": "s4", "what_changed": "video page opened and started playing",
    "element": "Play overlay on the first video card in YouTube search results",
    "revealed_by_hover": true, "kind": "list_item|nav|form_field|control|canvas_cell",
    "varies_per_visit": true, "selection_guess": "first result for the query | this exact item",
    "sensitive_visible": false, "evidence": ["pre: no Play icon on card", "post: /watch page"] }
  ```
- **Skip Stage A** for steps whose meaning is obvious from text: navigate, fs moves, AX menu paths. This saves cost.

**Stage B: compile** (text model, one call, retried up to 3 times).
- Input: the user's own goal sentence (from the pre-record prompt), the Stage A captions, today's `forModel` fields, the skeleton and memory.
- Output: extended `Annotations`.
- Keep the existing rule "never output targets, selectors, channels or actions".
- Add a requirement that every intent and question cite step ids and evidence. That makes hallucinations easier to catch.

**Stage C: validate with code.**
- Keep zod + `templateProblems`. Add semantic lints:
  - A `url_matches` must not contain per-visit segments. Reuse `CHANGES_EACH_VISIT`.
  - Every `text_visible`/`element_visible` check must hold in the recorded post-state (post-frame DOM/AX text). This is "replay the checks against the recording".
  - A click whose target wasn't visible before must carry a hover precondition or `revealed_by`.
  - Steps the model marks `noise` (e.g. the seek-slider clicks) are dropped only after a drill question.
- Send failures back as repair messages, as `compile.ts` already does.

**Stage D: drill + dry run**, as already designed.

**Skill format: hybrid** [opinion]
- The machine contract stays JSON (`skill.ts`). Add optional fields:
  - **step:**
    - `why`
    - `target_description` (NL, for the replay LLM)
    - `select` (`exact` | `first` | `nth` | `newest` | `by_text`, within a container Locator)
    - `precondition` (`hover: Locator`, or a new `web.hover` action)
    - `expect` (NL postcondition for an LLM judge)
    - `stable` (false for feed/preview elements)
  - **skill:** `goal` (the user's words), `done_when` (NL).
- Render a read-only `SKILL.md` from the JSON for people and for the replay agent's prompt. Do not make Markdown the source of truth: the player needs typed args and zod parsing.

**Determinism is kept** because the model never writes a locator, action or channel. A clean run still reads only JSON and makes 0 model calls. The new fields are read only on failure (agent fallback) and in the dry run. [opinion]

**Prompt patterns** [opinion]
- System rules as in today's `systemPrompt`.
- Add 2–3 full trajectory → annotation exemplars (Synapse-style), chosen from memory by similarity (AWM-style). Include one with a hover-revealed control, one feed item and one map URL.
- Turn reasoning on (`enable_thinking`) for compile only.
- Use `response_format: json_schema` generated from the zod schema (e.g. `zod-to-json-schema`), and keep `extractJson` + zod as the safety net.

**Video instead of frames.** Omni accepts MP4 up to 2 min, so a screen recording plus the event timeline is an alternative to stills. But it conflicts with the design's v1 exclusion of screen-recording video. Use stills first. [opinion]

**Which model does what** [opinion]

| Job | Vision needed? |
|---|---|
| Stage A captions; canvas/drawn-app understanding; replay rescue when the AX tree has no usable node; visual "did it work?" judging | **yes** (Nano VL v2 or Nano Omni) |
| Stage B compile, drill questions, intent prompt, sheet-header mapping, picking among AX candidates at replay, `data.ai` | **no**: any text Nemotron |

### Gaps
- vLLM docs do not confirm that JSON-schema decoding works together with image inputs. Test it on the Nebius endpoint.
- No source states how many tokens a Nemotron VL image costs (per tile), so per-compile cost could not be computed.
- The Omni "1 image per prompt" figure comes from the model card's serving example (`limit_mm_per_prompt`). It may be a deployment setting, not a hard model limit. Check it on Nebius.
- The OSWorld 47.4% for Omni is vendor-reported and not independently reproduced.

---

## Q3. LLM during recording: when it is needed, what an end-of-recording model misses, and the price

### Takeaway
Almost everything the compile model "misses" is **evidence that was never captured**, not reasoning that had to happen live. So the main live addition is **better capture**: hover, frames, DOM/AX context, an optional voice note. That is code, not an LLM. Live LLM calls are justified in three places:
1. **A one-time goal prompt before recording.** This can be just a text box, with no model needed.
2. **"Ask at the moment" for choices among look-alike items.** Code detects these and the user answers. A model is optional.
3. **Optionally, canvas-drawn apps,** where a vision caption made while the state is still on screen helps.

Everything else is better done after Stop. That approach is cheaper and keeps data on the Mac during recording, as the current privacy rule requires.

### Cited Findings
- **The design already includes natural-language teaching.**
  - "Teach a task by doing it once (event recording) or by describing it in natural language, with the system asking clarifying questions."
  - The sensors table lists "Natural language | Daemon chat UI | the user's description, used instead of or alongside a trace".
  - — [docs/design.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/design.md)
- **The current privacy rule rules out live model calls while recording.** "Data leaving the Mac: only when compiling a skill or recovering a failed step." — [docs/design.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/design.md)
- **The skill-level intent is gathered only after Stop**, as a drill question ("describe this task"). The saved skills' intents ("play music", "route to cafe") are those answers. — [12-how-it-works-simply.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/guide/12-how-it-works-simply.md); local skills folder
- **workflow-use can build a workflow from a natural-language task** ("Describe your task, we run browser-use once, then create a reusable semantic workflow"). Its recording path converts the recording after the fact. — [GitHub](https://github.com/browser-use/workflow-use)
- **What agents get wrong** [measured]: Online-Mind2Web failures are dominated by constraint handling. Filter and sorting errors are 57.7% of Operator's failures, navigation errors 19.6%, plus "Numeric/Temporal Constraint Sensitivity". — [arXiv 2504.01382](https://arxiv.org/html/2504.01382)
- **A description alone is not enough** [measured]: ECLAIR's end-to-end completion from a natural-language workflow description alone was 40%. — [arXiv 2405.03710](https://arxiv.org/abs/2405.03710)
- **Recording-and-induction work captures environment state per step.** AgentRR records "the state of the environment at each step"; AWM induces workflows online at test time as well as offline. — [arXiv 2505.17716](https://arxiv.org/html/2505.17716v1); [arXiv 2409.07429](https://arxiv.org/abs/2409.07429)
- **Nemotron 3 Nano Omni accepts audio** (WAV/MP3 up to 1 hour). A spoken note made during recording could be transcribed after Stop by the same model family. [vendor] — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16)
- **Normalise is deliberately mechanical.** "Mechanical rules only, so the compiler's input is stable and testable." It removes focus clicks, merges keystrokes and drops unreplayable pages. — [normalise.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/normalise.ts)

### Inferences
**What the after-Stop model misses today**, and whether it must be captured live [opinion, derived from `forModel`]:

| Missing context | Example from this week | Captured live by | LLM live? |
|---|---|---|---|
| The user's goal and success criterion | "play music": any song, or this song? | Goal prompt before Record (text box) | No |
| Pre-action visual state / hover | YouTube Play shown only on hover | `pointerover` dwell ring buffer + pre-frame | No |
| Alternatives on screen (list position, siblings) | Feed card #1 of 20; "Rameshwaram Cafe" suggestion | DOM/AX context at event time | No |
| What the user read but didn't click or copy | Checked a price, then clicked "Buy" | Post-frame / masked DOM snapshot; voice note | No |
| Why a choice was made | "the cheapest", "today's row" | Ask-at-moment prompt, triggered by code when a click lands on one of ≥3 same-role siblings | Optional |
| Corrections and false starts | The seek-slider clicks | Keep them in the trace with a `noise?` flag rather than dropping silently | No |
| Canvas-drawn targets (Sheets cells, Maps tiles) | A click on the map | Frame + click point (the design forbids coordinates as a locator, not as evidence) | Optional: vision caption |
| Secrets | Passwords | Never captured, by design | Never |

**When a live LLM is worth it** [opinion]
- (a) **Goal clarification before Record.** One text call turns "play music" into 1–2 targeted questions ("Always this song, or the first result for what you type?"). This is cheap and needs no screen data.
- (b) **Ask at the moment** when code flags an ambiguous choice. The answer is freshest then. A model is only needed to phrase the question well; a template works.
- (c) **Drawn or canvas apps**, where after-Stop reconstruction from frames may be ambiguous. One vision call per such click.
- (d) **Live narration.** Record audio locally and transcribe after Stop. Live transcription buys nothing for compile.

**Not worth it live** [opinion]
- Variable detection while typing: compile already has the values and `candidateFor`.
- Gesture recognition (hover/drag): code with DOM events does this deterministically.
- Sensitive-data detection: deterministic rules (input types, autocomplete, AX secure fields) must run anyway, before anything is stored. An LLM can only add a second pass at compile.

**The price of live calls** [opinion]
- Per-event network latency during recording. A model call in the loop can make the UI lag or reorder events, so make it async and non-blocking.
- Data leaves the Mac while the user works, possibly on sites they didn't intend to share. This contradicts the current rule.
- The cost scales with events, not recordings.
- If adopted, gate it per site and per recording, send only redacted crops, and change the design.md privacy line.

### Gaps
- I found no study that measures compile quality with and without a stated goal, or live versus post-hoc annotation, for demonstration-to-workflow systems.
- ECLAIR's numbers for "demonstration + description" versus "description only" were not in the abstract, and I did not read the full paper.

---

## Q4. Replay robustness: self-healing, LLM-judged checks, renamed/removed elements, changed sheets, learn-back, when to ask

### Takeaway
Build the ladder cheapest-first:
1. Finish the deterministic matcher (`near`/`label`/`text`, hover preconditions, overlays).
2. A **text** model chooses among the top-k AX candidates using the step's intent and `target_description`.
3. A **vision** model on a set-of-marks screenshot, only when the AX tree has no usable node.
4. Ask the user.

Verify every heal with the step's machine check, and only then optionally with an LLM judge. Write back a new version with the healed locator first and the old one as a fallback. Stop and ask on risky steps, ambiguity or role change.

### Cited Findings
- **The planned per-step loop** is: resolve → wait → deterministic match ("one clear winner above a confidence threshold") → approve → act → verify → retry → **agent fallback** (step intent, stored snapshot, memory, compact DOM/AX outline "plus screenshot if needed") → escalate.
  - Learn-back: "replay proposes a new skill version with the updated locator (the old one stays as a fallback). The user approves it the first time; later, small locator fixes can be applied automatically."
  - Injection guard: "the agent fallback may only return targets and actions for the current step's `intent`; it cannot add steps, change URLs outside the skill's domains".
  - — [docs/design.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/design.md)
- **Healenium** stores "a successful locator… as a baseline". On `NoSuchElement` it "triggers the LSC algorithm, passes the current page state, gets previous successful locator path, compares them, and generates the list of healed locators", then "takes the locator with the highest score". Its report includes a screenshot and a feedback button. — [Healenium docs](https://healenium.io/docs/how_healenium_works)
- **Playwright healer agent**: it "Replays the failing steps", "Inspects the current UI to locate equivalent elements or flows", "Suggests a patch (e.g., locator update, wait adjustment, data fix)" and "Re-runs the test until it passes or until guardrails stop the loop". It can skip a test when the functionality itself is broken. — [Playwright test agents](https://playwright.dev/docs/test-agents)
- **Stagehand caching**: the cache key is built "from the instruction, page content, and the options you pass" (URL included, tracking params filtered). "On a cache hit… no LLM inference and no token cost." It "replays a cached `act()` result deterministically with self-healing turned off. If the recorded selector no longer resolves, Stagehand falls back to full inference." — [Stagehand docs](https://docs.stagehand.dev/v4/best-practices/caching)
- **workflow-use** falls back per step to the Browser Use agent. Its own roadmap calls that fallback "currently really bad". — [README](https://cdn.jsdelivr.net/gh/browser-use/workflow-use@main/README.md)
- **AgentRR**: check functions guard replay. On low-level failure it falls back to the high-level experience, which "necessitates more powerful model capabilities". [projected] — [arXiv 2505.17716](https://arxiv.org/html/2505.17716v1)
- **LLM-as-judge**: Online-Mind2Web's WebJudge reaches "around 85% agreement with human judgment". [measured] — [arXiv 2504.01382](https://arxiv.org/abs/2504.01382)
- **Text versus vision for grounding** [measured]
  - OSWorld (2024): the best overall result, 12.24%, is **text-only GPT-4 on the accessibility tree**. GPT-4V gets 12.17% with screenshot + a11y tree and 5.26% with screenshot only. The best Set-of-Mark result is 11.77% (from my first extraction; model attribution not re-checked). The authors attribute SoM's weakness to noise at high OS resolutions. — [arXiv 2404.07972](https://arxiv.org/html/2404.07972)
  - SeeAct: GPT-4V succeeds on 51.1% of live tasks with oracle grounding, and "grounding still remains a major challenge". — [arXiv 2401.01614](https://arxiv.org/abs/2401.01614)
  - WILBUR: text-only, "within 5% of a strong multi-modal model", with "intelligent backtracking". — [arXiv 2404.05902](https://arxiv.org/abs/2404.05902)
- **Matcher limits.** It accepts at ≥0.5 with a 0.15 margin. `near`/`text`/`label`/frames/shadow are not used yet. It returns `none` or `ambiguous` with top candidates, which is a natural input for a model rescue. — [match.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/player/src/web/match.ts)
- **Sheets.** `data.pick` finds a column by **header name**, case- and space-insensitively. A moved column still works. A renamed or removed header fails with `no column X`. A rule with no matching row fails with `no row where Date = …`. `data.ai` is capped per run and cached per day. — [data-channel.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/player/src/node/data-channel.ts)
- **Vision steps are replay-only.** The `vision` channel is "never written by the compiler, only chosen by replay". — [skill.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/core/src/skill.ts)

### Inferences
**Replay ladder** [opinion]

| Tier | What | Model | Typical trigger |
|---|---|---|---|
| 0 | Matcher v1: add `near`/`label`/`text` scoring, frames/shadow; prefer `stable:false` → follow `select` rule (first/nth within container) | none | always |
| 1 | Code heals: dismiss known overlays (site notes in memory), scroll into view, **hover the `revealed_by`/precondition ancestor then rematch**, wait longer | none | `none` |
| 2 | Pick among the top-k (≤15) AX candidates. Input: step `intent`, `target_description`, recorded crop *caption* (text), candidates `{id, role, name, near, text, bbox}`. Output: `{choice: id \| "none", confidence, reason}` | **text** | `ambiguous`, or `none` with candidates |
| 3 | Set-of-marks screenshot. Numbered boxes are drawn from DOM/AX rects (not segmentation, per SeeAct), CDP `captureScreenshot` with `clip`. Output a mark id | **vision** | no usable AX node (canvas, Sheets grid, Maps) |
| 4 | Ask the user, showing the frame and the candidates | — | risky step, low confidence, judge disagrees |

**Verification order** [opinion]
- First the step's machine `check` (url_matches/text_visible/element_visible/file_exists).
- Then, for healed steps only, an LLM judge on `expect` with the post-screenshot or post-AX text.
- At about 85% judge-human agreement, the judge should never be the only gate before a `requires_approval` step.

**Renamed element** (e.g. "Submit" → "Send"): Tier 2 handles it, since the role, `near` and `intent` still match. **Moved element**: Tier 0 already handles it, since nothing is positional. **Removed element**: Tier 2 answers "none". If the `intent` might be served by a different flow (Playwright-healer style), allow Tier 2 to propose **at most one** replacement action within the skill's domains, then verify. Otherwise ask. [opinion]

**Changed Google Sheet** [opinion]

| Change | Handling |
|---|---|
| Column moved | Already fine |
| Header renamed | Code fuzzy-match first (normalise, contains, edit distance). Then one cheap **text** call: map the old header to the new header list, with a sample of rows. Cache by a hash of the headers. Write back to the skill after approval |
| Column removed or split | Ask |
| "No row for today" | Not a heal. That is real data absence: ask or skip |

**Learn-back** [opinion]
- Write v(n+1) with the healed locator first and the old locator appended to `fallbacks`.
- Record heal provenance in the run log: tier, model, confidence, before/after crops.
- Auto-apply only for non-risky steps after the heal has verified on 2 consecutive runs. Always ask for `requires_approval` steps or a role change.
- This follows design.md and Healenium's "last successful locator" baseline.

**Stop and ask when** [opinion]
- The two best candidates are within the margin on a risky step.
- The model's choice has a different role from the recorded one.
- The check fails after a heal.
- An action would leave the skill's domains.
- The data rule finds no row.
- The heal budget is spent: at most 2 model calls per step and N per run, like `data.ai`'s per-run cap.

### Gaps
- Healenium's docs do not describe the tree-comparison scoring or the threshold, or whether healed locators are stored automatically.
- I did not research Testim/mabl "smart locators" (mostly marketing material) or Skyvern's caching. They are left out.
- There is no public measurement of heal success rates for any of these tools.
- A third-party mirror of Stagehand's docs ([mintlify](https://www.mintlify.com/browserbase/stagehand/concepts/caching), seen only as a search summary) says cached actions take about 150–300 ms versus 1–3 s uncached. The official caching page I fetched gives no numbers, so this stays unverified.

---

## Q5. Academic and industry evidence: demonstration-to-workflow, vision vs accessibility-tree grounding, deterministic vs agentic reliability, cost

### Takeaway
- **Agentic replay is still unreliable.** The best frontier agents complete about 56–61% of live web tasks, older ones about 30%, and OSWorld began at 12% against 72% for humans.
- **Text grounding is at least as good as screenshots.** Structured text (AX/HTML) matches or beats screenshot-only input. Vision helps most when combined with structure.
- **Demonstrations and induced workflows give large relative gains.**
- No source compares deterministic replay with agentic replay head-to-head on the same tasks. The case for "deterministic first, model on failure" rests on these indirect results plus cost: a clean replay makes 0 calls.

### Cited Findings

| Source | What it shows | Type |
|---|---|---|
| [Online-Mind2Web, arXiv 2504.01382](https://arxiv.org/html/2504.01382) | 300 tasks / 136 live sites. Human-evaluated success: Operator 61.3%, Claude Computer Use 3.7 56.3%, SeeAct 30.7%, Browser Use 30.0%, Claude CU 3.5 29.0%, Agent-E 28.0%. "Many recent agents… do not outperform the simple SeeAct agent" | measured |
| [OSWorld, arXiv 2404.07972](https://arxiv.org/abs/2404.07972) | Humans 72.36% vs best model 12.24% (2024). Failures due to "GUI grounding and operational knowledge". Best = text-only GPT-4 on a11y tree (12.24%). GPT-4V: screenshot + a11y 12.17%, screenshot only 5.26% | measured |
| [SeeAct, arXiv 2401.01614](https://arxiv.org/abs/2401.01614) | 51.1% on live sites with oracle grounding. SoM "not effective for web agents". Best is HTML + visuals | measured |
| [ECLAIR, arXiv 2405.03710](https://arxiv.org/abs/2405.03710) | Workflow understanding 93%. NL-only end-to-end 40%. RPA initial accuracy 60%, set-up 12–18 months (case studies) | measured |
| [Agent Workflow Memory, arXiv 2409.07429](https://arxiv.org/abs/2409.07429) | +24.6% / +51.1% relative success from induced workflows. +8.9 to +14.0 points cross-domain | measured |
| [Synapse, arXiv 2306.07863](https://arxiv.org/abs/2306.07863) | Trajectory-as-exemplar + state abstraction: 99.2% MiniWoB++ with 48 demos | measured |
| [WILBUR, arXiv 2404.05902](https://arxiv.org/abs/2404.05902) | Retrieved demonstrations + backtracking. SOTA on WebVoyager, +8% over text-only. Text-only within 5% of multimodal | measured |
| [AutoManual, arXiv 2405.16247](https://arxiv.org/abs/2405.16247) | Builds a rule "manual" from interaction. 97.4% ALFWorld (GPT-4-turbo) from "only one simple demonstration" | measured (not web) |
| [AgentTrek, arXiv 2412.09605](https://arxiv.org/abs/2412.09605) | Tutorials → replayed trajectories verified by a VLM, "$0.55 per high-quality trajectory" | measured |
| [AgentRR, arXiv 2505.17716](https://arxiv.org/html/2505.17716v1) | Record → multi-level experience → replay with check functions. No numbers | projected |
| [Nemotron 3 Nano Omni card](https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16) | OSWorld 47.4% | vendor |
| [Stagehand caching](https://docs.stagehand.dev/v4/best-practices/caching) | Cache hit = no LLM call. Fall back to inference when the selector fails | vendor (design) |

- I did not pursue **WorkflowLLM** (arXiv 2411.05451) or WorkArena. They concern fine-tuning for API-workflow orchestration and enterprise-agent benchmarks, which are less directly relevant to replaying demonstrations.

### Inferences
- [opinion] **Agentic replay per run is a poor fit for a "teach once, replay later" agent.** At about 30–61% task success (Online-Mind2Web) it would fail a weekly task most months. A deterministic replay that fails loudly, with a targeted model rescue, keeps the model's error rate confined to the steps that drifted.
- [opinion] **Use text grounding first at replay.** OSWorld and WILBUR show text (AX/HTML) is at least as good as screenshots, and it is cheaper. Use vision as Tier 3.
- [opinion] **Demonstrations plus induced structure are what make LLM agents better** (AWM, Synapse, WILBUR). That supports using the LLM to *annotate and generalise* the recording, not to replace it.

### Gaps
- No published head-to-head between deterministic record/replay and agentic replay on the same tasks over time (drift).
- No source gives cost per run in dollars for Nemotron on Nebius. Out of scope here; another researcher covers Nebius.

---

## Q6. Code + AI (hybrid) vs AI-only for building the skill, with this week's failures as test cases

### Takeaway
**Use the hybrid, which is the current architecture, and feed it better evidence.**
- Code captures and decides **facts**: what happened, which element, what value, which channel and action, locators, deterministic URL and secret rules.
- The model decides **meaning**: goal, per-step why, which values vary, selection rules, natural-language expectations, noise, questions.
- Code **validates** the model against the recording.

AI-only would let the model invent selectors and actions, and would make every replay depend on the model. The evidence above shows that is the least reliable part.

**Why this week's skills fail.** The pipeline is already hybrid by design: code builds the skeleton, and the model may only add meaning, which code then validates. But the saved skills that failed this week match the code-only path. There is no `.env` key, and the intents are template strings. On top of that, the model's input has no screenshots, no stated goal and no hover. Most of the "not logically built" feeling comes from those two facts, not from the hybrid design.

### Cited Findings
#### Current code and this week's saved skills (grounding)
- **The saved skills match the code-only path.**
  - `task-on-www-youtube-com/v4.json` has intent "play music", which is the user's answer to the describe question. Its steps are "Type into the combobox", "Press Enter in the combobox", and "Open 'Akcent - Stay with Me (Lyrics) 4 minutes, 9 seconds'" with a fixed `watch?v=…&list=RD…` URL.
  - `task-on-www-google-com/v2.json` keeps incidental clicks: "Click 'Seek slider'" twice, then "Click 'Pause keyboard shortcut k'".
  - `maps/v2.json` step s3 is "Click 'Rameshwaram Cafe'". Its locator is `{text, near: "Suggestions", fallbacks: ["#cell0x0 > span…", "//span[…]"]}` and has no role.
  - The repo has no `.env` with `NEBIUS_API_KEY` set as of today.
  - — `~/Library/Application Support/TaskPlayer/skills/{task-on-www-youtube-com,task-on-www-google-com,maps}/` (local, read-only)
- **Code fixes already exist for some failures.** These are uncommitted edits already in the working tree when this research began. They were not written as part of this research.
  - `pagePath` + `CHANGES_EACH_VISIT` cut url_matches before `@lat,lng,zoom`, `data=`, coordinates and long generated ids. This fixes failure (2).
  - `linkDestination` turns a link click into a `navigate` to where it led ("Feeds, search results and hover previews (YouTube's home page) show different links on every visit"). This partly addresses failures (1) and (3).
  - — `git diff packages/recorder/src/skeleton.ts` in [the repo](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/skeleton.ts)
- **Failure (4) is already handled in normalise.**
  - `opensOnReplay = /^(https?|file):/` drops pages replay can't open: "a new tab page, another extension's page, chrome://settings".
  - The first real page then becomes the start `navigate`.
  - — [normalise.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/normalise.ts)
- **Hover and screenshots are not captured at all.**
  - The extension source has no `mouseover`/`pointerover`/`captureVisibleTab`/`captureScreenshot` listeners. The only "hover" hits are CSS in `button.ts`.
  - `ElementDescriptor.crop` ("Small cropped screenshot of the element, as a data URL… used by the agent fallback") exists, but nothing fills it.
  - The trace event kinds include no hover or scroll.
  - — [descriptor.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/core/src/descriptor.ts); [trace.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/core/src/trace.ts); grep of `apps/extension/src`
- **The skill schema has no hover action.**
  - `ACTIONS.web = navigate, click, type, select, press, upload, drag, wait_for, extract`.
  - `Locator` has no ordinal or "first item in list" selector.
  - Changes need sign-off from both sides.
  - — [skill.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/core/src/skill.ts)
- **The matcher.**
  - Matcher v0 scores Chrome AX role+name (0.45), attrs (0.25) and fallback selectors (0.30). It accepts at ≥0.5 with a 0.15 margin.
  - "Not yet used: `near`, `text`, `label`, frames and shadow roots (TODO)". The maps s3 locator relies only on `text`/`near` + fallbacks, so today it can match only through its CSS/XPath fallbacks.
  - — [match.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/player/src/web/match.ts)
- **The agent fallback is not built.** `// TODO(player): agent fallback (on_fail.fallback === "agent") goes here; until then every failure escalates.` — [run.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/player/src/run.ts)

#### External sources and design
- The current division of labour: "Code builds the skeleton (actions, targets, recorded values); Nemotron adds what code can't know: what each step is for, which values change each run, how to tell it worked, what to ask you." — [compile.ts](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/packages/recorder/src/compile.ts)
- The design goal: "deterministic matching first, an LLM agent only when a step fails". A clean replay makes 0 AI calls. — [docs/design.md](/Users/rushil.jariwala/Desktop/nxn-global-ai-hackathon-personal-agent/docs/design.md); architecture-map.excalidraw text ("A clean replay makes zero AI calls")
- workflow-use (LLM → deterministic workflow, agent fallback per step) and Stagehand (cache = deterministic, inference on miss) take the same hybrid shape in industry. — [workflow-use](https://github.com/browser-use/workflow-use); [Stagehand](https://docs.stagehand.dev/v4/best-practices/caching)
- Grounding is the main failure source for model-driven agents. — [SeeAct](https://arxiv.org/abs/2401.01614); [OSWorld](https://arxiv.org/abs/2404.07972)

### Inferences
- [opinion] **This week's failing skills look code-only.** Template intents, no `.env` key, and the noise steps kept all point that way. So "the code is not logically built" partly measures code without its model. The team should confirm by re-running `compile <session>` on the same traces with the model on, before redesigning.
- [opinion] **The model is blind even when it is on.** It sees about 10 text fields per step and never sees the screen or the goal. It cannot tell "the first search result" from "this exact video", a hover-revealed control from a visible one, or an incidental seek-slider click from a meaningful one. The fix is better evidence, not handing control to the model.
**Division of labour** [opinion]

| Layer | Code | Text LLM | Vision LLM |
|---|---|---|---|
| Before record | Goal text box; site/privacy toggles | Optional: turn the goal into 1–2 clarifying questions | — |
| Capture | Events, hover dwell, DOM/AX context, frames + crops, redaction, FSEvents/AX | — | — |
| Normalise | Merge, de-noise, unreplayable pages, per-visit URL segments, link → navigate | — | — |
| Compile | Skeleton, locators, lints, re-checking against the recording, repair loop | Intents, why, variables, select rules, NL expectations, noise flags, questions | Per-step captions (pre/post), canvas targets |
| Replay | Matcher, overlays, hover precondition, checks, approvals, learn-back writing | Choose among AX candidates; header remapping; `data.ai` | Set-of-marks rescue; visual judge (secondary) |

**This week's failures, by layer** [opinion, grounded in the code above]

| # | Failure | Root cause | Fix layer | Role of the LLM |
|---|---|---|---|---|
| 1 | Hover-revealed YouTube "Play" recorded as a click without the hover | **Capture gap**: no hover events, no hover action in the schema | Code: `pointerover` dwell + "visible before?" check → `revealed_by` → `web.hover` precondition. Replay Tier 1 hovers the ancestor | Vision caption confirms "appears on hover" and writes `target_description`. It cannot recover a hover that was never recorded |
| 2 | Maps URL check copied `@lat,lng,zoom` | Normalise/compile rule | Code: `pagePath`/`CHANGES_EACH_VISIT` (uncommitted) | Optional lint backup for unknown sites. A better check is often `text_visible` with the place name, which the LLM can propose and code verifies against the post-frame |
| 3 | Click on a feed/preview element that changes per visit | **Intent ambiguity** plus a missing selection rule | Code: `linkDestination` → navigate (uncommitted) is right only if the intent is "this exact item" | **Needed.** Goal prompt / compile question: "this video, or the first result for your search?" Then `select: first` within the results container (needs a schema addition) |
| 4 | Recording started on another extension's new-tab page | Unreplayable start page | Code: `opensOnReplay` drops it; the first http(s) page becomes `navigate` | None |
| 5 | Skills have no real intent ("Click 'Play'") | Code-only compile (no `.env` key) plus a blind model input | Turn the model on, add the goal prompt + Stage A captions | **Needed**: this is the model's core job |

**AI-only would be worse** [opinion]
- Non-deterministic output per compile.
- Selectors and actions that can't be traced to the recording.
- Larger prompts: full DOM or frames for every step.
- Every replay's success capped by agent grounding (about 30–61% on live sites per Online-Mind2Web).
- No guarantee that the skill parses for the player.

The hybrid keeps a replayable skill even when the model is down, and the existing "skeleton saved if the model fails" behaviour gives that.

**Order of work** [opinion]
1. Turn the model on and recompile this week's traces.
2. Add the goal prompt.
3. Capture hover + frames/crops + DOM context.
4. Stage A captions + semantic lints.
5. Finish matcher `near`/`text`/`label` + hover precondition.
6. Tier 2 text rescue + learn-back.
7. Tier 3 vision rescue.

### Gaps
- I could not tell whether `.env` existed when these skills were recorded. Its absence today is suggestive, not proof.
- Schema additions (`web.hover`/precondition, `select`, `why`, `target_description`, `expect`, `goal`) need sign-off from both the record and replay owners, per the `skill.ts` header. Not yet discussed.
- No measured comparison of compile quality with and without screenshots exists for Nemotron models. Run an internal eval: recompile the five failing recordings both ways and replay them on a later day.
