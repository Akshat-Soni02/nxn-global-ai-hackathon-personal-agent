import { describe, expect, it } from "vitest";
import { ftsQuery, openMemory } from "./sqlite.ts";

describe("sqlite memory", () => {
  it("adds, searches by meaning words, lists and removes", async () => {
    const memory = openMemory(":memory:");
    const fact = await memory.add({
      kind: "fact",
      text: "Invoices from Acme arrive in ~/Downloads",
      skillId: "upload-invoice",
    });
    await memory.add({ kind: "preference", text: "Name uploads YYYY-MM-DD-vendor.pdf" });
    expect((await memory.search("acme invoice-0923")).map((m) => m.id)).toEqual([fact.id]);
    expect(await memory.search("vendor.pdf")).toHaveLength(1); // words, not substrings: "pdf" finds the preference
    expect(await memory.search("acme", { skillId: "other-skill" })).toEqual([]);
    expect(await memory.list({ skillId: "upload-invoice" })).toHaveLength(1);
    await memory.remove(fact.id);
    expect(await memory.search("acme")).toEqual([]);
    memory.close();
  });

  it("does not store the same answer twice", async () => {
    const memory = openMemory(":memory:");
    const a = await memory.add({ kind: "fact", text: "same", skillId: "s" });
    const b = await memory.add({ kind: "fact", text: "same", skillId: "s" });
    expect(b.id).toBe(a.id);
    memory.close();
  });

  it("treats any text as a safe query, even FTS syntax", async () => {
    const memory = openMemory(":memory:");
    await memory.add({ kind: "fact", text: "acme portal" });
    expect(await memory.search('acme-portal: "x" (AND) NOT * OR')).toHaveLength(1);
    expect(await memory.search("--- !!")).toEqual([]);
    expect(ftsQuery('a "b" c')).toBe('"a" OR "b" OR "c"');
    memory.close();
  });
});
