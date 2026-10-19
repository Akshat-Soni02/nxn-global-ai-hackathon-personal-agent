// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type PageEvent, startCapture } from "./capture.ts";
import { describeElement } from "./describe.ts";

const load = (page: string) => {
  const html = readFileSync(join(import.meta.dirname, "../../../fixtures/pages", page), "utf8");
  document.documentElement.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/g, "");
};
const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const fire = (el: Element, type: string, init: EventInit = {}) =>
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));

describe("describeElement on the fixture pages", () => {
  it("describes the invoice input the way the example skill stores it", () => {
    load("upload.html");
    expect(describeElement($("input[type=file]"))).toMatchObject({
      tag: "input",
      role: "button", // Chrome's role for a file input
      name: "Upload invoice",
      near: "Documents",
      attrs: { type: "file", name: "invoice" },
      selectors: { css: "input[type=file][name=invoice]", xpath: "//section[h2='Documents']//input[@type='file']" },
    });
    expect(describeElement($("#submit"))).toMatchObject({
      role: "button",
      name: "Submit",
      selectors: { css: "#submit" },
    });
  });

  it("keeps a text-anchored selector on the redesigned page", () => {
    load("upload-drifted.html");
    expect(describeElement($("input[type=file]")).selectors.xpath).toBe(
      "//section[h2='Documents']//input[@type='file']",
    );
    expect(describeElement($(".cookie-banner button")).near).toBe("Cookies");
  });

  it("gives a select its label without its options, and a number field Chrome's role", () => {
    load("timesheet.html");
    expect(describeElement($("select"))).toMatchObject({ role: "combobox", name: "Project", label: "Project" });
    expect(describeElement($("input[name=hours]"))).toMatchObject({ role: "spinbutton", name: "Hours" });
  });
});

describe("capture", () => {
  const record = () => {
    const events: PageEvent[] = [];
    const stop = startCapture(
      document,
      (e) => events.push(e),
      () => true,
    );
    return { events, stop };
  };

  it("records a click on a label once, as a click on its control", () => {
    load("upload.html");
    const { events, stop } = record();
    const label = $("label");
    fire(label, "pointerdown");
    label.click(); // the browser also clicks the input the label is for
    stop();
    expect(events.map((e) => [e.event, e.target?.name, e.echo])).toEqual([["click", "Upload invoice", true]]);
  });

  it("records a picked file by name only", () => {
    load("upload.html");
    const { events, stop } = record();
    const input = $("input[type=file]");
    Object.defineProperty(input, "files", {
      value: [{ name: "invoice-0923.pdf", size: 48213, type: "application/pdf" }],
    });
    fire(input, "change");
    stop();
    expect(events).toMatchObject([
      { event: "file", file: { name: "invoice-0923.pdf", size: 48213, type: "application/pdf" } },
    ]);
  });

  it("turns keystrokes into one value, flushed before Enter, and never records a password", () => {
    load("timesheet.html");
    document.body.insertAdjacentHTML("beforeend", '<input type="password" name="pw">');
    const { events, stop } = record();
    const hours = $("input[name=hours]") as HTMLInputElement;
    for (const value of ["3", "38"]) {
      hours.value = value;
      fire(hours, "input");
    }
    hours.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    fire(hours, "change"); // the browser's change after Enter: already sent, not sent twice
    const pw = $("input[name=pw]") as HTMLInputElement;
    pw.value = "hunter2";
    fire(pw, "input");
    fire(pw, "change");
    const select = $("select") as HTMLSelectElement;
    select.value = "NX-101";
    fire(select, "change");
    stop();
    expect(events.map((e) => [e.event, e.value, e.secret])).toEqual([
      ["type", "38", undefined],
      ["key", "Enter", undefined],
      ["type", undefined, true],
      ["select", "NX-101", undefined],
    ]);
    expect(JSON.stringify(events)).not.toContain("hunter2");
  });

  it("records a copy's text, and a paste without its content", () => {
    load("paste-form.html");
    document.body.insertAdjacentHTML("afterbegin", "<p id='note'>Invoice total 1,234</p>");
    const { events, stop } = record();
    const copy = new Event("copy", { bubbles: true, composed: true });
    Object.defineProperty(copy, "clipboardData", { value: { getData: () => "1,234" } });
    $("#note").dispatchEvent(copy);
    const field = $("input[name=amount]") as HTMLInputElement;
    fire(field, "paste");
    field.value = "1,234 secret-ish pasted text";
    fire(field, "input");
    fire(field, "change");
    stop();
    expect(events.map((e) => [e.event, e.value, e.pasted])).toEqual([
      ["copy", "1,234", undefined],
      ["paste", undefined, true],
      ["type", undefined, true],
    ]);
    expect(JSON.stringify(events)).not.toContain("secret-ish");
  });

  it("records nothing while no session is open", () => {
    load("upload.html");
    const events: PageEvent[] = [];
    const stop = startCapture(
      document,
      (e) => events.push(e),
      () => false,
    );
    $("#submit").click();
    stop();
    expect(events).toEqual([]);
  });

  const select = (el: Element) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  const pointer = (el: Element, type: string, x: number) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: 5 }));

  it("records a drag-selection as the selected text in its own element, and not the click that follows", () => {
    document.body.innerHTML = `<article><h3 id="co">Eventual</h3><p>Building the AI data engine</p></article>`;
    const { events, stop } = record();
    const heading = $("#co");
    pointer(heading, "pointerdown", 0);
    select(heading);
    pointer(heading, "pointerup", 60);
    heading.click(); // the click the browser fires on whatever holds both ends of the selection
    stop();
    expect(events.map((e) => [e.event, e.value, e.target?.tag])).toEqual([["select_text", "Eventual", "h3"]]);
  });

  it("records a copy from the element holding the selection, and how it was made", () => {
    document.body.innerHTML = `<article><h3 id="co">Eventual</h3><p>Building it</p></article>`;
    const { events, stop } = record();
    select($("#co"));
    const copy = (key: boolean) => {
      if (key) document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }));
      const e = new Event("copy", { bubbles: true, composed: true });
      Object.defineProperty(e, "clipboardData", { value: { getData: () => "Eventual" } });
      $("#co").dispatchEvent(e);
    };
    copy(true);
    copy(false);
    stop();
    expect(events.filter((e) => e.event === "copy").map((e) => [e.target?.tag, e.via])).toEqual([
      ["h3", "keyboard"],
      ["h3", "menu"],
    ]);
  });

  it("gives a click its own id, where it landed, and its place in a list", () => {
    document.body.innerHTML = `<ul>${["a", "b", "c"].map((n) => `<li class="job"><a href="/${n}"><b>${n}</b></a></li>`).join("")}</ul>`;
    const { events, stop } = record();
    const third = document.querySelectorAll("a")[2] as HTMLElement;
    pointer(third, "pointerdown", 5);
    third.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, clientX: 5, clientY: 5, detail: 1 }));
    stop();
    const click = events.find((e) => e.event === "click");
    expect(click?.cid).toEqual(expect.any(String));
    expect(click?.point).toMatchObject({ x: 5, y: 5, dpr: 1 });
    expect(click?.list).toMatchObject({ index: 2, count: 3 });
  });

  it("records ⌘Enter with its modifier, and a ⌘-click as opening a new tab", () => {
    document.body.innerHTML = `<textarea id="m">hi</textarea><a id="l" href="/x">Open</a>`;
    const { events, stop } = record();
    $("#m").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, composed: true }));
    $("#l").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, metaKey: true, detail: 1 }));
    stop();
    expect(events.map((e) => [e.event, e.value, e.modifiers, e.newTab])).toEqual([
      ["key", "Enter", ["cmd"], undefined],
      ["click", undefined, undefined, true],
    ]);
  });

  it("records what a page's Copy button put on the clipboard, as a copy made by that button", () => {
    document.body.innerHTML = `<button id="copy-link">Copy link</button>`;
    const { events, stop } = record();
    $("#copy-link").click();
    const message = (text: string, source: Window | null) => {
      const e = new MessageEvent("message", { data: { __shadowCopy: true, text } });
      Object.defineProperty(e, "source", { value: source });
      window.dispatchEvent(e);
    };
    message("https://share.test/abc", window);
    message("forged", null); // not from this page's own window: ignored
    stop();
    expect(events.filter((e) => e.event === "copy").map((e) => [e.value, e.via, e.target?.name])).toEqual([
      ["https://share.test/abc", "button", "Copy link"],
    ]);
  });

  it("never records text selected inside a secret field, even when the selection's container is its wrapper", () => {
    document.body.innerHTML = `<div id="w"><input name="otp" value="483920"><span id="s">code</span></div>`;
    const { events, stop } = record();
    ($("input[name=otp]") as HTMLInputElement).focus();
    const s = $("#s");
    pointer(s, "pointerdown", 0);
    select(s);
    pointer(s, "pointerup", 60);
    const copy = new Event("copy", { bubbles: true, composed: true });
    Object.defineProperty(copy, "clipboardData", { value: { getData: () => "483920" } });
    s.dispatchEvent(copy);
    stop();
    expect(events.find((e) => e.event === "select_text")).toBeUndefined();
    expect(events.find((e) => e.event === "copy")?.secret).toBe(true);
    expect(JSON.stringify(events)).not.toContain("483920");
  });

  it("never records characters typed with Option, nor any key in a secret field", () => {
    document.body.innerHTML = `<input type="password" name="pw"><div id="doc">x</div>`;
    const { events, stop } = record();
    const key = (el: Element, init: KeyboardEventInit) =>
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, ...init }));
    key($("input[name=pw]"), { key: "@", altKey: true });
    key($("input[name=pw]"), { key: "Enter", metaKey: true });
    key($("#doc"), { key: "@", altKey: true });
    stop();
    expect(events.filter((e) => e.event === "key")).toEqual([]);
  });
});
