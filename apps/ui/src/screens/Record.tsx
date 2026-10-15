// Record a task (docs/design.md, "1. Describe" and "2. Record"): one goal box first, then the recording, then Stop
// turns it into a workflow, and its questions are answered here. Every Record button (Chrome, the desktop, the menu
// bar) opens this screen; recording starts only when the goal is sent. Only the goal is asked before: how often it
// runs, what changes, what stays and what it must never do come from what you say and show while recording, and
// anything still unclear is asked after Stop.
import type { Skill, Trigger } from "@shadow/core";
import type { InboxItem, RecordingView } from "@shadow/daemon/src/types.ts";
import { type ReactNode, useEffect, useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";
import { Question } from "./Inbox.tsx";

// `again`: a workflow's id, to record that task again: the box starts filled in from it, and the recording becomes
// the workflow's next version (same id, Frequency and state).
export function Record({ again }: { again?: string }) {
  const { data, error } = useQuery<RecordingView>("recording");
  const inbox = useQuery<InboxItem[]>("inbox", { open: true });
  if (!data) return <Loading error={error} />;
  // Questions outside a run: the form's (from the terminal) and the ones about this recording.
  const questions = (inbox.data ?? []).filter((i) => i.kind === "question").reverse();

  return (
    <>
      <header className="page-header">
        <h1>{again ? "Record it again" : "Record a task"}</h1>
        <p className="muted">
          {again
            ? "Do the task once more. The new recording becomes the next version of this workflow; its Frequency and whether it is live stay as they are."
            : "Say what you want done, then do it once while Shadow watches. Talk as you go: what you say is what it follows."}
        </p>
      </header>
      {data.phase === "idle" ? (
        again ? (
          <AgainForm again={again} consent={data.consent} last={data.last} />
        ) : (
          <GoalBox consent={data.consent} last={data.last} />
        )
      ) : null}
      {data.phase === "describing" ? <p>Answer the questions below (or in the terminal) to start recording.</p> : null}
      {data.phase === "recording" ? <Recording view={data} /> : null}
      {data.phase === "compiling" ? (
        <section className="section">
          <h2>Turning your recording into a workflow…</h2>
          <p className="muted">{data.form?.goal}</p>
        </section>
      ) : null}
      {data.phase !== "idle" && questions.length > 0 ? (
        <section className="section">
          <h2>Questions</h2>
          <div className="cards">
            {questions.map((item) => (
              <Question key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}
    </>
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
}: {
  again: string;
  consent: RecordingView["consent"];
  last: RecordingView["last"];
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
  again,
  initial,
}: {
  consent: RecordingView["consent"];
  last: RecordingView["last"];
  again?: string;
  initial?: Initial;
}) {
  const session = useSession();
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [screen, setScreen] = useState(consent.screen);
  const [microphone, setMicrophone] = useState(consent.microphone);
  const [pictures, setPictures] = useState(consent.pictures);
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
      consent: { screen, microphone, pictures: screen && pictures },
      ...(again ? { again } : {}),
    });

  return (
    <>
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
          <Action kind="primary" run={start}>
            <span className="dot rec" /> {again ? "Record again" : "Record"}
          </Action>
        </div>
      </form>

      <p className="muted small goalbox-note">{consentNote(screen, microphone, screen && pictures)}</p>
      <p className="muted small">
        Say how often it runs and the rules you follow while you record ("every morning", "skip the ones already in the
        sheet"). Anything still unclear is asked after you stop.
      </p>
    </>
  );
}

// What leaves the Mac, in one sentence, for the switches as they are.
function consentNote(screen: boolean, microphone: boolean, pictures: boolean): string {
  const senses = [screen ? "read the words on your screen (private ones hidden)" : "", microphone ? "hear you" : ""]
    .filter(Boolean)
    .join(" and ");
  if (!senses) return "Shadow records your clicks and typing only.";
  return `While you record, Shadow will ${senses}. Only text leaves your Mac${
    pictures ? ", and a blacked-out picture when the words aren't enough" : ""
  }; the recording is deleted a day after the workflow is saved.`;
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
