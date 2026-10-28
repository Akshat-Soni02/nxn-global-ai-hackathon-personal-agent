# Shadow: look, feel and name

> Written 13 Oct 2026. How Shadow looks and moves, and why. The rules come from Apple's Human Interface Guidelines
> and the WWDC talks on fluid interfaces; the tokens below are what the code uses (`apps/ui/src/styles.css`,
> `apps/mac/Sources/Pill.swift`, `apps/website/app/globals.css`).

## What premium means here, in five rules

1. **Respond on the press, not the release.** Every button changes the instant it is pressed (a 97% scale, 120 ms).
   Nothing waits for a round trip to look pressed.
2. **One accent, used rarely.** Shadow blue marks the one thing to do next on a screen: Approve, Start recording,
   Save. Everything else is grey, white or black. A screen with three blue buttons has no next step.
3. **Quiet surfaces, real depth.** The sidebar is a translucent material over the content, not a flat panel. Cards sit
   on the page with one soft shadow, never a border and a shadow. Light and dark are both designed, not inverted.
4. **Motion that can be interrupted.** Transitions are short (120 to 320 ms) and ease out, so the next action never
   waits for the last animation. With "Reduce motion" on, they become cross-fades.
5. **Words a person would say.** No jargon on a screen: "Waiting for you", "Do it", "Walk through", "Forget". The
   system font, sized by role, with tighter tracking as text gets bigger.

## The name

Three candidates were weighed. Keep **Shadow**.

| Name | For | Against |
| --- | --- | --- |
| **Shadow** (keep) | A verb and a noun: to shadow someone at work is to learn by watching, then do the job. One syllable; reads well in a menu bar; already the app's id, data folder and Chrome extension name, so nothing to rename mid-sprint | Common word; "shadow IT" and "shadow mode" exist |
| Understudy | The exact metaphor: watches the lead, steps in when needed | Three syllables; awkward as a menu bar name and a verb ("understudy this task") |
| Echo | Repeats what it heard | Taken (Amazon Echo), and an echo is dumber than what Shadow does: it understands, it doesn't repeat |

**Tagline:** *Show it once.* The brand is the name plus the mark; the code, the bundle id (`com.shadow.mac`) and
the folders stay as they are. If a different brand name is ever chosen, it is used on the website and the wordmark
only (decided 13 Oct: no rename in code).

## The mark

A crisp white dot and the soft blue shadow it casts, on a night-blue rounded square. The dot is the record button;
the shadow is what follows it and does the work. It is drawn by the app itself (`Shadow --icon`, `Icon.swift`), so
the app ships no image files; the website carries the same mark as an SVG (`apps/website/public/mark.svg`) and, for
browser tabs and installs, a small icon set drawn from the same geometry by `apps/website/scripts/icons.py`
(`favicon.ico` 16/32/48, `apple-touch-icon.png`, `icon-192/512.png`, a maskable 512, and `icon.svg`, wired in
`app/layout.tsx` and `manifest.webmanifest`). Each has a 1 px light rim (#7F86B8): the night square is only ~1.2:1
against a dark tab strip or a night bar, and the rim lifts it to ~5.4:1. On the page the rim is a token
(`--mark-rim`), transparent over light bands and set only on the bar and its sheet when they are over night.

- Icon: 1024 pt rounded square, corner radius 22.37% (Apple's template), gradient #242642 → #0D0D17, dot at
  (47%, 53%) radius 19%, blue shadow offset (+9%, −9%) with a 12% blur, red record dot inside at 34% of the dot.
- In the menu bar: the system symbol `circle.lefthalf.filled`, a template image so it follows the bar's colour.
- Wordmark: "Shadow" in SF Pro Display, semibold, tracking −0.02 em, next to the mark at 0.8 of its height.

## Tokens

Colours, light and dark. Dark is its own palette (deeper, less saturated), not an inversion.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--bg` | #F5F5F7 | #0B0B0F | The page |
| `--surface` | #FFFFFF | #151519 | Cards, inputs, the content column |
| `--text` | #1D1D1F | #F5F5F7 | Text |
| `--muted` | #6E6E73 | #9A9AA3 | Secondary text, labels |
| `--line` | rgba(0,0,0,.08) | rgba(255,255,255,.1) | Hairlines |
| `--accent` | #3A5BD9 | #6C8CFF | The one next action, focus rings, the walk-through outline |
| `--ok` / `--bad` / `--wait` | #1F8A4C / #C92A2A / #B35C00 | #4FD18B / #FF6B6B / #FFB054 | Done, failed, waiting for you |
| `--rec` | #EF4444 | #EF4444 | The record dot, the recording pill |

Type: the system font (`-apple-system`, SF Pro). Sizes by role, with tracking that tightens as size grows:

| Role | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| Display (website hero) | 56 / 1.05 | 700 | −0.03 em |
| Title (page) | 24 / 1.15 | 600 | −0.02 em |
| Heading (section) | 15 / 1.3 | 600 | −0.01 em |
| Body | 14 / 1.45 | 400 | 0 |
| Caption | 12 / 1.4 | 400 | +0.01 em |
| Mono (ids, paths) | 12 | 400 | 0 |

Spacing on a 4 pt grid: 4, 8, 12, 16, 24, 32, 48. Radii: 6 (chips), 10 (buttons, inputs), 14 (cards), 18
(panels), full (the pill). Shadows: cards `0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.06)`; the pill
`0 8px 24px rgba(0,0,0,.35)`. Materials: the sidebar is `--bg` at 72% over a 20 px blur with 180% saturation. It folds to a 56 px strip of icons (the toggle stays at the top-left; remembered on the Mac; always the strip below 760 px), the Inbox count on its icon and the health dots kept, their words in tooltips.

Motion: `--ease: cubic-bezier(.2,.8,.2,1)` (eases out: fast start, soft landing). Press 120 ms, hover 200 ms,
enter 320 ms. The pill's shape change is a critically damped spring (response 0.35, damping 1.0). Reduced motion
turns slides and springs into 150 ms opacity cross-fades.

## The components

- **Button.** Primary (accent fill, white text), secondary (surface, hairline), danger (red text, red fill once
  armed), link (text only). A press scales to 97%. A destructive action asks again on the same button ("Stop the
  run?"), never in a dialog.
- **Chip.** Status in a word: Done, Failed, Waiting for you, Live, Paused, Draft. Tinted background, no border.
- **Card.** One inbox item: a kind label, the title, the answers as buttons, a link to the run. The left edge carries
  the kind's colour, 3 px.
- **Tree.** Steps as an outline: the kind in small caps, what the step is for, its id in mono, flags for approval
  and questions. Loops and branches indent their steps behind a hairline. The step a question is about is outlined
  in the accent.
- **Pill.** The floating button (`Pill.swift`): 40 pt tall, a capsule; red with the stop square, the clock, mic and
  camera marks and the trash while recording; dark with an icon and one line while the recording is compiled, asks
  and is saved. It shows only for a recording: it fades in, already recording, when one starts, and fades out once
  the saved note is over (Reduce Motion: at once). Dragged anywhere, its place remembered.
- **Form field.** Label above, placeholder that says why the field matters ("e.g. the email, the numbers"), full
  width on the record form.
- **Consent switch.** A checkbox with the whole promise in plain words next to it. Never a one-word label.

## The screens

| Screen | Before | Now |
| --- | --- | --- |
| Inbox | Cards with a left border | The same cards on the token system: kind colour on the edge, one next action in the accent, a walk-through card with Do it / Next, Skip, Stop |
| Workflows | A table | A table with the state chip first, Frequency and next run in one cell, Run now on the row |
| Workflow | Steps, versions, runs | Plus Walk through, Edit (the draft editor inline), Record again |
| Editor | "No step picked" in the panel | The workflow as the same tree as on its page, scaled down to fit (to 75%, then it scrolls); the picked step is changed in a panel on the right that stays put while the tree scrolls (a sheet at the bottom when the window is narrow): what it is for, approval, its fields, move up or down, remove; Esc puts it down; undo, redo, discard, Save as v(n+1); the daemon's reason when a change is refused |
| Record | The form | The form with the three consents in plain words, Record again prefilled, Discard while recording |
| Settings | None | The key (write-only), a connection check, the consents, Chrome, memory, where things are |
| Menu bar | Counts and health | Plus "Shadow is not running · Start" |
| First run | None | Three steps in one window: key, Chrome, permissions |

## Accessibility

- Every control has a name; the pill and the step rows carry `accessibilityLabel` / `aria-label`.
- Focus is visible: a 2 px accent ring, 2 px out, on `:focus-visible`.
- Colour is never the only signal: a chip has a word, a dot has a label.
- `prefers-reduced-motion`, `prefers-reduced-transparency` (the sidebar goes solid) and `prefers-contrast`
  (hairlines darken) are honoured in the window and on the website.

## The website

Five pages in `apps/website` (Next.js, App Router, a static export to `out/`; no server, no web fonts, no images): the
product is drawn in HTML so it stays sharp and can move.

| Page | What it holds |
| --- | --- |
| Overview `/` | Night hero ("Show it once. It does the rest."), the window with its inbox and a workflow, the Record pill in front; three promises; the scroll story; privacy in four lines; four use cases; the models; the closing download |
| How it works | Eight moments, each beside the part of the app where it happens: goal box, Record pill, workflow tree, question card, editor panel, walk-through, approval, repair |
| Use cases | KPI email → sheet, Downloads filed, YC jobs picked, a Hacker News digest: what you do once, what Shadow does every time, the steps; then good at / not yet |
| Privacy | The four promises, masking shown on a line of screen text, what stays on the Mac and for how long, what leaves (text only) and what never does, the controls |
| Download | The .dmg (`releases/latest`, so it works once `pnpm release` has run), what you need, the three setup steps, quick fixes, the questions, building from source |

- **Bands, not boxes.** Each page opens and closes on night (`#0B0C1A`, the dot and its blue shadow); the middle
  alternates light (`#F5F5F7`) and white. The bar at the top is a translucent material that takes the tone of the
  band under it. One accent, Shadow blue, for the next action only.
- **Type** (Apple's product pages): hero 48 → 96 px / 1.04, −0.015 em; headline 32 → 56 / 1.07; eyebrow 17 → 21
  semibold; lead 19 → 24 / 1.33; body 17 / 1.47, −0.022 em; footer 12. The system font.
- **Motion** (GSAP + ScrollTrigger through `@gsap/react`): reveals rise 24 px and fade in once; the hero's shadow
  slides out from under the dot and the window settles flat as the page scrolls (scrubbed); on wide screens the
  Overview pins a story the scroll plays: the pill records, the workflow builds, an approval is approved, a repair
  lands as v2. Phones get the finished story without pinning; Reduce Motion shows everything at once; without
  scripts nothing is hidden (`html.js`, set before first paint, gates the hidden start).
- **The window's glow** (28 Oct; `AiRim.tsx`): an iridescent rim (cyan, magenta, amber, violet) turns round the
  Overview's hero window with a blurred bloom behind it, after Apple Intelligence. It fades in when the page loads,
  breathes in opacity only (one cycle per 4 s, nothing scales), and at the first scroll, wheel, touch or key it
  dissolves into the page on a critically damped spring (`spring.ts`: Apple's damping and response as a GSAP ease).
  Still with Reduce Motion or a slow display; no bloom with Reduce Transparency; paused off screen. **This is the
  one place colour leaves the single accent.** There is no first-visit intro: a cinematic opening was built on 28 Oct
  and removed the same day as not needed.
- TypeScript 6 for this app only: Next 16.3 needs TypeScript's JS API, which TypeScript 7 (the repo's) no longer has.
