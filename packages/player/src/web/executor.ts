// Executes one web step against one tab: wait -> match -> act -> verify. Runs in the extension (chrome.debugger)
// or, for development, against a debug-port Chrome. Templates are already resolved by the daemon.
import type { Step } from "@taskplayer/core";
import type { StepResult } from "../types.ts";
import { type Cdp, callOn, evaluate, pollUntil, sleep } from "./cdp.ts";
import { pagePart, waitForCheck } from "./checks.ts";
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
const FN_FILE_COUNT = `function () { return this.files ? this.files.length : -1; }`;

const fail = (error: string, extra: Partial<StepResult> = {}): StepResult => ({ ok: false, error, ...extra });

async function waitForTarget(cdp: Cdp, step: Step, timeoutMs: number): Promise<MatchOutcome> {
  const target = step.target;
  if (!target) throw new Error("step has no target");
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

export async function executeWebStep(cdp: Cdp, step: Step): Promise<StepResult> {
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
        const input = await fileInputFor(cdp, id);
        if (!input) {
          error = "target has no file input";
          break;
        }
        const files = Array.isArray(a.file) ? a.file.map(String) : [String(a.file ?? "")];
        await cdp.send("DOM.setFileInputFiles", { files, backendNodeId: input });
        if ((await callOn<number>(cdp, input, FN_FILE_COUNT)) !== files.length)
          error = "file input did not take the file";
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
