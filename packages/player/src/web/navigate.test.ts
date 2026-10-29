import { describe, expect, it } from "vitest";
import type { Cdp } from "./cdp.ts";
import { navigate } from "./executor.ts";

// A page at `start` that answers the expressions navigate asks. Going to another address starts a new document (a new
// timeOrigin); going to the same address with another #fragment does not: that is how single-page apps and Google
// Sheets (#gid=) move.
const fakePage = (start: string) => {
  const page = { href: start, origin: 1 };
  const withoutHash = (u: string) => u.split("#")[0];
  const cdp = {
    send: async (method: string, params: { url?: string; expression?: string }) => {
      if (method === "Page.navigate") {
        if (withoutHash(params.url ?? "") !== withoutHash(page.href)) page.origin += 1;
        page.href = params.url ?? page.href;
        return {};
      }
      const run = new Function("performance", "location", "document", `return ${params.expression}`);
      return { result: { value: run({ timeOrigin: page.origin }, { href: page.href }, { readyState: "complete" }) } };
    },
  } as unknown as Cdp;
  return { page, cdp };
};

describe("navigate", () => {
  it("opens another address", async () => {
    const { cdp, page } = fakePage("https://sheets.test/d/1/edit#gid=0");
    expect(await navigate(cdp, "https://other.test/", 600)).toBeUndefined();
    expect(page.href).toBe("https://other.test/");
  });

  it("moves to another #fragment of the same page without waiting for a load that never comes (C31)", async () => {
    const { cdp, page } = fakePage("https://sheets.test/d/1/edit#gid=0");
    const started = Date.now();
    expect(await navigate(cdp, "https://sheets.test/d/1/edit#gid=5", 600)).toBeUndefined();
    expect(page.href).toBe("https://sheets.test/d/1/edit#gid=5");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
