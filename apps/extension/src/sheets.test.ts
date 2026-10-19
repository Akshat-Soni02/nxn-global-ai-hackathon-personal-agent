// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://docs.google.com/spreadsheets/d/SHEET/edit#gid=0"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCell } from "./adapters/google-sheets.ts";
import { type PageEvent, startCapture } from "./capture.ts";

const CSV = "Week,Tickets,Cost\nw/c 12 Oct,4928,131\nw/c 19 Oct,4928,142\n";
const page = (ref: string, value: string) => {
  document.body.innerHTML = `<input id="t-name-box" value="${ref}">
    <div id="t-formula-bar-input">${value}</div>
    <div class="docs-sheet-active-tab"><span class="docs-sheet-tab-name">KPI Sheet</span></div>
    <canvas id="grid" width="800" height="600"></canvas>
    <div class="cell-input" contenteditable="true"></div>`;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Google Sheets", () => {
  it("reads the selected cell, its value and the sheet tab from the page", () => {
    page("$B$3", "4928");
    expect(readCell(document)).toEqual({ ref: "B3", value: "4928", sheet: "KPI Sheet" });
  });

  it("takes a copy's row from the Name Box, not from the first cell holding the same value", async () => {
    page("B3", "4928");
    const events: PageEvent[] = [];
    const stop = startCapture(
      document,
      (e) => events.push(e),
      () => true,
      { fetchSheet: async () => CSV },
    );
    const copy = new Event("copy", { bubbles: true, composed: true });
    Object.defineProperty(copy, "clipboardData", { value: { getData: () => "4928" } });
    document.querySelector("#grid")?.dispatchEvent(copy);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(events[0]).toMatchObject({
      event: "copy",
      cell: { ref: "B3", sheet: "KPI Sheet" },
      context: { row: { Week: "w/c 19 Oct", Tickets: "4928", Cost: "142" }, column: "Tickets" },
    });
  });

  it("gives a click on the grid and the value typed into a cell their cells", async () => {
    page("A1", "");
    const events: PageEvent[] = [];
    const stop = startCapture(
      document,
      (e) => events.push(e),
      () => true,
      {},
    );
    const grid = document.querySelector("#grid") as Element;
    grid.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    grid.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
    (document.querySelector("#t-name-box") as HTMLInputElement).value = "A5"; // Sheets moves the selection
    await vi.advanceTimersByTimeAsync(200);
    const editor = document.querySelector(".cell-input") as HTMLElement;
    editor.textContent = "19 Oct";
    editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    (document.querySelector("#t-name-box") as HTMLInputElement).value = "A6"; // Enter moved on
    editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    stop();
    expect(events.map((e) => [e.event, e.cell?.ref])).toEqual([
      ["click", "A5"],
      ["type", "A5"],
    ]);
  });
});
