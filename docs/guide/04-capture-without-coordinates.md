# 04 · Capturing clicks and objects without coordinates

> **Superseded (Oct 8, 2026).** This note describes the flat-skill flow from before the workflow pivot (describe + record with screenshots and voice → editable workflow tree → self-correcting replay). It is kept as history; the current design is [docs/design.md](../design.md).

> *"How the screen recording will capture the objects, clicks, actions ? it should not be dependent on x and y coordinates as windows resizes then what and how to capture it in a smart way ?"*

## The short answer

You don't capture objects from a recording of the screen. You capture them **from the page itself, at the instant each event fires**:

- When you click, the browser delivers an event whose `target` *is the element*: the actual `<button>` or `<input>` object. That object knows its role, accessible name, label, nearby heading and attributes.
- The content script describes that element by *meaning* and sends the description to the daemon.
- Coordinates are never stored. At replay time, CDP does need a point to click, and replay computes it from the freshly matched element a millisecond before acting.

## The perspective that makes it simple

**The browser hands you the element itself, so there is nothing to reconstruct.** Coordinates are a *derived, perishable* property of an element, like its current colour or scroll offset. You store what the element *is*. You re-derive where it *is* only at the moment you need it.

A video frame is the opposite. It has pixels and no element identity, so everything has to be reconstructed by guessing. That's why the screen recording is not the source of truth ([below](#so-what-is-the-screen-recording-for)).

## Why x/y fails: measured on this repo's own fixtures

The repo ships a page and its "redesign": `fixtures/pages/upload.html` and `upload-drifted.html`. Here is the same control, the invoice file input, on both. **Measured** in a test browser today:

| Signal about the invoice file input | `upload.html` | `upload-drifted.html` | Survives the redesign? |
|---|---|---|---|
| Position (CSS px, top-left of viewport) | x = 110, y = 127, 252 × 21 | **0 × 0**: the input is `hidden` (`upload-drifted.html:14`) | ❌ there is no point to click at all |
| Chrome's role + name | `button "Upload invoice"` | **absent from the accessibility tree**; the label shows as `generic "Browse files"` | ❌ |
| `name` attribute | `invoice` | `invoice_file` | ❌ |
| CSS fallback `input[type=file][name=invoice]` | 1 match | **0 matches** | ❌ |
| XPath fallback `//section[h2='Documents']//input[@type='file']` | 1 match | **1 match** | ✅ |
| Nearest heading | `Documents` | `Documents` | ✅ |

Also on the drifted page: a `dialog "Cookies"` is inserted at the top (`upload-drifted.html:5-7`). It pushes everything below it down the page. A stored y would now point at the wrong thing even for controls that did not change.

Two lessons come straight out of this table:

1. **Store many independent signals, because any one of them can die.** Here, the only survivors were the heading text and a selector *anchored on the heading text*.
2. **Some actions never need a point at all.** Uploading into a hidden input is CDP `DOM.setFileInputFiles({ backendNodeId, files })` on the node. No click and no coordinate. The skill's `upload` action (`skill.ts:12`) exists so this isn't modelled as a click.

## How capture works, mechanically

### 1 · The content script is injected into every page and frame

`apps/extension/manifest.json:11-18`:

```json
"content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"],
                      "run_at": "document_start", "all_frames": true }]
```

- `all_frames` gives one instance per iframe, including cross-origin ones. Each knows its own `frameId` through `sender.frameId` in the background worker.
- `document_start` means your listeners exist before the page's own scripts run.
- Consider adding `"match_about_blank": true` so blank iframes, such as rich-text editors, are covered too.

> 🔴 **First, fix the build.** Today `content.js` is emitted as ESM with an `export` and fails to parse as a classic script (**measured**, [01](01-status-and-diff.md#found-while-reading-four-problems-with-evidence)). Nothing in this file runs until it is built as IIFE.

### 2 · Listen in the capture phase, describe on `pointerdown`

```ts
// apps/extension/src/content.ts (proposed shape; sessionId / recording state already exists at :5-16)
const ACTIONABLE = "button, a[href], input, select, textarea, label, summary, [role], [tabindex], [contenteditable]";
let pending: ElementDescriptor | undefined;

document.addEventListener("pointerdown", (e) => {
  if (sessionId === undefined) return;
  const hit = e.composedPath()[0];                         // real target, even inside an open shadow root
  const el = hit instanceof Element ? (hit.closest(ACTIONABLE) ?? hit) : undefined;
  pending = el && describeElement(el);                     // describe NOW, before the click handler re-renders
}, true);                                                  // true = capture phase

document.addEventListener("click", () => {
  if (pending) emit("click", pending);
  pending = undefined;
}, true);

function emit(event: string, target?: ElementDescriptor, value?: string) {
  chrome.runtime.sendMessage({ type: "record.event", id: crypto.randomUUID(), at: Date.now(), event, value, target });
}
```

Each choice exists to defeat a specific failure:

| Choice | Failure it prevents |
|---|---|
| **Capture phase** (`true`) | A page handler calls `stopPropagation()` and your bubble-phase listener never hears the click |
| **Describe on `pointerdown`, emit on `click`** | The click handler closes the menu, re-renders the list or navigates. By `click` time the element may be detached and its text gone |
| **`composedPath()[0]`** | `e.target` is retargeted to the shadow host for events inside a shadow root. `composedPath` gives the real inner element (open roots only) |
| **`closest(ACTIONABLE)`** | You clicked the `<span>` or `<svg>` inside a button. The step should target the button |
| **`id` + `at` on every message** | `Message` requires them (`messages.ts:13`, `:33`). Without them the daemon's `safeParse` drops the event silently (`daemon.ts:35`) |

### 3 · What to capture per kind of interaction

| Interaction | Listen to | Store | Watch out |
|---|---|---|---|
| Click | `pointerdown` + `click` | descriptor of the actionable element | Describe before re-render |
| Typing | `input` (to know it's dirty), then `change`/`blur` | **final value** per field, once | 14 keystrokes must become 1 `type` step. Never store secrets (below) |
| Select, checkbox, radio | `change` | chosen option's value **and** visible text; checked state | Custom dropdowns are clicks, not `change` |
| File chosen | `change` on `input[type=file]` | `files[0].name`, `size`, `type`, **never a path** | The page only gets `C:\fakepath\name`. The compiler turns it into an `Input` with a resolver ([05](05-context-layer.md)) |
| Submit, Enter, Tab, Esc | `submit`; `keydown` for those keys | the form or the focused element | Single-page apps often never fire `submit`. The *next* thing that changes is the real signal |
| Navigation, SPA routes | background worker: `chrome.webNavigation` (permission present, `manifest.json:19`) | URL, transition type | Not visible to the content script across page loads |
| Tabs, popups | background worker: `chrome.tabs.onCreated` + `openerTabId` | which tab opened which | Becomes "expect a new tab" in replay |
| Downloads | background worker: `chrome.downloads` (permission present) | filename, MIME, final path | Later a check plus an output for a later step |
| Files on disk | daemon, FSEvents (TODO `daemon.ts:69`) | created, moved, renamed paths | The extension cannot see the filesystem |

### 4 · Redact at the source

`design.md:106-109`, under *"Record must not"*: *"Record password fields' values. Mark them as a secret input instead."* Do it in the content script, so the secret never crosses native messaging:

```ts
const isSecret = (el: HTMLInputElement) =>
  el.type === "password" ||
  /current-password|new-password|one-time-code|cc-number|cc-csc/.test(el.autocomplete) ||
  /pass|otp|pin|cvv/i.test(el.name);
// → emit("change", describeElement(el), undefined) plus a flag; the compiler makes it Input.type "secret" (skill.ts:43)
```

## Describing an element: `describeElement(el)`

`descriptor.ts:15-16` asks for it and says who uses it: *"Both the recorder (on the clicked element) and the player (on each candidate) call it."* That sharing is the most important property of this function.

- At **record** time it produces the stored description.
- At **replay** time it describes each candidate on the page, and the matcher scores candidate against stored.

If the two sides computed "name" differently, replay would fail on an unchanged page. That's why it is **one function, written once, in `apps/extension/src/describe.ts`**, reviewed by both of you.

```ts
// apps/extension/src/describe.ts  (proposed; dom-accessibility-api is a new dependency)
import type { ElementDescriptor } from "@taskplayer/core";
import { computeAccessibleName, getRole } from "dom-accessibility-api";

const KEEP = ["id", "name", "type", "placeholder", "aria-label", "data-testid", "data-test", "data-qa", "href"];
const GENERATED = /\d{4,}|[a-f0-9]{8,}|:r\d+:/;     // ids and classes that change every deploy

export function describeElement(el: Element): ElementDescriptor {
  const near = nearestHeadingText(el);              // walk up ancestors; first h1–h6 / legend / aria-label region
  return {
    tag: el.tagName.toLowerCase(),
    url: location.href,
    role: getRole(el) ?? undefined,
    name: computeAccessibleName(el) || undefined,
    label: labelText(el),                           // <label for>, wrapping <label>, aria-labelledby
    text: el.textContent?.trim().slice(0, 80) || undefined,
    near,
    attrs: pickAttrs(el, KEEP, GENERATED),
    fallbacks: [],                                  // the compiler copies selectors in, best first
    selectors: { css: stableCss(el, GENERATED), xpath: anchoredXPath(el, near) },
  };
}
```

What it produces for the invoice input on `upload.html`. Role and name are **measured** from Chrome. The rest is **reasoned** from the HTML at `upload.html:5-7`:

```json
{
  "tag": "input", "url": "http://localhost:5173/upload.html",
  "role": "button", "name": "Upload invoice", "label": "Upload invoice", "near": "Documents",
  "attrs": { "type": "file", "name": "invoice" },
  "fallbacks": [],
  "selectors": { "css": "input[type=file][name=invoice]", "xpath": "//section[h2='Documents']//input[@type='file']" }
}
```

Compare it with the hand-written skill, `upload-invoice.json:27-32`. Same role, name, `near` and both fallbacks. **The example skill is the exact target your recorder should hit.** Compile a recording of `upload.html`, diff the result against that file, and the diff is your bug list.

### Three rules the measurements forced

1. **Anchor selectors on text, not on position or classes.** The XPath survived the redesign because it hangs off `h2='Documents'`. The drifted page's classes (`x9f-layout`, `a81-card`, `btn-3a8f`) look generated and would kill any class-based CSS.
2. **Chrome is the authority on role and name.** Replay resolves through Chrome. Chrome said `spinbutton` for `<input type=number>` where the hand-written example said `textbox` (**measured**, [01](01-status-and-diff.md#found-while-reading-four-problems-with-evidence)). It also leaves hidden inputs out of its tree entirely. In the first hour, check that `dom-accessibility-api` agrees with Chrome on all three fixtures. Where they differ, ask Chrome directly with CDP `Accessibility.getPartialAXTree({ backendNodeId })`.
3. **Crops stay out of skills.** `ElementDescriptor.crop` (`descriptor.ts:12`) is a data-URL screenshot, and `Locator` has no such field. Keep it that way. The daemon sends the **whole skill** inside every `run.step` (`messages.ts:40`), and messages to Chrome are capped at 1 MB (`framing.ts:7`). Crops belong in the trace, for the agent fallback.

### Echo verification

Recorder bugs show up as replay failures days later, unless you catch them during the demo. Right after describing `el`, resolve your own description and confirm it finds `el` again:

```ts
const unique = (css?: string) => !!css && document.querySelectorAll(css).length === 1 && document.querySelector(css) === el;
// same idea for xpath via document.evaluate; mark the event { echo: true | false }
```

That's the cheap version, in the page. The full version, once Akshat's matcher exists, runs the *real* matcher on the descriptor. A recorder that only emits descriptors which pass echo verification can't produce a skill that fails on an unchanged page.

## So what is the screen recording for?

> *(same question)* *"How the screen recording will capture the objects, clicks, actions?"*

**It can't, and that's why the event recorder exists.** Compare what each one actually sees:

| | Event recorder (content script) | Video of the screen |
|---|---|---|
| Which element was clicked | the element object | a guess from pixels |
| Its role and name | computed | OCR of visible text, if any |
| Hidden inputs, typed values, focus | available (secrets redacted) | invisible |
| Fast double-clicks, keyboard shortcuts | every event | can fall between frames |
| What replay can resolve | DOM targets → deterministic | pixels → a vision model at every step |

The intuition to keep: **video and natural language are the same kind of input. Both carry *intent* without *targets*.** Event recording carries intent *and* targets. So adding video doesn't give you a better recording. It's a different, weaker-for-replay input that joins the natural-language path:

```
event recording   →  trace (intent + targets)  ─────────────────────────────→  compile → skill
natural language  →  intents only   ─┐
video (stretch)   →  VLM → intents  ─┴→  ground each intent on the live page  →  compile → skill
                                         (dry run: matcher/agent finds the element, you confirm)
```

The useful version of video is **alongside** the event trace, not instead of it:

- Record the tab (`chrome.tabCapture`) while capturing events.
- Keep a frame just before and just after each event. These help a human reviewing the skill card, and help the agent fallback when it has to choose.
- Video never writes a target into the skill. The schema enforces the same rule for vision *steps*: `skill.ts:80-83` rejects `channel: "vision"` in a stored skill.

Video-only input needs a vision-language model. Two facts stand in the way today:

- the Nemotron models reportedly served on Token Factory are text-only (**dossier claim**);
- `packages/llm` can only send `content: string` (`llm/index.ts:13`, **from code**).

It's a stretch goal for after the core loop works.

## What capture is NOT

- **Not mouse logging.** No `clientX`/`clientY` is stored. `ElementDescriptor` has no position field, and `Locator`'s comment says *"Never pixel coordinates."* (`skill.ts:19`).
- **Not a DOM snapshot per event.** You describe one element plus a little context. The agent fallback reads a page outline at *replay* time, not record time.
- **Not class-based CSS as the primary locator.** Role and name come first, then label and near, then anchored fallbacks (`design.md:145`).
- **Not the page's own file path.** The browser never gives it to the page. Paths come from the drill or from FSEvents ([05](05-context-layer.md)).
