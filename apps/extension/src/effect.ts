// What a click or an Enter did (spec 1.3), watched for 700 ms after it: did the page go somewhere, did something expand
// or open, did a field empty (a chat message sent), and how much changed near the target. Pages like Gmail re-render
// all the time, so "how much changed" is counted beyond what changed in the same place in the 700 ms before: a click on
// the header of an open email changes nothing, and is noise; a click that opens an email changes a lot near it.
// Only `import type` from @shadow/core: this runs in every page while recording.
import type { Effect } from "@shadow/core";

export type { Effect };
export const WATCH_MS = 700;
const OPENED: Record<string, Effect["opened"]> = {
  dialog: "dialog",
  alertdialog: "dialog",
  menu: "menu",
  menubar: "menu",
  listbox: "listbox",
};
const OPENABLE = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],dialog";

interface Change {
  t: number;
  node: Node;
  opened?: Effect["opened"];
}

export interface EffectWatcher {
  // Starts watching the page's changes: only while a recording is open (capture calls it on its first event of a
  // session), never during your ordinary browsing or a replay.
  start(): void;
  // Stops watching and forgets what it saw (the recording ended).
  pause(): void;
  // Watches what follows an action on `el`, from `since` (when the pointer went down; else now); `done` gets the effect
  // after WATCH_MS, unless the page went away first (then the navigation the browser reports is the effect).
  watch(el: Element, done: (effect: Effect) => void, since?: number): void;
  // The watcher's clock, to note when the pointer went down.
  clock(): number;
  stop(): void;
}

export function watchEffects(doc: Document, now: () => number = () => performance.now()): EffectWatcher {
  const changes: Change[] = [];
  let observer: MutationObserver | undefined;
  const record = (records: MutationRecord[]) => {
    const t = now();
    for (const r of records) {
      for (const node of r.addedNodes) changes.push({ t, node, opened: openedBy(node) });
      if (r.type !== "childList" || r.removedNodes.length > 0) changes.push({ t, node: r.target });
    }
    // Two seconds are enough: the 700 ms before the oldest watch, and the watch itself.
    while (changes.length > 0 && (changes[0]?.t ?? t) < t - 2_000) changes.shift();
    if (changes.length > 5_000) changes.splice(0, changes.length - 5_000);
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const start = () => {
    if (observer || !doc.documentElement) return;
    observer = new MutationObserver(record);
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  const pause = () => {
    observer?.disconnect();
    observer = undefined;
    changes.length = 0;
  };

  return {
    start,
    pause,
    clock: now,
    watch(el, done, since) {
      start();
      const t0 = since ?? now();
      const scope = scopeOf(el);
      const near = (c: Change) => scope.contains(c.node) || Boolean(c.opened);
      const before = changes.filter((c) => c.t >= t0 - WATCH_MS && c.t < t0 && near(c)).length;
      const url = doc.location?.href;
      const expandedBefore = expandedOf(el);
      const valueBefore = fieldText(el);
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!el.ownerDocument.defaultView) return;
        const after = changes.filter((c) => c.t >= t0);
        const extra = Math.max(0, after.filter(near).length - before);
        const effect: Effect = { changed: extra <= 2 ? "none" : extra <= 25 ? "small" : "large" };
        if (doc.location?.href !== url) effect.navigated = true;
        if (expandedBefore === false && expandedOf(el) === true) effect.expanded = true;
        const opened = after.find((c) => c.opened)?.opened;
        if (opened) effect.opened = opened;
        if (valueBefore.trim() && !fieldText(el).trim()) effect.emptied = true;
        done(effect);
      }, WATCH_MS);
      timers.add(timer);
    },
    stop() {
      pause();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

function openedBy(node: Node): Effect["opened"] {
  if (!(node instanceof Element)) return undefined;
  const role = node.getAttribute("role") ?? (node.localName === "dialog" ? "dialog" : "");
  if (OPENED[role]) return OPENED[role];
  const inner = node.querySelector(OPENABLE);
  return inner ? openedBy(inner) : undefined;
}

function expandedOf(el: Element): boolean | undefined {
  const holder = el.closest("[aria-expanded]");
  if (holder) return holder.getAttribute("aria-expanded") === "true";
  const details = el.closest("details");
  return details ? details.open : undefined;
}

function fieldText(el: Element): string {
  if ("value" in el && typeof (el as HTMLInputElement).value === "string") return (el as HTMLInputElement).value;
  return el.closest("[contenteditable]:not([contenteditable=false])")?.textContent ?? "";
}

// "Near the target": the closest region it sits in (a dialog, a list item, a section), so churn elsewhere on the page
// doesn't count for it.
function scopeOf(el: Element): Element {
  return el.closest("[role=dialog],dialog,[role=main],main,article,section,li,tr,form") ?? el.parentElement ?? el;
}
