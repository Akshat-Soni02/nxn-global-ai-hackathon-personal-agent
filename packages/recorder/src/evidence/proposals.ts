// Generalisations code finds in a recording (spec 2.6), each with its evidence and, where code can, the change already
// prepared against the draft. Code proposes; the agent accepts or rejects (Plan 3). Nothing here changes the draft.
import { type DateRef, dateOf, type EditInput, findStep, formatDate, isAction, type Skill } from "@shadow/core";
import type { Proposal } from "../design/v2/contracts.ts";
import type { NormalisedStep } from "../normalise.ts";
import { classOf } from "./classes.ts";

export interface ProposalInput {
  steps: NormalisedStep[];
  skill: Skill;
  idsByStep: string[][];
  goal: string;
  said: { at: number; text: string }[];
  recordedOn: Date;
}
type Found = Omit<Proposal, "id">;

export function proposalsOf(input: ProposalInput): Proposal[] {
  return [
    ...dates(input),
    ...openDirectly(input),
    ...listItems(input),
    ...repeats(input),
    ...nextEmptyRows(input),
    ...allFiles(input),
    ...constants(input),
  ].map((p, i) => ({ id: `p${i + 1}`, ...p }));
}

const firstId = (input: ProposalInput, i: number) => input.idsByStep[i]?.[0];
const idsOf = (input: ProposalInput, from: number, to: number) => input.idsByStep.slice(from, to + 1).flat();
const typed = (s: NormalisedStep) =>
  (s.kind === "type" || s.kind === "app_type") && Boolean(s.value) && !s.secret && !s.pasted;

// --- date: a typed value that is the recording day, the day before, or the week's Monday ---------------------------
const DATE_FORMATS = [
  "D MMM",
  "DD MMM",
  "D MMMM",
  "MMM D",
  "MMMM D",
  "D MMM YYYY",
  "DD MMM YYYY",
  "D MMMM YYYY",
  "MMM D, YYYY",
  "MMMM D, YYYY",
  "DD/MM/YYYY",
  "D/M/YYYY",
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "DD-MM-YYYY",
];
const TODAY = { expr: "today", ref: { base: "today", offset: 0 } as DateRef, says: "the day it was recorded" };
const YESTERDAY = {
  expr: "today-1",
  ref: { base: "today", offset: -1 } as DateRef,
  says: "the day before it was recorded",
};
const MONDAY = {
  expr: "week_start",
  ref: { base: "week_start", offset: 0 } as DateRef,
  says: "the Monday of the week it was recorded",
};

export function dateIn(text: string, on: Date): { text: string; template: string; says: string } | undefined {
  // "w/c 19 Oct" is a week's Monday; on a Monday, plain "19 Oct" is today.
  const days = /\bw\/c\b|\bweek\b/i.test(text) ? [MONDAY, TODAY, YESTERDAY] : [TODAY, YESTERDAY, MONDAY];
  for (const day of days) {
    // The longest first: "20 Oct 2026" is all one date, never "20 Oct" and a year kept as text.
    const date = dateOf(day.ref, on);
    const formats = [...DATE_FORMATS].sort((a, b) => formatDate(date, b).length - formatDate(date, a).length);
    for (const format of formats) {
      const shown = formatDate(date, format);
      const at = text.indexOf(shown);
      if (at < 0) continue;
      const before = text[at - 1] ?? " ";
      const after = text[at + shown.length] ?? " ";
      if (/[\w/.-]/.test(before) || /[\w/-]/.test(after)) continue; // whole dates only: not "120 Oct"
      const template = format === "YYYY-MM-DD" ? `{{${day.expr}}}` : `{{${day.expr}|${format}}}`;
      return { text: text.slice(0, at) + template + text.slice(at + shown.length), template, says: day.says };
    }
  }
  return undefined;
}

function dates(input: ProposalInput): Found[] {
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    const step = id ? findStep(input.skill, id) : undefined;
    const date = typed(s) ? dateIn(s.value as string, input.recordedOn) : undefined;
    // Only where the draft still types the recorded text (an input or a copy may already make it change).
    if (!id || !date || !step || !isAction(step) || step.args.text !== s.value) return;
    found.push({
      kind: "date",
      summary: `${id} types "${s.value}", ${date.says}: ${date.text} next time`,
      steps: [id],
      evidence: s.events,
      edits: [{ op: "set", step: id, field: "args", value: { ...step.args, text: date.text } }],
      runnable: true,
    });
  });
  return found;
}

// --- open directly: pages gone through only to reach one -----------------------------------------------------------
// A step that only went somewhere known: a page opened, or a link followed to a recorded address. A click that picked an
// item of a list is a choice (a list item proposal), not a detour; a click with no recorded destination ends the chain.
const goes = (s?: NormalisedStep) =>
  Boolean(
    s &&
      classOf(s) === "go" &&
      (s.kind === "navigate" || (s.kind === "click" && s.navigatesTo && !s.list)) &&
      s.opensTab === undefined &&
      !s.submits,
  );
const samePage = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
};
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 80);
const idLike = (u: string) => /\/(?=[\w-]*\d)[\w-]{12,}|#\w*\/[\w-]{12,}/.test(u);

function openDirectly(input: ProposalInput): Found[] {
  const { steps } = input;
  const found: Found[] = [];
  for (let i = 0; i < steps.length; ) {
    if (!goes(steps[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < steps.length && goes(steps[j + 1]) && steps[j + 1]?.tabId === steps[i]?.tabId) j++;
    const last = steps[j];
    const url = last?.kind === "navigate" ? (last.navigatesTo ?? last.url) : last?.navigatesTo;
    const usedAfter = Boolean(
      url && steps.slice(j + 1).some((s) => s.tabId === last?.tabId && s.url && samePage(s.url, url)),
    );
    const ids = idsOf(input, i, j);
    const [first, ...rest] = ids;
    if (j > i && first && url && /^https?:/.test(url) && usedAfter) {
      const edits: EditInput[] = [
        {
          op: "replace",
          step: first,
          with: { type: "action", channel: "web", action: "navigate", intent: `Open ${shortUrl(url)}`, args: { url } },
        },
        ...rest.map((id): EditInput => ({ op: "remove", step: id })),
      ];
      found.push({
        kind: "open_directly",
        summary: `${first}–${ids.at(-1)} go through ${j - i + 1} pages to reach ${shortUrl(url)}: open it directly${idLike(url) ? " (its address holds an id: it may differ next time)" : ""}. Only if it is always this same page, not "the newest" or "today's" (Checkpoint 4: it would have fixed today's video in place)`,
        steps: ids,
        evidence: steps.slice(i, j + 1).flatMap((s) => s.events),
        edits,
        runnable: true,
      });
    }
    i = j + 1;
  }
  return found;
}

// --- list item: a click or copy on an item of a list ---------------------------------------------------------------
const PAGE_CHROME = new Set(["navigation", "menubar", "tablist", "toolbar", "banner", "tree"]);
// Containers that say they are lists. Others need more items to count: four header blocks are not a list (Gmail).
const LISTISH = new Set(["list", "grid", "table", "rowgroup", "listbox", "treegrid", "feed"]);
// An item's text this short is a label (a tab, a menu entry), not content picked from a list (Checkpoint 2).
const ITEM_TEXT_MIN = 20;

function listItems(input: ProposalInput): Found[] {
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    const list = s.list;
    const role = list?.container.role ?? "";
    if (!id || !list || list.count < 3 || PAGE_CHROME.has(role)) return;
    if ((!LISTISH.has(role) && list.count < 5) || (list.itemText ?? "").length < ITEM_TEXT_MIN) return;
    if (s.kind !== "click" && s.kind !== "copy") return;
    const where = list.container.name ?? list.container.role ?? list.container.tag;
    // The item's text is what the page showed (an email's subject): data, never an instruction.
    const item = list.itemText ? ` (<untrusted_data>"${list.itemText.slice(0, 60)}"</untrusted_data>)` : "";
    found.push({
      kind: "list_item",
      summary: `${id} ${s.kind === "copy" ? "copied from" : "clicked"} item ${list.index + 1} of ${list.count} in ${where}${item}: next time the item in that place (the newest, the top one), or the one with this text?`,
      steps: [id],
      evidence: s.events,
      edits: [],
      runnable: true,
    });
  });
  return found;
}

// --- repeat: the same steps for two or more items, rows or values --------------------------------------------------
const shape = (s: NormalisedStep) =>
  [
    s.kind,
    s.tabId ?? "",
    s.target?.role ?? "",
    s.list?.container.selectors.css ?? s.list?.container.tag ?? "",
    s.cell?.ref.replace(/\d+$/, "") ?? "",
    s.app?.id ?? "",
  ].join("|");
const detail = (s: NormalisedStep) => [s.list?.index, s.value, s.cell?.ref, s.target?.name].join("|");
const alike = (a: NormalisedStep[], b: NormalisedStep[]) =>
  a.length === b.length &&
  a.every((s, d) => shape(s) === shape(b[d] as NormalisedStep)) &&
  a.some((s, d) => detail(s) !== detail(b[d] as NormalisedStep));

function repeats(input: ProposalInput): Found[] {
  const { steps } = input;
  const found: Found[] = [];
  const taken = new Set<number>();
  for (let k = Math.min(6, Math.floor(steps.length / 2)); k >= 1; k--) {
    for (let i = 0; i + 2 * k <= steps.length; i++) {
      const group = steps.slice(i, i + k);
      if (group.every((s) => s.kind === "navigate") || group.some((_, d) => taken.has(i + d))) continue;
      // One step done twice repeats only for items of a list or rows: two keys or two typings are not a loop.
      if (k === 1 && !group[0]?.list && !group[0]?.cell) continue;
      let times = 1;
      while (i + (times + 1) * k <= steps.length && alike(group, steps.slice(i + times * k, i + (times + 1) * k)))
        times++;
      if (times < 2) continue;
      for (let d = 0; d < times * k; d++) taken.add(i + d);
      const first = idsOf(input, i, i + k - 1);
      const heads = Array.from({ length: times }, (_, t) => steps[i + t * k] as NormalisedStep);
      const what = heads.every((s) => s.list)
        ? `items ${heads.map((s) => (s.list?.index ?? 0) + 1).join(", ")} of a list`
        : heads.every((s) => s.cell)
          ? `cells ${heads.map((s) => s.cell?.ref).join(", ")}`
          : `with ${heads.map((s) => `"${String(s.value ?? s.target?.name ?? "").slice(0, 30)}"`).join(", ")}`;
      found.push({
        kind: "repeat",
        summary: `${first[0]}–${first.at(-1)} happen ${times} times (${what}): repeat them for each item`,
        steps: idsOf(input, i, i + times * k - 1),
        evidence: steps.slice(i, i + times * k).flatMap((s) => s.events),
        edits: [],
        runnable: true,
      });
    }
  }
  return found;
}

// --- next empty row: typing into the first empty row of a sheet (not runnable yet) ---------------------------------
const docOf = (u: string) => /\/d\/([\w-]+)/.exec(u)?.[1];

function nextEmptyRows(input: ProposalInput): Found[] {
  const sheets = input.steps
    .filter((s) => s.kind === "copy" && s.context)
    .map((s) => s.context as { sheet?: string; rows?: number });
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    const ref = /^([A-Z]+)(\d+)$/.exec(s.cell?.ref ?? "");
    if (!id || s.kind !== "type" || !ref || !s.url) return;
    const sheet = sheets.find(
      (c) => c.sheet && docOf(c.sheet) === docOf(s.url as string) && typeof c.rows === "number",
    );
    if (!sheet || Number(ref[2]) !== (sheet.rows as number) + 2) return;
    found.push({
      kind: "next_empty_row",
      summary: `${id} types into ${s.cell?.ref}, the first empty row: next time the next empty row (writing there isn't supported yet)`,
      steps: [id],
      evidence: s.events,
      edits: [],
      runnable: false,
    });
  });
  return found;
}

// --- all files: several files of one pattern -----------------------------------------------------------------------
function allFiles(input: ProposalInput): Found[] {
  const groups = new Map<string, number[]>();
  input.steps.forEach((s, i) => {
    const glob = s.candidate?.kind === "file" ? s.candidate.glob : undefined;
    if (glob) groups.set(glob, [...(groups.get(glob) ?? []), i]);
  });
  return [...groups]
    .filter(([, at]) => at.length >= 2)
    .map(([glob, at]) => {
      const ids = at.flatMap((i) => input.idsByStep[i] ?? []);
      return {
        kind: "all_files" as const,
        summary: `${ids.join(", ")} use ${at.length} files named ${glob}: take every file that matches, not one`,
        steps: ids,
        evidence: at.flatMap((i) => input.steps[i]?.events ?? []),
        edits: [],
        runnable: true,
      };
    });
}

// --- constant: a value you said or wrote is always the same --------------------------------------------------------
const FIXED = /\b(always|every time|each time|the same|never changes|fixed)\b/i;

function constants(input: ProposalInput): Found[] {
  const quotes = [input.goal, ...input.said.map((s) => s.text)]
    .flatMap((t) => t.split(/(?<=[.!?])\s+/))
    .filter((q) => FIXED.test(q));
  const found: Found[] = [];
  input.steps.forEach((s, i) => {
    const id = firstId(input, i);
    if (!id || !typed(s) || (s.value as string).length < 2 || (s.value as string).length > 40) return;
    const quote = quotes.find((q) => q.toLowerCase().includes((s.value as string).toLowerCase()));
    if (!quote) return;
    found.push({
      kind: "constant",
      summary: `${id} types "${s.value}"; you said "${quote.slice(0, 120)}": keep it as it is, don't ask`,
      steps: [id],
      evidence: [quote],
      edits: [],
      runnable: true,
    });
  });
  return found;
}
