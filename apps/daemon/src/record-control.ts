// Recording, from the user's side (docs/design.md, "1. Describe" and "2. Record"): the description form comes first,
// then the recording, then Stop turns it into a workflow. Every Record button goes through here: the one in Chrome,
// the desktop one, the menu bar, `record` in the terminal and the window's API, so no recording starts without its
// form, and so without its Never list.
//
//   idle ──press──▶ the form in Shadow's window (or its questions in the inbox) ──start(form)──▶ recording
//   recording ──stop──▶ compiling (the trace becomes a workflow, its questions wait in the inbox) ──▶ idle
import { randomUUID } from "node:crypto";
import type { Trigger } from "@shadow/core";
import type { Daemon } from "./daemon.ts";
import {
  deleteRecording,
  type RecordForm,
  type RecordFormInput,
  RecordForm as RecordFormSchema,
  readConsent,
  readForm,
  recordingExists,
  saveConsent,
  writeForm,
  writeMeta,
} from "./recording-store.ts";
import type { Question, RecordingView, RecordPhase } from "./types.ts";

export type { RecordingView, RecordPhase } from "./types.ts";

type Log = (...args: unknown[]) => void;

export type RecordEvent = { type: "recording"; view: RecordingView };

// The button's status line in Chrome and on the desktop (record.status).
type Phase = "compiling" | "question" | "saved" | "empty" | "failed" | "busy" | "form";

export interface RecordControlOptions {
  dataDir: string;
  daemon: Pick<Daemon, "startRecording" | "stopRecording" | "broadcast" | "mac">;
  // A question in the inbox (service.ask): how the form is filled in from the terminal.
  ask(question: Question): Promise<string>;
  // The recording → a saved workflow (record.ts finishRecording). Undefined when nothing was recorded.
  finish(sessionId: string): Promise<{ skill: { id: string } } | undefined>;
  log: Log;
}

export interface RecordControl {
  view(): RecordingView;
  // A Record button was pressed: the form opens in Shadow's window, or, without the app, its questions go to the inbox.
  press(): void;
  // The form as inbox questions (the terminal's `record`).
  describeInInbox(): Promise<void>;
  // The form was sent: recording starts.
  start(form: RecordFormInput): { sessionId: string };
  // Stop: recording ends and is turned into a workflow; resolves once it is saved (or failed).
  stop(): Promise<{ sessionId?: string }>;
  // Discard: recording ends and everything it captured is deleted at once; nothing is compiled or kept.
  discard(): Promise<{ sessionId?: string }>;
  // Turn a kept recording into a workflow again.
  compile(sessionId: string): Promise<void>;
  subscribe(listener: (event: RecordEvent) => void): () => void;
}

// The Frequency choices the terminal offers (the window has the full picker, with any time and a folder).
export const TERMINAL_FREQUENCIES: { label: string; when: Trigger[] }[] = [
  { label: "only when I start it", when: [{ type: "manual" }] },
  { label: "every hour", when: [{ type: "schedule", cron: "0 * * * *", missed: "run_once" }] },
  { label: "every day at 9:00", when: [{ type: "schedule", cron: "0 9 * * *", missed: "run_once" }] },
  { label: "weekdays at 9:00", when: [{ type: "schedule", cron: "0 9 * * 1-5", missed: "run_once" }] },
  { label: "every Monday at 9:00", when: [{ type: "schedule", cron: "0 9 * * 1", missed: "run_once" }] },
  { label: "on the 1st of every month at 9:00", when: [{ type: "schedule", cron: "0 9 1 * *", missed: "run_once" }] },
];

export function createRecordControl(options: RecordControlOptions): RecordControl {
  const { daemon, dataDir, log } = options;
  const listeners = new Set<(event: RecordEvent) => void>();
  let phase: RecordPhase = "idle";
  let sessionId: string | undefined;
  let startedAt: number | undefined;
  let form: RecordForm | undefined;
  let last: RecordingView["last"];

  const view = (): RecordingView => ({
    phase,
    sessionId,
    startedAt,
    form,
    consent: readConsent(dataDir),
    last,
    macApp: daemon.mac().connected,
  });
  const changed = () => {
    const event: RecordEvent = { type: "recording", view: view() };
    for (const listener of listeners) listener(event);
  };
  const status = (p: Phase, text: string) =>
    daemon.broadcast({ id: randomUUID(), type: "record.status", phase: p, text });
  const busy = () => {
    log("still turning the last recording into a workflow; answer its questions first");
    status("busy", "Still compiling the last recording: answer its questions first");
  };

  async function compile(id: string) {
    phase = "compiling";
    sessionId = id;
    form ??= readForm(dataDir, id);
    changed();
    status("compiling", "Turning your recording into a workflow…");
    try {
      const saved = await options.finish(id);
      if (saved) {
        // The recording's folder is deleted a day from now (recording-store.ts).
        writeMeta(dataDir, id, { savedAt: Date.now(), skillId: saved.skill.id, outcome: "saved" });
        log(`replay it with: run ${saved.skill.id}`);
        last = { sessionId: id, outcome: "saved", skillId: saved.skill.id, text: `Saved ${saved.skill.id}` };
        status("saved", `Saved ${saved.skill.id}. Replay: run ${saved.skill.id}`);
      } else {
        last = { sessionId: id, outcome: "empty", text: "Nothing to save: no steps were recorded" };
        status("empty", last.text);
        deleteRecording(dataDir, id); // nothing worth keeping
      }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      log("compile failed:", why);
      log(`the recording is kept: retry with "compile ${id}"`);
      last = { sessionId: id, outcome: "failed", text: `Could not save it: ${why}` };
      writeMeta(dataDir, id, { outcome: "failed" });
      status("failed", "Compile failed: see the daemon's log");
    } finally {
      phase = "idle";
      sessionId = undefined;
      startedAt = undefined;
      form = undefined;
      changed();
    }
  }

  const control: RecordControl = {
    view,

    press() {
      if (phase === "compiling") return busy();
      if (phase === "recording") {
        daemon.startRecording(); // already recording: says so again, so every button shows it
        return;
      }
      if (daemon.mac().connected) {
        // Shadow.app opens its window on the Record screen when it sees this status.
        status("form", "Fill in the form in Shadow to start recording");
        return;
      }
      if (phase === "describing") return;
      void control.describeInInbox();
    },

    async describeInInbox() {
      if (phase !== "idle") return phase === "compiling" ? busy() : undefined;
      phase = "describing";
      changed();
      status("question", "Answer in Shadow: what is this task for?");
      try {
        const goal = (await options.ask({ title: "Record a task. What is done when it is done? (the goal)" })).trim();
        if (!goal) {
          log("not recording: the goal is required");
          status("empty", "Not recording: the goal is required");
          return;
        }
        const labels = TERMINAL_FREQUENCIES.map((f) => f.label);
        const frequency = pick(
          await options.ask({ title: "How often should it run?", options: labels, default: labels[0] }),
          labels,
        );
        const changes = await options.ask({
          title: "What changes each run? (comma-separated, e.g. the email, the amount; Enter for nothing)",
        });
        const constants = await options.ask({
          title: "What stays the same? (comma-separated, e.g. the KPI 2026 sheet; Enter for nothing)",
        });
        const never = await options.ask({
          title: "What must it never do without asking? (comma-separated, e.g. send, delete; Enter for nothing)",
        });
        phase = "idle";
        control.start({
          goal,
          when: TERMINAL_FREQUENCIES[frequency]?.when,
          changes: split(changes),
          constants: split(constants),
          never: split(never),
          consent: readConsent(dataDir),
        });
      } finally {
        if (phase === "describing") {
          phase = "idle";
          changed();
        }
      }
    },

    start(input) {
      if (phase === "compiling") {
        busy();
        throw new Error("still turning the last recording into a workflow: answer its questions first");
      }
      if (phase === "recording") throw new Error("already recording: press Stop first");
      const parsed = RecordFormSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      form = parsed.data;
      saveConsent(dataDir, form.consent);
      // startRecording and writeForm both run before any event is handled, so the folder has its form first.
      sessionId = daemon.startRecording({ consent: form.consent });
      writeForm(dataDir, sessionId, form);
      startedAt = Date.now();
      phase = "recording";
      log(`recording "${form.goal}"`);
      changed();
      return { sessionId };
    },

    async stop() {
      if (phase !== "recording") {
        if (phase === "compiling") busy();
        return {};
      }
      phase = "compiling"; // covers the wait for late events too, so a new recording can't start in between
      changed();
      const stopped = await daemon.stopRecording();
      if (stopped) writeMeta(dataDir, stopped, { stoppedAt: Date.now() });
      if (stopped) await compile(stopped);
      else {
        phase = "idle";
        changed();
      }
      return { sessionId: stopped };
    },

    async discard() {
      if (phase !== "recording") {
        if (phase === "compiling") busy();
        return {};
      }
      phase = "compiling"; // no new recording while late events drain
      changed();
      const stopped = await daemon.stopRecording();
      if (stopped) deleteRecording(dataDir, stopped);
      last = stopped ? { sessionId: stopped, outcome: "empty", text: "Recording discarded: nothing was kept" } : last;
      phase = "idle";
      sessionId = undefined;
      startedAt = undefined;
      form = undefined;
      changed();
      status("empty", "Recording discarded");
      log("recording discarded: its folder is gone");
      return { sessionId: stopped };
    },

    async compile(id) {
      if (phase !== "idle") return busy();
      if (!recordingExists(dataDir, id)) {
        log(`no recording ${id}: a recording is deleted a day after Stop, or a day after its workflow is saved`);
        return;
      }
      await compile(id);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return control;
}

const split = (text: string): string[] =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// An answer by number ("2") or by label; anything else is the first choice.
function pick(answer: string, labels: string[]): number {
  const text = answer.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    const n = Number(text) - 1;
    return n >= 0 && n < labels.length ? n : 0;
  }
  const found = labels.findIndex((l) => l.toLowerCase() === text);
  return found >= 0 ? found : 0;
}
