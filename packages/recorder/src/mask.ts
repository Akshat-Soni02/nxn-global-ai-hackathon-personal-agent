// Masking the words read from a screenshot before they leave the Mac (docs/design.md, "Redaction"): emails, phone
// numbers, card numbers (Luhn-checked), IBANs, API keys and tokens, and the user's Never terms become ███. Only the
// masked text is ever sent to the model; the lines that had something masked are also blacked out in the saved
// picture. Conservative on purpose: masking a harmless number costs a little context, missing a card number leaks it.
export const MASK = "███";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Line {
  text: string;
  box: Box;
}

const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};
const digitsOf = (text: string) => text.replace(/\D/g, "");

const RULES: { pattern: RegExp; keep?: (match: string) => boolean }[] = [
  // Emails.
  { pattern: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi },
  // JSON Web Tokens and well-known key prefixes (OpenAI, Stripe, GitHub, Slack, AWS, Google).
  { pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g },
  {
    pattern:
      /\b(?:sk|pk|rk)[-_][\w-]{12,}|\bgh[pousr]_\w{20,}|\bgithub_pat_\w{20,}|\bxox[abprs]-[\w-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[\w-]{30,}/g,
  },
  // Any other long run of letters and digits mixed: tokens, session ids, secrets.
  { pattern: /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{32,}\b/g },
  // IBANs: two letters, two check digits, 11 to 30 more letters or digits (spaces allowed in groups of 4).
  { pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  // Card numbers: 13 to 19 digits, with spaces or dashes, that pass the Luhn check.
  { pattern: /\b\d(?:[ -]?\d){12,18}\b/g, keep: (m) => !luhn(digitsOf(m)) },
  // Phone numbers: a leading + or 9 to 15 digits with the usual separators.
  {
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,4}/g,
    keep: (m) => {
      const n = digitsOf(m).length;
      return n < 9 || n > 15 || /^\d{4}-\d{2}-\d{2}$/.test(m.trim());
    },
  },
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The text with everything sensitive replaced by ███, and how many things were masked.
export function maskText(text: string, never: string[] = []): { text: string; hits: number } {
  let hits = 0;
  let out = text;
  for (const term of never.map((t) => t.trim()).filter((t) => t.length >= 3)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"), () => {
      hits++;
      return MASK;
    });
  }
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) => {
      if (rule.keep?.(match)) return match;
      hits++;
      return MASK;
    });
  }
  return { text: out, hits };
}

// Lines read from a picture, masked; `boxes` are the lines that had something masked, to black out in the picture.
export function maskLines(lines: Line[], never: string[] = []): { lines: Line[]; boxes: Box[]; hits: number } {
  const masked: Line[] = [];
  const boxes: Box[] = [];
  let hits = 0;
  for (const line of lines) {
    const result = maskText(line.text, never);
    masked.push({ text: result.text, box: line.box });
    if (result.hits > 0) boxes.push(line.box);
    hits += result.hits;
  }
  return { lines: masked, boxes, hits };
}
