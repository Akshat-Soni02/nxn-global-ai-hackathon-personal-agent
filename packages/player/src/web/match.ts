// Matcher v0: turns a stored Locator into scored candidates on the live page.
// Signals: Chrome's own accessibility tree (role + accessible name), stored attributes, fallback selectors.
// Positions are never stored; they are looked up after matching. See "Per-step loop" step 3 in the design doc.
// Not yet used: `near`, `text`, `label`, frames and shadow roots (TODO).
import type { Locator } from "@taskplayer/core";
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

const WEIGHTS = { roleName: 0.45, attrs: 0.25, fallback: 0.3 };
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

export async function selectAll(cdp: Cdp, selector: string): Promise<number[]> {
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
    nodeId: await rootNodeId(cdp),
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
  const scores = new Map<number, Candidate>();
  const bump = (id: number, points: number, why: string) => {
    const c = scores.get(id) ?? { backendNodeId: id, score: 0, matchedBy: [] };
    c.score += points;
    c.matchedBy.push(why);
    scores.set(id, c);
  };

  let possible = 0;

  // 1. Role and accessible name, as Chrome computes them.
  if (target.role) {
    possible += WEIGHTS.roleName;
    const root = await rootNodeId(cdp);
    for (const role of equivalentRoles(target.role)) {
      const { nodes } = await cdp.send<{ nodes: AXNode[] }>("Accessibility.queryAXTree", { nodeId: root, role });
      for (const n of nodes) {
        if (n.ignored || !n.backendDOMNodeId) continue;
        const sim = target.name ? nameSimilarity(target.name, n.name?.value ?? "") : 1;
        if (sim > 0) bump(n.backendDOMNodeId, WEIGHTS.roleName * sim, `role+name(${sim})`);
      }
    }
  }

  // 2. Stored attributes (id, name, type, href ...).
  const attrs = Object.entries(target.attrs ?? {});
  if (attrs.length > 0) {
    possible += WEIGHTS.attrs;
    const selector = attrs.map(([k, v]) => `[${k}="${cssEscape(v)}"]`).join("");
    const partial = attrs.some(([k]) => k === "id") ? `[id="${cssEscape(target.attrs?.id ?? "")}"]` : selector;
    const ids = new Set([...(await selectAll(cdp, selector)), ...(await selectAll(cdp, partial))]);
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
      const ids = await selectAll(cdp, selector).catch(() => [] as number[]);
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
  if (second && best.score - second.score < MIN_MARGIN) return { status: "ambiguous", candidates };
  return { status: "found", best, candidates };
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
