// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { shotHint } from "./shot.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a screenshot's hint from the page", () => {
  it("says not to take one while a password field has focus, or for a secret value", () => {
    document.body.innerHTML = `<input id="u"><input id="p" type="password">`;
    (document.getElementById("p") as HTMLInputElement).focus();
    expect(shotHint(document, {})).toEqual({ skip: true });
    (document.getElementById("u") as HTMLInputElement).focus();
    expect(shotHint(document, { secret: true })).toEqual({ skip: true });
  });

  it("gives the password and card fields on screen, to black out", () => {
    document.body.innerHTML = `<input id="u"><input type="password"><input autocomplete="cc-number">`;
    const boxes: Record<string, DOMRect> = {};
    for (const el of document.querySelectorAll("input")) {
      const box = { left: 10, top: 20 + Object.keys(boxes).length * 40, width: 200, height: 30 };
      const rect = { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top };
      boxes[el.outerHTML] = rect as DOMRect;
      el.getBoundingClientRect = () => rect as DOMRect;
    }
    const hint = shotHint(document, {});
    const scale = window.devicePixelRatio || 1;
    expect(hint.skip).toBeUndefined();
    expect(hint.masks).toEqual([
      { x: 10 * scale, y: 60 * scale, w: 200 * scale, h: 30 * scale },
      { x: 10 * scale, y: 100 * scale, w: 200 * scale, h: 30 * scale },
    ]);
  });
});
