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
});
