# Shadow: the guide

**The source of truth is [`docs/design.md`](../design.md).** If a page here disagrees with it, design.md wins.

## Read these

| Page | What it answers |
| --- | --- |
| [13 · The whole picture](13-the-whole-picture.md) | Which programs run on your Mac (daemon, Shadow.app, extension, native host, window), how they talk, and how one approval travels end to end |
| [14 · Record, replay and AI](14-shadow-end-to-end.md) | What happens when you record a task and when it runs, where the model is used, what is built, which files are created on your Mac, and which code does what |
| [15 · Ten real-life tests](15-test-ideas.md) | Ten everyday tasks to try, in order, with a results table |
| [`examples.md`](../examples.md) | The real workflows the design is measured against |

## Words used everywhere

| Word | Meaning |
| --- | --- |
| Workflow (skill) | A taught task: its description, when it runs, and its steps. Saved as `skills/<id>/vN.json`; each change is a new version |
| Daemon | The always-on background program. Everything goes through it |
| Shadow.app | The Mac app: Record button, menu bar, notifications, the window, and reading Mac apps (Accessibility) |
| Extension | The Chrome extension: records and replays web pages |
| Inbox | Everything that waits for you: approvals, questions, a run that needs help |
| Design agent | Turns a recording into a workflow, after Stop (record side) |
| Repair agent | Fixes a workflow when a site changed, during a run (replay side) |

## Old pages

[`history/`](history/) keeps the guide as it was from 1 to 12 Oct (pages 01–12, the old diagrams, the sprint tracker). They describe the flat-skill flow from before the 8 Oct redesign and are not kept up to date.
