// Record a task (docs/design.md, "1. Describe" and "2. Record"): one goal box first, then the recording, then Stop
// turns it into a workflow, and its questions are answered here. Every Record button (Chrome, the desktop, the menu
// bar) opens this screen; recording starts only when the goal is sent. Only the goal is asked before: how often it
// runs, what changes, what stays and what it must never do come from what you say and show while recording, and
// anything still unclear is asked after Stop.
import type { Skill, Trigger } from "@shadow/core";
import type { InboxItem, RecordingView } from "@shadow/daemon/src/types.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";
import { chromeWarning, progressOf, questionsFor, signInFirst, waitingNote } from "../questions.ts";
import { savedSince } from "../review.ts";

// `again`: a workflow's id, to record that task again: the box starts filled in from it, and the recording becomes
// the workflow's next version (same id, Frequency and state).
export function Record({ again }: { again?: string }) {
  // Looked at again now and then: Chrome connecting (after you reload the extension) announces nothing, so the warning
  // above the goal box would stay until something else changed.
  const { data, error } = useQuery<RecordingView>("recording", {}, { everyMs: 4_000 });
  const inbox = useQuery<InboxItem[]>("inbox", { open: true });
  // After Stop, the workflow it saved opens (H24): only one saved since this screen opened. `seen` is the last
  // recording when the screen first had its data (null until then), so an older one never opens.
  const seen = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (!data) return;
    if (seen.current === null) {
      seen.current = data.last?.sessionId;
      return;
    }
    const saved = savedSince(seen.current, data.last);
    // Not while you are recording the next one (N23): that one's screen stays.
    if (saved && data.phase === "idle") location.hash = `#/workflows/${saved}`;
  }, [data]);
  if (!data) return <Loading error={error} />;
  // Questions outside a run: the form's (from the terminal) and the ones about this recording. They are answered in the
  // Inbox, not here: this screen shows what is happening, so you aren't left in the dark, and points there (W2).
  // The questions of every recording being turned into a workflow (N23), and of the one going on.
  const jobs = data.compiling ?? [];
  const sessions = [...jobs.map((j) => j.sessionId), ...(data.phase === "idle" ? [] : [data.sessionId])];
  const asked = new Set(sessions.flatMap((id) => questionsFor(inbox.data ?? [], id).map((q) => q.id)));
  const waiting = waitingNote(sessions.length === 0 ? 0 : asked.size);

  return (
    <>
      <header className="page-header">
        <h1>{again ? "Record it again" : "Record a task"}</h1>
        <p className="muted">
          {again
            ? "Do the task once more: it becomes this workflow's next version."
            : "Do the task once while Shadow watches. Say how often and any rules as you go."}
        </p>
      </header>
      {data.phase === "idle" ? (
        again ? (
          <AgainForm
            again={again}
            consent={data.consent}
            last={data.last}
            screenReady={data.screenReady}
            chrome={data.chromeConnected}
            feed={progressOf(data)}
          />
        ) : (
          <GoalBox
            consent={data.consent}
            last={data.last}
            screenReady={data.screenReady}
            chrome={data.chromeConnected}
            feed={progressOf(data)}
          />
        )
      ) : null}
      {data.phase === "describing" ? <p>Answer in the Inbox (or in the terminal) to start recording.</p> : null}
      {data.phase === "recording" ? <Recording view={data} /> : null}
      {data.phase === "compiling" ? <p className="muted">Stopping the recording…</p> : null}
      {jobs.map((job) => (
        <Compiling key={job.sessionId} job={job} />
      ))}
      {waiting ? (
        <p className="notice">
          {waiting} <a href="#/inbox">Open the Inbox</a>
        </p>
      ) : null}
    </>
  );
}

// While a recording becomes a workflow: what is happening, and a Stop (W1). Stop ends the design at its next model call,
// saves nothing and keeps the recording for a day; a new recording can start at once.
// One recording being turned into a workflow (N23: there may be several, while you record the next).
type Job = NonNullable<RecordingView["compiling"]>[number];
function Compiling({ job }: { job: Job }) {
  const session = useSession();
  return (
    <section className="section">
      <h2>Turning your recording into a workflow…</h2>
      <p className="muted">{job.goal}</p>
      {job.progress.length > 0 ? (
        <ol className="progress-feed" aria-live="polite">
          {job.progress.map((p) => (
            <li key={`${p.at}-${p.line}`}>{p.line}</li>
          ))}
        </ol>
      ) : null}
      <div className="answers">
        {job.stopping ? (
          <button type="button" className="button" disabled>
            Stopping…
          </button>
        ) : (
          <Action
            kind="danger"
            confirm="Stop? Nothing will be saved; the recording is kept for a day."
            run={() => session.call("recordCancel", { sessionId: job.sessionId })}
          >
            Stop
          </Action>
        )}
      </div>
    </section>
  );
}

function Recording({ view }: { view: RecordingView }) {
  const session = useSession();
  const since = view.startedAt ?? Date.now();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <section className="section recording">
      <h2>
        <span className="dot rec" /> Recording · {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
      </h2>
      <p>
        <strong>{view.form?.goal}</strong>
      </p>
      <p className="muted">
        Do the task now, the way you always do, in Chrome or any Mac app.
        {view.form?.consent.microphone
          ? " Say out loud what you're doing and why: how many, which ones you skip, where each value goes."
          : ""}{" "}
        Press Stop when it is done.
      </p>
      <div className="answers">
        <Action kind="primary" run={() => session.call("recordStop")}>
          Stop
        </Action>
        <Action kind="danger" confirm="Throw this recording away?" run={() => session.call("recordDiscard")}>
          Discard
        </Action>
      </div>
    </section>
  );
}

// The box filled in from the workflow being recorded again.
function AgainForm({
  again,
  consent,
  last,
  screenReady,
  chrome,
  feed,
}: {
  again: string;
  consent: RecordingView["consent"];
  last: RecordingView["last"];
  screenReady?: boolean;
  chrome?: boolean;
  feed: RecordingView["progress"];
}) {
  const workflow = useQuery<{ id: string; versions: number[]; latest: Skill } | null>("workflow", { id: again });
  if (workflow.data === null) return <p className="error">No workflow {again}.</p>;
  if (!workflow.data) return <Loading error={workflow.error} />;
  const { latest } = workflow.data;
  const trigger = latest.steps.find((s) => s.type === "trigger");
  const when = trigger?.type === "trigger" ? trigger.when : [];
  return (
    <>
      <p className="muted small">
        <a href={`#/workflows/${again}`}>{latest.name}</a> · v{latest.version} now; this recording becomes v
        {latest.version + 1}.
      </p>
      <GoalBox
        consent={consent}
        last={last}
        screenReady={screenReady}
        chrome={chrome}
        feed={feed}
        again={again}
        initial={{ ...latest.description, when: when.find((t) => t.type !== "manual") ?? when[0] }}
      />
    </>
  );
}

interface Initial {
  goal: string;
  changes: string[];
  constants: string[];
  never: string[];
  when?: Trigger;
}

function GoalBox({
  consent,
  last,
  screenReady,
  chrome,
  feed,
  again,
  initial,
}: {
  consent: RecordingView["consent"];
  last: RecordingView["last"];
  screenReady?: boolean;
  chrome?: boolean;
  feed: RecordingView["progress"];
  again?: string;
  initial?: Initial;
}) {
  const session = useSession();
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [screen, setScreen] = useState(consent.screen);
  const [microphone, setMicrophone] = useState(consent.microphone);
  const [pictures, setPictures] = useState(consent.pictures);
  // Names and codes to hide from the model (optional, folded): masked like the Never words.
  const [privateWords, setPrivateWords] = useState("");
  // Only the goal before recording. How often it runs, what changes, what stays and what it must never do come from
  // what is said and shown, and are set after Stop (the design agent, the editor). Recorded again: what the workflow
  // already says stays as it is.
  const start = () =>
    session.call("recordStart", {
      goal,
      ...(initial
        ? {
            when: initial.when ? [initial.when] : undefined,
            changes: initial.changes,
            constants: initial.constants,
            never: initial.never,
          }
        : {}),
      consent: { screen, microphone, pictures: screen && pictures, identifiers: consent.identifiers ?? false },
      private: privateWords
        .split(/[,\n]/)
        .map((w) => w.trim())
        .filter(Boolean),
      ...(again ? { again } : {}),
    });

  // Signed in or not, and the code while the browser page is open: looked at every two seconds, as the Inbox does.
  const settings = useQuery<{
    account: { signedIn: boolean; apiUrl?: string; pending?: { userCode: string } };
    key: { present: boolean };
  }>("settings", {}, { everyMs: 2000 });
  const mustSignIn = signInFirst(settings.data);
  const pending = settings.data?.account.pending;
  const noChrome = chromeWarning(chrome);
  return (
    <>
      {mustSignIn ? (
        <div className="notice sign-in">
          <p>
            <b>Sign in to Shadow first.</b> Shadow turns what you record into a workflow with NVIDIA Nemotron, through
            your Shadow account: no API key needed.
          </p>
          <Action kind="primary" run={() => session.call("signIn").then(() => settings.reload())}>
            {pending ? `Finish signing in (code ${pending.userCode})` : "Sign in with Google"}
          </Action>
        </div>
      ) : null}
      {noChrome ? (
        <p className="notice warn">
          {noChrome} <a href="#/settings">Open Settings</a>
        </p>
      ) : null}
      {last ? (
        <p className={last.outcome === "failed" ? "error" : "muted"}>
          Last recording: {last.text}
          {last.skillId ? (
            <>
              {" "}
              · <a href={`#/workflows/${last.skillId}`}>open it</a>
            </>
          ) : null}
        </p>
      ) : null}
      {/* What happened while it was turned into a workflow stays here after it ends: it was gone the moment it was needed. */}
      {last && feed.length > 0 ? (
        <details className="last-feed">
          <summary>What happened</summary>
          <ol className="progress-feed">
            {feed.map((p) => (
              <li key={`${p.at}-${p.line}`}>{p.line}</li>
            ))}
          </ol>
        </details>
      ) : null}

      <form className="goalbox" onSubmit={(e) => e.preventDefault()}>
        <textarea
          className="goalbox-text"
          rows={3}
          value={goal}
          aria-label="What should Shadow learn?"
          placeholder="What should Shadow learn? e.g. Every morning, add the 5 newest YC jobs to my Ycomb jobs sheet, skipping companies already in it"
          onChange={(e) => setGoal(e.target.value)}
        />
        <div className="goalbox-bar">
          <span className="goalbox-space" />
          <Toggle on={screen} onChange={setScreen} label="Read the words on my screen" icon="screen" />
          <Toggle on={microphone} onChange={setMicrophone} label="Hear my voice" icon="mic" />
          <Toggle
            on={screen && pictures}
            disabled={!screen}
            onChange={setPictures}
            label="Let the model see masked pictures"
            icon="picture"
          />
          {mustSignIn ? (
            <button type="button" className="button primary" disabled title="Sign in to Shadow first">
              <span className="dot rec" /> {again ? "Record again" : "Record"}
            </button>
          ) : (
            <Action kind="primary" run={start}>
              <span className="dot rec" /> {again ? "Record again" : "Record"}
            </Action>
          )}
        </div>
        <details className="goalbox-private">
          <summary>Private words (optional)</summary>
          <input
            type="text"
            value={privateWords}
            onChange={(e) => setPrivateWords(e.target.value)}
            aria-label="Private words"
            placeholder="Names or codes to hide from the model, comma-separated: Project Falcon, ACME-2231"
          />
        </details>
      </form>

      <p className="muted small goalbox-note">{consentNote(screen, microphone, screen && pictures)}</p>
      {screen && screenReady === false ? (
        <p className="error small">
          Pictures can't be read right now: Shadow.app needs updating (download the latest version, or pnpm setup:mac
          from the repository). The words on your screen won't be recorded until it is.
        </p>
      ) : null}
    </>
  );
}

// What leaves the Mac, in one sentence, for the switches as they are.
function consentNote(screen: boolean, microphone: boolean, pictures: boolean): string {
  const senses = [screen ? "read the words on your screen (private ones hidden)" : "", microphone ? "hear you" : ""]
    .filter(Boolean)
    .join(" and ");
  if (!senses) return "Clicks and typing only.";
  return `Shadow will also ${senses}. Only text leaves your Mac${pictures ? ", and masked pictures when needed" : ""}.`;
}

function Toggle({
  on,
  onChange,
  label,
  icon,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  icon: IconName;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-toggle${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <Icon name={icon} />
    </button>
  );
}

type IconName = "clock" | "screen" | "mic" | "picture";
const PATHS: Record<IconName, ReactNode> = {
  clock: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  screen: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" />
      <path d="M5.5 14h5M8 11.25V14" />
    </>
  ),
  mic: (
    <>
      <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25" />
    </>
  ),
  picture: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <circle cx="5.5" cy="6.25" r="1.25" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </>
  ),
};
function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
