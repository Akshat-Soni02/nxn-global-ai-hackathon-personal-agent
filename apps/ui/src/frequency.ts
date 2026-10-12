// The Frequency (docs/design.md, "Triggers"): the choices the picker offers, turned into a trigger and back, and any
// trigger in words. Times are the Mac's own; cron fields are minute hour day-of-month month weekday.
import type { Trigger } from "@shadow/core";

export type Choice =
  | { kind: "manual" }
  | { kind: "hourly"; minute: number }
  | { kind: "daily" | "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "custom"; cron: string }
  | { kind: "folder"; dir: string; glob: string };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const hm = (time: string) => {
  const [h = "9", m = "0"] = time.split(":");
  return { h: Number(h), m: Number(m) };
};
const pad = (n: number) => String(n).padStart(2, "0");

export function toTrigger(choice: Choice, missed: "run_once" | "skip"): Trigger {
  switch (choice.kind) {
    case "manual":
      return { type: "manual" };
    case "folder":
      return { type: "folder_watch", dir: choice.dir, glob: choice.glob || "*", missed };
    case "custom":
      return { type: "schedule", cron: choice.cron.trim(), missed };
    case "hourly":
      return { type: "schedule", cron: `${choice.minute} * * * *`, missed };
    default: {
      const { h, m } = hm(choice.time);
      const day = choice.kind === "monthly" ? String(choice.day) : "*";
      const week = choice.kind === "weekdays" ? "1-5" : choice.kind === "weekly" ? String(choice.weekday) : "*";
      return { type: "schedule", cron: `${m} ${h} ${day} * ${week}`, missed };
    }
  }
}

// The picker's choice for a trigger; a cron the picker can't express is "custom".
export function toChoice(trigger: Trigger | undefined): Choice {
  if (!trigger || trigger.type === "manual") return { kind: "manual" };
  if (trigger.type === "folder_watch") return { kind: "folder", dir: trigger.dir, glob: trigger.glob ?? "*" };
  const parts = trigger.cron.trim().split(/\s+/);
  const [m, h, day, month, week] = parts;
  const num = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined);
  const minute = num(m);
  const hour = num(h);
  if (parts.length !== 5 || minute === undefined || month !== "*") return { kind: "custom", cron: trigger.cron };
  if (h === "*" && day === "*" && week === "*") return { kind: "hourly", minute };
  if (hour === undefined) return { kind: "custom", cron: trigger.cron };
  const time = `${pad(hour)}:${pad(minute)}`;
  if (day === "*" && week === "*") return { kind: "daily", time };
  if (day === "*" && week === "1-5") return { kind: "weekdays", time };
  if (day === "*" && num(week) !== undefined && Number(week) <= 6)
    return { kind: "weekly", weekday: Number(week), time };
  if (week === "*" && num(day) !== undefined) return { kind: "monthly", day: Number(day), time };
  return { kind: "custom", cron: trigger.cron };
}

export function describe(trigger: Trigger): string {
  const c = toChoice(trigger);
  switch (c.kind) {
    case "manual":
      return "Only when you start it";
    case "hourly":
      return c.minute === 0 ? "Every hour" : `Every hour at :${pad(c.minute)}`;
    case "daily":
      return `Every day at ${c.time}`;
    case "weekdays":
      return `Weekdays at ${c.time}`;
    case "weekly":
      return `Every ${WEEKDAYS[c.weekday]} at ${c.time}`;
    case "monthly":
      return `Every month on day ${c.day} at ${c.time}`;
    case "custom":
      return `On the schedule ${c.cron}`;
    case "folder":
      return `When a file${c.glob && c.glob !== "*" ? ` (${c.glob})` : ""} appears in ${c.dir}`;
  }
}
