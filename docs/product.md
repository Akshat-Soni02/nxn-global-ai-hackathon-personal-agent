# Shadow, for someone opening it for the first time

> Written 13 Oct 2026. What Shadow is, how to install it, and how to record, test and run your first task. No
> jargon on purpose. The design behind it is [design.md](design.md); the questions people ask are in
> [questions.md](questions.md).

## What it is, in three lines

Shadow learns a task from watching you do it once. From then on it does the task for you: in your browser, in your
Mac apps, with your files. When a website changes, it fixes the task itself and tells you.

## Install

1. Download `Shadow-<version>.dmg` from the latest GitHub Release and open it.
2. Drag **Shadow** to Applications and open it. The first time, right-click → Open (it is signed by us, not by Apple).
3. A setup window appears with three steps:
   - **Your key.** Paste your Nebius Token Factory key and press Save and check. It goes into your Keychain. You
     should see "Connected to Nemotron".
   - **Chrome.** Press Connect Chrome. A Finder window shows the extension folder. In Chrome open
     `chrome://extensions`, turn on Developer mode, press Load unpacked, pick that folder, then open the extension's
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
   it is about. Answer it. The workflow appears under **Workflows**.

## Look at it, change it, walk through it

- Open the workflow. The steps are a tree: browser steps, Mac steps, model steps that read text, loops ("for
  each") and branches ("if"). Steps that send, pay or delete carry an **approval** flag: they will wait for you.
- **Edit** lets you change any step: what it is for, its values, whether it needs your approval; remove or reorder
  steps. Changes are kept as a draft; **Save as v2** makes them the new version. The old one keeps running until
  then.
- **Walk through** runs the workflow one step at a time. Each step's target is outlined on the page or in the app;
  you press Next (a step that only reads or opens a page), Do it (a step that acts), Skip or Stop.
- **Record again** records the same task once more, as the next version, with the form filled in from last time.

## Run it

- **Run now** runs it in a separate Chrome window you can watch. If a step needs your approval, it waits in the
  **Inbox**, with a notification. Press Approve or Deny. It waits as long as needed, even if you close everything.
- To let it run on its own, set its **Frequency** on the workflow's page (every day at…, every Monday, when a file
  appears in a folder…) and press **Go live**. **Pause** stops it starting on its own; Run now still works.
- A workflow that fails three times in a row pauses itself and tells you why.

## When something changes

- A website renames a button or adds a banner: Shadow fixes the step, keeps the fix only when it can see it worked,
  and saves it as a new version. An inbox card says what changed; **Roll back** undoes it in one click.
- Something only you can do (log in, a code by text): the run waits in the inbox. Do it by hand in the automation
  window and press "I did it by hand: go on".
- If Shadow can't fix a step, it asks you to show it: do the step by hand, press go on.

## What stays on your Mac

| Thing | Where | How long |
| --- | --- | --- |
| Your workflows and their versions | `~/Library/Application Support/Shadow/skills/` | Until you delete them |
| What each run did | `…/Shadow/runs/` | Kept (a 30-day limit is planned) |
| The inbox and the runs list | `…/Shadow/shadow.db` | Kept |
| What Shadow remembers from your answers | `…/Shadow/memory.db` | Until you press Forget in Settings |
| A recording's raw files (events, pictures, audio) | `…/Shadow/recordings/<session>/` | Deleted 24 hours after the workflow is saved |
| Your model key | The macOS Keychain | Until you replace it |

What leaves your Mac: text only, to Nebius Token Factory, with your own key: the form, the recorded steps without
secret values, the narration's text, the masked words from screenshots, and for a repair the failed step and an
outline of the page. Pictures leave only if you turn that on, blacked out first. Passwords are never recorded.

## Settings

Shadow in the menu bar → Open Shadow → **Settings**: replace the key, check the connection, the three switches,
connect Chrome again, see and forget what Shadow remembers, and where its files are.

## If something is off

- **Record does nothing.** Shadow's daemon is not running. The menu bar says so and offers Start; it also
  starts by itself within seconds.
- **"No API key".** Settings → paste the key → Save and check.
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
