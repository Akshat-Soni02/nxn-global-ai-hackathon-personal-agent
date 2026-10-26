import { describe, expect, it } from "vitest";
import { MASK, maskLines, maskText } from "./mask.ts";

const inPicture = (text: string, terms?: string[]) => maskText(text, terms, { patterns: true }).text;

describe("masking", () => {
  it("in pictures: hides emails, phone numbers, cards that pass the Luhn check, IBANs, keys and tokens", () => {
    expect(inPicture("From: Jane Doe <jane.doe@acme.co.uk>")).toBe(`From: Jane Doe <${MASK}>`);
    expect(inPicture("Call +1 (415) 555-0132 today")).toBe(`Call ${MASK} today`);
    expect(inPicture("Call 020 7946 0958")).toBe(`Call ${MASK}`);
    expect(inPicture("Card 4242 4242 4242 4242 exp 12/28")).toBe(`Card ${MASK} exp 12/28`);
    expect(inPicture("IBAN DE89 3704 0044 0532 0130 00")).toBe(`IBAN ${MASK}`);
    expect(inPicture("key sk-proj-abcDEF1234567890xyz")).toBe(`key ${MASK}`);
    expect(inPicture("token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe(`token ${MASK}`);
    expect(inPicture("Authorization eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4")).toBe(
      `Authorization ${MASK}`,
    );
    expect(inPicture("session 3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a")).toBe(`session ${MASK}`);
  });

  it("in text the AI reads: only the user's private words, so a sheet's id or an email stays readable", () => {
    const sheet = "docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit";
    expect(maskText(sheet).text).toBe(sheet);
    expect(maskText("From jane@acme.com about Project Falcon", ["project falcon"]).text).toBe(
      `From jane@acme.com about ${MASK}`,
    );
  });

  it("leaves what a task needs even in pictures: dates, amounts, short numbers, an order number that is not a card", () => {
    const text = "Invoice 1042 due 2026-10-31 · Total $1,234.56 · Order 1234567812345678 · Week 41";
    expect(inPicture(text)).toBe(text);
    expect(maskText(text, [], { patterns: true }).hits).toBe(0);
  });

  it("hides private words as whole words, whatever the case", () => {
    expect(maskText("Payroll for Project Falcon, falconry club", ["project falcon"]).text).toBe(
      `Payroll for ${MASK}, falconry club`,
    );
  });

  it("blacks out sensitive lines in the picture, and keeps their words readable for the AI", () => {
    const box = (y: number) => ({ x: 0, y, w: 100, h: 20 });
    const result = maskLines(
      [
        { text: "Inbox", box: box(0) },
        { text: "jane@acme.com wrote:", box: box(30) },
        { text: "Weekly metrics for Falcon", box: box(60) },
      ],
      ["falcon"],
    );
    expect(result.lines.map((l) => l.text)).toEqual(["Inbox", "jane@acme.com wrote:", `Weekly metrics for ${MASK}`]);
    expect(result.boxes).toEqual([box(30), box(60)]);
    expect(result.hits).toBe(2);
  });
});
