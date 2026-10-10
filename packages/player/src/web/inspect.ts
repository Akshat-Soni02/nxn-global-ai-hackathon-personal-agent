// Looking at, and safely poking, the live page for recovery (docs/design.md, "The repair agent's tools"). One function,
// pageOp, runs every operation over the same Cdp as the web executor, so the extension and `pnpm replay` answer them
// alike. Elements are named by short refs ("e12") the page script stamps on them (data-tp-ref), so an agent can say
// which element it means; a ref turns into a stored Locator (role, name, attrs, a CSS fallback) through `inspect`.
// No zod or core values here: this file is bundled into the extension.
import type { ActionStep, Locator } from "@taskplayer/core";
import { type Cdp, evaluate, sleep } from "./cdp.ts";
import { executeWebStep } from "./executor.ts";
import { axNodeOf, selectAll } from "./match.ts";

export type PageOp =
  // The page as an indented list of headings, dialogs, forms and controls (hidden file inputs included).
  | { op: "outline"; scope?: string; max?: number }
  // Controls whose accessible name looks like `text`, best first.
  | { op: "find"; text: string; role?: string; limit?: number }
  // One element in detail, with the Locator a step would store for it.
  | { op: "inspect"; ref: string }
  // URL, title, HTTP status, whether it looks like a login page, open dialogs.
  | { op: "signals" }
  // Probes: they act on the page. The caller's guard decides which are allowed.
  | { op: "click"; ref: string }
  | { op: "press"; key: string }
  | { op: "scroll"; ref?: string; direction?: "down" | "up" }
  | { op: "back" }
  | { op: "navigate"; url: string }
  | { op: "wait"; ms: number };

export type PageOpResult = { ok: true; value: unknown } | { ok: false; error: string };

export interface ElementInfo {
  ref: string;
  tag: string;
  role: string;
  name: string;
  text: string;
  attrs: Record<string, string>;
  visible: boolean;
  disabled: boolean;
  // The nearest heading before it, and the dialog it is in.
  near?: string;
  dialog?: string;
  selector: string;
}

export interface FoundElement {
  ref: string;
  role: string;
  name: string;
  score: number;
  visible: boolean;
  near?: string;
  dialog?: string;
}

export interface PageSignals {
  url: string;
  title: string;
  // The main document's HTTP status, when the browser reports it.
  status?: number;
  loginLike: boolean;
  dialogs: string[];
  readyState: string;
}

export const REF_ATTR = "data-tp-ref";

export async function pageOp(cdp: Cdp, op: PageOp): Promise<PageOpResult> {
  try {
    switch (op.op) {
      case "outline":
      case "find":
      case "signals":
        return { ok: true, value: await inPage(cdp, op) };
      case "inspect":
        return { ok: true, value: await inspect(cdp, op.ref) };
      case "click":
        return stepResult(await executeWebStep(cdp, probeStep("click", { fallbacks: [refSelector(op.ref)] })));
      case "press":
        return stepResult(await executeWebStep(cdp, probeStep("press", undefined, { key: op.key })));
      case "navigate":
        return stepResult(await executeWebStep(cdp, probeStep("navigate", undefined, { url: op.url })));
      case "scroll":
        await inPage(cdp, op);
        return { ok: true, value: "scrolled" };
      case "back":
        await evaluate(cdp, "history.back()");
        await sleep(1500);
        return { ok: true, value: await evaluate<string>(cdp, "location.href") };
      case "wait":
        await sleep(Math.min(op.ms, 15_000));
        return { ok: true, value: "waited" };
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// The element in detail, and the Locator to store: role and name as Chrome computes them (what the matcher compares),
// stable attributes, and a CSS selector as the fallback. Never the ref.
async function inspect(cdp: Cdp, ref: string): Promise<ElementInfo & { locator: Locator }> {
  const info = (await inPage(cdp, { op: "describe", ref })) as ElementInfo | null;
  if (!info) throw new Error(`no element ${ref} on the page now: look at the outline again`);
  const [id] = await selectAll(cdp, refSelector(ref));
  const ax = id === undefined ? undefined : await axNodeOf(cdp, id);
  const role = ax?.role?.value || info.role;
  const name = ax?.name?.value || info.name;
  return { ...info, role, name, locator: locatorFor({ ...info, role, name }) };
}

export function locatorFor(info: Pick<ElementInfo, "role" | "name" | "attrs" | "selector">): Locator {
  const attrs = Object.fromEntries(
    Object.entries(info.attrs).filter(([k]) => ["id", "name", "type", "data-testid", "aria-label"].includes(k)),
  );
  return {
    ...(info.role ? { role: info.role } : {}),
    ...(info.name ? { name: info.name } : {}),
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    fallbacks: [info.selector],
  };
}

const refSelector = (ref: string) => `[${REF_ATTR}="${ref.replace(/[^\w-]/g, "")}"]`;

const probeStep = (action: string, target?: Locator, args: Record<string, unknown> = {}): ActionStep => ({
  id: "probe",
  type: "action",
  intent: "probe",
  requires_approval: false,
  channel: "web",
  action,
  target,
  args,
  timeout_ms: 5000,
});

const stepResult = (r: { ok: boolean; error?: string }): PageOpResult =>
  r.ok ? { ok: true, value: "done" } : { ok: false, error: r.error ?? "failed" };

async function inPage(cdp: Cdp, op: Record<string, unknown>): Promise<unknown> {
  return evaluate(cdp, `(${PAGE_SCRIPT})(${JSON.stringify(op)})`);
}

// ---- The page side ------------------------------------------------------------------------------------------------
// Kept as a string so build tools cannot rewrite it before it is sent to the page; tests run it under jsdom.

export const PAGE_SCRIPT = `function (op) {
  const ATTR = ${JSON.stringify(REF_ATTR)};
  const clean = (s) => String(s == null ? "" : s).replace(/\\s+/g, " ").trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const IMPLICIT = { A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", SUMMARY: "button",
    H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading", DIALOG: "dialog",
    FORM: "form", NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
    OPTION: "option", IMG: "img" };
  const INPUT_ROLES = { button: "button", submit: "button", reset: "button", image: "button", checkbox: "checkbox",
    radio: "radio", range: "slider", number: "spinbutton", search: "searchbox", file: "file" };
  const CONTROL_ROLES = ["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "tab",
    "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton", "file", "listbox", "treeitem"];
  const CONTAINERS = ["dialog", "alertdialog", "form", "navigation", "main", "banner", "contentinfo", "complementary",
    "menu", "menubar", "tablist", "listbox", "region"];
  const GROUPS = [["textbox", "searchbox", "spinbutton", "combobox"], ["button", "menuitem"], ["link"],
    ["checkbox", "switch", "menuitemcheckbox"], ["radio", "menuitemradio"]];

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(" ")[0];
    if (el.tagName === "INPUT") return INPUT_ROLES[(el.getAttribute("type") || "text").toLowerCase()] ||
      (el.getAttribute("list") ? "combobox" : (el.getAttribute("type") || "").toLowerCase() === "hidden" ? "" : "textbox");
    if (el.tagName === "A") return el.hasAttribute("href") ? "link" : "";
    if (el.tagName === "SECTION" && (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby"))) return "region";
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return "textbox";
    return IMPLICIT[el.tagName] || (el.hasAttribute("onclick") ? "button" : "");
  };
  const byId = (id) => document.getElementById(id);
  const nameOf = (el) => {
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby.split(/\\s+/).map((id) => byId(id)).filter(Boolean).map((n) => n.textContent).join(" ");
      if (clean(text)) return clean(text);
    }
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) return clean(el.value || el.getAttribute("value") || (type === "submit" ? "Submit" : ""));
      if (el.id) {
        const label = document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
        if (label) return clean(label.textContent);
      }
      const wrap = el.closest("label");
      if (wrap) {
        const copy = wrap.cloneNode(true);
        copy.querySelectorAll("select, textarea, option").forEach((n) => n.remove());
        if (clean(copy.textContent)) return clean(copy.textContent);
      }
      return clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "");
    }
    if (el.tagName === "IMG") return clean(el.getAttribute("alt"));
    // Landmarks and containers are named by their label only; a dialog by its heading too.
    if (CONTAINERS.includes(roleOf(el))) {
      const heading = ["dialog", "alertdialog"].includes(roleOf(el)) ? el.querySelector("h1, h2, h3, h4, [role=heading]") : null;
      return clean(el.getAttribute("title") || (heading ? heading.textContent : ""));
    }
    const text = clean(el.innerText !== undefined && document.documentElement.getBoundingClientRect().height > 0 ? el.innerText : el.textContent);
    if (text) return cut(text, 80);
    const img = el.querySelector("img[alt], svg[aria-label], [title]");
    return clean(el.getAttribute("title") || (img ? img.getAttribute("alt") || img.getAttribute("aria-label") || img.getAttribute("title") : ""));
  };
  const hasLayout = document.documentElement.getBoundingClientRect().height > 0;
  const visible = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || n.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(n);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (n.tagName === "DIALOG" && !n.open) return false;
    }
    if (!hasLayout) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const disabled = (el) => el.disabled === true || el.getAttribute("aria-disabled") === "true";
  let counter = Number(document.documentElement.getAttribute("data-tp-refs") || "0");
  const refOf = (el) => {
    let ref = el.getAttribute(ATTR);
    if (!ref) {
      counter += 1;
      ref = "e" + counter;
      el.setAttribute(ATTR, ref);
      document.documentElement.setAttribute("data-tp-refs", String(counter));
    }
    return ref;
  };
  const interesting = (el) => {
    const role = roleOf(el);
    if (CONTROL_ROLES.includes(role) || CONTAINERS.includes(role) || role === "heading") return true;
    return el.tagName === "IFRAME";
  };
  const dialogOf = (el) => {
    const d = el.closest("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]");
    return d ? nameOf(d) || "dialog" : undefined;
  };
  const headingBefore = (el) => {
    const all = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]"));
    let last;
    for (const h of all) {
      if (h === el) break;
      if (h.compareDocumentPosition(el) & 4) last = h; else break;
    }
    return last ? cut(clean(last.textContent), 60) : undefined;
  };
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\\w-]/g, (c) => "\\\\" + c));
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const selectorOf = (el) => {
    if (el.id && unique("#" + esc(el.id))) return "#" + esc(el.id);
    for (const a of ["data-testid", "name", "aria-label"]) {
      const v = el.getAttribute(a);
      const sel = el.tagName.toLowerCase() + "[" + a + '="' + String(v).replace(/"/g, '\\\\"') + '"]';
      if (v && unique(sel)) return sel;
    }
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id && unique("#" + esc(n.id))) { parts.unshift("#" + esc(n.id)); break; }
      const same = Array.from(n.parentElement ? n.parentElement.children : []).filter((c) => c.tagName === n.tagName);
      parts.unshift(n.tagName.toLowerCase() + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(n) + 1) + ")" : ""));
    }
    return parts.join(" > ");
  };
  const KEEP = ["id", "name", "type", "href", "aria-label", "placeholder", "data-testid", "title", "accept", "aria-expanded", "aria-haspopup"];
  const attrsOf = (el) => {
    const out = {};
    for (const a of KEEP) if (el.hasAttribute(a)) out[a] = cut(el.getAttribute(a), 120);
    return out;
  };
  const similarity = (wanted, actual) => {
    const w = clean(wanted).toLowerCase(), a = clean(actual).toLowerCase();
    if (!w || !a) return 0;
    if (w === a) return 1;
    if (a.startsWith(w) || w.startsWith(a)) return 0.8;
    if (a.includes(w) || w.includes(a)) return 0.6;
    const ws = new Set(w.split(" ")), as = a.split(" ");
    const shared = as.filter((x) => ws.has(x)).length;
    return shared ? Math.round((0.5 * shared) / Math.max(ws.size, as.length) * 100) / 100 : 0;
  };

  if (op.op === "signals") {
    const nav = performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : undefined;
    const password = Array.from(document.querySelectorAll("input[type=password]")).some(visible);
    return {
      url: location.href, title: document.title, status: nav && nav.responseStatus ? nav.responseStatus : undefined,
      loginLike: password || /(log-?in|sign-?in|auth|sso)/i.test(location.pathname),
      dialogs: Array.from(document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]")).filter(visible).map((d) => nameOf(d) || "dialog"),
      readyState: document.readyState,
    };
  }
  if (op.op === "scroll") {
    const el = op.ref ? document.querySelector("[" + ATTR + '="' + op.ref + '"]') : null;
    if (el) el.scrollIntoView({ block: "center" });
    else window.scrollBy(0, (op.direction === "up" ? -0.8 : 0.8) * window.innerHeight);
    return true;
  }
  if (op.op === "describe") {
    const el = document.querySelector("[" + ATTR + '="' + op.ref + '"]');
    if (!el) return null;
    return { ref: op.ref, tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el),
      text: cut(clean(el.textContent), 160), attrs: attrsOf(el), visible: visible(el), disabled: disabled(el),
      near: headingBefore(el), dialog: dialogOf(el), selector: selectorOf(el) };
  }
  if (op.op === "find") {
    const group = op.role ? (GROUPS.find((g) => g.includes(op.role)) || [op.role]) : undefined;
    const found = [];
    for (const el of document.body.querySelectorAll("*")) {
      const role = roleOf(el);
      if (!CONTROL_ROLES.includes(role) || (group && !group.includes(role))) continue;
      const isVisible = visible(el);
      if (!isVisible && role !== "file") continue;
      const name = nameOf(el);
      const score = Math.max(similarity(op.text, name), 0.9 * similarity(op.text, el.getAttribute("title") || ""));
      if (score > 0) found.push({ ref: refOf(el), role, name, score, visible: isVisible, near: headingBefore(el), dialog: dialogOf(el) });
    }
    found.sort((a, b) => b.score - a.score);
    return found.slice(0, op.limit || 8);
  }
  // outline
  const root = op.scope ? document.querySelector("[" + ATTR + '="' + op.scope + '"]') : document.body;
  if (!root) return "no element " + op.scope + " on the page now";
  const lines = op.scope ? [] : ["URL " + location.href + (document.title ? ' "' + cut(clean(document.title), 80) + '"' : "")];
  const max = op.max || 250;
  let more = 0;
  const walk = (el, depth) => {
    for (const child of el.children) {
      const role = roleOf(child);
      const isVisible = visible(child);
      if (!isVisible && role !== "file") continue;
      if (!interesting(child)) { walk(child, depth); continue; }
      if (lines.length >= max) { more += 1; continue; }
      const pad = "  ".repeat(depth);
      if (role === "heading") {
        lines.push(pad + child.tagName.toLowerCase().replace("div", "heading") + ' "' + cut(clean(child.textContent), 80) + '"');
        continue;
      }
      const bits = [refOf(child), role === "file" ? "file input" : role];
      const name = nameOf(child);
      if (name) bits.push(JSON.stringify(name));
      if (role === "file") { bits.push(isVisible ? "" : "(hidden)"); if (child.getAttribute("accept")) bits.push("accept=" + child.getAttribute("accept")); }
      if (disabled(child)) bits.push("[disabled]");
      if (child.checked) bits.push("[checked]");
      if (child.getAttribute("aria-expanded")) bits.push("[expanded=" + child.getAttribute("aria-expanded") + "]");
      if (child.getAttribute("aria-modal") === "true" || (child.tagName === "DIALOG" && child.open)) bits.push("(modal)");
      const type = (child.getAttribute("type") || "").toLowerCase();
      if (["textbox", "searchbox", "combobox", "spinbutton"].includes(role) && type !== "password" && child.value) bits.push("value=" + JSON.stringify(cut(String(child.value), 40)));
      if (role === "link" && child.getAttribute("href")) bits.push("→ " + cut(child.getAttribute("href"), 60));
      lines.push(pad + bits.filter(Boolean).join(" "));
      if (CONTAINERS.includes(role) || role === "listbox") walk(child, depth + 1);
    }
  };
  walk(root, 0);
  if (more) lines.push("… " + more + " more (outline a part with its ref as scope)");
  return lines.join("\\n");
}`;
