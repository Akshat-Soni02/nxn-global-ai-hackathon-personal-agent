// Skeleton: the skill as far as code alone can take it. Channel, action, target and every recorded value come from
// here, so the model (compile.ts) can only add meaning on top: it can never invent a selector or an action.
// It is also a complete, valid skill on its own, which is what gets saved when no model is configured.
import type { Input, Skill } from "@taskplayer/core";
import type { z } from "zod";
import type { Question } from "./compile.ts";
import { toLocator } from "./locator.ts";
import type { NormalisedStep } from "./normalise.ts";

export type SkillDraft = z.input<typeof Skill>;
type StepDraft = SkillDraft["steps"][number];

// Steps that commit something you can't take back. Replay pauses for your OK before them.
const RISKY = /\b(submit|pay|send|delete|remove|post|publish|confirm|purchase|buy|order|transfer|sign)\b/i;

export function buildSkeleton(steps: NormalisedStep[]): SkillDraft {
  return skeletonOf(steps).draft;
}

export interface Skeleton {
  draft: SkillDraft;
  // The skill step ids each recorded step became (a copy from a sheet becomes two: read the sheet, pick the value).
  idsByStep: string[][];
  // What code can't decide and must ask: which row of a sheet, what a pasted value should be.
  questions: Question[];
}

export function skeletonOf(steps: NormalisedStep[]): Skeleton {
  const inputs: Record<string, Input> = {};
  const out: StepDraft[] = [];
  const idsByStep: string[][] = [];
  const questions: Question[] = [];
  const copies = new Map<string, string>(); // a copy event's id -> the variable its value is saved as
  for (const step of steps) {
    const first = out.length;
    const id = (k: number) => `s${first + k + 1}`;
    out.push(
      ...(step.kind === "copy"
        ? copySteps(step, id, copies, questions)
        : [toStep(step, id(0), inputs, copies, questions)]),
    );
    idsByStep.push(out.slice(first).map((s) => s.id));
  }
  return {
    draft: {
      id: guessId(steps),
      version: 1,
      intent: guessIntent(steps),
      inputs,
      triggers: [{ type: "manual" }],
      steps: out,
      success: [],
    },
    idsByStep,
    questions,
  };
}

// A copy keeps its value for later steps (save_as). On a normal page that is the text of the element you copied
// from. In a Google Sheet, whose cells are drawn, it is the sheet's rows read from its export, then a rule that
// picks the value: code writes the rule for the exact row you copied from, and asks if it should be "today's row".
function copySteps(
  step: NormalisedStep,
  id: (k: number) => string,
  copies: Map<string, string>,
  questions: Question[],
): StepDraft[] {
  const name = `copied_${copies.size + 1}`;
  copies.set(step.events.at(-1) ?? "", name);
  const ctx = step.context as
    | { sheet?: string; header?: string[]; row?: Record<string, string>; column?: string }
    | undefined;
  if (ctx?.sheet && ctx.row && ctx.column) {
    const sheet = `sheet_${copies.size}`;
    const [firstColumn = ""] = Object.keys(ctx.row);
    const exact = { [firstColumn]: ctx.row[firstColumn] ?? "" };
    const recordedOn = localDate(step.at);
    const dateColumn = Object.keys(ctx.row).find((k) => datesOf(ctx.row?.[k] ?? "").includes(recordedOn));
    const pickId = id(1);
    if (dateColumn) {
      questions.push({
        id: `row-${pickId}`,
        text: `Which row of the sheet should ${ctx.column} come from on later runs?`,
        appliesTo: `steps.${pickId}.args.where`,
        options: [
          { label: `the row whose ${dateColumn} is that day's date`, value: { [dateColumn]: "{{today}}" } },
          { label: `always the row whose ${firstColumn} is ${exact[firstColumn]}`, value: exact },
        ],
        default: `the row whose ${dateColumn} is that day's date`,
      });
    }
    return [
      {
        id: id(0),
        intent: "Read the sheet's rows",
        channel: "web",
        action: "extract",
        args: { source: "google_sheet" },
        save_as: sheet,
      },
      {
        id: pickId,
        intent: `Pick ${ctx.column} from the row`,
        channel: "data",
        action: "pick",
        args: { from: `{{vars.${sheet}}}`, where: exact, column: ctx.column },
        save_as: name,
      },
    ];
  }
  return [
    {
      id: id(0),
      intent: `Copy the text of ${describe(step)}`,
      channel: "web",
      action: "extract",
      target: step.target && toLocator(step.target),
      args: {},
      save_as: name,
    },
  ];
}

function toStep(
  step: NormalisedStep,
  id: string,
  inputs: Record<string, Input>,
  copies: Map<string, string>,
  questions: Question[],
): StepDraft {
  const target = step.target && toLocator(step.target);
  const what = describe(step);
  const leadsTo = step.navigatesTo ? { url_matches: pathOf(step.navigatesTo) } : undefined;
  switch (step.kind) {
    case "navigate":
      return {
        id,
        intent: `Open ${short(step.url)}`,
        channel: "web",
        action: "navigate",
        args: { url: step.url },
        check: { url_matches: pathOf(step.navigatesTo ?? step.url) },
      };
    case "click":
      return {
        id,
        intent: step.checked === undefined ? `Click ${what}` : `${step.checked ? "Tick" : "Untick"} ${what}`,
        channel: "web",
        action: "click",
        target,
        args: step.checked === undefined ? {} : { checked: step.checked },
        check: leadsTo,
        requires_approval: isRisky(step),
      };
    case "type": {
      if (step.pasted) {
        // Pasted from this recording's copy: the saved value. Pasted from elsewhere: not recorded, so ask for it.
        const copied = step.fromCopy && copies.get(step.fromCopy);
        if (copied) {
          return {
            id,
            intent: `Paste into ${what}`,
            channel: "web",
            action: "type",
            target,
            args: { text: `{{vars.${copied}}}`, clear: true },
          };
        }
        const name = addInput(inputs, `pasted ${step.target?.label ?? step.target?.name ?? "text"}`, {
          type: "string",
          description: `What you pasted into ${what}`,
        });
        questions.push({
          id: `paste-${name}`,
          text: `You pasted something into ${what}; it was not recorded. What should go there?`,
          appliesTo: `inputs.${name}.default`,
        });
        return {
          id,
          intent: `Paste into ${what}`,
          channel: "web",
          action: "type",
          target,
          args: { text: `{{inputs.${name}}}`, clear: true },
        };
      }
      if (step.secret) {
        // The value was never recorded. Replay fills it from the macOS Keychain.
        const name = addInput(inputs, step.target?.label ?? step.target?.name ?? "password", {
          type: "secret",
          description: `Secret for ${what}, from the Keychain at run time`,
        });
        return {
          id,
          intent: `Enter the secret for ${what}`,
          channel: "web",
          action: "type",
          target,
          args: { text: `{{inputs.${name}}}`, clear: true },
        };
      }
      return {
        id,
        intent: `Type into ${what}`,
        channel: "web",
        action: "type",
        target,
        // clear: the field ends up holding exactly the recorded value, not the old one plus it.
        args: { text: step.value ?? "", clear: true },
      };
    }
    case "select":
      return {
        id,
        intent: `Choose '${step.value ?? ""}' in ${what}`,
        channel: "web",
        action: "select",
        target,
        args: { option: step.value ?? "" },
      };
    case "drag":
      return {
        id,
        intent: `Drag ${what} to ${step.to ? describe({ ...step, target: step.to }) : "its place"}`,
        channel: "web",
        action: "drag",
        target,
        // Code copies where it landed too, so the destination can't change any more than the target can.
        args: { to: step.to ? toLocator(step.to) : {} },
      };
    case "press":
      return {
        id,
        intent: `Press ${step.value ?? "Enter"} in ${what}`,
        channel: "web",
        action: "press",
        target,
        args: { key: step.value ?? "Enter" },
        check: leadsTo,
        requires_approval: isRisky(step),
      };
    case "upload": {
      // The page never knew the file's path, so the file is always an input, found again at run time.
      const c = step.candidate;
      const name = addInput(inputs, stem(step.file?.name ?? "file"), {
        type: "file",
        description: `File like ${step.file?.name ?? "the one you picked"}`,
        // Several files dropped or picked at once: all files of that kind, not the newest one.
        resolve: {
          dir: tilde(c?.dir) ?? "~/Downloads",
          glob: c?.glob ?? "*",
          pick: (step.files?.length ?? 1) > 1 ? "all" : "newest",
        },
      });
      return {
        id,
        intent: `Attach a file to ${what}`,
        channel: "web",
        action: "upload",
        target,
        args: { file: `{{inputs.${name}}}` },
      };
    }
    case "copy":
      throw new Error("copy steps are built by copySteps");
    case "fs_move":
      return {
        id,
        intent: `Move ${basename(step.path)} to ${tilde(dirname(step.toPath))}`,
        channel: "fs",
        action: "move",
        args: { from: tilde(step.path), to: tilde(dirname(step.toPath)) },
        check: { file_exists: tilde(step.toPath) },
      };
    case "fs_rename":
      return {
        id,
        intent: `Rename ${basename(step.path)} to ${basename(step.toPath)}`,
        channel: "fs",
        action: "rename",
        args: { from: tilde(step.path), to: tilde(step.toPath) },
        check: { file_exists: tilde(step.toPath) },
      };
  }
}

// A form submit, or a button whose words say it commits something. skills/real gates every form submit the same way.
function isRisky(step: NormalisedStep): boolean {
  const t = step.target;
  return Boolean(step.submits) || RISKY.test([t?.name, t?.text, t?.label].filter(Boolean).join(" "));
}

function describe(step: NormalisedStep): string {
  const t = step.target;
  const name = t?.name ?? t?.label ?? t?.text;
  if (name) return `'${name}'`;
  return t?.role ? `the ${t.role}` : "the element";
}

// A name usable in {{inputs.NAME}}: lowercase letters, digits and underscores, unique within the skill.
function addInput(inputs: Record<string, Input>, raw: string, input: Input): string {
  const base =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "input_$1") || "input";
  let name = base;
  for (let n = 2; name in inputs; n++) name = `${base}_${n}`;
  inputs[name] = input;
  return name;
}

// invoice-0923.pdf -> invoice
function stem(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .split(/[^A-Za-z]+/)
      .find(Boolean) ?? "file"
  );
}

// Only a placeholder: the model (or the drill) names the skill. Prefer what was uploaded, then the page's own name
// (timesheet.html -> timesheet), then the site.
function guessId(steps: NormalisedStep[]): string {
  const upload = slug(steps.find((s) => s.kind === "upload" && s.target?.name)?.target?.name);
  const url = steps.find((s) => s.url)?.url;
  const page = slug(
    pathOf(url)
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/\.[a-z]+$/i, ""),
  );
  const host = hostOf(url);
  return upload ?? page ?? slug(host ? `task on ${host}` : undefined) ?? "recorded-task";
}

function guessIntent(steps: NormalisedStep[]): string {
  const host = hostOf(steps.find((s) => s.url)?.url);
  return host ? `Recorded task on ${host}` : "Recorded task";
}

function slug(text: string | undefined): string | undefined {
  const s = text
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return s || undefined;
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

function pathOf(url: string | undefined): string {
  try {
    return url ? new URL(url).pathname : "";
  } catch {
    return url ?? "";
  }
}

function short(url: string | undefined): string {
  try {
    const u = new URL(url ?? "");
    return `${u.host}${u.pathname}`;
  } catch {
    return url ?? "the page";
  }
}

// Skills are portable and shareable: /Users/<you>/Downloads/x becomes ~/Downloads/x.
function tilde(path: string | undefined): string | undefined {
  return path?.replace(/^\/Users\/[^/]+/, "~");
}

// YYYY-MM-DD of a timestamp, local time (as {{today}} is at replay).
function localDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The dates a cell could mean (10/3/2026 is October 3 or 10 March): matches the player's data.pick.
function datesOf(text: string): string[] {
  const pad = (n: string) => n.padStart(2, "0");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (iso) return [`${iso[1]}-${pad(iso[2] ?? "")}-${pad(iso[3] ?? "")}`];
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text.trim());
  if (!slash) return [];
  const [a = "", b = "", y = ""] = slash.slice(1);
  return [`${y}-${pad(a)}-${pad(b)}`, `${y}-${pad(b)}-${pad(a)}`];
}

const basename = (path = "") => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path = "") => path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || "/";
