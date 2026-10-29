# Shadow, for someone opening it for the first time

> Written 13 Oct 2026, updated 28 Oct 2026 (Test, the change box, Show me, secrets, apps connected with your own key). What Shadow is, how to
> install it, and how to record, test and run your first task. No jargon on purpose. The design behind it is [design.md](design.md); the questions people ask are in
> [questions.md](questions.md).

## What it is, in three lines

Shadow learns a task from watching you do it once. From then on it does the task for you: in your browser, in your
Mac apps, with your files. When a website changes, it fixes the task itself and tells you.

## Install

1. Download `Shadow.dmg` from the latest GitHub Release (the Download button on the site) and open it.
2. Drag **Shadow** to Applications and open it. The first time macOS stops it (it is signed by us, not notarised by Apple): press **Done**, then in System Settings → Privacy & Security press **Open Anyway**, then **Open Anyway** again and enter your password. Details: [the README](../README.md#opening-an-app-apple-hasnt-verified).
3. A setup window appears with three steps:
   - **Sign in.** Press Sign in. Your browser opens Shadow's sign-in page: use Google or your email. Back in the
     app you should see "Connected to Nemotron". You don't need an API key; Shadow's free tier covers everyday use.
   - **Chrome.** Press Connect Chrome, then Show the extension folder: a Finder window shows it and its path is
     copied. In Chrome open `chrome://extensions`, turn on Developer mode and press Load unpacked. The picker can't
     open Shadow.app by clicking, so press **⌘⇧G**, paste the path
     (`/Applications/Shadow.app/Contents/Resources/extension`), press Return, then Select. Then open the extension's
     Details and turn on "Allow access to file URLs".
   - **Permissions.** Allow Accessibility if you want Mac apps recorded; Screen Recording and Microphone only if you
     want screenshots and narration.
4. Press Open Shadow. From now on Shadow starts when you log in. You start a recording from its window, or from
   Shadow in the menu bar.

## Record your first task

1. Open Shadow and go to **Record** (or Shadow in the menu bar → Record a task). The window opens on the Record screen.
2. Fill in the **goal**: what is done when this task is done. Example: "This week's numbers are in the KPI sheet".
   Everything else is optional: how often it should run, what changes each time, what stays the same, what it must
   never do without asking. Leave them empty if you are not sure.
3. Two switches: a picture of the window at each step (only the words on it leave your Mac; emails, card numbers, keys and any private words you list are masked),
   and your voice while you explain (turned into text on your Mac). Both off is fine.
4. Press **Record**. A red button with a clock appears on your screen, above every app: that is the recording. Do
   the task the way you always do, in Chrome, in a Mac app, in Finder. If you like, say out loud why you choose what you choose: "always the newest one".
5. Press **Stop**. (The trash next to it throws the recording away.)
6. Shadow turns the recording into a workflow. If it is unsure about something, a question appears next to the step
   it is about, while it builds. Answer it and it builds with your answer. You can record the next task meanwhile:
   each recording being turned into a workflow has its own card, with Cancel. The workflow appears under **Workflows**. If the task worked in an app Shadow can connect
   (Google Sheets, Docs, Gmail…), Shadow asks first whether to use it directly (with a Connect button if you haven't
   connected it): say yes and the workflow writes to the app itself instead of clicking through its page. Connect apps
   under **Apps** (see Apps below).
7. Said "never email the client" or "don't touch the archive folder" while recording? It becomes one of the
   workflow's Never rules, like those you type in the form. A password you typed is never recorded: the workflow gets
   a **secret** for it, which you type once on the workflow's page (**Secrets**); it is kept in your Mac's Keychain
   and read only when the workflow runs.

## Look at it, change it, walk through it

- Open the workflow. It is a short list of **blocks**, named in plain words ("Open the jobs page", "Copy the title
  from the page", "Fill in the sheet"); a recording of 33 clicks becomes about 10 blocks. Inside a block are its steps:
  browser steps, Mac steps, connected-app steps, model steps that read text. Loops ("for each") and branches ("if")
  are blocks too. Steps that send, pay or delete carry an **approval** flag: they will wait for you.
- **Click a block** to open its side panel: **Details** says in plain words what it does, what it needs and what it
  makes; **Debug** lists its steps with their technical details. A block with something to check shows an orange count,
  and the panel says what in a sentence.
- Before **Go live** you read what the design changed and press **Looks right**. If the design says "Can't run yet"
  (for example a file the recording shows that no step makes), Go live waits until you fix that: Edit it, or record
  again.
- **Edit** lets you change any step: what it is for, its values, whether it needs your approval; remove or reorder
  steps. **+** adds a step: Open a page, Click, Type, Read from a page, an AI step, Find files, an App action (a field
  for each thing the app asks, with the sheets and documents the workflow already uses to pick from), Ask me, or
  Wait for my OK.
  **Group it** (in a step's panel) puts the next steps in a block, repeats them for each item of a list, or does
  them only if a value is there; **Take the steps out** undoes a block. A workflow saved before blocks shows
  **Tidy up**, which groups it and gives it a short name as a draft you can save or undo. Changes are kept as a draft;
  **Save as v2** makes them the new version. The old one keeps running until then.
- **Test** (on the workflow's page) runs the safe test in the automation window: it opens pages and reads for real,
  and only outlines what would type, click or send. Each block gets a ✓, or the reason it didn't work; **Test this
  block** in a block's panel tests just that part. Use it after any change, before a real run.
- **What would you like to change?** (the box on the workflow's page): write one sentence, "also skip jobs older than
  a week". The design agent changes the workflow and the change appears on the blocks as a draft; nothing runs until
  you save, and Undo takes it back.
- **Show me** (in the "+" menu): when one part is wrong or new, name it, press Start recording, do just that part once,
  and Stop. It becomes a block at that spot, in the draft.
- **Walk through** runs the workflow one step at a time. Each step's target is outlined on the page or in the app;
  you press Next (a step that only reads or opens a page), Do it (a step that acts), Skip or Stop.
- **Record again** records the same task once more, as the next version, with the form filled in from last time.

## Run it

- **Run now** runs it in a separate Chrome window you can watch. If a step needs your approval, it waits in the
  **Inbox**, with a notification. Press Approve or Deny. It waits as long as needed, even if you close everything.
  The run's page shows the blocks in order, each with how it went (done, failed, waiting, skipped); a block that went
  well is folded.
- To let it run on its own, set its **Frequency** on the workflow's page (every day at…, every Monday, when a file
  appears in a folder…) and press **Go live**. **Pause** stops it starting on its own; Run now still works.
- A workflow that fails three times in a row pauses itself and tells you why.

## When something changes

- A website renames a button or adds a banner: Shadow fixes the step, keeps the fix only when it can see it worked,
  and saves it as a new version. An inbox card says what changed, naming the block the step is in; **Roll back**
  undoes it in one click.
- Pop-ups over the page: an "Are you sure?" box is answered yes only in a step you approved (else no, and the run
  says so); the page's print is skipped; a site asking for your location or notifications gets no; a tab the page
  opens is followed. If Chrome asks where to save a download (your Chrome setting "Ask where to save each file"),
  the run says so: choose a place in the automation window and go on, or turn that setting off.
- A step a connected app can do (typing into a sheet's cells, which can't be replayed on the page): if the app isn't
  connected, the inbox offers **Connect**; once it is, the card says "Shadow can fix it", shows what the app's step
  will do, and offers **Use it**. Use it saves that step as the next version and the run goes on.
- If a fix says a step shouldn't be there at all (a detour), it asks you first; if you agree, the run goes on without
  it and the next version drops it. [`reports/changes.md`](../reports/changes.md) lists what else can go wrong.
- Something only you can do (log in, a code by text): the run waits in the inbox. Do it by hand in the automation
  window and press "I did it by hand: go on".
- If Shadow can't fix a step, it asks you to show it: do the step by hand, press go on.

## What stays on your Mac

| Thing | Where | How long |
| --- | --- | --- |
| Your workflows and their versions | `~/Library/Application Support/Shadow/skills/` | Until you delete them |
| What each run did | `…/Shadow/runs/` | 30 days after the run ended (a run waiting for you is kept) |
| The inbox and the runs list | `…/Shadow/shadow.db` | Kept |
| What Shadow remembers from your answers | `…/Shadow/memory.db` | Until you press Forget in Settings |
| A recording's raw files (events, pictures, audio) | `…/Shadow/recordings/<session>/` | Deleted 24 hours after the workflow is saved |
| Your sign-in (a device token, not a password or a key) | The macOS Keychain | Until you sign out |

What leaves your Mac goes through Shadow's own service, which counts it against your free tier and never stores
what you send. To the model (Nebius Token Factory, which keeps nothing), text only: the form, the recorded steps without
secret values, the narration's text, the masked words from screenshots, and for a repair the failed step and an
outline of the page. Pictures leave only if you turn that on, blacked out first. Passwords are never recorded.
To the apps you connect (through Composio, which keeps your sign-in to them): what a step writes or reads there,
such as the row it adds to a sheet.

## Apps and Settings

Shadow in the menu bar → Open Shadow → **Apps** (in the sidebar): connect Google Sheets, Docs, Gmail, Drive,
Calendar, Slack, Notion, GitHub and others, check one works, see what it can do, or disconnect it. You must be signed
in first. Most apps sign you in on their own page; others (search, scraping, data tools) say **Connect with your
key**: paste the app's API key there, and Composio keeps it for your account (your Mac doesn't).

→ **Settings**: your account (sign out), check the connection, **Usage** this month, the switches (including
**Hide emails and ids from the AI**: the design agent then sees them blacked out), connect Chrome again, see and
forget what Shadow remembers, and where its files are. If Chrome is still running an older Shadow extension, the
sidebar says so: reload it in `chrome://extensions`.

## If something is off

- **Record does nothing.** Shadow's daemon is not running. The menu bar says so and offers Start; it also
  starts by itself within seconds.
- **"Not signed in".** Settings → Sign in, and finish in the browser.
- **"Free tier used up".** Settings → Usage shows when it starts again (tomorrow, or next month). Web and Mac-app
  steps still run; AI steps and connected-app steps wait.
- **"Connect Google Sheets first".** A workflow writes to an app you haven't connected: Apps.
- **Chrome: "not connected".** Settings → Connect Chrome, then reload the extension in `chrome://extensions`.
- **Mac apps are not recorded.** System Settings → Privacy & Security → Accessibility → turn Shadow on. After an
  update, turn it off and on again.
- **A run says "interrupted".** The daemon stopped during a step (a restart). Run it again.
- Logs are in `~/Library/Logs/Shadow` (Console.app shows them).

## Questions people ask

- **Does it click things while I am not looking?** Only once a workflow is live with a Frequency, and never a
  sending, paying or deleting step without your approval.
- **Can it reach a site I never used?** No. A repair may not add a new site, a new outward step, or turn an approval
  off.
- **Where is the model?** On Nebius Token Factory: NVIDIA Nemotron 3.5 Lightning for the small reading steps,
  Nemotron 3 Super for understanding a recording and repairing a step, GLM-5.3-Flash only for masked pictures if you
  allow them. Turn on Zero Data Retention on your Token Factory account.
- **Can I see what it did?** Runs → each run, step by step, with what repair did and what the model cost.
