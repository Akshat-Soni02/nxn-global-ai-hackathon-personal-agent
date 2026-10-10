// The page side of inspect.ts, run under jsdom on the drift fixtures (no layout: visibility comes from styles and
// attributes only). The CDP side is exercised live, through the extension or `pnpm replay`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { type ElementInfo, type FoundElement, locatorFor, PAGE_SCRIPT, type PageSignals } from "./inspect.ts";

const drift = (file: string) => {
  const html = readFileSync(join(import.meta.dirname, "../../../../fixtures/pages/drift", file), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: `http://localhost:5173/drift/${file}` });
  const run = dom.window.eval(`(${PAGE_SCRIPT})`) as (op: Record<string, unknown>) => unknown;
  return { run, document: dom.window.document };
};

describe("the page outline", () => {
  it("lists headings, forms and controls with refs, hidden menus left out", () => {
    const { run } = drift("menu.html");
    const outline = run({ op: "outline" }) as string;
    expect(outline.split("\n")).toEqual([
      'URL http://localhost:5173/drift/menu.html "Invoice portal"',
      "e1 main",
      '  h1 "Invoices"',
      "  e2 form",
      '    e3 textbox "Invoice number"',
      '    e4 file input "Invoice PDF" accept=application/pdf',
      '    e5 button "Submit"',
      '  e6 navigation "Account"',
      '    e7 link "Reports" → #reports',
      '    e8 button "More actions" [expanded=false]',
    ]);
    // Refs stay with their elements between calls.
    expect(run({ op: "outline" })).toBe(outline);
  });

  it("shows a modal dialog first, and a hidden file input as hidden", () => {
    const { run, document } = drift("banner.html");
    const outline = run({ op: "outline" }) as string;
    expect(outline).toMatch(
      /^URL .*\ne1 dialog "Cookie settings" \(modal\)\n {2}h2 "Cookie settings"\n {2}e2 button "Accept all"\n {2}e3 button "Manage choices"\n/,
    );
    document.querySelector("input[type=file]")?.setAttribute("hidden", "");
    expect(run({ op: "outline" })).toMatch(/file input "Invoice PDF" \(hidden\) accept=application\/pdf/);
  });

  it("can outline just one part, by ref", () => {
    const { run } = drift("base.html");
    run({ op: "outline" });
    expect(run({ op: "outline", scope: "e6" })).toBe('e7 link "Reports" → #reports\ne8 button "Export CSV"');
  });
});

describe("finding and inspecting", () => {
  it("finds controls by name, best first, and filters by role group", () => {
    const { run } = drift("reworded.html");
    const found = run({ op: "find", text: "Submit", role: "button" }) as FoundElement[];
    expect(found.map((f) => [f.name, f.score])).toEqual([["Submit invoice", 0.8]]);
    expect(found[0]).toMatchObject({ role: "button", near: "Invoices", visible: true });

    const renamed = drift("renamed.html").run({ op: "find", text: "Submit", role: "button" }) as FoundElement[];
    expect(renamed).toEqual([]); // no shared words: the cheap ladder finds nothing, the agent has to look
  });

  it("describes an element and the Locator a step would store for it", () => {
    const { run } = drift("reworded.html");
    const [best] = run({ op: "find", text: "Submit invoice" }) as FoundElement[];
    const info = run({ op: "describe", ref: best?.ref }) as ElementInfo;
    expect(info).toMatchObject({
      tag: "button",
      role: "button",
      name: "Submit invoice",
      visible: true,
      near: "Invoices",
    });
    expect(info.selector).toBe("main > form > button:nth-of-type(1)");
    expect(locatorFor(info)).toEqual({
      role: "button",
      name: "Submit invoice",
      attrs: { type: "button" },
      fallbacks: [info.selector],
    });
    expect(run({ op: "describe", ref: "e99" })).toBeNull();
  });

  it("uses a unique id or name for the selector when there is one", () => {
    const { run } = drift("base.html");
    const [submit] = run({ op: "find", text: "Submit" }) as FoundElement[];
    expect((run({ op: "describe", ref: submit?.ref }) as ElementInfo).selector).toBe("#submit");
    const [number] = run({ op: "find", text: "Invoice number" }) as FoundElement[];
    expect((run({ op: "describe", ref: number?.ref }) as ElementInfo).selector).toBe('input[name="number"]');
  });
});

describe("signals", () => {
  it("says when a page looks like a login page, and which dialogs are open", () => {
    expect(drift("logged-out.html").run({ op: "signals" })).toMatchObject({
      title: "Sign in · Invoice portal",
      loginLike: true,
      dialogs: [],
    } satisfies Partial<PageSignals>);
    expect(drift("banner.html").run({ op: "signals" })).toMatchObject({
      loginLike: false,
      dialogs: ["Cookie settings"],
    });
  });
});
