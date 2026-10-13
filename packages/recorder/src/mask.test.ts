import { describe, expect, it } from "vitest";
import { MASK, maskLines, maskText } from "./mask.ts";

const masked = (text: string, never?: string[]) => maskText(text, never).text;

describe("masking what a screenshot shows", () => {
  it("hides emails, phone numbers, cards that pass the Luhn check, IBANs, keys and tokens", () => {
    expect(masked("From: Jane Doe <jane.doe@acme.co.uk>")).toBe(`From: Jane Doe <${MASK}>`);
    expect(masked("Call +1 (415) 555-0132 today")).toBe(`Call ${MASK} today`);
    expect(masked("Call 020 7946 0958")).toBe(`Call ${MASK}`);
    expect(masked("Card 4242 4242 4242 4242 exp 12/28")).toBe(`Card ${MASK} exp 12/28`);
    expect(masked("IBAN DE89 3704 0044 0532 0130 00")).toBe(`IBAN ${MASK}`);
    expect(masked("key sk-proj-abcDEF1234567890xyz")).toBe(`key ${MASK}`);
    expect(masked("token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe(`token ${MASK}`);
    expect(masked("Authorization eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4")).toBe(`Authorization ${MASK}`);
    expect(masked("session 3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a")).toBe(`session ${MASK}`);
  });

  it("leaves what a task needs: dates, amounts, short numbers, an order number that is not a card", () => {
    const text = "Invoice 1042 due 2026-10-31 · Total $1,234.56 · Order 1234567812345678 · Week 41";
    expect(masked(text)).toBe(text);
    expect(maskText(text).hits).toBe(0);
  });

  it("hides the user's Never terms, as whole words, whatever the case", () => {
    expect(masked("Payroll for Project Falcon, falconry club", ["project falcon"])).toBe(
      `Payroll for ${MASK}, falconry club`,
    );
  });

  it("says which lines to black out in the picture", () => {
    const box = (y: number) => ({ x: 0, y, w: 100, h: 20 });
    const result = maskLines(
      [
        { text: "Inbox", box: box(0) },
        { text: "jane@acme.com wrote:", box: box(30) },
        { text: "Weekly metrics", box: box(60) },
      ],
      [],
    );
    expect(result.lines.map((l) => l.text)).toEqual(["Inbox", `${MASK} wrote:`, "Weekly metrics"]);
    expect(result.boxes).toEqual([box(30)]);
    expect(result.hits).toBe(1);
  });
});
