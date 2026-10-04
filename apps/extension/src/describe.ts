// describeElement: everything we know about one control, by meaning, never by position.
// The recorder calls it on the element you used. The player will call it on each candidate and score that against the
// stored Locator, so both sides must compute role and name the same way (descriptor.ts).
import type { ElementDescriptor } from "@taskplayer/core";
import { computeAccessibleName, getRole } from "dom-accessibility-api";

// What a click is "on": a click on the <span> inside a button is a click on the button.
const ACTIONABLE = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "option",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=combobox]",
  "[role=treeitem]",
  "[contenteditable='']",
  "[contenteditable=true]",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

// Values that change on every deploy or render, so they can't find the element again.
const GENERATED = /\d{4,}|[a-f0-9]{8,}|^:r[0-9a-z]*:$|^(ember|react|mui|radix|headlessui)[-:]/i;
const KEEP_ATTRS = [
  "id",
  "name",
  "type",
  "placeholder",
  "aria-label",
  "title",
  "href",
  "data-testid",
  "data-test",
  "data-qa",
];
const TEST_ID_ATTRS = ["data-testid", "data-test", "data-qa"];
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6", "legend"];
const HEADING_CHILD = HEADINGS.map((h) => `:scope > ${h}`).join(", ");
const LANDMARKS = new Set(["section", "form", "nav", "main", "aside", "header", "footer", "dialog", "fieldset"]);
const FIELDS = new Set(["input", "select", "textarea"]);
const XPATH_SNAPSHOT = 7; // XPathResult.ORDERED_NODE_SNAPSHOT_TYPE

interface Near {
  text: string;
  scope: Element;
  heading?: Element;
}

// The element a pointer event is really on: the innermost target (even inside an open shadow root), its actionable
// ancestor, and for a <label> the control it labels. Clicking "Upload invoice" means using the file input.
export function actionableTarget(event: Event): Element | undefined {
  const hit = event.composedPath()[0] as Node | undefined;
  const start = hit?.nodeType === 1 ? (hit as Element) : (hit?.parentElement ?? undefined);
  if (!start) return undefined;
  const el = start.closest(ACTIONABLE) ?? start;
  if (el.localName === "label") return (el as HTMLLabelElement).control ?? el;
  if (el === el.ownerDocument.body || el === el.ownerDocument.documentElement) return undefined;
  return el;
}

export function describeElement(el: Element): ElementDescriptor {
  const near = nearest(el);
  // A hidden file input is not in Chrome's accessibility tree, so it has no role or name to match on at replay;
  // storing one would only lower the match score. Its label, attributes and selectors still describe it.
  const inTree = !isHiddenFileInput(el);
  return {
    tag: el.localName,
    url: el.ownerDocument.location?.href ?? "",
    role: inTree ? role(el) : undefined,
    name: inTree ? accessibleName(el) : undefined,
    label: labelText(el),
    text: FIELDS.has(el.localName) ? undefined : clean(el.textContent),
    near: near?.text,
    attrs: keptAttrs(el),
    fallbacks: [],
    // Only selectors that resolve back to exactly this element are kept (echo verification).
    selectors: { css: stableCss(el) ?? structuralCss(el), xpath: anchoredXPath(el, near) },
    shadowPath: shadowPath(el),
    framePath: framePath(el),
  };
}

export function isHiddenFileInput(el: Element): boolean {
  if (el.localName !== "input" || (el as HTMLInputElement).type !== "file") return false;
  if ((el as HTMLElement).hidden) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display === "none" || style?.visibility === "hidden";
}

// True when replay has at least one exact selector to fall back on.
export function hasVerifiedSelector(d: ElementDescriptor): boolean {
  return Boolean(d.selectors.css || d.selectors.xpath);
}

// Replay resolves through Chrome, so record stores Chrome's role where dom-accessibility-api differs.
// Measured on fixtures/pages: Chrome exposes <input type=file> as "button"; dom-accessibility-api returns no role.
function role(el: Element): string | undefined {
  if (el.localName === "input" && (el as HTMLInputElement).type === "file") return "button";
  return getRole(el) ?? undefined;
}

function accessibleName(el: Element): string | undefined {
  try {
    return clean(computeAccessibleName(el));
  } catch {
    return undefined;
  }
}

function labelText(el: Element): string | undefined {
  const labels = "labels" in el ? (el as HTMLInputElement).labels : null;
  const first = labels?.[0];
  // Leave out the controls inside the label, or a <select>'s options would become part of its label.
  if (first) return clean(textWithout(first, "input, select, textarea, button"));
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return undefined;
  return clean(
    ids
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

// The heading of the section the element sits in, or the aria-label of its landmark ("Documents", "Cookies").
function nearest(el: Element): Near | undefined {
  for (let a = el.parentElement; a && a !== el.ownerDocument.documentElement; a = a.parentElement) {
    const heading = a.querySelector(HEADING_CHILD);
    const text = heading && !heading.contains(el) ? clean(heading.textContent) : undefined;
    if (heading && text) return { text, scope: a, heading };
    const aria = clean(a.getAttribute("aria-label"));
    if (aria && (a.hasAttribute("role") || LANDMARKS.has(a.localName))) return { text: aria, scope: a };
  }
  return undefined;
}

function keptAttrs(el: Element): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of KEEP_ATTRS) {
    const value = el.getAttribute(name);
    if (value && value.length <= 120 && !GENERATED.test(value)) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Ranked by stability: test ids, a hand-written id, name (+type), aria-label. The first that is unique wins.
function stableCss(el: Element): string | undefined {
  const tag = el.localName;
  const candidates: string[] = [];
  for (const name of TEST_ID_ATTRS) {
    const value = el.getAttribute(name);
    if (value) candidates.push(`${tag}${attr(name, value)}`);
  }
  if (el.id && !GENERATED.test(el.id)) candidates.push(isIdent(el.id) ? `#${el.id}` : `${tag}${attr("id", el.id)}`);
  const name = el.getAttribute("name");
  if (name && !GENERATED.test(name)) {
    const type = el.getAttribute("type");
    candidates.push(`${tag}${type ? attr("type", type) : ""}${attr("name", name)}`);
  }
  const aria = el.getAttribute("aria-label");
  if (aria) candidates.push(`${tag}${attr("aria-label", aria)}`);
  return candidates.find((selector) => cssResolvesTo(selector, el));
}

// Last resort: a short tag path from the nearest ancestor with a stable id. Works on an unchanged page only.
function structuralCss(el: Element): string | undefined {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < 6; depth++) {
    if (node !== el && node.id && isIdent(node.id) && !GENERATED.test(node.id)) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    const tag = node.localName;
    const siblings = parent ? Array.from(parent.children).filter((c) => c.localName === tag) : [node];
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
    node = parent;
  }
  const selector = parts.join(" > ");
  return cssResolvesTo(selector, el) ? selector : undefined;
}

// An XPath hung off the section heading, e.g. //section[h2='Documents']//input[@type='file']. Text anchors survive
// redesigns that rename classes and ids (measured on fixtures/pages/upload-drifted.html).
function anchoredXPath(el: Element, near: Near | undefined): string | undefined {
  const doc = el.ownerDocument;
  if (el.getRootNode() !== doc) return undefined; // XPath can't enter shadow roots
  const tag = el.localName;
  const prefixes = near?.heading ? [`//${near.scope.localName}[${headingPredicate(near.heading)}]//`, "//"] : ["//"];
  for (const prefix of prefixes) {
    for (const predicate of [...predicates(el), ""]) {
      const xpath = `${prefix}${tag}${predicate}`;
      if (xpathResolvesTo(doc, xpath, el)) return xpath;
    }
  }
  return undefined;
}

function predicates(el: Element): string[] {
  const out: string[] = [];
  const type = el.getAttribute("type");
  const name = el.getAttribute("name");
  if (type) out.push(`[@type=${literal(type)}]`);
  if (name && !GENERATED.test(name)) out.push(`[@name=${literal(name)}]`);
  if (type && name && !GENERATED.test(name)) out.push(`[@type=${literal(type)}][@name=${literal(name)}]`);
  const text = FIELDS.has(el.localName) ? undefined : clean(el.textContent);
  if (text) out.push(`[normalize-space()=${literal(text)}]`);
  const aria = el.getAttribute("aria-label");
  if (aria) out.push(`[@aria-label=${literal(aria)}]`);
  return out;
}

function headingPredicate(heading: Element): string {
  const raw = heading.textContent ?? "";
  const text = clean(raw) ?? "";
  return raw === text
    ? `${heading.localName}=${literal(text)}`
    : `normalize-space(${heading.localName})=${literal(text)}`;
}

function shadowPath(el: Element): string[] | undefined {
  const path: string[] = [];
  for (let root = el.getRootNode(); isShadowRoot(root); root = root.host.getRootNode()) {
    path.unshift(stableCss(root.host) ?? structuralCss(root.host) ?? root.host.localName);
  }
  return path.length > 0 ? path : undefined;
}

function framePath(el: Element): string[] | undefined {
  const win = el.ownerDocument.defaultView;
  return win && win !== win.top ? [win.location.href] : undefined;
}

function cssResolvesTo(selector: string, el: Element): boolean {
  try {
    const all = (el.getRootNode() as Document | ShadowRoot).querySelectorAll(selector);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}

function xpathResolvesTo(doc: Document, xpath: string, el: Element): boolean {
  try {
    const result = doc.evaluate(xpath, doc, null, XPATH_SNAPSHOT, null);
    return result.snapshotLength === 1 && result.snapshotItem(0) === el;
  } catch {
    return false;
  }
}

function isShadowRoot(node: Node): node is ShadowRoot {
  return Boolean((node as ShadowRoot).host);
}

function textWithout(root: Element, skip: string): string {
  const copy = root.cloneNode(true) as Element;
  for (const node of copy.querySelectorAll(skip)) node.remove();
  return copy.textContent ?? "";
}

function clean(text: string | null | undefined, max = 80): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

const isIdent = (value: string) => /^[A-Za-z_][\w-]*$/.test(value);

function attr(name: string, value: string): string {
  return isIdent(value) ? `[${name}=${value}]` : `[${name}="${value.replace(/["\\]/g, "\\$&")}"]`;
}

function literal(text: string): string {
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  return `concat('${text.split("'").join(`', "'", '`)}')`;
}
