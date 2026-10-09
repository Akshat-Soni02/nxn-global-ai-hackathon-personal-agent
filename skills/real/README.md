# Real skills

> **Workflow format** (Oct 9): each skill starts with a `trigger` step (when it runs, and its typed inputs), declares a typed `output` on every step that produces a value, and refers to variables as `{{name}}` / `{{name.field}}`. `sort-inbox` uses a loop and branches; none uses llm steps yet.

Five hand-written skills against real, public test sites, used as the replay team's test suite.
Each web target is checked against a saved snapshot of its page by `skills/real/skills.test.ts`.

All local paths live in `~/TaskPlayerTest` (create it with `pnpm seed:sandbox`), never in real folders.
The exception is Chrome's own download folder, `~/Downloads`, which `download-and-file` reads from.

| Skill | Kind | Site | What it exercises |
| --- | --- | --- | --- |
| `upload-test-file` | Mac + Chrome | the-internet.herokuapp.com/upload | file input resolved from disk, `upload` without a native dialog, approval gate, result-page check, `fs.move` afterwards |
| `download-and-file` | Mac + Chrome | selenium.dev downloads page | a click that starts a download, waiting on the filesystem (`since_run_start`, `timeout_ms`), Chrome's ` (1)` suffix, dated rename |
| `hn-digest` | Mac + Chrome | news.ycombinator.com | `extract` over many elements into a text `output`, `fs.write` from that variable, AppleScript (needs Automation permission for TextEdit) |
| `fill-web-form` | Chrome only | selenium.dev web form | text, textarea, `select`, datalist, checkbox, radio, date picker popup + `press Escape`, submit and navigate, input defaults |
| `sort-inbox` | Mac only | none | a **loop** over every inbox file with nested **branches** on its kind, `on_item_fail: skip`, file values moved by `{{file}}`, notification |

**Status (Oct 9):** all five replay end to end with `pnpm replay` (scratch home). Every web target matched with score 1.0; `sort-inbox` sorts each file by its kind through its loop and branches, and leaves files of other kinds in the inbox.

Notes:

- **the-internet's uploads are public**: every uploaded file appears on its `/download` page for anyone. `upload-test-file` only ever sends the seeded `taskplayer-test-*.txt` file.
- **Live pages change.** Hacker News changes hourly (the skill only relies on structure). If a test fails after `pnpm snapshot:pages`, the site changed, which is a useful drift case for the matcher.
- **the-internet.herokuapp.com stalls intermittently**: one of its `<head>` scripts sometimes hangs for 20 s+, so the page never parses. `upload-test-file` retries navigation once.
- Approval-gated steps (`requires_approval`) need an approval in tests too; the test harness should auto-approve.
