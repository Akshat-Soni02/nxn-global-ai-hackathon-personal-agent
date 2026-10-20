// The key events a press sends (CDP Input.dispatchKeyEvent): named keys and any single character, with ⌘, Ctrl,
// Option and Shift. A recording keeps Gmail's e and ⌘Enter (spec 1.8); replay presses them the same way.
export type Modifier = "cmd" | "shift" | "option" | "ctrl";

export interface KeyEvent {
  type: "keyDown" | "keyUp";
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
  modifiers: number;
  text?: string;
}

const NAMED: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  " ": { code: "Space", keyCode: 32, text: " " },
};
// CDP's modifier bits.
const BITS: Record<Modifier, number> = { option: 1, ctrl: 2, cmd: 4, shift: 8 };

export function keyEvents(key: string, modifiers: Modifier[] = []): KeyEvent[] | string {
  let code: string;
  let keyCode: number;
  let text: string | undefined;
  const named = NAMED[key];
  if (named) ({ code, keyCode, text } = named);
  else if ([...key].length === 1) {
    const upper = key.toUpperCase();
    code = /[A-Z]/.test(upper) ? `Key${upper}` : /\d/.test(key) ? `Digit${key}` : "";
    keyCode = /[A-Z0-9]/.test(upper) ? upper.charCodeAt(0) : 0;
    text = key;
  } else return `unsupported key ${key}`;
  const bits = modifiers.reduce((sum, m) => sum | BITS[m], 0);
  // With ⌘ or Ctrl a key is a shortcut: it types nothing.
  const typed = text !== undefined && !modifiers.includes("cmd") && !modifiers.includes("ctrl") ? { text } : {};
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: bits };
  return [
    { type: "keyDown", ...common, ...typed },
    { type: "keyUp", ...common },
  ];
}

export function modifiersOf(value: unknown): Modifier[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is Modifier => m === "cmd" || m === "shift" || m === "option" || m === "ctrl");
}
