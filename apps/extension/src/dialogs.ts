// What to do when a page opens its own dialog (alert, confirm, prompt, "Leave this page?") while a step runs. Nothing
// listened for them before: the page froze behind the dialog, the step timed out ("did not answer"), and repair saw a
// frozen page. Now every dialog is answered at once, so a run never hangs behind one:
//  - alert and "Leave this page?" only inform: accepted.
//  - a confirm or prompt is a question. In a step the user approved (a Delete, a Send) it is part of that act, so it is
//    accepted; anywhere else nothing says what to answer, so it is dismissed and the step fails with the page's words,
//    for the user to answer by hand ("the page asked …"), rather than the run guessing yes to "Delete 3 items?".
// The CDP event itself (Page.javascriptDialogOpening) is wired in replay.ts; this is the part that decides.

export interface PageDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultPrompt?: string;
}
export interface DialogAnswer {
  accept: boolean;
  promptText?: string;
  // A question nobody could answer: it was dismissed, and the step must say so.
  unanswered?: true;
}

export function answerDialog(dialog: PageDialog, step: { approved: boolean }): DialogAnswer {
  if (dialog.type === "alert" || dialog.type === "beforeunload") return { accept: true };
  if (!step.approved) return { accept: false, unanswered: true };
  return dialog.type === "prompt" ? { accept: true, promptText: dialog.defaultPrompt ?? "" } : { accept: true };
}

// The dialogs each tab's current step met, kept until the step ends and takes them.
export class DialogLog {
  private byTab = new Map<number, { dialog: PageDialog; answer: DialogAnswer }[]>();
  add(tabId: number, dialog: PageDialog, answer: DialogAnswer): void {
    this.byTab.set(tabId, [...(this.byTab.get(tabId) ?? []), { dialog, answer }]);
  }
  take(tabId: number): { dialog: PageDialog; answer: DialogAnswer }[] {
    const seen = this.byTab.get(tabId) ?? [];
    this.byTab.delete(tabId);
    return seen;
  }
}

// The failure a step reports when a question went unanswered (undefined: nothing to report).
export function dialogProblem(seen: { dialog: PageDialog; answer: DialogAnswer }[]): string | undefined {
  const asked = seen.find((s) => s.answer.unanswered);
  if (!asked) return undefined;
  return `the page asked "${asked.dialog.message.slice(0, 200)}" (${asked.dialog.type}) and nothing says what to answer: answer it by hand in the automation window, then go on`;
}
