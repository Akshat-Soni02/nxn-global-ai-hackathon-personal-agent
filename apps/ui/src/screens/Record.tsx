// Record a task (docs/design.md, "1. Describe" and "2. Record"): the description form first, then the recording, then
// Stop turns it into a workflow, and its questions are answered here. Every Record button (Chrome, the desktop, the
// menu bar) opens this screen; recording starts only when the form is sent.
import type { Skill } from "@shadow/core";
import type { InboxItem, RecordingView } from "@shadow/daemon/src/types.ts";
import { useEffect, useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Loading } from "../components.tsx";
import { FrequencyFields, type Missed } from "../FrequencyPicker.tsx";
import { type Choice, describe, toTrigger } from "../frequency.ts";
import { Card } from "./Inbox.tsx";
import { StepTree } from "./Workflow.tsx";

export function Record() {
  const { data, error } = useQuery<RecordingView>("recording");
  const inbox = useQuery<InboxItem[]>("inbox", { open: true });
  if (!data) return <Loading error={error} />;
  // Questions outside a run: the form's (from the terminal) and the ones about this recording.
  const questions = (inbox.data ?? []).filter((i) => i.kind === "question").reverse();

  return (
    <>
      <header className="page-header">
        <h1>Record a task</h1>
        <p className="muted">Say what it is for, then do it once. Shadow turns it into a workflow you can run again.</p>
      </header>
      {data.phase === "idle" ? <Form consent={data.consent} last={data.last} /> : null}
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

// A question about the draft (the design agent's drill) is shown next to the draft, with its step marked.
function Question({ item }: { item: InboxItem }) {
  const draft = item.detail.draft as Skill | undefined;
  if (!draft?.steps) return <Card item={item} />;
  return (
    <div className="drill">
      <div className="drill-draft">
        <div className="muted small">
          The workflow so far{item.detail.step ? `: the question is about ${item.detail.step}` : ""}
        </div>
        <StepTree steps={draft.steps} highlight={item.detail.step as string | undefined} />
      </div>
      <Card item={item} />
    </div>
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
        {view.form?.consent.microphone ? " Say out loud why you choose what you choose." : ""} Press Stop when it is
        done.
      </p>
      <div className="answers">
        <Action kind="danger" run={() => session.call("recordStop")}>
          Stop
        </Action>
      </div>
    </section>
  );
}

function Form({ consent, last }: { consent: RecordingView["consent"]; last: RecordingView["last"] }) {
  const session = useSession();
  const [goal, setGoal] = useState("");
  const [choice, setChoice] = useState<Choice>({ kind: "manual" });
  const [missed, setMissed] = useState<Missed>("run_once");
  const [changes, setChanges] = useState("");
  const [constants, setConstants] = useState("");
  const [never, setNever] = useState("");
  const [screen, setScreen] = useState(consent.screen);
  const [microphone, setMicrophone] = useState(consent.microphone);
  const when = toTrigger(choice, missed);

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
      <form className="record-form" onSubmit={(e) => e.preventDefault()}>
        <label className="field wide">
          <span>Goal (required): what is done when this task is done?</span>
          <textarea
            className="input"
            rows={2}
            value={goal}
            placeholder="e.g. This week's revenue, signups and churn are in the KPI sheet"
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>

        <div className="picker">
          <FrequencyFields choice={choice} missed={missed} onChoice={setChoice} onMissed={setMissed} />
          <p className="muted small">How often it runs: {describe(when)}. Times are your Mac's.</p>
        </div>

        <label className="field wide">
          <span>What changes each run (comma-separated, optional)</span>
          <input
            className="input"
            value={changes}
            placeholder="e.g. the email, the numbers, the week's date"
            onChange={(e) => setChanges(e.target.value)}
          />
        </label>
        <label className="field wide">
          <span>What stays the same (optional)</span>
          <input
            className="input"
            value={constants}
            placeholder="e.g. the sender Reporting Bot, the KPI 2026 sheet, the column names"
            onChange={(e) => setConstants(e.target.value)}
          />
        </label>
        <label className="field wide">
          <span>Never, without asking me (optional)</span>
          <input
            className="input"
            value={never}
            placeholder="e.g. send anything, delete files"
            onChange={(e) => setNever(e.target.value)}
          />
        </label>

        <fieldset className="consent">
          <legend>While recording</legend>
          <label>
            <input type="checkbox" checked={screen} onChange={(e) => setScreen(e.target.checked)} /> Take a picture of
            the window at each step. Shadow reads the words on it here on your Mac, hides private ones (emails, phone
            and card numbers, keys, your Never words) and sends only those words to the model. The picture never leaves
            your Mac and is deleted a day after the workflow is saved.
          </label>
          <label>
            <input type="checkbox" checked={microphone} onChange={(e) => setMicrophone(e.target.checked)} /> Record my
            voice while I explain. It is turned into text on your Mac; only the text is sent. The audio never leaves
            your Mac.
          </label>
        </fieldset>

        <div className="answers">
          <Action
            kind="primary"
            run={() =>
              session.call("recordStart", {
                goal,
                when: [when],
                changes: split(changes),
                constants: split(constants),
                never: split(never),
                consent: { screen, microphone },
              })
            }
          >
            Start recording
          </Action>
        </div>
      </form>
    </>
  );
}

const split = (text: string): string[] =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
