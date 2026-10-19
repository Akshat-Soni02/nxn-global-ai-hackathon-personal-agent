// Google Sheets draws its cells on a canvas, so a click on a cell has no element to describe, and what you type goes
// into a hidden editor. Three parts of the page are ordinary DOM and say where you are: the Name Box (the selected
// cell, "B3"), the formula bar (that cell's content) and the active sheet tab. Read at the moment of a click, a copy, a
// paste or the first key typed into a cell, they give the cell the action was on (spec 1.11). The ids are checked on a
// live sheet at Checkpoint 1; when Google changes them, readCell returns nothing and capture works as before.
import type { Cell } from "@shadow/core";

const REF = /^\$?([A-Z]{1,3})\$?(\d{1,7})(:\$?[A-Z]{1,3}\$?\d{1,7})?$/i;

export const isSheet = (url: string): boolean => /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(url);

export function readCell(doc: Document): Cell | undefined {
  const raw = doc.querySelector<HTMLInputElement>("#t-name-box")?.value?.trim();
  if (!raw || !REF.test(raw)) return undefined;
  const value = doc.querySelector("#t-formula-bar-input")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 500);
  const sheet = doc.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name")?.textContent?.trim();
  return { ref: raw.replace(/\$/g, "").toUpperCase(), ...(value ? { value } : {}), ...(sheet ? { sheet } : {}) };
}

// The cell's line in the CSV export: "B7" is line 7 (line 1 is the header row).
export function rowOfCell(ref: string): number | undefined {
  const m = REF.exec(ref);
  return m ? Number(m[2]) : undefined;
}

// The cell's column, from 0: A is 0, Z is 25, AA is 26.
export function columnOfCell(ref: string): number | undefined {
  const m = REF.exec(ref);
  if (!m?.[1]) return undefined;
  return [...m[1].toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}
