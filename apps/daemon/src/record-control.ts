// Recording, from the user's side (docs/design.md, "1. Describe" and "2. Record"): the description form comes first,
// then the recording, then Stop turns it into a workflow. Every Record button goes through here: the one in Chrome,
// the desktop one, the menu bar, `record` in the terminal and the window's API, so no recording starts without its
// goal. Only the goal is asked before: the rest is worked out from what is said and shown, or set after Stop.
//
//   idle ──press──▶ the form in Shadow's window (or its questions in the inbox) ──start(form)──▶ recording
//   recording ──stop──▶ compiling (the trace becomes a workflow, its questions wait in the inbox) ──▶ idle
import { randomUUID } from "node:crypto";
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
  // `signal` aborts when the user presses Stop on "Turning your recording into a workflow": the design ends at its next
  // model call, and nothing is saved.
  finish(
    sessionId: string,
    progress: (line: string) => void,
    signal: AbortSignal,
  ): Promise<{ skill: { id: string }; text?: string } | undefined>;
  // Answers a recording's waiting questions with their defaults, so nothing keeps waiting for a design that was stopped.
  dismissQuestions?(sessionId: string): number;
  log: Log;
  // Shadow.app can read and mask pictures. Absent: assumed ready.
  screenReady?(): boolean;
  // Whether Chrome's extension is connected to the daemon: nothing in Chrome is recorded without it. Absent: assumed
  // connected.
  chromeConnected?(): boolean;
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
  // Stop while a recording is becoming a workflow: the design is aborted, its questions dismissed, nothing saved, the
  // recording kept. Nothing to stop (not compiling): {}.
  cancel(sessionId?: string): { sessionId?: string };
  // Turn a kept recording into a workflow again.
  compile(sessionId: string): Promise<void>;
  // A line of what is happening while a recording becomes a workflow, for the Record screen.
  progress(line: string): void;
  subscribe(listener: (event: RecordEvent) => void): () => void;
}

export function createRecordControl(options: RecordControlOptions): RecordControl {
  const { daemon, dataDir, log } = options;
  const listeners = new Set<(event: RecordEvent) => void>();
  let phase: RecordPhase = "idle";
  let sessionId: string | undefined;
  let startedAt: number | undefined;
  let form: RecordForm | undefined;
  let last: RecordingView["last"];
  // Whether Chrome's extension was connected when this recording started (an empty recording says why).
  let chromeAtStart: boolean | undefined;
  // The recordings being turned into workflows (N23): several at once, each with its own feed and Stop, while the
  // Record button is free for the next recording. Before, one at a time: "still turning the last recording into a
  // workflow". `canceller` aborts that one's design (cancel).
  interface Job {
    sessionId: string;
    goal?: string;
    startedAt: number;
    progress: RecordingView["progress"];
    canceller: AbortController;
    chromeAtStart?: boolean;
  }
  const jobs = new Map<string, Job>();
  // The last one's feed, kept until the next, so its lines stay next to "Last recording: …".
  let progress: RecordingView["progress"] = [];

  const view = (): RecordingView => {
    const latest = [...jobs.values()].at(-1);
    return {
      phase,
      sessionId,
      startedAt,
      form,
      consent: readConsent(dataDir),
      last,
      macApp: daemon.mac().connected,
      screenReady: options.screenReady?.() ?? true,
      chromeConnected: options.chromeConnected?.() ?? true,
      progress: latest?.progress ?? progress,
      ...(latest?.canceller.signal.aborted ? { stopping: true } : {}),
      compiling: [...jobs.values()].map((j) => ({
        sessionId: j.sessionId,
        ...(j.goal ? { goal: j.goal } : {}),
        startedAt: j.startedAt,
        progress: j.progress,
        ...(j.canceller.signal.aborted ? { stopping: true } : {}),
      })),
    };
  };
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

  // Chrome's button and Shadow.app say what the recording going on is doing: a job that finishes meanwhile doesn't
  // overwrite "Recording" with its own news.
  const jobStatus = (p: Phase, text: string) => {
    if (phase === "idle") status(p, text);
  };

  async function compile(id: string, chromeWas?: boolean) {
    const controller = new AbortController();
    const job: Job = {
      sessionId: id,
      goal: readForm(dataDir, id)?.goal,
      startedAt: Date.now(),
      progress: [],
      canceller: controller,
      chromeAtStart: chromeWas,
    };
    jobs.set(id, job);
    changed();
    jobStatus("compiling", "Turning your recording into a workflow…");
    const jobProgress = (line: string) => {
      job.progress = [...job.progress, { at: Date.now(), line }].slice(-200);
      changed();
    };
    try {
      const saved = await options.finish(id, jobProgress, controller.signal);
      if (saved) {
        // The recording's folder is deleted a day from now (recording-store.ts).
        writeMeta(dataDir, id, { savedAt: Date.now(), skillId: saved.skill.id, outcome: "saved" });
        log(`replay it with: run ${saved.skill.id}`);
        last = {
          sessionId: id,
          outcome: "saved",
          skillId: saved.skill.id,
          text: saved.text ?? `Saved ${saved.skill.id}`,
        };
        jobStatus("saved", saved.text ?? `Saved ${saved.skill.id}. Replay: run ${saved.skill.id}`);
      } else {
        last = {
          sessionId: id,
          outcome: "empty",
          text:
            job.chromeAtStart === false
              ? "Nothing to save: no steps were recorded. Chrome's extension wasn't connected, so nothing in Chrome was captured: reload it in chrome://extensions and look for \"Chrome: connected\" in the sidebar"
              : "Nothing to save: no steps were recorded",
        };
        jobStatus("empty", last.text);
        deleteRecording(dataDir, id); // nothing worth keeping
      }
    } catch (error) {
      if (controller.signal.aborted) {
        // Stopped by the user: not a failure. Kept like one, so it can be compiled again; the sweep deletes it a day later.
        log("stopped: the workflow was not saved; the recording is kept");
        last = {
          sessionId: id,
          outcome: "cancelled",
          text: "Stopped: nothing was saved. The recording is kept for a day.",
        };
        writeMeta(dataDir, id, { outcome: "cancelled" });
        jobStatus("empty", last.text);
        return;
      }
      const why = error instanceof Error ? error.message : String(error);
      log("compile failed:", why);
      log(`the recording is kept: retry with "compile ${id}"`);
      last = { sessionId: id, outcome: "failed", text: `Could not save it: ${why}` };
      writeMeta(dataDir, id, { outcome: "failed" });
      jobStatus("failed", "Compile failed: see the daemon's log");
    } finally {
      jobs.delete(id);
      progress = job.progress;
      changed();
    }
  }

  const control: RecordControl = {
    view,

    // A line for the newest recording being turned into a workflow (each job gets its own from finish).
    progress(line) {
      const latest = [...jobs.values()].at(-1);
      if (latest) latest.progress = [...latest.progress, { at: Date.now(), line }].slice(-200);
      else progress = [...progress, { at: Date.now(), line }].slice(-200);
      changed();
    },

    press() {
      // Only while the last recording's late events drain, a second or two.
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
        // Only the goal before recording: how often it runs, what changes, what stays and what it must never do are
        // worked out from what is said and shown, or set after Stop (the design agent, the editor).
        phase = "idle";
        control.start({ goal, consent: readConsent(dataDir) });
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
        throw new Error("the last recording is still stopping: try again in a moment");
      }
      if (phase === "recording") throw new Error("already recording: press Stop first");
      const parsed = RecordFormSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      form = parsed.data;
      progress = [];
      saveConsent(dataDir, form.consent);
      // startRecording and writeForm both run before any event is handled, so the folder has its form first.
      sessionId = daemon.startRecording({ consent: form.consent });
      writeForm(dataDir, sessionId, form);
      startedAt = Date.now();
      chromeAtStart = options.chromeConnected?.() ?? true;
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
      phase = "compiling"; // only while late events drain, so a new recording can't start in between
      changed();
      const stopped = await daemon.stopRecording();
      const chromeWas = chromeAtStart;
      // Free for the next recording at once: this one becomes a workflow on its own (N23).
      phase = "idle";
      sessionId = undefined;
      startedAt = undefined;
      form = undefined;
      changed();
      if (stopped) {
        writeMeta(dataDir, stopped, { stoppedAt: Date.now() });
        await compile(stopped, chromeWas);
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

    cancel(id) {
      // That recording's, or the newest one's.
      const job = id ? jobs.get(id) : [...jobs.values()].at(-1);
      if (!job || job.canceller.signal.aborted) return {};
      job.canceller.abort();
      options.dismissQuestions?.(job.sessionId);
      log("stopping: the workflow will not be saved; the recording is kept");
      changed();
      return { sessionId: job.sessionId };
    },

    async compile(id) {
      if (jobs.has(id)) return;
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
