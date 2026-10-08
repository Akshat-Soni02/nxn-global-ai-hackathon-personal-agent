# 08 · FAQ: the naive questions that come up while building this

> **Superseded (Oct 8, 2026).** This note describes the flat-skill flow from before the workflow pivot (describe + record with screenshots and voice → editable workflow tree → self-correcting replay). It is kept as history; the current design is [docs/design.md](../design.md).

Each answer is short and points to the file that holds the detail. Evidence labels are the same as in [00](00-start-here.md#how-claims-are-labelled).

## Browser and identity

### Do we need to pull cookies or tokens from the user's browser?

Sprint 1 asked for this: *"Interface to reliably pull token/cookie from user's browser live … if not found fallback to input from user … APIs to handle state capturing of token"*.

**No. The architecture made that task unnecessary.** Replay runs *inside* the user's logged-in Chrome, so every request already carries their cookies, exactly as if they had clicked themselves. Reading cookies out is also the very thing Chrome 136 hardened against (*"attackers … steal cookies"*, doc-verified, [03](03-tools-chrome-electron-openai.md#the-perspective-that-makes-it-simple)).

What remains of "auth management" is smaller:

| Need | Mechanism |
|---|---|
| Know you're logged out | A per-site precondition from the recording ("Sign out" visible, no password field) |
| Re-log in unattended | `Input.type: "secret"` (`skill.ts:43`), resolved from the macOS Keychain at run time (`design.md:191`) |
| Session expired, no saved secret | Run → `waiting_user` (`design.md:181`); notify "log in to X, then resume" |
| 2FA, OTP | Pause and ask, with a timeout. Never automated (`design.md:28`) |

### What is the "started debugging this browser" bar? Can we hide it?

Chrome shows it whenever an extension is attached with `chrome.debugger`. The design keeps it short: attach only to tabs in the automation window, and only during a run (`design.md:195`). Hiding it needs a Chrome launch flag (`--silent-debugger-extension-api`, **dossier claim**), which means editing how the user starts Chrome. In the demo, present it as the transparency signal that it is. It's an open question in `design.md:236`.

### Does replay work in a background tab, or in a minimised window?

Mostly, yes:

- **CDP input doesn't need focus** (`design.md:157`). Runs go in a dedicated automation window, never the user's active one.
- **Chrome throttles background tabs** (`design.md:158`), so a heavy single-page app can stall. The plan is to bring that tab forward *inside the automation window*.
- **Some sites insist on a visible, focused window.** For example, certain SSO flows. The Cursor research lists the caveats (`docs/research/cursor-chat-task-replay.md:310-316`).

### What if Chrome is closed when a schedule fires? What if the Mac is asleep?

- **Chrome closed:** the daemon opens Chrome, without flags, and waits for the extension to connect (`design.md:42`). Mac-only skills don't need Chrome at all.
- **Asleep:** nothing runs. On wake, a missed run fires *once* and the gap is logged. A backlog is never replayed silently (`design.md:182`).

### Why does the daemon own the recording session, not the extension?

A task can be Mac-only, with no Chrome involved, or mixed, where the trace must also hold filesystem events the extension can't see. `daemon.ts:12`: *"Web capture joins if Chrome is connected; Mac-only tasks work without it."* This changed in commit `55fd9fb`.

## Recording

### My content-script event never reaches the daemon. Why?

Check these in order:

1. **Is the content script running at all?** Today's build emits ESM, which fails as a classic script (**measured**, [01](01-status-and-diff.md#found-while-reading-four-problems-with-evidence)). Look for a SyntaxError in the *page's* DevTools console.
2. **Was the tab open before the extension was loaded or reloaded?** Manifest content scripts are injected when a page loads. Reload the tab.
3. **Is a session active?** Type `record` in the daemon terminal. The content script learns it through `content.ts:7-16`.
4. **Does the message validate?** It needs `type`, `id`, `at` and `event`. An invalid one is dropped with `invalid message` on the daemon's stderr (`daemon.ts:35`).
5. **Is the extension connected?** `status` in the daemon prints the connected count (`main.ts:16`).

### The browser hides the file's path from the page. How does the skill know which file to upload?

It doesn't know a path from the page. It knows only the name, size and type. The compiler turns *"a file named `invoice-0923.pdf`"* into an input with a resolver, such as `{dir: "~/Downloads", glob: "invoice-*.pdf", pick: "newest"}` (`upload-invoice.json:5-10`), and the drill confirms the folder. At replay, the resolver produces an absolute path for `DOM.setFileInputFiles` ([02](02-product-and-architecture.md#traced-one-control-record-to-replay)).

### What about iframes and shadow DOM?

- **Iframes:** `all_frames: true` (`manifest.json:16`) gives each frame its own content script. The background worker learns `frameId` from `sender` ([05](05-context-layer.md#stage-1--capture)). `Locator.framePath` stores the path (`skill.ts:28`).
- **Shadow DOM:** `composedPath()[0]` gives the real element inside an *open* shadow root. `ElementDescriptor.shadowPath` stores the host chain (`descriptor.ts:10`). Closed roots are invisible to content scripts; CDP can see through them at replay.

### Do we record passwords?

Never. They are redacted in the content script before anything is sent, and become secret inputs ([04](04-capture-without-coordinates.md#4--redact-at-the-source), `design.md:109`).

### Is screen recording needed?

No. It's a stretch goal and never the source of targets. It joins the natural-language path as "intent without targets" ([04](04-capture-without-coordinates.md#so-what-is-the-screen-recording-for)).

## The skill format

### Why "skill" and not "plan"? Why zod and not JSON Schema + Ajv?

- **"Plan"** was the earlier name (`design.md:14`). The code says skill. The dossier's `nxn.plan` is the same idea.
- **zod** gives TypeScript types *and* runtime validation from one definition. Its refinements already produce the error messages the compiler's retry loop needs (`skill.ts:76-83`).

### Why are `vision` steps rejected in a stored skill?

Vision is a replay-time last resort, chosen when every other rung failed. A stored skill that *starts* with vision would force a screenshot plus a model call on every run. `skill.ts:80-83`: *"vision steps are chosen by replay at run time, never written into a skill"*.

### What does `{{inputs.invoice.name}}` resolve to, and who implements it?

It's intended to mean the chosen file's name. The examples use `{{inputs.*}}`, `{{inputs.invoice.name}}` and `{{today}}` (`upload-invoice.json:34`, `tidy-screenshots.json:19`), but **no code implements templating yet**. Agree on the grammar at DSU: the compiler emits it and the player resolves it ([07](07-how-to-proceed.md#decisions-to-take-at-todays-dsu-thu-1-oct-5-pm)).

### How big can a message or a skill be?

Messages to Chrome from the native host are capped at **1 MB** (`framing.ts:6-7`, enforced in `encode`). `run.step` carries the *whole* skill (`messages.ts:40`), so keep screenshots and crops out of skills ([04](04-capture-without-coordinates.md#three-rules-the-measurements-forced)).

## Replay and the model

### Why not call the LLM on every step, like OpenAI's Record & Replay?

On every run you would pay for it in time, tokens and non-determinism, for no gain on an unchanged page. Here the model is the exception handler ([03](03-tools-chrome-electron-openai.md#q3--how-openai-built-record--replay), [06](06-processing-and-learning.md)).

### Can a malicious page talk the agent into doing something else?

The design forbids it structurally: *"it cannot add steps, change URLs outside the skill's domains, or read other tabs"* (`design.md:190`). Page text is treated as data, and `requires_approval` steps still ask after a heal.

### Can two tasks run at the same time?

*"One run at a time per Chrome window"* (`design.md:181`).

### Does "the model learns the new UI" mean fine-tuning?

No. A verified fix is written into skill version N+1 ([06](06-processing-and-learning.md#q2--when-the-ui-changes-does-the-model-learn-it)).

## Project and logistics

### What do I need running to develop?

From `readme.md:115-134`:

- `pnpm install`
- `pnpm setup:native-host` (once)
- load `apps/extension/dist` unpacked
- `pnpm fixtures`
- `pnpm extension`, which watches the build
- `pnpm daemon`, then type `record`, `stop` or `status`

Install with **pnpm**, not npm ([01](01-status-and-diff.md#measured-the-test-suite-in-this-checkout)).

### How do we test drift reproducibly?

With fixture pairs. `upload.html` and `upload-drifted.html` already differ in the ways that matter: renamed button, hidden input, renamed `name`, generated classes, cookie dialog. Every new drift case is a new fixture page, never a live site. The drifted page already exposed one real design flaw ([06](06-processing-and-learning.md#what-is-unusual-here-a-correction-to-the-dossier)).

### What will the "working demo URL" be?

It's an open question (`design.md:235`). The cheapest credible answer is to host `fixtures/pages` publicly as the sandbox the demo runs against, plus a static page showing skills, versions and run logs. Sprint 4.

### Does it run on Windows?

Not yet. Socket paths, the host-manifest location and the launcher are macOS-specific ([01](01-status-and-diff.md#found-while-reading-four-problems-with-evidence)). Windows needs a named pipe and a registry entry. Defer it, but keep path code behind `packages/ipc/src/paths.ts`.

### Is there anything sensitive in the project sheet I shouldn't copy into the repo?

Yes. The Idea tab contains the Nebius builder-programme activation code. The repo is public and MIT-licensed, so keep it out of `docs/`, commits and the README. This guide does not include it.
