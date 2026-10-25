// The matcher on a real page, in headless Chrome (skipped where Chrome isn't installed, as on CI).
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DevChrome, launchChrome, MAC_CHROME } from "../node/chrome.ts";
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

describe("XPath literals", () => {
  it("quote any text", () => {
    expect(xpathLiteral("Save")).toBe('"Save"');
    expect(xpathLiteral('say "hi"')).toBe(`'say "hi"'`);
    expect(xpathLiteral(`it's "x"`)).toBe(`concat("it's ", '"', "x", '"', "")`);
  });
});
