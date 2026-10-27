// Matcher: turns a stored Locator into scored candidates on the live page.
// Signals: Chrome's own accessibility tree (role + accessible name, or the label when there is no name), the label as
// an accessible name of its own, the element's own text, stored attributes, fallback selectors. `near` breaks a tie:
// of two candidates that score alike, the one closest on the page to the words it was recorded near wins (two "Save"
// buttons, one under "Billing"). Positions are never stored; they are looked up after matching. See "Per-step loop"
// step 3 in the design doc.
// Frames and shadow roots (N3): the page is searched first; only when nothing there matches, frames of the same site
// and shadow roots are searched too (querySelector and XPath from the page never reach inside them, and Chrome's
// accessibility tree reaches shadow roots but not frames). A frame from another site is a page of its own: not searched.
import type { Locator } from "@shadow/core";
import type { Cdp } from "./cdp.ts";

// Roles a recorder or Chrome may report for the same kind of control.
const ROLE_GROUPS = [
  ["textbox", "searchbox", "spinbutton", "combobox"],
  ["button", "menuitem"],
  ["link"],
  ["checkbox", "switch", "menuitemcheckbox"],
  ["radio", "menuitemradio"],
];
export function equivalentRoles(role: string): string[] {
  return ROLE_GROUPS.find((g) => g.includes(role)) ?? [role];
}

const WEIGHTS = { roleName: 0.45, attrs: 0.25, fallback: 0.3, text: 0.3, label: 0.25 };
// A tie broken by `near`: the closest candidate must be this much closer than the next one.
const NEAR_RATIO = 0.7;
export const ACCEPT_SCORE = 0.5;
export const MIN_MARGIN = 0.15;

export interface Candidate {
  backendNodeId: number;
  score: number;
  matchedBy: string[];
}

export type MatchOutcome =
  | { status: "found"; best: Candidate; candidates: Candidate[] }
  | { status: "none"; candidates: Candidate[] }
  | { status: "ambiguous"; candidates: Candidate[] };

interface AXNode {
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function nameSimilarity(wanted: string, actual: string): number {
  const w = normalize(wanted);
  const a = normalize(actual);
  if (!w || !a) return 0;
  if (w === a) return 1;
  if (a.startsWith(w) || w.startsWith(a)) return 0.8;
  if (a.includes(w) || w.includes(a)) return 0.6;
  return 0;
}

async function rootNodeId(cdp: Cdp): Promise<number> {
  const { root } = await cdp.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
  return root.nodeId;
}

async function backendIds(cdp: Cdp, nodeIds: number[]): Promise<number[]> {
  const ids: number[] = [];
  for (const nodeId of nodeIds) {
    const { node } = await cdp.send<{ node: { backendNodeId: number } }>("DOM.describeNode", { nodeId });
    ids.push(node.backendNodeId);
  }
  return ids;
}

// Where a match looks: documents for the accessibility tree (backend ids), scopes for selectors and text (node ids,
// all from one DOM.getDocument, which re-numbers nodes each time it is called). `nested`: scopes past the page's own.
interface Roots {
  documents: number[];
  scopes: number[];
  nested: boolean;
}

async function pageRoots(cdp: Cdp): Promise<Roots> {
  const { root } = await cdp.send<{ root: { nodeId: number; backendNodeId: number } }>("DOM.getDocument", {
    depth: 0,
  });
  return { documents: [root.backendNodeId], scopes: [root.nodeId], nested: false };
}

interface DomNode {
  nodeId: number;
  backendNodeId: number;
  shadowRootType?: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

// The page, its frames of the same site and its shadow roots (not the browser's own, inside an <input>), or undefined
// when it has none: then a second pass would find nothing new.
async function nestedRoots(cdp: Cdp): Promise<Roots | undefined> {
  const has = await cdp
    .send<{ result: { value?: boolean } }>("Runtime.evaluate", {
      expression: `!!document.querySelector("iframe,frame") || Array.prototype.some.call(document.querySelectorAll("*"), (e) => e.shadowRoot)`,
      returnByValue: true,
    })
    .then((r) => r.result.value === true)
    .catch(() => false);
  if (!has) return undefined;
  const { root } = await cdp.send<{ root: DomNode }>("DOM.getDocument", { depth: -1, pierce: true });
  const roots: Roots = { documents: [root.backendNodeId], scopes: [root.nodeId], nested: true };
  const walk = (node: DomNode) => {
    if (node.contentDocument) {
      roots.documents.push(node.contentDocument.backendNodeId);
      roots.scopes.push(node.contentDocument.nodeId);
      walk(node.contentDocument);
    }
    for (const shadow of node.shadowRoots ?? []) {
      if (shadow.shadowRootType === "user-agent") continue;
      roots.scopes.push(shadow.nodeId);
      walk(shadow);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return roots.scopes.length > 1 ? roots : undefined;
}

// An XPath inside a frame or a shadow root, run there by the page: DOM.performSearch searches the page's own tree only.
// A frame's document takes it as written. Chrome's XPath refuses a shadow root as its starting point (NotSupportedError,
// checked 28 Oct) but not an element inside one: "//x" runs from each of the root's elements as descendant-or-self::x,
// and an XPath from the top of a page ("/html/…") means nothing there.
const FN_XPATH_IN = `function (xpath) {
  const doc = this.nodeType === 9 ? this : this.ownerDocument;
  const out = [];
  const run = (expr, from) => {
    const found = doc.evaluate(expr, from, null, 7, null);
    for (let i = 0; i < found.snapshotLength && out.length < 200; i++) out.push(found.snapshotItem(i));
  };
  if (this.nodeType === 9) run(xpath, this);
  else if (xpath.startsWith("//")) for (const child of this.children) run("descendant-or-self::" + xpath.slice(2), child);
  return out;
}`;

async function xpathIn(cdp: Cdp, scope: number, xpath: string): Promise<number[]> {
  const { object } = await cdp.send<{ object: { objectId?: string } }>("DOM.resolveNode", {
    nodeId: scope,
    objectGroup: "match",
  });
  try {
    const { result } = await cdp.send<{ result: { objectId?: string } }>("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: FN_XPATH_IN,
      arguments: [{ value: xpath }],
      objectGroup: "match",
    });
    if (!result.objectId) return [];
    const { result: items } = await cdp.send<{ result: { name: string; value?: { objectId?: string } }[] }>(
      "Runtime.getProperties",
      { objectId: result.objectId, ownProperties: true },
    );
    const ids: number[] = [];
    for (const item of items) {
      if (!/^\d+$/.test(item.name) || !item.value?.objectId) continue;
      const { node } = await cdp.send<{ node: { backendNodeId: number } }>("DOM.describeNode", {
        objectId: item.value.objectId,
      });
      ids.push(node.backendNodeId);
    }
    return ids;
  } finally {
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "match" }).catch(() => {});
  }
}

// A selector in every scope: the page's own through selectAll, the nested ones each in turn.
async function selectIn(cdp: Cdp, roots: Roots, selector: string): Promise<number[]> {
  const xpath = selector.startsWith("/") || selector.startsWith("(");
  const ids = new Set<number>();
  for (const [i, scope] of roots.scopes.entries()) {
    const found =
      i === 0
        ? xpath
          ? await selectAll(cdp, selector)
          : await selectAll(cdp, selector, scope)
        : xpath
          ? await xpathIn(cdp, scope, selector)
          : await selectAll(cdp, selector, scope);
    for (const id of found) ids.add(id);
  }
  return [...ids];
}

export async function selectAll(cdp: Cdp, selector: string, scope?: number): Promise<number[]> {
  if (selector.startsWith("/") || selector.startsWith("(")) {
    const { searchId, resultCount } = await cdp.send<{ searchId: string; resultCount: number }>("DOM.performSearch", {
      query: selector,
    });
    try {
      if (resultCount === 0) return [];
      const { nodeIds } = await cdp.send<{ nodeIds: number[] }>("DOM.getSearchResults", {
        searchId,
        fromIndex: 0,
        toIndex: resultCount,
      });
      return backendIds(cdp, nodeIds);
    } finally {
      await cdp.send("DOM.discardSearchResults", { searchId });
    }
  }
  const { nodeIds } = await cdp.send<{ nodeIds: number[] }>("DOM.querySelectorAll", {
    nodeId: scope ?? (await rootNodeId(cdp)),
    selector,
  });
  return backendIds(cdp, nodeIds);
}

export async function attributesOf(cdp: Cdp, backendNodeId: number): Promise<Record<string, string>> {
  const { node } = await cdp.send<{ node: { attributes?: string[] } }>("DOM.describeNode", { backendNodeId });
  const flat = node.attributes ?? [];
  const attrs: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) attrs[flat[i] as string] = flat[i + 1] as string;
  return attrs;
}

export async function axNodeOf(cdp: Cdp, backendNodeId: number): Promise<AXNode | undefined> {
  const { nodes } = await cdp.send<{ nodes: AXNode[] }>("Accessibility.getPartialAXTree", {
    backendNodeId,
    fetchRelatives: false,
  });
  return nodes.find((n) => n.backendDOMNodeId === backendNodeId) ?? nodes[0];
}

const cssEscape = (s: string) => s.replace(/["\\]/g, "\\$&");

export async function match(cdp: Cdp, target: Locator): Promise<MatchOutcome> {
  const onPage = await matchIn(cdp, target, await pageRoots(cdp));
  if (onPage.status !== "none") return onPage;
  const nested = await nestedRoots(cdp);
  return nested ? matchIn(cdp, target, nested) : onPage;
}

async function matchIn(cdp: Cdp, target: Locator, roots: Roots): Promise<MatchOutcome> {
  const scores = new Map<number, Candidate>();
  const bump = (id: number, points: number, why: string) => {
    const c = scores.get(id) ?? { backendNodeId: id, score: 0, matchedBy: [] };
    c.score += points;
    c.matchedBy.push(why);
    scores.set(id, c);
  };

  let possible = 0;

  // 1. Role and accessible name, as Chrome computes them. A field recorded by its label has that label as its name.
  const wantedName = target.name ?? target.label;
  // Each document's accessibility tree: a frame's is its own.
  const axQuery = async (query: Record<string, unknown>) => {
    const nodes = new Map<number, AXNode>();
    for (const backendNodeId of roots.documents) {
      const found = await cdp
        .send<{ nodes: AXNode[] }>("Accessibility.queryAXTree", { backendNodeId, ...query })
        .catch(() => ({ nodes: [] as AXNode[] }));
      for (const n of found.nodes) if (n.backendDOMNodeId) nodes.set(n.backendDOMNodeId, n);
    }
    return [...nodes.values()];
  };
  if (target.role) {
    possible += WEIGHTS.roleName;
    for (const role of equivalentRoles(target.role)) {
      for (const n of await axQuery({ role })) {
        if (n.ignored || !n.backendDOMNodeId) continue;
        const sim = wantedName ? nameSimilarity(wantedName, n.name?.value ?? "") : 1;
        if (sim > 0) bump(n.backendDOMNodeId, WEIGHTS.roleName * sim, `role+name(${sim})`);
      }
    }
  }

  // 1b. The label as an accessible name, whatever the role (a field whose role was recorded differently).
  if (target.label) {
    possible += WEIGHTS.label;
    for (const n of await axQuery({ accessibleName: target.label })) {
      // The label's own text node is named after it too: only controls count.
      if (
        n.ignored ||
        !n.backendDOMNodeId ||
        ["StaticText", "LabelText", "InlineTextBox", "generic"].includes(n.role?.value ?? "")
      )
        continue;
      bump(n.backendDOMNodeId, WEIGHTS.label, "label");
    }
  }

  // 1c. The element's own text: a link or a cell known by what it says.
  if (target.text) {
    possible += WEIGHTS.text;
    const literal = xpathLiteral(normalize(target.text));
    // Never a script's or a style's source: words in a page's code are not on the page.
    const shown = "not(self::script or self::style or self::noscript or self::template)";
    const exact = await selectIn(
      cdp,
      roots,
      `//*[${shown}][text()[translate(normalize-space(.), ${UPPER}, ${LOWER}) = ${literal}]]`,
    ).catch(() => [] as number[]);
    for (const id of exact) bump(id, WEIGHTS.text, "text(1)");
    if (exact.length === 0) {
      const partial = await selectIn(
        cdp,
        roots,
        `//*[${shown}][text()[contains(translate(normalize-space(.), ${UPPER}, ${LOWER}), ${literal})]]`,
      ).catch(() => [] as number[]);
      for (const id of partial.slice(0, 50)) bump(id, WEIGHTS.text * 0.6, "text(0.6)");
    }
  }

  // 2. Stored attributes (id, name, type, href ...).
  const attrs = Object.entries(target.attrs ?? {});
  if (attrs.length > 0) {
    possible += WEIGHTS.attrs;
    const selector = attrs.map(([k, v]) => `[${k}="${cssEscape(v)}"]`).join("");
    const partial = attrs.some(([k]) => k === "id") ? `[id="${cssEscape(target.attrs?.id ?? "")}"]` : selector;
    const ids = new Set([...(await selectIn(cdp, roots, selector)), ...(await selectIn(cdp, roots, partial))]);
    for (const id of ids) {
      const actual = await attributesOf(cdp, id);
      const hits = attrs.filter(([k, v]) => actual[k] === v).length;
      bump(id, (WEIGHTS.attrs * hits) / attrs.length, `attrs(${hits}/${attrs.length})`);
    }
  }

  // 3. Fallback selectors, first one weighted most.
  if (target.fallbacks.length > 0) {
    possible += WEIGHTS.fallback;
    const seen = new Set<number>();
    for (const [i, selector] of target.fallbacks.entries()) {
      const ids = await selectIn(cdp, roots, selector).catch(() => [] as number[]);
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        bump(id, WEIGHTS.fallback * (i === 0 ? 1 : 0.7), `fallback[${i}]`);
      }
    }
  }

  if (possible === 0) return { status: "none", candidates: [] };
  const candidates = [...scores.values()]
    .map((c) => ({ ...c, score: Math.round((c.score / possible) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = candidates;
  if (!best || best.score < ACCEPT_SCORE) return { status: "none", candidates };
  if (second && best.score - second.score < MIN_MARGIN) {
    const near = target.near ? await nearest(cdp, candidates, best.score, target.near) : undefined;
    if (near) return { status: "found", best: near, candidates };
    return { status: "ambiguous", candidates };
  }
  return { status: "found", best, candidates };
}

// XPath has no lowercase(): translate() over the letters, so text matches whatever its case.
const UPPER = `"ABCDEFGHIJKLMNOPQRSTUVWXYZ"`;
const LOWER = `"abcdefghijklmnopqrstuvwxyz"`;

// A string as an XPath literal, quotes and all (XPath 1.0 has no escapes: concat() joins the pieces).
export function xpathLiteral(s: string): string {
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return `concat(${s
    .split('"')
    .map((part) => `"${part}"`)
    .join(`, '"', `)})`;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function boxOf(cdp: Cdp, backendNodeId: number): Promise<Box | undefined> {
  try {
    const { model } = await cdp.send<{ model: { content: number[] } }>("DOM.getBoxModel", { backendNodeId });
    const q = model.content;
    return { left: q[0] ?? 0, top: q[1] ?? 0, right: q[4] ?? 0, bottom: q[5] ?? 0 };
  } catch {
    return undefined; // not rendered
  }
}

// From a control's centre to the nearest edge of the words' box: a heading as wide as the page is as near to a
// button under it at the left as at the right.
function distance(anchor: Box, control: Box): number {
  const x = (control.left + control.right) / 2;
  const y = (control.top + control.bottom) / 2;
  const dx = Math.max(anchor.left - x, 0, x - anchor.right);
  const dy = Math.max(anchor.top - y, 0, y - anchor.bottom);
  return Math.hypot(dx, dy);
}

// Of the candidates tied with the best, the one closest to an element showing the `near` words, when it is clearly the
// closest; undefined when nothing shows them or two are about as close.
async function nearest(
  cdp: Cdp,
  candidates: Candidate[],
  bestScore: number,
  near: string,
): Promise<Candidate | undefined> {
  const literal = xpathLiteral(normalize(near));
  const anchors = (
    await selectAll(cdp, `//*[text()[contains(translate(normalize-space(.), ${UPPER}, ${LOWER}), ${literal})]]`).catch(
      () => [] as number[],
    )
  ).slice(0, 5);
  const boxes = (await Promise.all(anchors.map((id) => boxOf(cdp, id)))).filter((b): b is Box => b !== undefined);
  if (boxes.length === 0) return undefined;
  const tied = candidates.filter((c) => bestScore - c.score < MIN_MARGIN).slice(0, 10);
  const measured: { c: Candidate; d: number }[] = [];
  for (const c of tied) {
    const box = await boxOf(cdp, c.backendNodeId);
    if (!box) continue;
    measured.push({ c, d: Math.min(...boxes.map((a) => distance(a, box))) });
  }
  measured.sort((a, b) => a.d - b.d);
  const [first, next] = measured;
  if (!first || (next && first.d > next.d * NEAR_RATIO)) return undefined;
  return { ...first.c, matchedBy: [...first.c.matchedBy, "near"] };
}

// For extract with `all`: every element the first fallback selects (document order), filtered by role.
export async function matchAll(cdp: Cdp, target: Locator): Promise<number[]> {
  const selector = target.fallbacks[0];
  if (!selector) throw new Error("extract with all needs a fallback selector");
  const ids = await selectAll(cdp, selector);
  if (!target.role) return ids;
  const roles = equivalentRoles(target.role);
  const kept: number[] = [];
  for (const id of ids) {
    const ax = await axNodeOf(cdp, id);
    if (ax?.role?.value && roles.includes(ax.role.value)) kept.push(id);
  }
  return kept;
}
