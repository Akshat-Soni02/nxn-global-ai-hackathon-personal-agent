// Code's questions that the recording already answers are not asked (spec 2.10): "which file next time?" after "all
// the reports" (H2), "which row?" after "today's row". The answer carries the words it came from, for the log and the
// review.
import type { Question } from "../compile.ts";

const ALL = /\b(all|every|each)\b[^.!?]{0,40}\b(files?|reports?|invoices?|pdfs?|documents?|attachments?|ones?)\b/i;
const NEWEST = /\b(newest|latest|most recent|last one)\b/i;
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
    return (
      pick((o) => /\ball\b/i.test(optionText(o)), ALL) ?? pick((o) => /newest|latest/i.test(optionText(o)), NEWEST)
    );
  }
  if (question.id.startsWith("row-")) return pick((o) => optionText(o).includes("{{today"), TODAY);
  return undefined;
}
