import { describe, expect, it } from "vitest";
import { keyEvents } from "./keys.ts";

describe("the keys a press sends", () => {
  it("types a single letter (Gmail's e)", () => {
    const common = { key: "e", code: "KeyE", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69, modifiers: 0 };
    expect(keyEvents("e")).toEqual([
      { type: "keyDown", ...common, text: "e" },
      { type: "keyUp", ...common },
    ]);
  });

  it("presses a shortcut with its modifiers, typing nothing (⌘Enter sends in Gmail)", () => {
    const common = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 4 };
    expect(keyEvents("Enter", ["cmd"])).toEqual([
      { type: "keyDown", ...common },
      { type: "keyUp", ...common },
    ]);
    expect(keyEvents("k", ["ctrl", "shift"])).toMatchObject([{ code: "KeyK", modifiers: 10 }, { modifiers: 10 }]);
    expect((keyEvents("k", ["ctrl"]) as { text?: string }[])[0]?.text).toBeUndefined();
  });

  it("says which key it can't press", () => {
    expect(keyEvents("F13")).toBe("unsupported key F13");
  });
});
