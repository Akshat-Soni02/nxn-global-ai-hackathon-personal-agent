// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Button, type ButtonState, mountButton, viewOf } from "./button.ts";
import { type PageEvent, startCapture } from "./capture.ts";

describe("what the button shows", () => {
  const now = 1_000_000;

  it("is hidden while the daemon is not running", () => {
    expect(viewOf(undefined, now)).toBeUndefined();
    expect(viewOf({ daemon: false }, now)).toBeUndefined();
  });

  it("goes Record -> Stop with a clock -> compiling -> question -> saved -> Record", () => {
    expect(viewOf({ daemon: true }, now)).toMatchObject({ kind: "idle", icon: "record" });
    expect(viewOf({ daemon: true, recording: { since: now - 65_000 } }, now)).toMatchObject({
      kind: "rec",
      icon: "stop",
      text: "Stop · 1:05",
    });
    const status = (phase: NonNullable<ButtonState["status"]>["phase"], at = now) => ({
      daemon: true,
      status: { phase, text: phase, at },
    });
    expect(viewOf(status("compiling"), now)).toMatchObject({ kind: "work", icon: "spinner" });
    expect(viewOf(status("question", now - 60_000), now)).toMatchObject({ kind: "work", icon: "terminal" });
    expect(viewOf(status("saved"), now)).toMatchObject({ kind: "note", icon: "check" });
    expect(viewOf(status("saved", now - 16_000), now)).toMatchObject({ kind: "idle" }); // the note has expired
  });
});

describe("the button on a page", () => {
  let button: Button | undefined;
  afterEach(() => {
    button?.remove();
    document.body.innerHTML = "";
  });

  it("asks to start, then stop, and pressing it is never recorded as a step", async () => {
    document.body.innerHTML = `<button id="save">Save</button>`;
    // The shadow root is closed: keep a handle on it, as only the button's own code has one.
    const roots: ShadowRoot[] = [];
    const attach = Element.prototype.attachShadow;
    const spy = vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init) {
      const root = attach.call(this, init);
      roots.push(root);
      return root;
    });
    const press = vi.fn(async (_command: "start" | "stop") => undefined);
    button = mountButton(document, { press });
    spy.mockRestore();
    const events: PageEvent[] = [];
    let recording = false;
    const stop = startCapture(
      document,
      (e) => events.push(e),
      () => recording,
    );

    const host = document.querySelector("[data-taskplayer-ui]") as HTMLElement;
    const inner = roots[0]?.querySelector("button") as HTMLButtonElement;
    expect(host.shadowRoot).toBeNull(); // closed to the page
    expect(host.style.display).toBe("none"); // no state yet: no daemon

    button.update({ daemon: true });
    expect(host.style.display).toBe("block");
    expect(inner.getAttribute("aria-label")).toBe("Record a task (Task Player)");
    inner.click();
    await Promise.resolve();
    expect(press).toHaveBeenLastCalledWith("start");

    recording = true;
    button.update({ daemon: true, recording: { since: Date.now() } });
    expect(inner.getAttribute("aria-label")).toMatch(/^Stop recording/);
    for (const type of ["pointerdown", "pointerup", "keydown"]) {
      inner.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true }));
    }
    inner.click();
    await Promise.resolve();
    expect(press).toHaveBeenLastCalledWith("stop");
    expect(events).toEqual([]); // pressing Stop is not a step of the task

    // The page itself is still recorded.
    (document.querySelector("#save") as HTMLElement).click();
    expect(events.map((e) => [e.event, e.target?.name])).toEqual([["click", "Save"]]);
    stop();
  });

  it("replaces a button left by an orphaned copy of the content script", () => {
    let alive = true;
    const old = mountButton(document, { press: async () => undefined, alive: () => alive });
    alive = false; // the extension was reloaded
    button = mountButton(document, { press: async () => undefined });
    expect(document.querySelectorAll("[data-taskplayer-ui]")).toHaveLength(1);
    old.remove();
  });
});
