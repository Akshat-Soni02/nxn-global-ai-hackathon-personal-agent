// Normalise: turns a raw trace into the steps a person would describe, with no AI.
// Mechanical rules only, so the compiler's input is stable and testable, and the model sees fewer tokens.
import type { AxElement, ElementDescriptor, FileInfo, TraceEvent } from "@taskplayer/core";

export type StepKind =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "press"
  | "upload"
  | "drag"
  | "copy"
  | "fs_move"
  | "fs_rename"
  // Mac apps (Task Player.app, Accessibility API)
  | "app_open"
  | "app_press"
  | "app_type"
  | "app_key"
  | "app_menu";

// A value that will probably be different next time. The compiler and the drill decide; this only proposes.
export interface ParamCandidate {
  kind: "file" | "date" | "number" | "text";
  value: string;
  glob?: string;
  dir?: string;
}

export interface NormalisedStep {
  index: number;
  kind: StepKind;
  at: number;
  tabId?: number;
  frameId?: number;
  url?: string;
  target?: ElementDescriptor;
  to?: ElementDescriptor; // drag: where the target was dropped
  value?: string;
  secret?: boolean;
  checked?: boolean;
  file?: FileInfo;
  files?: FileInfo[];
  accept?: string; // upload: the kinds of file the page's input takes
  path?: string;
  toPath?: string;
  navigatesTo?: string; // the page this click or key press led to
  submits?: boolean; // it submitted a form
  produces?: string[]; // files that appeared because of it (downloads)
  candidate?: ParamCandidate;
  // copy: what was copied, and for drawn apps (a Google Sheet) the header and row it came from.
  context?: Record<string, unknown>;
  drawn?: boolean;
  // type: the value was pasted from this recording's copy (its first event id); it is not stored.
  pasted?: boolean;
  fromCopy?: string;
  // Clicks just before this step that had no element to replay (a canvas): reported, not replayed.
  drawnBefore?: number;
  // Mac apps: the app, the control (AX), a menu path, a shortcut's modifiers, a right click, a value too long to keep.
  app?: { id: string; name?: string };
  element?: AxElement;
  menu?: string[];
  modifiers?: ("cmd" | "shift" | "option" | "ctrl")[];
  button?: "left" | "right";
  long?: boolean;
  events: string[]; // ids of the trace events merged into this step
}

type Draft = Omit<NormalisedStep, "index">;

const FOLLOW_MS = 3_000; // a navigation this soon after a click or key press was caused by it
const FILE_DIALOG_MS = 5 * 60_000; // how long the macOS file dialog may stay open between the click and the pick
const SCRIPT_CLICK_MS = 1_000; // a page script clicking its hidden file input right after your click on its button
const CAUSED = new Set(["link", "form_submit"]);
const FOCUS_ONLY_ROLES = new Set(["textbox", "searchbox", "spinbutton"]);
// Finder is recorded by what it did to files (fs_move, fs_rename from the watcher), never by its clicks: a click on
// last month's row can't be replayed next month. Task Player.app leaves Finder out too; this also covers old traces.
const FILE_APPS = new Set(["com.apple.finder"]);
// Mac-app elements that only hold others: a click on one is a click on nothing in particular.
const AX_CONTAINERS = new Set([
  "AXWindow",
  "AXGroup",
  "AXScrollArea",
  "AXSplitGroup",
  "AXLayoutArea",
  "AXMenuBar",
  "AXUnknown",
]);
const DATE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const NUMBER = /^-?\d+([.,]\d+)?$/;

export function normalise(trace: TraceEvent[]): NormalisedStep[] {
  const events = [...trace].sort((a, b) => a.at - b.at);
  const steps: Draft[] = [];
  const last = () => steps.at(-1);
  let lastCopy: string | undefined;
  const base = (e: TraceEvent): Draft => ({
    kind: "click",
    at: e.at,
    tabId: e.tabId,
    frameId: e.frameId,
    url: e.url,
    target: e.target,
    events: [e.id],
  });
  // A click that only focused a field or opened a dropdown adds nothing once you type or choose in it.
  const takeFocusClick = (target?: ElementDescriptor): string[] => {
    const prev = last();
    if (prev?.kind !== "click" || !sameTarget(prev.target, target)) return [];
    steps.pop();
    return prev.events;
  };

  // A Mac-app step is replayed in its app: when the recording moves into an app (or back to it after Chrome or Finder),
  // an "open" step brings that app forward first. Switching apps without doing anything there adds nothing.
  const appOf = (e: TraceEvent) => e.app ?? (e.element && { id: e.element.app, name: e.element.appName });
  const pushApp = (e: TraceEvent, step: Omit<Draft, "events" | "at">) => {
    const app = appOf(e);
    const prev = last();
    const inApp = prev?.kind.startsWith("app_") && prev.app?.id === app?.id;
    if (app && !inApp) steps.push({ kind: "app_open", at: e.at - 1, app, events: [] });
    steps.push({ ...step, at: e.at, app, events: [e.id] });
  };

  for (const e of events) {
    const prev = last();
    if (e.event.startsWith("app_") && FILE_APPS.has(appOf(e)?.id ?? "")) continue;
    switch (e.event) {
      case "navigate": {
        // A page replay can't open (a new tab page, another extension's page, chrome://settings) is not a step: the
        // page you went to from there is.
        if (!opensOnReplay(e.url)) break;
        if (prev && (prev.kind === "click" || prev.kind === "press") && e.at - prev.at <= FOLLOW_MS) {
          if (CAUSED.has(e.transition ?? "")) {
            prev.navigatesTo = e.url;
            prev.events.push(e.id);
            break;
          }
        }
        // Redirects right after opening a page, and reloads of it, are the same step.
        if (prev?.kind === "navigate" && (e.at - prev.at <= FOLLOW_MS || e.transition === "reload")) {
          prev.navigatesTo = e.url;
          prev.events.push(e.id);
          break;
        }
        steps.push({ ...base(e), kind: "navigate", target: undefined });
        break;
      }
      case "click": {
        if (!e.target) break;
        // The same element clicked again at once (double click, a label and its control) is one action.
        if (prev?.kind === "click" && sameTarget(prev.target, e.target) && e.at - prev.at < 600) {
          prev.events.push(e.id);
          break;
        }
        // Enter in a form makes the browser click its submit button: the Enter is the step (older content scripts
        // recorded both).
        if (prev?.kind === "press" && prev.value === "Enter" && e.at - prev.at < 100 && e.target.role === "button") {
          prev.events.push(e.id);
          break;
        }
        steps.push({ ...base(e), drawn: e.drawn });
        break;
      }
      case "type": {
        // A pasted value is not in the trace; it comes from the copy recorded before it, as {{vars.x}}.
        const pastedFrom = e.pasted ? lastCopy : undefined;
        if (prev?.kind === "type" && sameTarget(prev.target, e.target)) {
          prev.value = e.secret || e.pasted ? undefined : e.value; // the last value wins
          if (e.pasted) Object.assign(prev, { pasted: true, fromCopy: pastedFrom });
          prev.events.push(e.id);
          break;
        }
        const merged = takeFocusClick(e.target);
        steps.push({
          ...base(e),
          kind: "type",
          value: e.secret || e.pasted ? undefined : e.value,
          secret: e.secret,
          pasted: e.pasted,
          fromCopy: pastedFrom,
          events: [...merged, e.id],
        });
        break;
      }
      case "copy": {
        if (e.secret || !e.value) break; // a copy out of a secret field: nothing to reuse, and nothing stored
        // The click that selected what was copied is part of the copy: a click on a drawn app's canvas, or the
        // press-and-drag that selected text in the same element.
        const selecting =
          prev?.kind === "click" && (prev.drawn || (sameTarget(prev.target, e.target) && e.at - prev.at < 10_000));
        const absorbed = selecting ? (steps.pop()?.events ?? []) : [];
        steps.push({
          ...base(e),
          kind: "copy",
          value: e.value,
          context: e.context,
          drawn: e.drawn,
          events: [...absorbed, e.id],
        });
        lastCopy = e.id;
        break;
      }
      case "paste":
        break; // the type event that follows carries it (pasted: true)
      case "select": {
        const merged = takeFocusClick(e.target);
        steps.push({ ...base(e), kind: "select", value: e.value, events: [...merged, e.id] });
        break;
      }
      case "check": {
        if (prev?.kind === "click" && sameTarget(prev.target, e.target)) {
          prev.checked = e.checked;
          prev.events.push(e.id);
          break;
        }
        steps.push({ ...base(e), checked: e.checked });
        break;
      }
      case "file":
      case "drop": {
        if (e.event === "drop" && !e.files?.length) break;
        // One upload, however the file got there. Replay sets the file directly (DOM.setFileInputFiles), so none of
        // the clicks that opened the macOS file dialog are replayed: doing so in your Chrome would open that dialog.
        //  - clicks on the file input itself (yours, a <label>'s, or the page's own script calling input.click());
        //  - and, when the page's script clicked it, the click just before that: the button you pressed.
        const absorbed: string[] = [];
        let opener: Draft | undefined;
        if (e.event === "file") {
          let own = 0;
          for (let p = last(); p?.kind === "click" && sameTarget(p.target, e.target); p = last()) {
            absorbed.unshift(...(steps.pop()?.events ?? []));
            own++;
          }
          const before = last();
          const ownClickAt = Number(absorbed.length ? events.find((x) => x.id === absorbed[0])?.at : Number.NaN);
          if (own > 0 && before?.kind === "click" && ownClickAt - before.at <= SCRIPT_CLICK_MS) {
            opener = steps.pop();
            absorbed.unshift(...(opener?.events ?? []));
          } else if (own === 0 && before?.kind === "click" && e.at - before.at <= FILE_DIALOG_MS) {
            opener = steps.pop(); // the dialog was opened by a click on something else (a button, a drop zone)
            absorbed.unshift(...(opener?.events ?? []));
          }
        }
        // Replay must find the target again. A file input it cannot reach (out of the accessibility tree and inside
        // a shadow root) is found through the control you clicked instead: the player looks from there.
        const target = e.event === "file" && !findable(e.target) && opener?.target ? opener.target : e.target;
        const file = e.file ?? e.files?.[0];
        steps.push({
          ...base(e),
          kind: "upload",
          target,
          file,
          files: e.files,
          accept: e.accept,
          path: file?.path,
          events: [...absorbed, e.id],
        });
        break;
      }
      case "drag": {
        if (e.target && e.to) steps.push({ ...base(e), kind: "drag", to: e.to });
        break;
      }
      case "key": {
        if (e.value === "Enter" || e.value === "Escape") steps.push({ ...base(e), kind: "press", value: e.value });
        break;
      }
      case "submit": {
        if (prev && (prev.kind === "click" || prev.kind === "press") && e.at - prev.at <= FOLLOW_MS) {
          prev.submits = true;
          prev.events.push(e.id);
        }
        break;
      }
      case "download":
      case "fs_create": {
        if (prev && e.path && !prev.produces?.includes(e.path)) prev.produces = [...(prev.produces ?? []), e.path];
        break;
      }
      case "fs_move":
      case "fs_rename":
        steps.push({ ...base(e), kind: e.event, target: undefined, path: e.path, toPath: e.toPath });
        break;
      case "app_click": {
        const el = e.element;
        if (!el || (AX_CONTAINERS.has(el.role) && !el.title && !el.description && !el.identifier)) break;
        // A double click, or the same control clicked again at once, is one press.
        if (prev?.kind === "app_press" && sameElement(prev.element, el) && e.at - prev.at < 600) {
          prev.events.push(e.id);
          break;
        }
        pushApp(e, { kind: "app_press", element: el, button: e.button });
        break;
      }
      case "app_type": {
        const el = e.element;
        if (!el) break;
        // The click that only put the cursor in this field adds nothing once you typed in it.
        const focus = prev?.kind === "app_press" && sameElement(prev.element, el) ? steps.pop()?.events : undefined;
        const field = last();
        if (field?.kind === "app_type" && sameElement(field.element, el)) {
          Object.assign(field, { value: e.value, secret: e.secret, pasted: e.pasted, long: e.long });
          field.events.push(e.id);
          break;
        }
        pushApp(e, { kind: "app_type", element: el, value: e.value, secret: e.secret, pasted: e.pasted, long: e.long });
        if (focus) last()?.events.unshift(...focus);
        break;
      }
      case "app_key":
        pushApp(e, { kind: "app_key", value: e.value, modifiers: e.modifiers, element: e.element });
        break;
      case "app_menu":
        if (e.menu && e.menu.length > 0) pushApp(e, { kind: "app_menu", menu: e.menu });
        break;
      default:
        break; // tab_open, tab_close: context only. app_activate: an "open" step is added before the app's first step.
    }
  }

  // Drawn clicks no copy explained can't be replayed by element: they are reported on the next step instead.
  const kept: Draft[] = [];
  let drawn = 0;
  for (const s of steps) {
    if (s.kind === "click" && s.drawn) drawn++;
    else if (s.kind !== "click" || isMeaningfulClick(s)) {
      kept.push(drawn > 0 ? { ...s, drawnBefore: drawn } : s);
      drawn = 0;
    }
  }
  addStartingPage(kept);
  const produced = events.flatMap((e) =>
    e.path && (e.event === "download" || e.event === "fs_create") ? [e.path] : [],
  );
  return kept.map((s, index) => ({ ...s, index, candidate: candidateFor(s, produced) }));
}

// Replay opens web pages and local files in its own tab. Chrome's own pages and other extensions' pages refuse it
// ("Not allowed").
const opensOnReplay = (url?: string) => /^(https?|file):/i.test(url ?? "");

// The matcher finds an element by Chrome's accessibility tree (role, name) or by selectors from the document; an
// element in a shadow root with no role or name can be reached by neither.
function findable(d?: ElementDescriptor): boolean {
  if (!d) return false;
  if (d.role || d.name) return true;
  return !d.shadowPath && Boolean(d.selectors?.css || d.selectors?.xpath);
}

// Clicks on nothing in particular (page background, a field you then left empty) are noise.
function isMeaningfulClick(step: Draft): boolean {
  if (step.navigatesTo || step.submits || step.checked !== undefined) return true;
  const t = step.target;
  if (!t) return false;
  if (t.role && FOCUS_ONLY_ROLES.has(t.role)) return false;
  return Boolean(t.role || t.name || t.text || t.label);
}

// A recording usually starts on a page that is already open, so replay needs to be told to open it first.
function addStartingPage(steps: Draft[]) {
  const first = steps[0];
  if (!first || first.kind === "navigate" || first.kind === "fs_move" || first.kind === "fs_rename") return;
  const url = first.frameId ? undefined : (first.url ?? first.target?.url);
  if (!url || !opensOnReplay(url)) return;
  steps.unshift({ kind: "navigate", at: first.at - 1, tabId: first.tabId, url, events: [] });
}

function candidateFor(step: Draft, produced: string[]): ParamCandidate | undefined {
  if (step.kind === "upload" && step.file) {
    // Where the file lives: found on disk by the daemon (locate-file.ts), or seen arriving earlier in this recording.
    const known = step.file.path ?? produced.find((p) => basename(p) === step.file?.name);
    return { kind: "file", value: step.file.name, glob: globFor(step.file.name), dir: known && dirname(known) };
  }
  if ((step.kind === "fs_move" || step.kind === "fs_rename") && step.path) {
    const name = basename(step.path);
    return { kind: "file", value: name, glob: globFor(name), dir: dirname(step.path) };
  }
  if ((step.kind === "type" || step.kind === "select" || step.kind === "app_type") && step.value && !step.secret) {
    const value = step.value.trim();
    const kind = DATE.test(value) ? "date" : NUMBER.test(value) ? "number" : "text";
    return { kind, value };
  }
  return undefined;
}

// invoice-0923.pdf -> invoice-*.pdf: digits are what usually changes between files of the same kind.
// The extension is kept as it is (video.mp4 stays .mp4).
export function globFor(name: string): string {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  return stem.replace(/\d+/g, "*").replace(/\*+/g, "*") + ext;
}

export function sameTarget(a?: ElementDescriptor, b?: ElementDescriptor): boolean {
  if (!a || !b) return false;
  if (a.selectors?.css && a.selectors.css === b.selectors?.css) return true;
  if (a.selectors?.xpath && a.selectors.xpath === b.selectors?.xpath) return true;
  const named = Boolean(a.name || a.label);
  return named && a.tag === b.tag && a.role === b.role && a.name === b.name && a.label === b.label && a.near === b.near;
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0)) || "/";

// Two AX descriptions of the same control: same app, role and identifier, or same role, name and place.
function sameElement(a?: AxElement, b?: AxElement): boolean {
  if (!a || !b || a.app !== b.app || a.role !== b.role) return false;
  if (a.identifier || b.identifier) return a.identifier === b.identifier;
  return a.title === b.title && a.description === b.description && a.path?.join(">") === b.path?.join(">");
}
