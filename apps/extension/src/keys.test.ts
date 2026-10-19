import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_EDITORS, SingleKeys, shortcut } from "./keys.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const el = {} as Element;

describe("shortcuts", () => {
  it("are keys with ⌘, Ctrl or Alt, except plain editing", () => {
    expect(shortcut("Enter", ["cmd"])).toBe(true); // ⌘Enter sends in Gmail
    expect(shortcut("k", ["ctrl"])).toBe(true);
    expect(shortcut("c", ["cmd"])).toBe(false);
    expect(shortcut("v", ["ctrl"])).toBe(false);
    expect(shortcut("A", ["shift"])).toBe(false);
    expect(shortcut("Meta", ["cmd"])).toBe(false);
  });
});

describe("single keys", () => {
  it("are sent after a second on their own (Gmail's e), never as part of typing", () => {
    const sent: string[] = [];
    const keys = new SingleKeys((key) => sent.push(key));
    keys.press("e", 0, el);
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual(["e"]);
    // Typing into a page that draws its own text: three keys in a second, none recorded, nor any key until a pause.
    keys.press("h", 5_000, el);
    keys.press("e", 5_100, el);
    keys.press("l", 5_200, el);
    keys.press("l", 5_300, el);
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual(["e"]);
    keys.press("c", 7_000, el);
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual(["e", "c"]);
  });

  it("are never taken in Google Docs, Sheets or Slides", () => {
    expect(CANVAS_EDITORS.test("https://docs.google.com/spreadsheets/d/X/edit")).toBe(true);
    expect(CANVAS_EDITORS.test("https://mail.google.com/mail/u/0/#inbox")).toBe(false);
  });
});
