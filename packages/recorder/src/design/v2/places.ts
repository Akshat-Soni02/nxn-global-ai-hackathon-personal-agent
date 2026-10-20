// Where a step may reach: paths as the player opens them (~ expanded, symlinks followed, dates written out), sites by
// origin, and what the recording touched. Shared by the old design agent until Task 10 and by v2's guardrails.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { dateValue, isAction, parseDateRef, parseRef, type Skill, triggerOf, walkSteps } from "@shadow/core";
import type { NormalisedStep } from "../../normalise.ts";

export const originOf = (url: unknown): string | undefined => {
  try {
    return typeof url === "string" ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

// A path as the player will open it: ~ expanded, made absolute, and symlinks followed as far as the path exists, so
// a link inside an allowed folder can't reach outside it.
export const expand = (path: string): string => {
  const abs = resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return abs;
      tail.unshift(basename(head));
      head = parent;
    }
  }
};
export const inside = (where: unknown, folders: string[]): boolean =>
  typeof where === "string" && folders.some((f) => expand(where) === f || expand(where).startsWith(`${f}${sep}`));
// A whole-string reference to a value an earlier step produced, or a run was given. A date is neither: it is checked
// like any place.
export const isReference = (where: unknown): boolean => {
  const inner = typeof where === "string" ? /^\{\{([^}]+)\}\}$/.exec(where.trim())?.[1] : undefined;
  return inner !== undefined && Boolean(parseRef(inner.trim())) && !parseDateRef(inner);
};
// A place with its dates written out as a run will write them: "{{today|D/.}}{{today|./D}}" is "20/../20", and
// only written out can the check see it climb. Any day gives the same dots and slashes.
export const withDates = (where: unknown): unknown =>
  typeof where === "string"
    ? where.replace(/\{\{([^}]+)\}\}/g, (ref, inner: string) => {
        const date = parseDateRef(inner);
        return date ? dateValue(date, new Date()) : ref;
      })
    : where;
// A glob that leaves its folder: absolute, from ~, or climbing with "..".
export const climbs = (glob: unknown): boolean =>
  typeof glob === "string" && (isAbsolute(glob) || glob.startsWith("~") || /(^|[\\/])\.\.([\\/]|$)/.test(glob));
// The arguments of fs steps that name a place on disk.
export const PATH_ARGS = ["dir", "path", "from", "to"] as const;

// The folders a recording touched (files picked, dropped, moved or downloaded, the folder its trigger watches, and
// where the first draft looks for files): a new or changed fs step may look only there, so no step can read ~/.ssh
// and hand it to an llm step.
export function recordedFolders(steps: NormalisedStep[], original: Skill): string[] {
  const paths = steps.flatMap((s) => [
    s.path,
    s.toPath,
    s.file?.path,
    ...(s.files ?? []).map((f) => f.path),
    ...(s.produces ?? []),
  ]);
  const folders = paths.filter((p): p is string => !!p).map((p) => dirname(expand(p)));
  const trigger = triggerOf(original);
  for (const input of Object.values(trigger.inputs)) {
    if (typeof input.resolve?.dir === "string") folders.push(expand(input.resolve.dir));
  }
  for (const when of trigger.when) {
    const dir = (when as { dir?: unknown }).dir;
    if (typeof dir === "string") folders.push(expand(dir));
  }
  for (const { step } of walkSteps(original.steps)) {
    if (isAction(step) && step.channel === "fs" && typeof step.args.dir === "string")
      folders.push(expand(step.args.dir));
  }
  return [...new Set(folders)];
}

// Every page the recording was on, or a click took it to (a sheet opened from Drive is a page it visited).
export function recordedPages(steps: NormalisedStep[]): string[] {
  return [...new Set(steps.flatMap((s) => [s.url, s.navigatesTo]).filter((u): u is string => !!u))];
}

// For each skill step a recorded click or key press became, the page it opened. A step that submitted a form is left
// out: its page is a result, and opening it directly would skip the submitting.
export function recordedOpens(steps: NormalisedStep[], idsByStep: string[][]): Record<string, string> {
  const opens: Record<string, string> = {};
  steps.forEach((s, i) => {
    if (!s.navigatesTo || s.submits) return;
    for (const id of idsByStep[i] ?? []) opens[id] = s.navigatesTo;
  });
  return opens;
}

// The same page, whatever the per-visit parts of its address (query, fragment).
export function samePage(a: unknown, b: unknown): boolean {
  try {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
}
