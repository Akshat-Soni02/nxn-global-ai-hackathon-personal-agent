// Keys worth recording beyond Enter and Escape (spec 1.8): shortcuts with ⌘, Ctrl or Alt (⌘Enter sends in Gmail), and
// single keys outside text fields (Gmail's e archives, c composes). Never a keylogger: a single key is held for a
// second, and three printable keys within a second are typing (a page that draws its own text has no text field), so
// none of them is recorded. Google Docs, Sheets and Slides record no single keys at all.
export type Modifier = "cmd" | "shift" | "option" | "ctrl";
const EDITING = new Set(["a", "c", "v", "x", "z", "y"]);
const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);
export const CANVAS_EDITORS = /^https:\/\/docs\.google\.com\/(spreadsheets|document|presentation)\//;

export function modifiersOf(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): Modifier[] {
  const mods: Modifier[] = [];
  if (e.metaKey) mods.push("cmd");
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("option");
  if (e.shiftKey) mods.push("shift");
  return mods;
}

// A shortcut to record at once: a key with ⌘, Ctrl or Alt that isn't plain editing (copy, paste, cut, select all,
// undo, redo), which the copy and paste events already say.
export function shortcut(key: string, mods: Modifier[]): boolean {
  if (MODIFIER_KEYS.has(key) || !mods.some((m) => m !== "shift")) return false;
  // A character typed with Option (or AltGr, Ctrl+Option) is typing: @ [ ] { } on many layouts, — and … on US.
  // A printable key is a shortcut only with ⌘, or with Ctrl alone.
  if (key.length === 1 && !mods.includes("cmd") && !(mods.includes("ctrl") && !mods.includes("option"))) return false;
  const editing = mods.length === 1 && (mods[0] === "cmd" || mods[0] === "ctrl") && EDITING.has(key.toLowerCase());
  return !editing;
}

interface Held {
  key: string;
  at: number;
  el: Element;
  timer: ReturnType<typeof setTimeout>;
}

export class SingleKeys {
  private held: Held[] = [];
  private burstUntil = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly send: (key: string, at: number, el: Element) => void,
    private readonly waitMs = 1_000,
  ) {}

  // A printable key with no modifier, pressed outside any text field.
  press(key: string, at: number, el: Element): void {
    if (at < this.burstUntil) {
      this.burstUntil = at + this.waitMs; // still typing
      return;
    }
    this.held = this.held.filter((h) => at - h.at < this.waitMs);
    if (this.held.length >= 2) {
      for (const h of this.held) clearTimeout(h.timer);
      this.held = [];
      this.burstUntil = at + this.waitMs;
      return;
    }
    const entry: Held = {
      key,
      at,
      el,
      timer: setTimeout(() => {
        this.held = this.held.filter((h) => h !== entry);
        this.send(key, at, el);
      }, this.waitMs),
    };
    this.held.push(entry);
  }

  stop(): void {
    for (const h of this.held) clearTimeout(h.timer);
    this.held = [];
  }
}
