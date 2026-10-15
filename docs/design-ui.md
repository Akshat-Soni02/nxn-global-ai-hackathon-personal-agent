# Shadow: look, feel and name

> Written 13 Oct 2026. How Shadow looks and moves, and why. The rules come from Apple's Human Interface Guidelines
> and the WWDC talks on fluid interfaces; the tokens below are what the code uses (`apps/ui/src/styles.css`,
> `apps/mac/Sources/Pill.swift`, `apps/website/src/styles.css`).

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
the repo ships no image files; the website carries the same mark as an SVG (`apps/website/public/mark.svg`).

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
- **Pill.** The floating button (`Pill.swift`): 40 pt tall, a capsule; the record dot alone when idle; red with the
  stop square, the clock, mic and camera marks and the trash while recording; dark with an icon and one line
  otherwise. Dragged anywhere, its place remembered.
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

One page, `apps/website`: a hero with the window and the pill shown half cut, the three parts (Record, Understand,
Run) each with one still of the product and one sentence, a privacy section that repeats the consent promises word
for word, the download (the latest GitHub Release .dmg and the extension zip), and the Nemotron / Token Factory
note. Animations are GSAP with ScrollTrigger on a static prototype: the pill starts recording, steps appear in the
tree, an approval card gets its Approve, a repair lands as v2. They respect reduced motion.
