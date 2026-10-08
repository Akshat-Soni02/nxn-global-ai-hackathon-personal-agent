# OpenAI Record & Replay and comparable teach-by-demonstration products: where the LLM sits at record, compile and replay time

Research date: 2026-10-07. Labels used throughout:
- **[OFFICIAL]**: vendor docs or posts, quoted.
- **[OFFICIAL-RELAYED]**: OpenAI-authored text that a third party reproduced, because the plugin is not installed on this machine and cannot be read directly.
- **[THIRD-PARTY]**: hands-on write-ups, GitHub issue reporters, reimplementations.
- **[SNIPPET]**: the claim appears only in a search-engine summary of that URL; the full page was not fetched.
- **[INFERENCE]**: my reasoning, not a source.

---

## 1. OpenAI Record & Replay: the exact end-to-end flow

### Takeaway
Record & Replay is a bundled Codex/ChatGPT plugin with two parts:
- an `event-stream` MCP server, run by the Computer Use helper, that writes `session.json` and `events.jsonl` (macOS Accessibility events plus AX trees and diffs);
- a `record-and-replay` skill that tells the model to read those files after the user says "done" and write an ordinary natural-language `SKILL.md` through `skill-creator`.

Replay has no script. A fresh agent turn loads the SKILL.md as context and does the work with Computer Use, browser actions or plugins. No source shows screenshots, video or audio in the recording artefact.

### Cited Findings

**Product framing and availability**
- [OFFICIAL] "Record & Replay lets you demonstrate a workflow on your Mac and turn it into a reusable skill. Use it when the workflow is repetitive, depends on your preferences, or is easier to show than to describe in a prompt." Examples: "file an expense, book a parking space, create a correctly configured issue, publish a video, or download a recurring report." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL] "Record & Replay is available on macOS. Computer Use must also be available and enabled." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL, possibly superseded] The June 2026 version of the page added: "Initial availability excludes the European Economic Area, the United Kingdom, and Switzerland." That sentence is absent from the current page. — [Wayback snapshot, 2026-06-19](http://web.archive.org/web/20260619093948/https://developers.openai.com/codex/record-and-replay); [Community announcement](https://community.openai.com/t/introducing-record-replay/1384088)
- [OFFICIAL] The old URL `developers.openai.com/codex/record-and-replay` now 308-redirects to `learn.chatgpt.com/docs/extend/record-and-replay`. The current page covers "ChatGPT or Codex"; the June page said "Codex" only. — [current doc](https://learn.chatgpt.com/docs/extend/record-and-replay); [June snapshot](http://web.archive.org/web/20260619093948/https://developers.openai.com/codex/record-and-replay)
- [THIRD-PARTY] Release: Codex app 26.616, June 18, 2026. The-decoder dates its coverage June 20, 2026. — [distsystem/codex-desktop-linux doc citing the changelog](https://github.com/distsystem/codex-desktop-linux/blob/main/docs/record-and-replay-linux.md); [The Decoder](https://the-decoder.com/openais-codex-can-now-watch-you-work-once-and-repeat-the-task-forever/)
- [OFFICIAL] Announcement copy: "Show Codex a workflow once. Reuse it as a skill." and "Codex turns that demo into an inspectable, editable skill." "You control when recording starts and stops." — [OpenAI Developer Community](https://community.openai.com/t/introducing-record-replay/1384088)
- [OFFICIAL] Admin kill switch: "If your organization manages Codex with `requirements.toml`, the `[features].computer_use` requirement controls Record & Replay too. Setting `computer_use = false` makes both features unavailable." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)

**How a recording starts**

[OFFICIAL] The current steps are quoted below. The June version began "Open Plugins in the Codex app", and its step 4 read "give Codex any helpful context". — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay); [June snapshot](http://web.archive.org/web/20260619093948/https://developers.openai.com/codex/record-and-replay)
1. "In the ChatGPT desktop app, select ChatGPT and turn on Work in the switcher, or select Codex. Then open **Plugins**."
2. "Open the **+** menu."
3. "Select **Record a skill**."
4. "Review the suggested prompt, add any helpful context, and submit it."
5. "When the chat asks for permission to record your actions, approve the request once you are ready to demonstrate the workflow."
6. "Perform the workflow on your Mac."
7. "When you are done, stop recording from the menu bar or overlay, or tell the chat that you are done."

Related findings on starting a recording:
- [OFFICIAL] Intent guidance (the closest thing to an "intent prompt"): "State your goal and any specific inputs that might vary between skill uses before you start recording." Other tips: "Keep the demonstration short and complete", "Use realistic inputs, but avoid secrets and sensitive data", "Refine the skill after recording to call out hidden preferences that matter, such as naming conventions, field defaults, or decision points", and "Stop recording when the workflow is complete instead of continuing into unrelated cleanup." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [THIRD-PARTY] OpenAI demo, as relayed by Memeburn citing an OpenAI Developers post of June 18, 2026:
  - Start prompt: "Watch me upload this YouTube video so you can handle these uploads for me in the future."
  - Captured actions: "dragging a video into YouTube Studio, copying title and description from Google Sheets, uploading a thumbnail and subtitles file, and setting privacy to private."
  - Replay: in a new chat with the new video attached, "Upload this YouTube video using @youtube-upload".
  - Source: [Memeburn](https://memeburn.com/openai-codex-can-now-learn-your-workflow-by-watching-you/)
- [OFFICIAL] On the `@youtube-upload` vs `$youtube-upload` question: "In ChatGPT, type `@` to select a skill. In Codex CLI or the IDE extension, run `/skills` or type `$` to mention a skill." Both forms are valid, depending on the surface. — [ChatGPT Learn: Build skills](https://learn.chatgpt.com/docs/build-skills)
- [THIRD-PARTY] Hands-on (June 21, 2026):
  - The user opens a new session, clicks "+", selects the Record & Replay plugin, and types "Record me entering work hours in the attendance app so I can repeat the same actions in the future."
  - "Record & Replay then asks for approval to record the user's actions, so I click 'Allow.'"
  - After the demo, the user types "I'm done".
  - Source: [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)

**Plugin anatomy (what the recorder is)**
- [THIRD-PARTY] "The plugin consists of the following two components. The event-stream MCP server [and] The record-and-replay skill." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] The tools are `event_stream_start`, `event_stream_status` and `event_stream_stop`. The server is launched as `SkyComputerUseClient event-stream mcp`. The plugin manifest reads `"name": "record-and-replay"` and `"description": "Record what I'm doing on my Mac"`. Version numbers in the reports run from plugin 1.0.829 in June to 1.0.1000968 on 2026-09-13. — [openai/codex issue #29051 and comments](https://github.com/openai/codex/issues/29051)
- [THIRD-PARTY] Strings in the helper binary include `eventsPath`, `metadataPath`, `suppressedEventsPath`, `AXUIElement` and `screenRecordingGranted`. This is binary-string evidence, not documented behaviour. — [dev.to: Codex Record & Replay principles](https://dev.to/ahab_indieseek/codex-record-replay-principles-3j6d)
- [THIRD-PARTY] "Recording is built on top of the Computer Use machinery, so just like Computer Use, recording requires accessibility and screen recording permissions." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] Reported failure modes:
  - "Computer Use server error -10005: Record & Replay is not enabled for this user", reported as a server-side entitlement mismatch.
  - On 2026-09-13, `-32603` during MCP initialisation after updating to app 26.908.40834.
  - Sources: [issue #29051](https://github.com/openai/codex/issues/29051); [issue #45326 (title only, not fetched)](https://github.com/openai/codex/issues/45326)

**What the user sees during recording; time limit**
- [OFFICIAL] Stop "from the menu bar or overlay, or tell the chat that you are done." "Recording continues until you stop it." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL-RELAYED] Per the bundled skill, the agent must "End your turn and ask the user to tell you when they are done recording and tell them what the time limit is on recording." — [azukiazusa.dev transcription of bundled SKILL.md](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] The 30-minute limit: "event_stream_start: … Recording can last up to 30 minutes." This is the author's paraphrase of the tool description. The current official doc does not state a cap. A Linux reimplementation's test matrix also lists a "30-minute session" cap and a "HUD visible … with state and timer" check. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/); [distsystem/codex-desktop-linux](https://github.com/distsystem/codex-desktop-linux/blob/main/docs/record-and-replay-linux.md)
- [OFFICIAL-RELAYED] Cancel path: if the user cancels, the agent may read `session.json` "to confirm that its `endReason` is `recording_controls_cancelled`". This implies the overlay or HUD has a cancel/discard control. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL-RELAYED] "Record & Replay supports one active recording at a time." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)

**What is captured**
- [OFFICIAL] "During recording, ChatGPT or Codex observes the actions and window content needed to learn the workflow." The June 19 and June 27, 2026 snapshots use the same wording ("actions and window content"). — [current doc](https://learn.chatgpt.com/docs/extend/record-and-replay); [June 27 snapshot](http://web.archive.org/web/20260627193152/https://developers.openai.com/codex/record-and-replay)
- [THIRD-PARTY] Captured items, per the author's description: "Information about the apps and windows used; Mouse and keyboard actions and their target elements; Focused UI elements; Selected text; The accessibility tree and its changes." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] Output files:
  - "`session.json`: recording duration, end reason, and so on."
  - "`events.jsonl`: the actual action events."
  - "The recorded actions themselves are not returned directly as the MCP response; instead, they are saved as the following files … Codex reads those files."
  - Source: [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] The only real `events.jsonl` excerpt published, from a Chrome web app. Event kinds seen: `mouse.click`, `selection.changed`, `keyboard.text_input`. Each event carries `app.name`, `window.title`, `window.url` and an AX target (`role`, `subrole`, `title`, `description`, `value`). Example line: `{"timestamp":"2026-06-21T02:04:14Z","kind":"mouse.click","app":{"name":"Google Chrome"},"window":{"title":"TimePort | 勤怠管理","url":"http://localhost:5173/"},"mouse":{"button":"left","target":{"description":"6/15(月)の工数を入力","role":"AXCheckBox","subrole":"AXToggleButton"}}}`. A `keyboard.text_input` event carries the field's resulting value (`"value":"画面実装"`) on the AX target, not individual keystrokes. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL-RELAYED] "Each event has app/window attribution when available … AX payloads may be full trees or diffs for the relevant window. AX diff payloads use compact render syntax with ~, +, and - representing changed, added, and removed elements, respectively." — [azukiazusa.dev transcription of bundled SKILL.md](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY, illustrative only] The dev.to event JSON (with `bounds`, `bundleIdentifier`) is the author's own model ("An event can be modeled like this"), not captured data. — [dev.to](https://dev.to/ahab_indieseek/codex-record-replay-principles-3j6d)
- [OFFICIAL] The privacy docs mention screenshots generally, not for Record & Replay specifically: "relevant file excerpts, prompts, screenshots, browser content, or tool results may be sent to OpenAI services to complete a task. Local execution does not mean offline or device-only model inference." — [ChatGPT Work local security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security)
- [THIRD-PARTY, conflicts with official] A Linux reimplementation says upstream Codex "observes the actions, window content, and spoken user context". Its own bundles include screenshots, transcripts and browser/CDP traces. The official June and current docs say only "actions and window content", so the "spoken" claim is unsupported by OpenAI's text. — [distsystem/codex-desktop-linux](https://github.com/distsystem/codex-desktop-linux/blob/main/docs/record-and-replay-linux.md); [ilysenko/codex-desktop-linux](https://github.com/ilysenko/codex-desktop-linux/blob/main/linux-features/record-and-replay/README.md)

**How the skill is written (compile step)**
- [OFFICIAL] "After you stop recording, ChatGPT or Codex inspects the captured workflow and drafts a skill. The skill explains when to use the workflow, what inputs it needs, what steps to follow, and how to verify the result. You can also ask for further refinements." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL-RELAYED] The bundled `record-and-replay` SKILL.md, as of June 21, 2026; the current plugin version may differ. Key lines:
  - "When the user says they are done recording, read the returned `metadataPath` and `eventsPath` from disk with normal filesystem tools and inspect the captured events before responding."
  - "Treat `events.jsonl` as the primary evidence. `session.json` gives paths and session timing only."
  - "Pay special attention to selection events, selected text, focused elements, and mouse & keyboard targets."
  - "If the recording contains enough information to identify a reusable workflow, create or refine a skill for that workflow. Do this by default even if the user did not explicitly ask for a skill."
  - "If the recording does not contain enough information … do not guess. Explain what is unclear and ask the user for the missing information."
  - "Before creating or refining a skill, read and follow the `skill-creator` skill … Complete the skill-creator workflow, including validation, before reporting that the skill was created."
  - "treat the recording as evidence of the user's intended outcome, not a requirement to reproduce every UI action. Check whether an available connector or dedicated tool supports the task; prefer it for stable semantic operations … Use Computer Use for unsupported UI interactions, visually dependent verification, or when manipulating the interface is itself the task. A skill may combine connectors and Computer Use. When using Computer Use, name it explicitly, describe stable app/window/control targets and interactions, include verification steps, and avoid coordinate-only replay unless the event stream gives no better target."
  - Redaction: "Do not include sensitive information from recorded events in summaries or generated skills … use placeholders or generic descriptions."
  - Source: [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] dev.to independently corroborates the same instructions from the bundled plugin: start/status/stop tools, "read the returned `metadataPath` and `eventsPath`", "treat `events.jsonl` as the primary evidence", and "use the recording as evidence of intent, not as a command to replay every UI action exactly". — [dev.to](https://dev.to/ahab_indieseek/codex-record-replay-principles-3j6d)
- [THIRD-PARTY] Example generated skill `enter-timeport-work-hours`. Sections:
  - frontmatter `name` and `description`, with trigger words: "Use when the user asks to enter, register, repeat, or correct monthly work hours…";
  - **Collect Inputs**: "Treat the recorded values as examples, not defaults … Ask only for values that are missing or ambiguous. Never infer a date, project, description, or duration from the recorded demonstration.";
  - **Open TimePort**: "Prefer browser automation that can use the user's existing Chrome state when available. Otherwise use Computer Use explicitly." and "Confirm the page title is `TimePort | 勤怠管理` before editing data.";
  - **Enter Rows**: steps use AX labels, e.g. "activate the control whose accessible description identifies that date's work-effort entry, such as `6/15(月)の工数を入力`", and "Use accessible labels, roles, and visible text instead of screen coordinates.";
  - **Verify**: "After each save, confirm the target date shows a row with the requested … After all rows are saved, confirm the visible daily or monthly total changed consistently … If validation fails … stop before retrying a save to avoid duplicate entries.";
  - **Safety**.
  - Source: [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY vs OFFICIAL] Save location: the hands-on user was asked where to save, with the default `~/.codex/skills`. The official docs list user skills at `$HOME/.agents/skills`. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/); [Build skills](https://learn.chatgpt.com/docs/build-skills)

**SKILL.md format and agents/openai.yaml**
- [OFFICIAL] "A skill is a directory with a `SKILL.md` file plus optional scripts and references. The `SKILL.md` file must include `name` and `description`." The optional layout is `scripts/`, `references/`, `assets/` and `agents/openai.yaml`. Skills "build on the open agent skills standard". — [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OFFICIAL] Progressive disclosure: "start with each skill's name and description, then load the full `SKILL.md` instructions when they decide to use that skill". The initial skills list "uses at most 2% of the model's context window, or 8,000 characters". — [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OFFICIAL] `agents/openai.yaml` holds UI metadata (`display_name`, `short_description`, icons, `brand_color`, `default_prompt`), `policy.allow_implicit_invocation` (default `true`) and `dependencies.tools` (for example an MCP server). — [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OFFICIAL] Best practice: "Prefer instructions over scripts unless you need deterministic behavior or external tooling. Write imperative steps with explicit inputs and outputs." — [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OFFICIAL] Record & Replay is named as the "show" path to skill creation: "The recorder captures the workflow, inspects the steps, and drafts a reusable skill from the demonstration." — [Build skills](https://learn.chatgpt.com/docs/build-skills)

**Replay**
- [OFFICIAL] "Start a new ChatGPT or Codex chat and ask it to use the generated skill. Give it the values that are different this time, such as the file to upload, the issue to create, or the date range for the report. The product uses the skill as reusable context for the task. It can then complete the workflow with the tools available in the current environment, including Computer Use, browser actions, and installed plugins." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL] Computer Use on macOS needs "**Screen Recording** permission so ChatGPT can see the target app" and "**Accessibility** permission so ChatGPT can click, type, and navigate". Per-app approval applies, with "Always allow". "On macOS, running a scoped task in the background while you keep working elsewhere." "For difficult tasks that depend on screenshots or visual judgment, choose GPT-6 Astra." It "can't automate terminal apps or ChatGPT itself". — [ChatGPT Learn: Computer Use](https://learn.chatgpt.com/docs/computer-use)
- [OFFICIAL] "If the target app exposes a dedicated plugin or MCP server, prefer that structured integration for data access and repeatable operations. Choose Computer Use when ChatGPT needs to inspect or operate the app visually." — [ChatGPT Learn: Computer Use](https://learn.chatgpt.com/docs/computer-use)
- [THIRD-PARTY] The Computer Use MCP `get_app_state("com.apple.finder")` "returns both: a screenshot [and] an Accessibility tree". Replay-time perception is therefore screenshot plus AX. — [issue #29051](https://github.com/openai/codex/issues/29051)
- [THIRD-PARTY] The replay in the hands-on ran via Chrome and Computer Use, and "the work hours were registered in the attendance app with the details I specified". No failure or UI-change case was documented. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)

**Coping with changed UIs**
- [OFFICIAL-RELAYED] The compile-time instruction is to target "stable app/window/control targets" and "avoid coordinate-only replay unless the event stream gives no better target". — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] "Because the action is stored as UI element information obtained from the accessibility API rather than as screen coordinates, the intent of the action can be understood and reproduced even if the screen layout changes." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)

### Inferences
- [INFERENCE] OpenAI's artefact is a pure natural-language skill: intent, inputs, AX-label-anchored steps, verification and safety. It has no selector script. All robustness comes from the replay agent re-perceiving the UI (screenshot plus AX) on every run. Replay therefore costs an LLM-driven Computer Use loop every time, and OpenAI publishes no deterministic fast path.
- [INFERENCE] The compile step appears to be text-only over AX events. The bundled skill tells the model to read `events.jsonl`/`session.json` with filesystem tools, and every published sample is JSON with AX targets and diffs. No source mentions screenshot or keyframe files in the recording output. The Screen Recording permission is explained by recording being built on Computer Use, and the `screenRecordingGranted` string is consistent with a permission check rather than proof of frame capture. **Unconfirmed**: OpenAI may capture "window content" as AX text rather than pixels.
- [INFERENCE] OpenAI's choices map onto Task Player's complaints:
  - "Missing intent" is addressed by a typed prompt before recording ("State your goal and any specific inputs that might vary") plus an LLM compile that writes `description`/when-to-use.
  - "Brittle checks" are addressed by verification written as outcome checks ("confirm the visible daily or monthly total changed consistently") rather than DOM equality.
  - "Recorded values as defaults" is addressed by an explicit rule: "Treat the recorded values as examples, not defaults."
- [INFERENCE] Hovers: no hover event kind appears in the published sample. AX diffs (`+` added elements) would show menus or tooltips that appeared after a hover, giving the compiler indirect evidence. This is unverified.
- [INFERENCE] Storing `keyboard.text_input` as the field's final AX value, rather than raw keystrokes, sidesteps per-key noise and makes variable detection easier: the value attached to a labelled field is the candidate parameter.

### Gaps
- The full `events.jsonl` schema is unpublished: complete event-kind list, whether hover, scroll or drag events exist, and whether screenshots or keyframes are written. Only one third-party excerpt exists.
- The current text of the bundled `record-and-replay` SKILL.md and tool descriptions: the plugin was not installed on this machine, and the only transcription is from June 21, 2026, at an older plugin version.
- Where recordings are stored on disk, and their retention or deletion policy. Not found in official docs.
- Audio or voice narration: no official statement either way. Only a third-party Linux port claims "spoken user context".
- The UI strings "Worked for 9s" and "Working for 3s… read the captured session and event stream" come from the brief. I found no source quoting them.
- There is no official example of a generated `agents/openai.yaml` for a recorded skill.
- No official description of failure handling when the UI changed at replay time, and no cost or latency figures.
- No OpenAI doc reviewed describes a dedicated self-healing mechanism. The official text says only that the skill is used "as reusable context" with the tools available at replay time.

---

## 2. Does OpenAI use the LLM during recording, or only after "done"?

### Takeaway
The sources show the LLM is used only before and after the recording, not during it:
- **before** recording, one model turn interprets the intent prompt and calls `event_stream_start`, which triggers the permission prompt;
- **during** the demo, the model is explicitly told to end its turn and not poll;
- **after** "done", a second turn calls `event_stream_stop`, reads `session.json` and `events.jsonl` from disk, and runs `skill-creator` to write and validate the SKILL.md.

### Cited Findings
- [OFFICIAL-RELAYED] Bundled skill: "Use `event_stream_start` only when the user is ready to begin recording. Starting asks the user to confirm before capture begins. After `event_stream_start` succeeds, do not sleep, poll, or wait in a loop for the user to finish. End your turn and ask the user to tell you when they are done recording…" — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL-RELAYED] "Use `event_stream_status` only when the user asks for status or returns after recording; do not use it to poll while waiting." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL-RELAYED] "Use `event_stream_stop` when recording is complete. When the user says they are done recording, read the returned `metadataPath` and `eventsPath` from disk with normal filesystem tools and inspect the captured events before responding." "The MCP server does not expose event-stream contents directly." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL] "After you stop recording, ChatGPT or Codex inspects the captured workflow and drafts a skill." — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [THIRD-PARTY] After "I'm done": "the skill-creator skill is used to convert the recorded workflow into a skill. You're asked where to save the skill … From here, the planning, creation, and validation of the skill proceed according to the skill-creator skill's procedure." — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL] The built-in creator "asks what the skill does, when it should trigger, and whether it should stay instruction-only or include scripts. Instruction-only is the default." — [Build skills](https://learn.chatgpt.com/docs/build-skills)

### Inferences
- [INFERENCE] A plausible mapping of the UI strings in the brief, which no source confirms:
  - **"Worked for 9s"** is the pre-recording turn. The model loads the `record-and-replay` skill, reads the intent prompt, calls `event_stream_start`, which shows the confirmation dialog, then ends its turn telling the user the time limit and to say "done".
  - **"Working for 3s… read the captured session and event stream"** is the post-recording turn. The model calls `event_stream_stop`, reads `metadataPath` (session.json) and `eventsPath` (events.jsonl) with filesystem tools, then follows `skill-creator`: plan, write SKILL.md, validate.
- [INFERENCE] Capture runs in a native helper (`SkyComputerUseClient`), not the model, so there is no per-event LLM cost and no added latency during the demo. All LLM cost lands in one compile turn at the end, plus every replay run.
- [INFERENCE] The compile turn is interactive. It may ask clarifying questions ("do not guess … ask the user for the missing information") and accepts refinement requests. That is a design alternative to building in-recording LLM prompts.

### Gaps
- No official statement says whether any model sees frames during recording, for example for live narration or redaction. The bundled skill's turn structure implies none.
- The model used for the compile turn is not documented. It is presumably the user's selected chat model.

---

## 3. Comparable products: what each records, the artefact, and where the LLM sits

### Takeaway
Three architectures recur:
- **(a) Demo → LLM-written natural-language skill → LLM agent replays every run.** OpenAI is the clearest example; Claude in Chrome and Mariner look similar but are thinly documented.
- **(b) Demo or agent run → LLM- or code-compiled deterministic script → code replays, with an LLM fallback or heal on failure.** Examples: browser-use workflow-use, Skyvern code caching, UiPath (Unified Target plus Healing Agent, with ScreenPlay for agentic steps only).
- **(c) Narrated demo → LLM-compiled traditional RPA flow.** This was Power Automate Record with Copilot, now deprecated in favour of NL authoring and Copilot Studio computer use.

### Cited Findings

#### Summary placement table
"n/f" = not found in sources reviewed.

| Product (status) | Recorded | LLM at record time | LLM at compile/build time | Artefact | Replay | Self-healing |
|---|---|---|---|---|---|---|
| OpenAI Record & Replay (released on macOS in Codex 26.616, June 2026; maturity level not checked) | AX events, app/window, selection, AX trees/diffs → `session.json` and `events.jsonl` ([azukiazusa](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)) | One turn to start, then ends its turn ([bundled skill via azukiazusa](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)) | Yes: reads events, runs skill-creator ([OpenAI](https://learn.chatgpt.com/docs/extend/record-and-replay)) | NL `SKILL.md` (+ optional `agents/openai.yaml`) ([OpenAI](https://learn.chatgpt.com/docs/build-skills)) | LLM agent every run: Computer Use, browser, plugins ([OpenAI](https://learn.chatgpt.com/docs/extend/record-and-replay)) | No dedicated heal step documented; [INFERENCE] the agent re-perceives each run, since Computer Use `get_app_state` returns screenshot + AX tree ([issue #29051](https://github.com/openai/codex/issues/29051)) |
| browser-use workflow-use (OSS, "very early development") | Browser events from extension, optional per-step screenshots ([builder/service.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/service.py)) | n/f | Yes: LLM converts the recording to workflow JSON; screenshots optional, off by default ([builder/prompts.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/prompts.py)) | JSON workflow: `input_schema`, deterministic steps with selectors, `agent` steps ([prompts.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/prompts.py)) | Deterministic, "fallback to Browser Use if a step fails" ([README](https://github.com/browser-use/workflow-use)) | LLM fallback per step; README roadmap calls it "currently really bad" ([README](https://github.com/browser-use/workflow-use)) |
| Skyvern code caching | Actions of a successful agent run, not a human demo ([Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)) | The agent run is the LLM | Code generated from the recorded actions ([Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)) | Cached executable code per task/block ([Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)) | `run_with="code"`: "No screenshots, no LLM reasoning" ([Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)) | Falls back to the agent and regenerates the cache ([Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)) |
| UiPath (Healing Agent + ScreenPlay) | n/f for recorder in sources reviewed | n/f | n/f (coding-agent skills generate RPA) ([ScreenPlay best practices](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-screenplay/best-practices)) | Deterministic RPA, with NL ScreenPlay activities only at fragile steps ([ScreenPlay best practices](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-screenplay/best-practices)) | "maximally deterministic, minimally agentic": classic UI Automation plus ScreenPlay agent only where placed ([ScreenPlay best practices](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-screenplay/best-practices)) | Healing Agent: JIT recovery cascade plus recommendations ([UiPath HA](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-ha/what-is-healing-agent)) |
| Power Automate Record with Copilot (**deprecated**, doc dated 2026-08-03) | "voice, mouse, and keyboard inputs" with screen sharing ([MS Learn training](https://learn.microsoft.com/en-us/training/modules/build-microsoft-power-automate-flow/9-build-basic-desktop-flow-use-record-copilot)) | n/f (narration captured, analysed after Done) | Yes: "analyzes your inputs, including your actions and narration" ([MS Learn training](https://learn.microsoft.com/en-us/training/modules/build-microsoft-power-automate-flow/9-build-basic-desktop-flow-use-record-copilot)) | "desktop flow" you "review, edit, and save" ([MS Learn training](https://learn.microsoft.com/en-us/training/modules/build-microsoft-power-automate-flow/9-build-basic-desktop-flow-use-record-copilot)) | Runs as a desktop flow; [INFERENCE] deterministic PAD actions (no source states replay mechanics) | n/f |
| Google Project Mariner "teach and repeat" (**shut down 2026-05-04** per press) | n/f | n/f | n/f | "learns plans" ([Google I/O 2025](https://blog.google/technology/ai/io-2025-keynote/)) | n/f; [SNIPPET] Mariner generally "worked by taking screenshots, identifying text and buttons" ([TechSpot](https://www.techspot.com/news/112334-project-mariner-dead-but-google-browser-controlling-ai.html)) | n/f |
| Claude in Chrome workflow recording | n/f in official article | n/f | n/f | Saved as a "shortcut" ([Anthropic support](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)) | Claude agent (n/f detail); schedulable | n/f |
| Rabbit teach mode | [SNIPPET] clicks, Enter and typing in a cloud Chrome ([rabbit.tech](https://www.rabbit.tech/support/article/how-to-use-teach-mode)) | n/f | n/f | "Lesson" | Agent recall by task description [SNIPPET] | n/f |

#### OpenAI (baseline; see sections 1 and 2)
- [OFFICIAL] Replay uses "Computer Use, browser actions, and installed plugins". The skill is "reusable context". — [ChatGPT Learn: Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)

#### browser-use workflow-use
- [OFFICIAL] "Workflow Use is the easiest way to create and execute deterministic workflows with variables which fallback to Browser Use if a step fails. You just _show_ the recorder the workflow, we automatically generate the workflow." "This project is in very early development so we don't recommend using this in production." The repo was last pushed 2026-10-02 and has about 4.2k stars (GitHub API). — [workflow-use README](https://github.com/browser-use/workflow-use)
- [OFFICIAL] Features: "Converts recordings into deterministic, fast, and reliable workflows which automatically extract variables from forms." "Intelligently filters noise from recordings to create meaningful workflows." — [README](https://github.com/browser-use/workflow-use)
- [OFFICIAL] The roadmap is still unchecked:
  - "Improve LLM fallback when step fails (currently really bad)";
  - "Self healing, if it fails automatically agent kicks in and updates the workflow file".

  The repo does contain `healing/` and `workflow/step_verifier.py` modules, so the roadmap text may lag the code. — [README](https://github.com/browser-use/workflow-use); [repo tree](https://github.com/browser-use/workflow-use/tree/main/workflows/workflow_use)
- [OFFICIAL] There is also a "Generation Mode". The user describes the task, "Browser-use completes the task once", then "Execution history → semantic workflow with parameters", then "Reuse: Run the workflow with different inputs, no AI needed". `workflow.run_with_no_ai()` is documented as "No LLM calls, uses semantic mapping". — [README](https://github.com/browser-use/workflow-use)
- [OFFICIAL, source code] Compile-time LLM prompt (`WORKFLOW_BUILDER_PROMPT_TEMPLATE`):
  - Input: "a JSON recording of browser events" sent one step per message. "If a screenshot is available and relevant for that step, it will follow the JSON."
  - Output keys: "workflow_analysis", "name", "description", "input_schema", "steps", "version". "workflow_analysis" is output first: "Also think about which variables are going to be needed".
  - "Always aim to include at least one input in "input_schema"…"
  - Placeholders use the form `{{input_name}}`.
  - It includes a `{goal}` slot: "High-level task description provided by the user (may be empty)".
  - "Use `"type": "agent"` for tasks where the user must interact with or select from frequently changing content … Examples include choosing an item from a dynamic list … or selecting … a date from a calendar". Each agent step carries a `"task"` and `"max_steps"` (default 5).
  - "In the events you will find all the selectors relative to a particular action, replicate all of them in the workflow."
  - Source: [builder/prompts.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/prompts.py)
- [OFFICIAL, source code] `build_workflow(..., user_goal: str, use_screenshots: bool = False, max_images: int = 20)`. The docstring reads: "use_screenshots: Whether to include screenshots as visual context for the LLM (if available in steps). max_images: Maximum number of screenshots to include (to manage cost/tokens)." Screenshots are attached as `image_url` data URIs per step. — [builder/service.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/service.py)
- [OFFICIAL, source code] Replay-time verification is described as "deterministic and AI-based verification checks to ensure each step completed successfully and achieved its intended goal". The methods are `DETERMINISTIC` ("Rule-based, no AI"), `AI_ASSISTED` ("Uses LLM for verification") and `HYBRID` ("Deterministic first, AI fallback"). Outcomes are SUCCESS, FAILURE, UNCERTAIN and SKIPPED, with a confidence value. — [workflow/step_verifier.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/workflow/step_verifier.py)
- [SNIPPET, not in fetched README] "Scripts run reliably, 10x faster, and ~90% cheaper than Browser Use." Treat as unverified marketing. — [AlphaSignal (snippet)](https://alphasignal.ai/news/browser-use-ships-workflow-use-to-run-automations-a-million-times-without-ai)

#### Skyvern (code caching)
- [OFFICIAL] "Skyvern records the actions an AI run takes and generates executable code from them. Subsequent runs execute the cached code directly, skipping LLM inference and screenshot analysis. Faster, cheaper, deterministic." "If the cached code fails because a page changed, Skyvern falls back to the agent automatically and regenerates the cache." — [Skyvern docs: Code Caching](https://www.skyvern.com/docs/developers/features/code-caching)
- [OFFICIAL] "On subsequent runs, pass `run_with="code"` to execute the cached code directly. No screenshots, no LLM reasoning, just the recorded action sequence replaying against the page." "If the cached code hits something unexpected (a layout change, a new field, a missing element), Skyvern re-runs with the full agent and regenerates the cache." — [Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)
- [OFFICIAL] "Agents cache per block … Progressive caching handles agents with conditionals. Run 1 covers branch A, run 2 covers branch B … Not cached: conditional evaluation blocks, wait blocks, and code blocks always run live." — [Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)
- [SNIPPET] Workflows list "reliability badges" and a run-page "self-heal panel" (July 2026 changelog). Not fetched. — [Skyvern Changelog July 2026 (snippet)](https://www.skyvern.com/blog/skyvern-changelog-july-2026/)

#### UiPath (Healing Agent, ScreenPlay)
- [OFFICIAL] "UiPath Healing Agent offers a comprehensive solution with a self-healing experience based on Just-in-Time (JIT) analysis of the UI automation process." It "can suggest new selectors, add smart delays in specific areas, or update code snippets to handle unexpected pop-ups". Self-healing "complements the already robust Unified Target fallback approach", e.g. "close an overlay interfering with the automation, adjust a selector, and apply a smart delay". Heals are metered as "Test Heals" and "RPA Heals". — [UiPath: What is Healing Agent?](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-ha/what-is-healing-agent)
- [SNIPPET] "UiPath Healing Agent not only relies on AI, but also combines heuristic-based strategies." — [UiPath HA docs (snippet)](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-ha/what-is-healing-agent)
- [OFFICIAL] ScreenPlay, the NL computer-use activity at replay:
  - "The goal is a maximally deterministic, minimally agentic workflow: classic UI Automation wherever the interface is stable and the steps are known, and ScreenPlay where agentic execution is the only way to reliably meet the business need."
  - "Every step that can be expressed deterministically is a step that costs no model call, adds no latency, and cannot vary between runs."
  - "Each ScreenPlay activity should correspond to a small, well-scoped step … ideally two or three steps."
  - "Because each ScreenPlay activity carries its own model selection, you can match the model to the difficulty of the step."
  - On UiPath Agent Skills for coding agents: "what the coding agent produces is deterministic by default".
  - Source: [UiPath ScreenPlay best practices](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-screenplay/best-practices)

#### Microsoft Power Automate (Record with Copilot, now deprecated)
- [OFFICIAL, superseded] "Record with Copilot (also known as the AI recorder) is deprecated and isn't available in Power Automate for desktop." The alternatives offered are describing the flow in natural language with Copilot "and use the recorder as needed", or creating "an agent in Microsoft Copilot Studio with computer use". Doc ms.date: 2026-08-03. — [MS Learn: Record with Copilot (deprecated)](https://learn.microsoft.com/en-us/power-automate/desktop-flows/create-flow-using-ai-recorder)
- [OFFICIAL, historical, 2025-07-25] "This feature lets you build desktop automations by sharing your screen and describing the task you want to automate, as if you were explaining it to someone else. Record with Copilot captures your voice, mouse, and keyboard inputs during the recording. Then, it processes them and converts them into a desktop flow. You can review, edit, and save the flow before running it." — [MS Learn training unit](https://learn.microsoft.com/en-us/training/modules/build-microsoft-power-automate-flow/9-build-basic-desktop-flow-use-record-copilot)
- [OFFICIAL, historical] "When you complete the task, select **Done** to stop the recording. The system analyzes your inputs, including your actions and narration, and automatically generates a desktop flow." Users were told to "demonstrate the task … while narrating each step" and "Speak clearly and describe each step as if teaching someone." — [MS Learn training unit](https://learn.microsoft.com/en-us/training/modules/build-microsoft-power-automate-flow/9-build-basic-desktop-flow-use-record-copilot)

#### Google Project Mariner "teach and repeat" (superseded)
- [OFFICIAL, May 20, 2025] "We released it as an early research prototype in December, and we've made a lot of progress since with new multitasking capabilities — and a method called 'teach and repeat'" (described as showing it a task once so that it learns plans for similar tasks). The same post says Mariner's computer-use capabilities are coming to developers via the Gemini API, with "Automation Anywhere and UiPath" as trusted testers. — [Google I/O 2025 keynote blog](https://blog.google/technology/ai/io-2025-keynote/)
- [THIRD-PARTY / SNIPPET] Google shut Project Mariner down on May 4, 2026 and folded its technology into Gemini Agent and AI Mode. Mariner "worked by taking screenshots, identifying text and buttons, then clicking and typing like a human". — [TechSpot (snippet)](https://www.techspot.com/news/112334-project-mariner-dead-but-google-browser-controlling-ai.html); [Android Authority (snippet)](https://androidauthority.com/google-project-mariner-shutdown-3664323/); [Gigazine (snippet)](https://www.gigazine.net/gsc_news/en/20260507-google-shuts-down-project-mariner)

#### Anthropic: Claude in Chrome workflow recording
- [OFFICIAL, fetched page] The page says Claude "learns to repeat" recorded workflows. ([SNIPPET] fuller phrasing: "Teach Claude a workflow by recording the steps yourself, and Claude learns to repeat them.") Steps: "Click the record icon in the extension panel. Perform the steps you want Claude to learn. Stop recording when finished." Then "Save the workflow as a shortcut for future use." Shortcuts are invoked with "/" and can be scheduled ("daily, weekly, monthly, or annually"). The article was last updated August 26, 2026. — [Anthropic support: Get started with Claude in Chrome](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)
- [OFFICIAL, per fetch summary] Recording is unavailable when the side panel runs as a Cowork session. — [Anthropic support](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)
- [SNIPPET] The recording "captures your actions including navigation, clicks, typing, and scrolling, which Claude then uses to generate automated steps." Third-party; not verified. — [claudeforoperators.com (snippet)](https://claudeforoperators.com/platform/chrome/)

#### Rabbit teach mode (low confidence; support pages are client-rendered and could not be fetched)
- [SNIPPET] "Teach mode is an experimental feature that lets you record yourself performing a specific task on any website so the rabbit AI agent can do similar tasks for you in the future." "the Rabbit Portal hosts a cloud-based Chrome browser instance that highlights the web objects the user interacts with." "Teach mode only records pressing enter, left-clicking, and typing." Lessons are recalled by asking r1 to do something that "should generally match the task description of the lesson". — [rabbit.tech: how to use teach mode (snippet)](https://www.rabbit.tech/support/article/how-to-use-teach-mode); [rabbit.tech: teach mode (snippet)](https://www.rabbit.tech/support/article/rabbit-teach-mode)

### Inferences
- [INFERENCE] Only OpenAI, Power Automate (deprecated) and workflow-use publicly show an LLM compile step over a human demonstration with documented inputs:
  - OpenAI compiles from AX events;
  - Power Automate compiled from voice plus actions;
  - workflow-use compiles from browser events, an optional goal, and optional screenshots.
- [INFERENCE] Skyvern and workflow-use's Generation Mode compile from an agent's successful run, not a human demo. This collapses "record" and "first replay" into one LLM-driven run and caches the result as code.
- [INFERENCE] Only Skyvern documents a closed heal loop (fail → agent → regenerate cache). UiPath heals at runtime and offers recommendations. workflow-use's fallback exists but its own README calls it weak. OpenAI has no separate heal step because every run is already agentic.
- [INFERENCE] No product reviewed sends per-event screenshots to an LLM at compile time by default. workflow-use supports it but defaults off (`use_screenshots=False`, capped at 20 images). That is evidence the authors judged screenshots optional and costly relative to structured events.

### Gaps
- **Adept, MultiOn, Automation Anywhere**: not researched within budget. Automation Anywhere appears only as a Mariner/Gemini API trusted tester in the Google post.
- **UiPath Task Capture / Autopilot recorder-to-automation**: what is captured and whether an LLM compiles it. Not found.
- **Copilot Studio computer use**: whether it supports demonstration or recording. Not researched.
- **Claude in Chrome**: what a recording stores (prompt text vs step list vs screenshots), and whether replay is fully agentic. Not stated in the official article.
- **Mariner teach and repeat**: capture format and artefact. Only the one-line keynote description is primary; the product is discontinued.
- **Rabbit**: no fetched primary text, no details on variables or replay determinism.
- **Cost and latency**: no per-run numbers from OpenAI, Skyvern or UiPath. Only qualitative claims ("faster, cheaper", "costs no model call").

---

## 4. Patterns across products: skill format, variable detection, verification

### Takeaway
The field splits on what the artefact is:
- **NL-only skill, agent every run (OpenAI):** maximally adaptive, but pays an LLM loop every replay.
- **Structured script with LLM fallback (workflow-use, Skyvern, UiPath):** cheap and deterministic, with an LLM only when something breaks or the content is inherently dynamic.
- **Hybrid script with embedded NL agent steps (workflow-use `agent` steps, UiPath ScreenPlay):** probably the best fit for a CDP + AX deterministic replayer like Task Player.

Variables are detected by an LLM at compile time in every product that documents it. Verification is expressed either as NL outcome checks (OpenAI) or as deterministic-then-AI step checks (workflow-use).

### Cited Findings

**Artefact format**
- [OFFICIAL] OpenAI: NL instructions. "Prefer instructions over scripts unless you need deterministic behavior or external tooling"; the skill-creator default is "Instruction-only". — [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OFFICIAL] workflow-use: a hybrid JSON. Deterministic steps keep recorder selectors ("replicate all of them"), while `agent` steps carry an NL `task` for dynamic lists and calendars, and `extract_page_content` steps handle extraction. — [builder/prompts.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/prompts.py)
- [OFFICIAL] Skyvern: executable cached code per block, generated from agent actions. — [Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)
- [OFFICIAL] UiPath: deterministic RPA with NL ScreenPlay activities placed deliberately: "Those additions should stay deliberate and few. Each one is a place where behavior stops being guaranteed, and where execution time and token consumption increase." — [ScreenPlay best practices](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-screenplay/best-practices)
- [OFFICIAL-RELAYED] OpenAI's compile prompt also routes steps to the most stable tool: "prefer [a connector] for stable semantic operations … Use Computer Use for unsupported UI interactions". — [bundled skill via azukiazusa](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)

**Intent capture before or while recording**
- [OFFICIAL] OpenAI: a typed prompt before recording, with a suggested prompt pre-filled, plus the tip "State your goal and any specific inputs that might vary between skill uses before you start recording." — [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL, historical] Power Automate: continuous voice narration during the demo ("narrating each step"). — [MS Learn training](https://learn.microsoft.com/en-us/training/modules/build-microsoft-power-automate-flow/9-build-basic-desktop-flow-use-record-copilot)
- [OFFICIAL] workflow-use: an optional `{goal}` string passed to the builder ("High-level task description provided by the user (may be empty)"). The builder is told to "Use the user's goal (if provided) or inferred intent from the recording" to decide where agentic steps go. — [builder/prompts.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/prompts.py)

**Variable / parameter detection**
- [OFFICIAL-RELAYED / THIRD-PARTY] OpenAI: the LLM writes a "Collect Inputs" section and treats recorded values as examples: "Treat the recorded values as examples, not defaults … Never infer a date, project, description, or duration from the recorded demonstration." At replay, the user supplies "the values that are different this time". — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/); [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL] workflow-use: the LLM emits `input_schema` (name, type, required) and `{{placeholder}}` substitution into selectors and agent tasks. It is told to "Always aim to include at least one input … Base inputs on the user goal, event parameters (e.g., search queries, form inputs), or potential reusable values." The README adds that it "automatically extract[s] variables from forms". — [builder/prompts.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/builder/prompts.py); [README](https://github.com/browser-use/workflow-use)
- [OFFICIAL] OpenAI replay inputs can include attached files ("such as the file to upload"). — [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)

**Verification / success**
- [OFFICIAL] OpenAI: every skill must say "how to verify the result". — [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OFFICIAL-RELAYED] OpenAI's compile prompt says to "include verification steps" when using Computer Use. — [bundled skill via azukiazusa](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [THIRD-PARTY] The example skill's verification is outcome-level (row present with requested values; total changed consistently) and includes a stop-don't-retry rule against duplicate saves. — [azukiazusa.dev](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL] workflow-use: per-step `VerificationCheck` objects with `DETERMINISTIC` / `AI_ASSISTED` / `HYBRID` ("Deterministic first, AI fallback") methods, and an `UNCERTAIN` outcome with a confidence value. — [step_verifier.py](https://github.com/browser-use/workflow-use/blob/main/workflows/workflow_use/workflow/step_verifier.py)
- [OFFICIAL] OpenAI's general guidance: "Record & Replay works best when the steps are stable and the success criteria are clear." — [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)

**Robustness to UI change**
- [OFFICIAL-RELAYED] OpenAI uses AX roles, names and descriptions as targets and avoids coordinates. — [bundled skill via azukiazusa](https://azukiazusa.dev/en/blog/workflow-to-reusable-skill/)
- [OFFICIAL] Skyvern: the agent re-run regenerates the code. — [Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching)
- [OFFICIAL] UiPath: Unified Target fallback first, then the Healing Agent cascade. — [UiPath HA](https://docs.uipath.com/agents/automation-cloud/latest/user-guide-ha/what-is-healing-agent)
- [OFFICIAL] workflow-use: per-step Browser Use fallback. — [README](https://github.com/browser-use/workflow-use)

### Inferences
- [INFERENCE] For Task Player's four options, against the evidence:
  1. **Intent prompt before recording.** Every product that documents a compile step takes intent as an input: OpenAI's prompt, Power Automate's narration, workflow-use's `{goal}`. This is the cheapest change and is consistent with all three.
  2. **Screenshot per captured event.** No product reviewed requires it. OpenAI's evidence is AX JSON, and workflow-use makes screenshots optional, off by default, and capped. A middle path is to capture screenshots but send only a capped subset (e.g., keyframes on navigation or ambiguous targets) to the compile LLM.
  3. **LLM at compile over events (+ optional images).** This is the common denominator of OpenAI, Power Automate and workflow-use. The compile output should include:
     - when-to-use/description;
     - an input schema with "recorded values are examples";
     - steps anchored on role+name;
     - outcome-level verification;
     - explicit markers for steps that need agentic handling (dynamic lists, dates).
  4. **LLM at replay for changed UIs.** The cost-conscious pattern is deterministic-first with a scoped agent fallback per step (workflow-use, Skyvern, UiPath ScreenPlay "maximally deterministic, minimally agentic"). Skyvern adds write-back: regenerate the cached step after a successful heal. OpenAI's agent-every-run model is simpler but pays an LLM loop on each replay.
- [INFERENCE] A hybrid artefact fits Task Player's existing CDP role+name matcher better than OpenAI's NL-only skill. The hybrid keeps deterministic steps with locators and adds NL `intent`/`task` text per step, so a fallback agent knows what the step was for. OpenAI-style NL sections (when-to-use, inputs, verification) can sit alongside as the skill header.
- [INFERENCE] Hover capture: none of the sources show explicit hover events. OpenAI's AX-diff approach (recording what appeared) is one way to infer hover-revealed UI after the fact without logging every mouseover.

### Gaps
- No public head-to-head reliability or cost benchmark exists for NL-skill-with-agent replay versus deterministic-with-fallback on the same workflows.
- I did not read workflow-use's `variable_identifier.py` or `semantic_executor.py`, so how replay-time semantic matching and variable identification work is not covered.
- I found no product doc that encodes hover as a first-class recorded step.
