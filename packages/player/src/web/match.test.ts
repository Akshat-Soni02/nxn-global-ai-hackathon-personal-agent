// The matcher on a real page, in headless Chrome (skipped where Chrome isn't installed, as on CI).
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DevChrome, launchChrome, MAC_CHROME } from "../node/chrome.ts";
import { evaluate } from "./cdp.ts";
import { executeWebStep } from "./executor.ts";
import { attributesOf, match, xpathLiteral } from "./match.ts";

const PAGE = `<!doctype html><html><body style="font:16px sans-serif">
<section style="height:300px"><h2>Profile</h2><button id="a">Save</button></section>
<section style="height:300px"><h2>Billing</h2><button id="b">Save</button></section>
<label for="email">Work email</label><input id="email" type="text">
<ul><li><a id="story" href="#x"><span>Show HN: a thing</span></a></li><li id="cell">Total due</li></ul>
</body></html>`;

describe.skipIf(!existsSync(MAC_CHROME))("the matcher on a real page", () => {
  let chrome: DevChrome;
  beforeAll(async () => {
    chrome = await launchChrome({ profileDir: mkdtempSync(join(tmpdir(), "match-")), headless: true });
    await chrome.cdp.send("Page.enable");
    await chrome.cdp.send("Page.navigate", { url: `data:text/html,${encodeURIComponent(PAGE)}` });
    await new Promise((r) => setTimeout(r, 800));
  }, 30_000);
  afterAll(async () => chrome?.close());

  const idOf = async (backendNodeId: number) => (await attributesOf(chrome.cdp, backendNodeId)).id;

  it("two buttons named alike: near picks the one under its heading", async () => {
    const plain = await match(chrome.cdp, { role: "button", name: "Save", fallbacks: [] });
    expect(plain.status).toBe("ambiguous");
    const near = await match(chrome.cdp, { role: "button", name: "Save", near: "Billing", fallbacks: [] });
    expect(near.status).toBe("found");
    if (near.status === "found") {
      expect(await idOf(near.best.backendNodeId)).toBe("b");
      expect(near.best.matchedBy).toContain("near");
    }
  });

  it("a field known only by its label", async () => {
    const found = await match(chrome.cdp, { label: "Work email", fallbacks: [] });
    expect(found.status).toBe("found");
    if (found.status === "found") expect(await idOf(found.best.backendNodeId)).toBe("email");
    const withRole = await match(chrome.cdp, { role: "textbox", label: "Work email", fallbacks: [] });
    expect(withRole.status === "found" && (await idOf(withRole.best.backendNodeId))).toBe("email");
  });

  it("an element known only by its text, whatever its case", async () => {
    const found = await match(chrome.cdp, { text: "total DUE", fallbacks: [] });
    expect(found.status).toBe("found");
    if (found.status === "found") expect(await idOf(found.best.backendNodeId)).toBe("cell");
  });

  it("text of a link inside a span still finds it with its role and name", async () => {
    const found = await match(chrome.cdp, {
      role: "link",
      name: "Show HN: a thing",
      text: "Show HN: a thing",
      fallbacks: [],
    });
    expect(found.status).toBe("found");
  });
});

// N3: controls inside an open shadow root (a web component's) and inside a frame of the same site.
const NESTED = `<!doctype html><html><body style="font:16px sans-serif">
<h1>Studio</h1><p id="log"></p><x-panel></x-panel>
<iframe id="f" style="width:600px;height:300px;border:4px solid #ccc;margin-left:40px" srcdoc="<button id='fb'>Approve</button><p id='ft'>Frame total</p><input id='fi' aria-label='Frame note'>"></iframe>
<script>
const log = (w) => { document.getElementById("log").textContent += w + ";"; };
customElements.define("x-panel", class extends HTMLElement { connectedCallback() {
  const root = this.attachShadow({ mode: "open" });
  root.innerHTML = '<button id="sb">Publish</button><p id="st">Shadow total</p>';
  root.getElementById("sb").addEventListener("click", () => log("published"));
} });
document.getElementById("f").addEventListener("load", (e) => {
  e.target.contentDocument.getElementById("fb").addEventListener("click", () => log("approved"));
});
</script>
</body></html>`;

describe.skipIf(!existsSync(MAC_CHROME))("the matcher inside shadow roots and frames (N3)", () => {
  let chrome: DevChrome;
  beforeAll(async () => {
    chrome = await launchChrome({ profileDir: mkdtempSync(join(tmpdir(), "match-n3-")), headless: true });
    await chrome.cdp.send("Page.navigate", { url: `data:text/html,${encodeURIComponent(NESTED)}` });
    await new Promise((r) => setTimeout(r, 1000));
  }, 30_000);
  afterAll(async () => chrome?.close());

  const idOf = async (backendNodeId: number) => (await attributesOf(chrome.cdp, backendNodeId)).id;
  const found = async (target: Parameters<typeof match>[1]) => {
    const out = await match(chrome.cdp, target);
    return out.status === "found" ? idOf(out.best.backendNodeId) : out.status;
  };

  it("by role and name", async () => {
    expect(await found({ role: "button", name: "Publish", fallbacks: [] })).toBe("sb");
    expect(await found({ role: "button", name: "Approve", fallbacks: [] })).toBe("fb");
  });

  it("by its own text", async () => {
    expect(await found({ text: "Shadow total", fallbacks: [] })).toBe("st");
    expect(await found({ text: "Frame total", fallbacks: [] })).toBe("ft");
  });

  it("a click and typing reach them, through the executor as a run does", async () => {
    const step = (id: string, action: string, target: object, args: object = {}) =>
      ({ id, type: "action", intent: id, channel: "web", action, target: { fallbacks: [], ...target }, args }) as never;
    expect((await executeWebStep(chrome.cdp, step("p", "click", { role: "button", name: "Publish" }))).ok).toBe(true);
    expect((await executeWebStep(chrome.cdp, step("a", "click", { role: "button", name: "Approve" }))).ok).toBe(true);
    const typed = await executeWebStep(
      chrome.cdp,
      step("t", "type", { role: "textbox", name: "Frame note" }, { text: "ok" }),
    );
    expect(typed.ok).toBe(true);
    expect(await evaluate(chrome.cdp, `document.getElementById("log").textContent`)).toBe("published;approved;");
    expect(await evaluate(chrome.cdp, `document.getElementById("f").contentDocument.getElementById("fi").value`)).toBe(
      "ok",
    );
  });

  it("by a recorded selector or its attributes", async () => {
    expect(await found({ fallbacks: ["#sb"] })).toBe("sb");
    expect(await found({ fallbacks: ["#fb"] })).toBe("fb");
    expect(await found({ attrs: { id: "fi" }, fallbacks: [] })).toBe("fi");
  });
});

describe("XPath literals", () => {
  it("quote any text", () => {
    expect(xpathLiteral("Save")).toBe('"Save"');
    expect(xpathLiteral('say "hi"')).toBe(`'say "hi"'`);
    expect(xpathLiteral(`it's "x"`)).toBe(`concat("it's ", '"', "x", '"', "")`);
  });
});
