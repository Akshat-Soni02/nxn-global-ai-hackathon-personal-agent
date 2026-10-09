// Executes one web step against one tab: wait -> match -> act -> verify. Runs in the extension (chrome.debugger)
// or, for development, against a debug-port Chrome. Templates are already resolved by the daemon.
import type { Locator, ActionStep as Step } from "@taskplayer/core";
import { wrongKind } from "@taskplayer/core/accept";

// A path where a file is expected: a file value's path ({ path, … }) or plain text. Inlined, not imported from core's
// vars.ts, so the extension bundle does not pull in zod.
const pathOf = (v: unknown): string | undefined =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && "path" in v
      ? String((v as { path: unknown }).path)
      : undefined;

import type { StepResult } from "../types.ts";
import { type Cdp, callOn, evaluate, pollUntil, type RemoteObject, sleep } from "./cdp.ts";
import { pagePart, waitForCheck } from "./checks.ts";
import { rowsOf, sheetExportUrl } from "./csv.ts";
import { type DomNode, fileAccessError, pickFileInput } from "./file-input.ts";
import { attributesOf, type MatchOutcome, match, matchAll, selectAll } from "./match.ts";

export const DEFAULT_WEB_TIMEOUT_MS = 10_000;

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
};

// Page-side functions, kept as strings so build tools cannot rewrite them before they are sent to the page.
const FN_HIT_TEST = `function (x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return "nothing";
  if (hit === this || this.contains(hit) || hit.contains(this)) return "";
  if (this.labels && Array.from(this.labels).some((l) => l === hit || l.contains(hit))) return "";
  return (hit.tagName + (hit.id ? "#" + hit.id : "") + (hit.className && typeof hit.className === "string" ? "." + hit.className.trim().split(/\\s+/).join(".") : "")).toLowerCase();
}`;
const FN_SELECT_TEXT = `function () { if (typeof this.select === "function") this.select(); }`;
const FN_VALUE = `function () { return "value" in this ? String(this.value) : null; }`;
const FN_CHOOSE_OPTION = `function (label) {
  if (this.tagName !== "SELECT") return "target is not a <select>";
  const option = Array.from(this.options).find((o) => o.label.trim() === label || o.text.trim() === label || o.value === label);
  if (!option) return "no option " + label;
  this.value = option.value;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return "";
}`;
const FN_TEXT_AND_HREF = `function () { return { text: (this.innerText || this.textContent || "").trim(), href: this.href || "" }; }`;
// HTML5 drag and drop, sent inside the page: Chrome does not start one from CDP mouse events.
const FN_HTML5_DRAG = `function (target) {
  const data = new DataTransfer();
  const fire = (el, type) =>
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: data }));
  fire(this, "dragstart");
  fire(target, "dragenter");
  fire(target, "dragover");
  fire(target, "drop");
  fire(this, "dragend");
}`;
// A <table>'s rows as objects keyed by its header cells.
const FN_TABLE_ROWS = `function () {
  const table = this.closest("table") || this.querySelector("table");
  if (!table) return null;
  const rows = Array.from(table.rows).map((r) => Array.from(r.cells).map((c) => (c.innerText || c.textContent || "").trim()));
  const [header = [], ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}`;
const FN_FILE_COUNT = `function () { return this.files ? this.files.length : -1; }`;
const FN_ACCEPT = `function () { return this.accept || ""; }`;

const fail = (error: string, extra: Partial<StepResult> = {}): StepResult => ({ ok: false, error, ...extra });

async function waitForTarget(cdp: Cdp, step: Step, timeoutMs: number): Promise<MatchOutcome> {
  if (!step.target) throw new Error("step has no target");
  return waitForLocator(cdp, step.target, timeoutMs);
}

async function waitForLocator(cdp: Cdp, target: Locator, timeoutMs: number): Promise<MatchOutcome> {
  let last: MatchOutcome = { status: "none", candidates: [] };
  await pollUntil(async () => {
    last = await match(cdp, target);
    return last.status === "found" ? last : undefined;
  }, timeoutMs);
  return last;
}

function describeMiss(outcome: MatchOutcome): string {
  const top = outcome.candidates
    .slice(0, 3)
    .map((c) => `${c.score} [${c.matchedBy.join(", ")}]`)
    .join("; ");
  return outcome.status === "ambiguous" ? `ambiguous target: ${top}` : `target not found${top ? `: best ${top}` : ""}`;
}

async function center(cdp: Cdp, backendNodeId: number): Promise<{ x: number; y: number } | undefined> {
  await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
  const { quads } = await cdp
    .send<{ quads: number[][] }>("DOM.getContentQuads", { backendNodeId })
    .catch(() => ({ quads: [] as number[][] }));
  const q = quads[0];
  if (!q || q.length < 8) return undefined;
  const xs = [q[0], q[2], q[4], q[6]] as number[];
  const ys = [q[1], q[3], q[5], q[7]] as number[];
  return { x: xs.reduce((a, b) => a + b) / 4, y: ys.reduce((a, b) => a + b) / 4 };
}

async function click(cdp: Cdp, backendNodeId: number): Promise<string | undefined> {
  const point = await center(cdp, backendNodeId);
  if (!point) return "target is not visible";
  const covered = await callOn<string>(cdp, backendNodeId, FN_HIT_TEST, point.x, point.y);
  if (covered) return `target is covered by ${covered}`;
  const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  return undefined;
}

async function press(cdp: Cdp, key: string): Promise<string | undefined> {
  const k = KEYS[key];
  if (!k) return `unsupported key ${key}`;
  const common = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...common, ...(k.text ? { text: k.text } : {}) });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
  return undefined;
}

// Types like a person: keyDown/keyUp per character. Input.insertText alone skips key events, and widgets that
// react to keyup (date pickers, autocompletes, masked inputs) then keep their own stale state and overwrite the field.
async function typeText(cdp: Cdp, text: string): Promise<void> {
  for (const ch of text) {
    if (ch === "\n") {
      await press(cdp, "Enter");
      continue;
    }
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
  }
}

async function navigate(cdp: Cdp, url: string, timeoutMs: number): Promise<string | undefined> {
  const before = await evaluate<number>(cdp, "performance.timeOrigin").catch(() => 0);
  const { errorText } = await cdp.send<{ errorText?: string }>("Page.navigate", { url });
  if (errorText) return `navigation failed: ${errorText}`;
  const loaded = await pollUntil(async () => {
    const state = await evaluate<{ origin: number; ready: string }>(
      cdp,
      "({ origin: performance.timeOrigin, ready: document.readyState })",
    );
    // "interactive" = parsed. Waiting for "complete" would block on slow images and ads; the next step waits
    // for its own target anyway.
    return state.origin !== before && state.ready !== "loading" ? true : undefined;
  }, timeoutMs);
  return loaded ? undefined : `page did not finish loading: ${url}`;
}

async function fileInputFor(cdp: Cdp, backendNodeId: number): Promise<number | undefined> {
  const attrs = await attributesOf(cdp, backendNodeId);
  if (attrs.type === "file") return backendNodeId;
  // The match may be a label or wrapper around a (possibly hidden) file input.
  const inside = await callOn<string | null>(
    cdp,
    backendNodeId,
    `function () { const i = this.querySelector('input[type="file"]') || (this.control && this.control.type === "file" ? this.control : null); if (!i) return null; i.setAttribute("data-taskplayer-upload", "1"); return "1"; }`,
  );
  if (!inside) return undefined;
  const [id] = await selectAll(cdp, '[data-taskplayer-upload="1"]');
  return id;
}

// Drags one element onto another. A draggable="true" source gets HTML5 drag events; anything else gets a trusted
// mouse press, a path of moves and a release over the destination (pointer-based boards and sortable lists).
async function dragTo(cdp: Cdp, from: number, to: number): Promise<string | undefined> {
  if ((await attributesOf(cdp, from)).draggable === "true") {
    const [source, target] = await Promise.all(
      [from, to].map((backendNodeId) => cdp.send<{ object: RemoteObject }>("DOM.resolveNode", { backendNodeId })),
    );
    const { exceptionDetails } = await cdp.send<{ exceptionDetails?: { text: string } }>("Runtime.callFunctionOn", {
      objectId: source?.object.objectId,
      functionDeclaration: FN_HTML5_DRAG,
      arguments: [{ objectId: target?.object.objectId }],
    });
    return exceptionDetails ? `drag failed: ${exceptionDetails.text}` : undefined;
  }
  const a = await center(cdp, from);
  const b = await center(cdp, to);
  if (!a || !b) return "drag source or destination is not visible";
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x, y: a.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", clickCount: 1 });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await sleep(15);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 });
  return undefined;
}

// Drops local files onto an element the way a drag from Finder does: dragEnter, dragOver, drop at its centre.
async function dropFiles(cdp: Cdp, backendNodeId: number, files: string[]): Promise<string | undefined> {
  const point = await center(cdp, backendNodeId);
  if (!point) return "drop target is not visible";
  const data = { items: [], files, dragOperationsMask: 1 }; // 1 = copy
  for (const type of ["dragEnter", "dragOver", "drop"]) {
    await cdp.send("Input.dispatchDragEvent", { type, x: point.x, y: point.y, data });
  }
  return undefined;
}

// What only the host can do. The extension fetches from its background worker: it has the user's cookies and is not
// held back by CORS, which a page-side fetch of a Google Sheet export (redirected to googleusercontent.com) would be.
export interface WebEnv {
  fetchText?(url: string): Promise<string>;
}

export async function executeWebStep(cdp: Cdp, step: Step, env: WebEnv = {}): Promise<StepResult> {
  const timeoutMs = step.timeout_ms ?? DEFAULT_WEB_TIMEOUT_MS;
  const a = step.args;

  if (step.wait && !(await waitForCheck(cdp, step.wait, timeoutMs))) {
    return fail("precondition did not hold", { failedCheck: step.wait });
  }

  let value: unknown;
  let matchScore: number | undefined;
  let matchedBy: string[] | undefined;

  if (step.action === "navigate") {
    const error = await navigate(cdp, String(a.url ?? ""), timeoutMs);
    if (error) return fail(error);
  } else if (step.action === "extract" && a.source === "google_sheet") {
    // The sheet's cells are drawn on a canvas, so its rows are read from its CSV export instead.
    const url = sheetExportUrl(await evaluate<string>(cdp, "location.href"));
    if (!url) return fail("this page is not a Google Sheet");
    const fetchInPage = `fetch(${JSON.stringify(url)}, { credentials: "include" }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })`;
    try {
      value = rowsOf(env.fetchText ? await env.fetchText(url) : await evaluate<string>(cdp, fetchInPage));
    } catch (error) {
      return fail(`could not read the sheet: ${(error as Error).message}`);
    }
  } else if (step.action === "extract" && a.source === "table") {
    if (!step.target) return fail("extract from a table needs a target");
    const outcome = await waitForTarget(cdp, step, timeoutMs);
    if (outcome.status !== "found") return fail(describeMiss(outcome), { matchScore: outcome.candidates[0]?.score });
    value = await callOn<Record<string, string>[] | null>(cdp, outcome.best.backendNodeId, FN_TABLE_ROWS);
    if (!value) return fail("the target is not in a table");
    matchScore = outcome.best.score;
    matchedBy = outcome.best.matchedBy;
  } else if (step.action === "extract" && a.all) {
    if (!step.target) return fail("extract needs a target");
    const ids = await pollUntil(async () => {
      const found = await matchAll(cdp, step.target as NonNullable<Step["target"]>);
      return found.length > 0 ? found : undefined;
    }, timeoutMs);
    if (!ids) return fail("no elements to extract");
    const items = await Promise.all(
      ids
        .slice(0, a.limit ? Number(a.limit) : undefined)
        .map((id) => callOn<{ text: string; href: string }>(cdp, id, FN_TEXT_AND_HREF)),
    );
    value = render(items, a);
  } else if (step.action === "press" && !step.target) {
    const error = await press(cdp, String(a.key ?? ""));
    if (error) return fail(error);
  } else if (step.target) {
    const outcome = await waitForTarget(cdp, step, timeoutMs);
    if (outcome.status !== "found") return fail(describeMiss(outcome), { matchScore: outcome.candidates[0]?.score });
    const id = outcome.best.backendNodeId;
    matchScore = outcome.best.score;
    matchedBy = outcome.best.matchedBy;

    let error: string | undefined;
    switch (step.action) {
      case "click":
        error = await click(cdp, id);
        break;
      case "type": {
        await cdp.send("DOM.focus", { backendNodeId: id });
        if (a.clear) await callOn(cdp, id, FN_SELECT_TEXT);
        const text = String(a.text ?? "");
        await typeText(cdp, text);
        const typed = await callOn<string | null>(cdp, id, FN_VALUE);
        if (typed !== null && !typed.includes(text)) error = `field holds "${typed}" after typing "${text}"`;
        break;
      }
      case "select":
        error = (await callOn<string>(cdp, id, FN_CHOOSE_OPTION, String(a.option ?? ""))) || undefined;
        break;
      case "press":
        await cdp.send("DOM.focus", { backendNodeId: id });
        error = await press(cdp, String(a.key ?? ""));
        break;
      case "upload": {
        // A file value or a list of them (or plain paths): the page gets their paths.
        const files = (Array.isArray(a.file) ? a.file : [a.file]).map((f) => pathOf(f) ?? String(f ?? ""));
        try {
          // The input itself, inside the target, or labelled by it; else the one in the target's dialog or the only
          // one on the page, shadow roots included ("Select files" buttons that open a hidden input elsewhere).
          let input = await fileInputFor(cdp, id);
          if (input === undefined) {
            const { root } = await cdp.send<{ root: DomNode }>("DOM.getDocument", { depth: -1, pierce: true });
            input = pickFileInput(root, id);
          }
          if (input === undefined) {
            // No file input at all: the page only takes drops. Drop the files on the target, as Finder would.
            error = await dropFiles(cdp, id, files);
            break;
          }
          // The daemon checked the file before the run; the page may take other kinds now than when you recorded.
          const accept = await callOn<string>(cdp, input, FN_ACCEPT);
          const wrong = files.map((file) => wrongKind(file, accept)).find(Boolean);
          if (wrong) {
            error = `${wrong}, as the page's file field says (${accept})`;
            break;
          }
          await cdp.send("DOM.setFileInputFiles", { files, backendNodeId: input });
          if ((await callOn<number>(cdp, input, FN_FILE_COUNT)) !== files.length)
            error = "file input did not take the file";
        } catch (failure) {
          error = fileAccessError(failure);
        }
        break;
      }
      case "drag": {
        const to = a.to as Locator | undefined;
        if (!to) {
          error = "drag needs args.to";
          break;
        }
        const landing = await waitForLocator(cdp, { ...to, fallbacks: to.fallbacks ?? [] }, timeoutMs);
        error =
          landing.status === "found"
            ? await dragTo(cdp, id, landing.best.backendNodeId)
            : `drop target ${describeMiss(landing)}`;
        break;
      }
      case "extract":
        value = render([await callOn<{ text: string; href: string }>(cdp, id, FN_TEXT_AND_HREF)], a);
        break;
      case "wait_for":
        break;
      default:
        error = `web.${step.action} is not supported`;
    }
    if (error) return fail(error, { matchScore, matchedBy });
  } else if (step.action !== "wait_for") {
    return fail(`web.${step.action} needs a target`);
  }

  const check = pagePart(step.check);
  if (check && !(await waitForCheck(cdp, check, timeoutMs))) {
    return fail(`check did not hold: ${JSON.stringify(check)}`, { failedCheck: check, matchScore, matchedBy });
  }
  // Let the page settle briefly so the next step does not race a reaction to this one.
  await sleep(100);
  return { ok: true, value, matchScore, matchedBy };
}

function render(items: { text: string; href: string }[], args: Record<string, unknown>): unknown {
  if (typeof args.each !== "string") return items.length === 1 && !args.all ? items[0]?.text : items.map((i) => i.text);
  const each = args.each;
  const lines = items.map((i) => each.replaceAll("{{text}}", i.text).replaceAll("{{href}}", i.href));
  return lines.join(typeof args.join === "string" ? args.join : "\n");
}
