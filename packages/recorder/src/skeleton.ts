// Skeleton: the skill as far as code alone can take it. Channel, action, target and every recorded value come from
// here, so the model (compile.ts) can only add meaning on top: it can never invent a selector or an action.
// It is also a complete, valid skill on its own, which is what gets saved when no model is configured.
import {
  type ActionStep,
  type AxElement,
  type Check,
  type Description,
  type Input,
  kindOf,
  type Locator,
  type Skill,
  type Trigger,
} from "@taskplayer/core";
import type { z } from "zod";
import type { Question } from "./compile.ts";
import { toLocator } from "./locator.ts";
import type { NormalisedStep } from "./normalise.ts";

// The recorder builds action steps only; an llm step comes from the drill (see aiQuestions in compile.ts).
export type ActionDraft = z.input<typeof ActionStep>;
type StepDraft = Omit<ActionDraft, "type">;

// The recorder's working copy: the trigger's parts (when, inputs) beside the action steps, so compile and the drill
// work on plain steps. skillInput() joins them into a skill whose first step is the trigger.
export interface SkillDraft {
  id: string;
  name: string;
  version: number;
  description: z.input<typeof Description>;
  when: Trigger[];
  inputs: Record<string, Input>;
  steps: ActionDraft[];
  success: Check[];
}

export const TRIGGER_ID = "start";

export function skillInput(draft: SkillDraft): z.input<typeof Skill> {
  const { when, inputs, steps, ...rest } = draft;
  const manual = when.every((w) => w.type === "manual");
  return {
    ...rest,
    steps: [
      { id: TRIGGER_ID, type: "trigger", intent: manual ? "By hand" : "On its trigger, or by hand", when, inputs },
      ...steps,
    ],
  };
}

const TEXT = { type: "text" } as const;
const FILE = { type: "file" } as const;

// Steps that commit something you can't take back. Replay pauses for your OK before them.
const RISKY = /\b(submit|pay|send|delete|remove|post|publish|confirm|purchase|buy|order|transfer|sign)\b/i;
// The same in Mac apps' words: menus and buttons that lose work or quit.
const RISKY_MAC = /\b(quit|erase|empty|trash|discard|don.t save|replace|overwrite|log ?out|shut ?down|restart)\b/i;

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
  const out: ActionDraft[] = [];
  const idsByStep: string[][] = [];
  const questions: Question[] = [];
  const copies = new Map<string, string>(); // a copy event's id -> the variable its value is saved as
  const files = new Map<string, string>(); // a path a step left a file at -> how later steps refer to it
  for (const step of steps) {
    const first = out.length;
    const id = (k: number) => `s${first + k + 1}`;
    const built =
      step.kind === "copy"
        ? copySteps(step, id, copies, questions)
        : [toStep(step, id(0), { inputs, copies, questions, files })];
    out.push(...built.map((s) => ({ ...s, type: "action" as const })));
    idsByStep.push(out.slice(first).map((s) => s.id));
  }
  return {
    draft: {
      id: guessId(steps),
      name: guessIntent(steps),
      version: 1,
      description: { goal: guessIntent(steps) },
      when: [{ type: "manual" }],
      inputs,
      steps: out,
      success: [],
    },
    idsByStep,
    questions,
  };
}

// A copy keeps its value for later steps (an output). On a normal page that is the text of the element you copied
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
        output: { name: sheet, type: { type: "list", items: { type: "object" } } },
      },
      {
        id: pickId,
        intent: `Pick ${ctx.column} from the row`,
        channel: "data",
        action: "pick",
        args: { from: `{{${sheet}}}`, where: exact, column: ctx.column },
        output: { name, type: TEXT },
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
      output: { name, type: TEXT },
    },
  ];
}

interface Context {
  inputs: Record<string, Input>;
  copies: Map<string, string>;
  questions: Question[];
  files: Map<string, string>;
}

function toStep(step: NormalisedStep, id: string, { inputs, copies, questions, files }: Context): StepDraft {
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
            args: { text: `{{${copied}}}`, clear: true },
          };
        }
        const name = addInput(inputs, `pasted ${step.target?.label ?? step.target?.name ?? "text"}`, {
          type: TEXT,
          description: `What you pasted into ${what}`,
        });
        questions.push({
          id: `paste-${name}`,
          text: `You pasted something into ${what}; it was not recorded. What should go there?`,
          appliesTo: `steps.${TRIGGER_ID}.inputs.${name}.default`,
        });
        return {
          id,
          intent: `Paste into ${what}`,
          channel: "web",
          action: "type",
          target,
          args: { text: `{{${name}}}`, clear: true },
        };
      }
      if (step.secret) {
        // The value was never recorded. Replay fills it from the macOS Keychain.
        const name = addInput(inputs, step.target?.label ?? step.target?.name ?? "password", {
          type: { type: "secret" },
          description: `Secret for ${what}, from the Keychain at run time`,
        });
        return {
          id,
          intent: `Enter the secret for ${what}`,
          channel: "web",
          action: "type",
          target,
          args: { text: `{{${name}}}`, clear: true },
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
      // The page never knew the file's path, so the file is always an input, chosen again at run time.
      const c = step.candidate;
      const fileName = step.file?.name ?? "file";
      const several = (step.files?.length ?? 1) > 1;
      // The kinds of file the page's input takes, else files like the recorded one (a photo: any image).
      const accept = step.accept ?? kindOf(fileName, step.file?.type);
      const found = {
        dir: tilde(c?.dir) ?? "~/Downloads",
        glob: c?.glob ?? "*",
        pick: several ? "all" : "newest",
        ...(accept ? { accept } : {}),
      };
      const choice = several ? undefined : fileQuestion(fileName, found, `the upload to ${what}`);
      const name = addInput(inputs, stem(fileName), {
        type: several ? { type: "list", items: FILE } : FILE,
        description: `File like ${step.file?.name ?? "the one you picked"}`,
        // Several files dropped or picked at once: all files of that kind, not the newest one.
        resolve: choice?.resolve ?? found,
      });
      if (choice) questions.push(choice.question(name));
      return {
        id,
        intent: `Attach a file to ${what}`,
        channel: "web",
        action: "upload",
        target,
        args: { file: `{{${name}}}` },
      };
    }
    case "copy":
      throw new Error("copy steps are built by copySteps");
    case "fs_move":
    case "fs_rename": {
      // The file is found again at run time, as an upload's is: the newest file like it in the folder it was in
      // (invoice-0923.pdf -> the newest invoice-*.pdf), so next month's file is the one moved. A step on a file an
      // earlier step moved follows that same file by name ({{x.name}} in its new folder).
      const from = step.path ?? "";
      const to = step.toPath ?? "";
      let source = files.get(from);
      if (!source) {
        const accept = kindOf(basename(from));
        const found = {
          dir: tilde(step.candidate?.dir ?? dirname(from)) ?? dirname(from),
          glob: step.candidate?.glob ?? "*",
          pick: "newest",
          ...(accept ? { accept } : {}),
        };
        const choice = fileQuestion(basename(from), found, `the ${step.kind === "fs_move" ? "move" : "rename"}`);
        const name = addInput(inputs, stem(basename(from)), {
          type: FILE,
          description: `File like ${basename(from)}`,
          resolve: choice.resolve,
        });
        questions.push(choice.question(name));
        source = `{{${name}}}`;
        files.set(from, source);
      }
      if (step.kind === "fs_move") {
        const folder = tilde(dirname(to));
        // Where the file is now: same name, new folder.
        const moved = source.startsWith("{{")
          ? `${folder}/${source.replace(/\}\}$/, ".name}}")}`
          : `${folder}/${basename(source)}`;
        files.set(to, moved);
        return {
          id,
          intent: `Move ${basename(from)} to ${folder}`,
          channel: "fs",
          action: "move",
          // The trailing "/" makes it a folder for fs.move (fs-channel.ts); without it the file would be renamed to it.
          args: { from: source, to: `${folder}/` },
          check: { file_exists: moved },
        };
      }
      // The new name is kept as recorded: what it should be next time (a date in it, say) is for the model to decide.
      files.set(to, tilde(to) ?? to);
      return {
        id,
        intent: `Rename ${basename(from)} to ${basename(to)}`,
        channel: "fs",
        action: "rename",
        args: { from: source, to: tilde(to) },
        check: { file_exists: tilde(to) },
      };
    }
    // Mac apps: the Accessibility API acts on the control itself (AXPress, its value), never at a screen position.
    case "app_open":
      return {
        id,
        intent: `Open ${step.app?.name ?? step.app?.id ?? "the app"}`,
        channel: "ax",
        action: "open",
        args: { app: step.app?.id ?? "", name: step.app?.name },
      };
    case "app_press": {
      const el = step.element;
      return {
        id,
        intent: `${step.button === "right" ? "Right-click" : "Click"} ${axWhat(el)} in ${appName(step)}`,
        channel: "ax",
        action: "press",
        target: el && axLocator(el),
        args: step.button === "right" ? { button: "right" } : {},
        requires_approval: axRisky(axName(el)),
      };
    }
    case "app_type": {
      const el = step.element;
      const field = axWhat(el);
      let text = step.value ?? "";
      if (step.secret || step.pasted || step.long) {
        // Never recorded (a password field, a paste, a whole document): an input, filled at run time or by you.
        const name = addInput(inputs, step.secret ? (el?.label ?? el?.title ?? "password") : `text for ${field}`, {
          type: step.secret ? { type: "secret" } : TEXT,
          description: step.secret ? `Secret for ${field}, from the Keychain at run time` : `What goes into ${field}`,
        });
        if (!step.secret) {
          questions.push({
            id: `app-text-${name}`,
            text: `${step.pasted ? "You pasted into" : "You wrote a long text in"} ${field}; it was not recorded. What should go there?`,
            appliesTo: `steps.${TRIGGER_ID}.inputs.${name}.default`,
          });
        }
        text = `{{${name}}}`;
      }
      return {
        id,
        intent: `${step.secret ? "Enter the secret for" : "Type into"} ${field} in ${appName(step)}`,
        channel: "ax",
        action: "set_value",
        target: el && axLocator(el),
        args: { text },
      };
    }
    case "app_key": {
      const keys = [...(step.modifiers ?? []), step.value ?? ""].join("+");
      return {
        id,
        intent: `Press ${keys} in ${appName(step)}`,
        channel: "ax",
        action: "key",
        args: { app: step.app?.id ?? "", key: step.value ?? "", modifiers: step.modifiers ?? [] },
        // Cmd+Delete moves things to the Trash in Finder.
        requires_approval: /^(delete|forwarddelete)$/i.test(step.value ?? "") && Boolean(step.modifiers?.length),
      };
    }
    case "app_menu": {
      const path = step.menu ?? [];
      return {
        id,
        intent: `Choose ${path.join(" > ")} in ${appName(step)}`,
        channel: "ax",
        action: "menu",
        args: { app: step.app?.id ?? "", path },
        requires_approval: axRisky(path.at(-1)),
      };
    }
  }
}

// Which file a run uses. By default you choose it each time you run the skill (the terminal suggests the newest file
// like the recorded one); the drill also offers "the newest of its kind" and "always this file" for runs nobody
// watches. A name with no numbers in it (Photo.jpeg) has no pattern of its own: "of its kind" is then its type.
function fileQuestion(
  fileName: string,
  found: { dir: string; glob: string; pick: string; accept?: string },
  use: string,
): { resolve: Record<string, unknown>; question: (input: string) => Question } {
  const dot = fileName.lastIndexOf(".");
  const like = found.glob === fileName ? (dot > 0 ? `*${fileName.slice(dot)}` : "*") : found.glob;
  const each = "ask me each time I run it";
  const askEachTime = { ...found, glob: like, ask: true };
  return {
    resolve: askEachTime,
    question: (input) => ({
      id: `file-${input}`,
      text: `You used ${fileName} for ${use}. Next time, which file?`,
      appliesTo: `steps.${TRIGGER_ID}.inputs.${input}.resolve`,
      options: [
        { label: each, value: askEachTime },
        { label: `the newest ${like} in ${found.dir}`, value: { ...found, glob: like, ask: false } },
        { label: `always ${fileName}`, value: { ...found, glob: fileName, ask: false } },
      ],
      default: each,
    }),
  };
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

// A variable name usable as {{NAME}}: lowercase letters, digits and underscores, unique within the skill.
function addInput(inputs: Record<string, Input>, raw: string, input: Input): string {
  const base =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "input_$1") || "input";
  let name = base === "today" ? "today_input" : base;
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
  const app = steps.find((s) => s.kind === "app_open")?.app;
  const url = steps.find((s) => s.url)?.url;
  const page = slug(
    pathOf(url)
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/\.[a-z]+$/i, ""),
  );
  const host = hostOf(url);
  return (
    upload ??
    page ??
    slug(host ? `task on ${host}` : undefined) ??
    slug(app && `task in ${app.name ?? app.id}`) ??
    "recorded-task"
  );
}

function guessIntent(steps: NormalisedStep[]): string {
  const host = hostOf(steps.find((s) => s.url)?.url);
  const app = steps.find((s) => s.kind === "app_open")?.app;
  return host ? `Recorded task on ${host}` : app ? `Recorded task in ${app.name ?? app.id}` : "Recorded task";
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

// How a Mac-app control is found again (ax channel): its role and name first, then what labels it, the developer's
// identifier, the window and where it sits in it. The same Locator shape as web targets; attrs carry the AX parts.
export function axLocator(el: AxElement): Locator {
  const attrs: Record<string, string> = { app: el.app };
  if (el.window) attrs.window = el.window;
  if (el.identifier) attrs.identifier = el.identifier;
  if (el.subrole) attrs.subrole = el.subrole;
  if (el.placeholder) attrs.placeholder = el.placeholder;
  if (el.path?.length) attrs.path = el.path.join(" > ");
  return {
    role: el.role,
    name: axName(el),
    label: el.label,
    near: el.near,
    attrs,
    fallbacks: [],
  };
}

const axName = (el?: AxElement) => el?.title || el?.description || undefined;
const axRisky = (words?: string) => Boolean(words && (RISKY.test(words) || RISKY_MAC.test(words)));
const appName = (step: NormalisedStep) => step.app?.name ?? step.element?.appName ?? step.app?.id ?? "the app";
function axWhat(el?: AxElement): string {
  const name = axName(el) ?? el?.label ?? el?.near ?? el?.placeholder;
  const kind = (el?.role ?? "control")
    .replace(/^AX/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return name ? `'${name}'` : `the ${kind}`;
}
