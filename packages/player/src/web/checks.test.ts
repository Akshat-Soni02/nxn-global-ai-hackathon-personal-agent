import { describe, expect, it } from "vitest";
import type { Cdp } from "./cdp.ts";
import { pageCheckHolds } from "./checks.ts";

// A page that says "Order placed" at https://shop.test/done, answering the expressions the check evaluates.
const page = (): Cdp =>
  ({
    send: async (_method: string, params: { expression: string }) => {
      const run = new Function("document", "location", `return ${params.expression}`);
      return { result: { value: run({ body: { innerText: "Order placed" } }, { href: "https://shop.test/done" }) } };
    },
  }) as unknown as Cdp;

describe("page checks", () => {
  it("hold when the page has the text and the address", async () => {
    expect(await pageCheckHolds(page(), { text_visible: "Order placed", url_matches: "/done" })).toBe(true);
    expect(await pageCheckHolds(page(), { text_visible: "Payment failed" })).toBe(false);
    expect(await pageCheckHolds(page(), { url_matches: "/cart" })).toBe(false);
  });

  it("never hold on an empty text or address: it matches every page (C6)", async () => {
    // includes("") is true on any page, so an empty value (a {{variable}} that came out empty) proved nothing.
    expect(await pageCheckHolds(page(), { text_visible: "" })).toBe(false);
    expect(await pageCheckHolds(page(), { url_matches: "" })).toBe(false);
  });
});
