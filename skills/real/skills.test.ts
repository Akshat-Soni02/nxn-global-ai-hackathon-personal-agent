// Checks the real skills in skills/real against saved snapshots of the real pages (fixtures/snapshots):
// every web target's fallback selector must find the element, and its stored role/name must match that element.
// Refresh snapshots with `pnpm snapshot:pages` when a site changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { isAction, type Locator, Skill, walkSteps } from "../../packages/core/src/skill.ts";

const root = join(import.meta.dirname, "../..");
const load = (id: string) => Skill.parse(JSON.parse(readFileSync(join(root, "skills/real", `${id}.json`), "utf8")));
const page = (file: string) => parseHTML(readFileSync(join(root, "fixtures/snapshots", file), "utf8")).document;

// Which page each web target lives on. Targets on pages reached only after submitting are listed in AFTER_SUBMIT.
const PAGES: Record<string, string> = {
  "upload-test-file": "the-internet-upload.html",
  "download-and-file": "selenium-download.html",
  "hn-digest": "hacker-news.html",
  "fill-web-form": "selenium-web-form.html",
};
const AFTER_SUBMIT = new Set(["upload-test-file/s4"]);

// Minimal role and accessible-name rules, enough for the elements these pages use.
function roleOf(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type") ?? "text";
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "button" || (tag === "input" && ["submit", "button"].includes(type))) return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "input" && el.hasAttribute("list")) return "combobox";
  if (tag === "input" && ["checkbox", "radio"].includes(type)) return type;
  if (tag === "input" && ["text", "email", "search", "tel", "url"].includes(type)) return "textbox";
  return undefined;
}

function nameOf(el: Element): string {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  if (el.tagName === "INPUT" && ["submit", "button"].includes(el.getAttribute("type") ?? "")) {
    return clean(el.getAttribute("value"));
  }
  const label = el.closest("label");
  if (label) {
    // Label text without the text of nested form controls (e.g. <option>s inside a labelled <select>).
    const copy = label.cloneNode(true) as Element;
    for (const c of copy.querySelectorAll("select, textarea, datalist")) c.remove();
    return clean(copy.textContent);
  }
  return clean(el.textContent);
}

function find(doc: Document, target: Locator): Element[] {
  const selector = target.fallbacks[0];
  if (!selector) throw new Error("target has no CSS fallback");
  return [...doc.querySelectorAll(selector)];
}

describe("real skills", () => {
  for (const [id, file] of Object.entries(PAGES)) {
    const skill = load(id);
    const doc = page(file);

    for (const { step } of walkSteps(skill.steps)) {
      if (!isAction(step) || step.channel !== "web" || !step.target || AFTER_SUBMIT.has(`${id}/${step.id}`)) continue;
      const target = step.target;

      it(`${id}/${step.id} finds "${step.intent}"`, () => {
        const matches = find(doc, target);
        if (step.args.all) {
          expect(matches.length).toBeGreaterThanOrEqual(Number(step.args.limit ?? 1));
        } else {
          expect(matches).toHaveLength(1);
        }
        const el = matches[0] as Element;
        if (target.role) expect(roleOf(el)).toBe(target.role);
        if (target.name && !step.args.all) expect(nameOf(el)).toBe(target.name);
        for (const [attr, value] of Object.entries(target.attrs ?? {})) {
          expect(el.getAttribute(attr)).toBe(value);
        }
      });
    }
  }

  // Variables (declared, visible, right fields) are checked by the schema itself: see packages/core/src/check.ts.
});
