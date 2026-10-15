// Everything that waits for the user (apps/daemon/src/store.ts, the inbox), answered here: an approval, a step's
// question, a run that needs the user (retry, skip, stop), a question outside a run, or a repair to review.
import type { Skill } from "@shadow/core";
import type { InboxItem } from "@shadow/daemon/src/types.ts";
import { useState } from "react";
import { useQuery, useSession } from "../api.ts";
import { Action, Empty, Loading } from "../components.tsx";
import { ago, KIND, when } from "../format.ts";
import { WorkflowTree } from "../WorkflowTree.tsx";

export function Inbox() {
  const { data, error } = useQuery<InboxItem[]>("inbox", { open: true });
  if (!data) return <Loading error={error} />;
  return (
    <>
      <header className="page-header">
        <h1>Waiting for you</h1>
        <p className="muted">
          {data.length === 0 ? "Runs go on by themselves until one needs you." : `${data.length} to look at`}
        </p>
      </header>
      {data.length === 0 ? (
        <Empty title="Nothing waits for you." />
      ) : (
        <div className="cards">
          {/* Oldest first: the inbox is a queue. */}
          {[...data].reverse().map((item) => (
            <Question key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

// An item; a question about a draft workflow (the design agent's drill) is shown next to the draft, its step marked.
export function Question({ item }: { item: InboxItem }) {
  const draft = item.detail.draft as Skill | undefined;
  if (!draft?.steps) return <Card item={item} />;
  return (
    <div className="drill">
      <div className="drill-draft">
        <div className="muted small">
          The workflow so far{item.detail.step ? `: the question is about ${item.detail.step}` : ""}
        </div>
        <WorkflowTree steps={draft.steps} highlight={item.detail.step as string | undefined} />
      </div>
      <Card item={item} />
    </div>
  );
}

// One item with its answers.
function Card({ item }: { item: InboxItem }) {
  return (
    <article className={`card kind-${item.kind}`} id={`item-${item.id}`}>
      <div className="card-meta">
        <span className={`kind kind-${item.kind}`}>{KIND[item.kind]}</span>
        {item.skillId ? <a href={`#/workflows/${item.skillId}`}>{item.skillId}</a> : null}
        {item.path ? <code>{item.path}</code> : null}
        <span className="muted" title={when(item.createdAt)}>
          {ago(item.createdAt)}
        </span>
      </div>
      <h2 className="card-title">{item.title}</h2>
      <Answer item={item} />
      {item.runId ? (
        <a className="card-link" href={`#/runs/${item.runId}`}>
          See the run
        </a>
      ) : null}
    </article>
  );
}

function Answer({ item }: { item: InboxItem }) {
  const session = useSession();
  const answer = (value: unknown) => session.call("answer", { itemId: item.id, answer: value });
  const options = (item.detail.options as string[] | undefined) ?? [];
  const waiting = item.detail.waiting as { error?: string; ask?: { kind: string } } | undefined;

  if (item.kind === "approval") {
    return (
      <div className="answers">
        <Action kind="primary" run={() => answer("approve")}>
          Approve
        </Action>
        <Action run={() => answer("deny")}>Deny</Action>
      </div>
    );
  }
  if (item.kind === "recovery") {
    return (
      <>
        {waiting?.error ? <p className="detail">The step said: {waiting.error}</p> : null}
        <div className="answers">
          <Action kind="primary" run={() => answer("retry")}>
            Try the step again
          </Action>
          <Action run={() => answer("skip")}>I did it by hand: go on</Action>
          <Action kind="danger" run={() => answer("stop")} confirm="Stop this run?">
            Stop the run
          </Action>
        </div>
      </>
    );
  }
  if (item.kind === "walk") {
    const w = item.detail.waiting as { acting?: boolean; highlighted?: boolean } | undefined;
    return (
      <>
        <p className="detail">
          {w?.highlighted
            ? "Its target is outlined in the automation window. "
            : "Its target could not be outlined (not on the page yet?). "}
          {w?.acting
            ? "This step would act (click, type, send): Do it runs it, Skip passes over it."
            : "This step only reads or opens a page: Next runs it."}
        </p>
        <div className="answers">
          <Action kind="primary" run={() => answer(w?.acting ? "do it" : "next")}>
            {w?.acting ? "Do it" : "Next"}
          </Action>
          <Action run={() => answer("skip")}>Skip</Action>
          <Action kind="danger" run={() => answer("stop")} confirm="Stop the walk-through?">
            Stop
          </Action>
        </div>
      </>
    );
  }
  if (item.kind === "paused") {
    return (
      <>
        <p className="detail">It won't start on its own until you resume it. Look at its last runs first.</p>
        <div className="answers">
          <Action kind="primary" run={() => answer("resume")}>
            Resume
          </Action>
          <Action run={() => answer("keep paused")}>Keep it paused</Action>
          {item.skillId ? <a href={`#/workflows/${item.skillId}`}>See the workflow</a> : null}
        </div>
      </>
    );
  }
  if (item.kind === "repaired") {
    const detail = item.detail as { version?: number; by?: string };
    return (
      <>
        <p className="detail">
          Saved as version {detail.version}
          {detail.by ? `, found by ${detail.by === "ladder" ? "a quick check" : "the repair agent"}` : ""}. Later runs
          use it.
        </p>
        <div className="answers">
          <Action kind="primary" run={() => answer("seen")}>
            Looks right
          </Action>
          <Action
            kind="danger"
            confirm="Undo this repair?"
            run={async () => {
              await session.call("rollback", { skillId: item.skillId });
              await answer("rolled back");
            }}
          >
            Roll back
          </Action>
        </div>
      </>
    );
  }
  // A step's question or a question outside a run: its options, and your own words when none of them fits.
  if (options.length > 0) {
    return (
      <>
        <div className="answers">
          {options.map((o, i) => (
            <Action key={o} kind={i === 0 ? "primary" : "secondary"} run={() => answer(o)}>
              {o}
            </Action>
          ))}
        </div>
        {item.detail.freeText ? <TextAnswer label="Or write your own answer" onSend={answer} required /> : null}
      </>
    );
  }
  return <TextAnswer placeholder={item.detail.default as string | undefined} onSend={answer} />;
}

function TextAnswer({
  placeholder,
  label,
  required,
  onSend,
}: {
  placeholder?: string;
  label?: string;
  // With options beside it, an empty answer would mean nothing: Send waits for words.
  required?: boolean;
  onSend: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  if (required) {
    return (
      <form className="answers other" onSubmit={(e) => e.preventDefault()}>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={label}
          aria-label={label}
        />
        {text.trim() ? (
          <Action kind="secondary" run={() => onSend(text.trim())}>
            Send
          </Action>
        ) : null}
      </form>
    );
  }
  return (
    <form
      className="answers"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <input
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ? `${placeholder} (leave empty for this)` : "Your answer"}
        aria-label="Your answer"
      />
      <Action kind="primary" run={() => onSend(text || placeholder || "")}>
        Send
      </Action>
    </form>
  );
}
