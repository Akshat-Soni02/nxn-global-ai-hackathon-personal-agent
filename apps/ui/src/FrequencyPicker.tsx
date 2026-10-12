// Choosing a workflow's Frequency (docs/design.md, "Triggers"). Saving sets the trigger and makes the next version.
import type { Trigger } from "@shadow/core";
import { useState } from "react";
import { useSession } from "./api.ts";
import { Action } from "./components.tsx";
import { type Choice, toChoice, toTrigger, WEEKDAYS } from "./frequency.ts";

const KINDS: { kind: Choice["kind"]; label: string }[] = [
  { kind: "manual", label: "Only when I start it" },
  { kind: "hourly", label: "Every hour" },
  { kind: "daily", label: "Every day at…" },
  { kind: "weekdays", label: "Weekdays at…" },
  { kind: "weekly", label: "Every week on… at…" },
  { kind: "monthly", label: "Every month on day… at…" },
  { kind: "folder", label: "When a file appears in a folder…" },
  { kind: "custom", label: "Custom schedule (cron)" },
];

function blank(kind: Choice["kind"], from: Choice): Choice {
  const time = "time" in from ? from.time : "09:00";
  switch (kind) {
    case "manual":
      return { kind };
    case "hourly":
      return { kind, minute: 0 };
    case "daily":
    case "weekdays":
      return { kind, time };
    case "weekly":
      return { kind, weekday: 1, time };
    case "monthly":
      return { kind, day: 1, time };
    case "folder":
      return { kind, dir: "~/Downloads", glob: "*" };
    case "custom":
      return { kind, cron: from.kind === "custom" ? from.cron : "0 9 * * 1-5" };
  }
}

export function FrequencyPicker({ id, current, onDone }: { id: string; current?: Trigger; onDone(): void }) {
  const session = useSession();
  const [choice, setChoice] = useState<Choice>(toChoice(current));
  const [missed, setMissed] = useState<"run_once" | "skip">(
    current && current.type !== "manual" ? current.missed : "run_once",
  );
  const set = (patch: Partial<Choice>) => setChoice((c) => ({ ...c, ...patch }) as Choice);

  return (
    <div className="picker">
      <label className="field">
        <span>Runs</span>
        <select value={choice.kind} onChange={(e) => setChoice(blank(e.target.value as Choice["kind"], choice))}>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      {choice.kind === "hourly" ? (
        <label className="field">
          <span>At minute</span>
          <input
            type="number"
            min={0}
            max={59}
            value={choice.minute}
            onChange={(e) => set({ minute: Number(e.target.value) })}
          />
        </label>
      ) : null}
      {choice.kind === "weekly" ? (
        <label className="field">
          <span>On</span>
          <select value={choice.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {choice.kind === "monthly" ? (
        <label className="field">
          <span>On day</span>
          <input
            type="number"
            min={1}
            max={28}
            value={choice.day}
            onChange={(e) => set({ day: Number(e.target.value) })}
          />
        </label>
      ) : null}
      {"time" in choice ? (
        <label className="field">
          <span>At</span>
          <input type="time" value={choice.time} onChange={(e) => set({ time: e.target.value })} />
        </label>
      ) : null}
      {choice.kind === "custom" ? (
        <label className="field">
          <span>Cron</span>
          <input className="input" value={choice.cron} onChange={(e) => set({ cron: e.target.value })} />
        </label>
      ) : null}
      {choice.kind === "folder" ? (
        <>
          <label className="field">
            <span>Folder</span>
            <input className="input" value={choice.dir} onChange={(e) => set({ dir: e.target.value })} />
          </label>
          <label className="field">
            <span>Files like</span>
            <input className="input short" value={choice.glob} onChange={(e) => set({ glob: e.target.value })} />
          </label>
        </>
      ) : null}
      {choice.kind !== "manual" ? (
        <label className="field">
          <span>
            {choice.kind === "folder" ? "Files that came while Shadow was off" : "If the Mac was asleep at that time"}
          </span>
          <select value={missed} onChange={(e) => setMissed(e.target.value as "run_once" | "skip")}>
            <option value="run_once">{choice.kind === "folder" ? "start them" : "run once when it wakes"}</option>
            <option value="skip">{choice.kind === "folder" ? "leave them" : "skip it until next time"}</option>
          </select>
        </label>
      ) : null}

      <div className="answers">
        <Action
          kind="primary"
          run={async () => {
            await session.call("setTrigger", { id, when: [toTrigger(choice, missed)] });
            onDone();
          }}
        >
          Save Frequency
        </Action>
        <button type="button" className="button link" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="muted small">Saving makes a new version of the workflow. Times are your Mac's.</p>
    </div>
  );
}
