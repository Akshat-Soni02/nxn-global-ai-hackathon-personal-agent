// Code's questions that the recording already answers are not asked (spec 2.10): "which file next time?" after "all
// the reports" (H2), "which row?" after "today's row". The answer carries the words it came from, for the log and the
// review.
import type { Question } from "../compile.ts";

const FILES = "files?|reports?|invoices?|pdfs?|documents?|attachments?|statements?|receipts?|exports?|downloads?";
const ALL = new RegExp(`\\b(all|every|each)\\b[^.!?]{0,40}\\b(${FILES}|ones?)\\b`, "i");
// "The newest" said of the files (or of the input's own name: "the latest invoice"), never of an email.
const newest = (stems: string[]) =>
  new RegExp(`\\b(newest|latest|most recent|last)\\b[^.!?]{0,30}?\\b(${[FILES, "one", ...stems].join("|")})\\b`, "i");
const TODAY = /\btoday'?s?\b/i;
type Option = NonNullable<Question["options"]>[number];
const optionText = (o: Option) => `${o.label} ${typeof o.value === "string" ? o.value : JSON.stringify(o.value ?? "")}`;

export function answerFromEvidence(
  question: Question,
  evidence: { goal: string; said: { text: string }[] },
): { answer: string; quote: string } | undefined {
  const sentences = [evidence.goal, ...evidence.said.map((s) => s.text)].flatMap((t) => t.split(/(?<=[.!?])\s+/));
  const options = question.options ?? [];
  const pick = (fits: (o: Option) => boolean, words: RegExp) => {
    const option = options.find(fits);
    const quote = option && sentences.find((s) => words.test(s));
    return option && quote ? { answer: option.label, quote: quote.trim().slice(0, 160) } : undefined;
  };
  if (/\bfiles?\b/i.test(question.text) || (question.appliesTo ?? "").includes(".resolve")) {
    const input = /\binputs\.([a-z0-9_]+)/.exec(question.appliesTo ?? "")?.[1] ?? "";
    const stems = input.split("_").filter((w) => /^[a-z]{3,}$/.test(w));
    return (
      pick((o) => /\ball\b/i.test(optionText(o)), ALL) ??
      pick((o) => /newest|latest/i.test(optionText(o)), newest(stems))
    );
  }
  if (question.id.startsWith("row-")) return pick((o) => optionText(o).includes("{{today"), TODAY);
  return undefined;
}
