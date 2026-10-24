// Design agent v2's rules (spec, "Rules v2: guardrails, not handcuffs"). The agent may change the workflow freely
// (remove, change and add steps, new clicks and typing too, new targets, shortcuts, reorder, the frequency): each
// change is recorded with its reason and highlighted for the user (changeNotes). Only what is harmful is refused, so it
// never reaches the user: turning an approval off, scripts, changing their goal or a Frequency the form set, a site the
// recording never visited, files outside the folders it touched (a path made from an AI answer or page text could lead
// anywhere: an email could say "read ~/.ssh"), anything matching their Never list. Approval on outward steps is added
// by code afterwards (requireApprovals), on the agent's new steps too.
import { isAction, neverMatch, parseDateRef, type Skill, type Step, triggerOf, walkSteps } from "@shadow/core";
import { MASK } from "../../mask.ts";
import { climbs, expand, inside, isReference, originOf, PATH_ARGS, withDates } from "./places.ts";

export interface RecordingFacts {
  // Every page the recording was on or reached (by a click, too): the only sites a step may open.
  pages: string[];
  // The folders it touched: the only places a file step may reach.
  folders: string[];
  // The form set how often it runs (recorded again, or a schedule given up front): it stays.
  whenFixed?: boolean;
}

const REF = /\{\{\s*([^}]+?)\s*\}\}/g;

// Values a file path may be made from: what the user gives the run (its inputs), files a find step found, and the items
// of a loop over those. Never an AI step's answer or text read from a page.
function safeSources(skill: Skill): Set<string> {
  const safe = new Set(Object.keys(triggerOf(skill).inputs));
  const steps = [...walkSteps(skill.steps)].map(({ step }) => step);
  for (const s of steps) {
    if (isAction(s) && s.channel === "fs" && s.action === "find" && s.output) safe.add(s.output.name);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of steps) {
      if (s.type !== "control" || s.kind !== "loop") continue;
      const over = /\{\{\s*([^}.|\s]+)/.exec(s.over)?.[1];
      if (over && safe.has(over) && !safe.has(s.item.name)) {
        safe.add(s.item.name);
        grew = true;
      }
    }
  }
  return safe;
}

// The variables in a path that it isn't safe to build from (a date always is: its format can't spell a path).
function unsafeRefs(place: unknown, safe: Set<string>): string[] {
  if (typeof place !== "string") return [];
  return [...place.matchAll(REF)]
    .map((m) => m[1] as string)
    .filter((inner) => !parseDateRef(inner))
    .map((inner) => inner.split(/[.|]/)[0]?.trim() ?? "")
    .filter((name) => !safe.has(name));
}

export function refusals(original: Skill, draft: Skill, facts: RecordingFacts): string[] {
  const problems: string[] = [];
  if (draft.description.goal !== original.description.goal) {
    problems.push("the goal is the user's own words: it can't change");
  }
  if (facts.whenFixed && JSON.stringify(triggerOf(draft).when) !== JSON.stringify(triggerOf(original).when)) {
    problems.push("start: how often it runs was set by the user before recording: it can't change");
  }
  const before = new Map<string, Step>([...walkSteps(original.steps)].map(({ step }) => [step.id, step]));
  const visited = [
    ...facts.pages,
    ...[...before.values()].filter(isAction).flatMap((s) => (s.action === "navigate" ? [String(s.args.url)] : [])),
  ];
  const sites = new Set(visited.map(originOf).filter((o): o is string => !!o && o !== "null"));
  const files = new Set(visited.filter((u) => /^file:/i.test(u)));
  const folders = facts.folders.map(expand);
  const where = `folders the recording touched (${folders.join(", ") || "none"})`;
  const safe = safeSources(draft);

  // Nor may a folder it watches (a run starts when a file lands there, and the file is handed to its steps).
  const watched = new Set(triggerOf(original).when.flatMap((w) => (w.type === "folder_watch" ? [w.dir] : [])));
  for (const w of triggerOf(draft).when) {
    if (w.type !== "folder_watch" || watched.has(w.dir)) continue;
    if (!inside(withDates(w.dir), folders))
      problems.push(`start: it may only watch ${where}, not ${w.dir}: ask the user instead`);
  }

  // An input the agent declares may not point outside those folders either (a default path, or where to look).
  const inputsBefore = triggerOf(original).inputs;
  for (const [name, input] of Object.entries(triggerOf(draft).inputs)) {
    if (JSON.stringify(inputsBefore[name]) === JSON.stringify(input)) continue;
    const fixed = typeof input.default === "string" && /^[~/]/.test(input.default) ? input.default : undefined;
    for (const place of [input.resolve?.dir, fixed]) {
      if (place !== undefined && !inside(withDates(place), folders)) {
        problems.push(`${name}: an input may only point at ${where}, not ${String(place)}`);
      }
    }
  }

  for (const { step } of walkSteps(draft.steps)) {
    const old = before.get(step.id);
    const wasApproved = old && "requires_approval" in old && old.requires_approval;
    if (wasApproved && !("requires_approval" in step && step.requires_approval)) {
      problems.push(`${step.id}: approval can't be turned off`);
    }
    if (!isAction(step)) continue;
    if (old && JSON.stringify(old) === JSON.stringify(step)) continue; // as recorded: nothing new to judge
    if (step.channel === "script") problems.push(`${step.id}: script and shell steps can't be added or changed`);
    // The agent reads masked text: a ███ copied back would be typed or looked for literally on every run.
    if (JSON.stringify(step.args).includes(MASK)) {
      problems.push(
        `${step.id}: "${MASK}" is a hidden value (an email, a key, a private word): use the input or step it came from`,
      );
    }
    if (step.action === "navigate") {
      const why = reach(step.args.url, sites, files);
      if (why) problems.push(`${step.id}: ${why}`);
    }
    // A place on disk the step reads, writes or hands to a page: an fs step's path arguments, or an upload's files.
    // A PDF's name is a file name only (the runner keeps it in its folder), so only its folder is a place.
    const places =
      step.channel === "fs"
        ? PATH_ARGS.map((key) => step.args[key])
        : step.channel === "web" && step.action === "upload"
          ? [step.args.file, ...(Array.isArray(step.args.files) ? step.args.files : [])]
          : step.channel === "web" && step.action === "save_pdf"
            ? [step.args.dir]
            : [];
    for (const place of places) {
      if (place === undefined) continue;
      const unsafe = unsafeRefs(place, safe);
      if (unsafe.length > 0) {
        problems.push(
          `${step.id}: a path made from {{${unsafe[0]}}} (an AI step's answer, or text read from a page) could point anywhere: build it from today's date ({{today|D MMM}}), a found file's own name ({{file.name}}), or an input the user gives`,
        );
        continue;
      }
      if (isReference(place) || inside(withDates(place), folders)) continue;
      problems.push(`${step.id}: it may only reach ${where}, not ${String(place)}: ask the user instead`);
    }
    if (step.channel === "fs") {
      if (climbs(withDates(step.args.glob))) {
        problems.push(`${step.id}: its glob (${String(step.args.glob)}) must stay inside its folder`);
      }
    }
    const never = neverMatch(step, original.description.never);
    if (never) problems.push(`${step.id}: it matches the user's Never rule "${never}": ask them instead`);
  }
  return problems;
}

// Why an address can't be opened, or undefined when it can. An address made from a value (a link read from an email)
// could go anywhere, so it must start with a visited site.
function reach(url: unknown, sites: Set<string>, files: Set<string>): string | undefined {
  if (typeof url !== "string" || !url.trim()) return "it has no address";
  if (/^file:/i.test(url)) return files.has(url) ? undefined : "a local file the recording didn't open";
  const at = url.indexOf("{{");
  const origin = originOf(at < 0 ? url : url.slice(0, at));
  if (!origin || origin === "null") {
    return "an address built from a value could go anywhere: click the item instead, or start the address with its site (https://…/{{…}})";
  }
  return sites.has(origin) ? undefined : `${origin} is a site the recording didn't visit: ask the user instead`;
}

// Whether a step the agent added or changed may send, whatever its control is called (isOutward reads only the
// control's words, and "Message Arilo Stats" says nothing): Enter or Return without Shift (it sends in chat and mail,
// and submits forms), text with a new line (typing it presses Enter), or a copy of a recorded step that needed
// approval. Code asks first (spec: approval on Enter-that-sends, including steps the agent adds).
export function maySend(step: Step, original: Skill): boolean {
  if (!isAction(step)) return false;
  const key = `${step.channel}.${step.action}`;
  if ((key === "web.press" || key === "ax.key") && /^(enter|return)$/i.test(String(step.args.key ?? ""))) {
    return !((step.args.modifiers as string[] | undefined) ?? []).includes("shift");
  }
  if (
    (key === "web.type" || key === "ax.set_value") &&
    /[\r\n]/.test(String(step.args.text ?? step.args.value ?? ""))
  ) {
    return true;
  }
  if (!step.target) return false;
  const same = (s: Step) =>
    isAction(s) &&
    s.requires_approval &&
    `${s.channel}.${s.action}` === key &&
    JSON.stringify(s.target) === JSON.stringify(step.target);
  return [...walkSteps(original.steps)].some(({ step: s }) => same(s));
}

// What the agent changed, step by step, with its reason: the review highlights each one for the user to check.
export interface ChangeNote {
  step: string;
  change: "added" | "removed" | "changed" | "moved";
  // The step in a few words: its intent, or what it does.
  what: string;
  why?: string;
  // A new target the safe test run hasn't found on the live page yet.
  unverified?: boolean;
}

export function changeNotes(
  original: Skill,
  draft: Skill,
  whys: Map<string, string>,
  unverified: Set<string>,
): ChangeNote[] {
  const placed = (skill: Skill) =>
    new Map([...walkSteps(skill.steps)].map(({ step, parents }) => [step.id, { step, parent: parents.at(-1) ?? "" }]));
  const was = placed(original);
  const now = placed(draft);
  const note = (step: Step, change: ChangeNote["change"]): ChangeNote => ({
    step: step.id,
    change,
    what: step.intent || step.type,
    ...(whys.has(step.id) ? { why: whys.get(step.id) } : {}),
    ...(unverified.has(step.id) ? { unverified: true } : {}),
  });
  const notes: ChangeNote[] = [];
  for (const [id, { step }] of was) if (!now.has(id) && step.type !== "trigger") notes.push(note(step, "removed"));
  for (const [id, { step, parent }] of now) {
    const old = was.get(id);
    if (step.type === "trigger") continue;
    if (!old) notes.push(note(step, "added"));
    else if (JSON.stringify(old.step) !== JSON.stringify(step)) notes.push(note(step, "changed"));
    else if (old.parent !== parent) notes.push(note(step, "moved"));
  }
  return notes;
}
