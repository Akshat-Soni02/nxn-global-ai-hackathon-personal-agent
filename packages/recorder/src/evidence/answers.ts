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
      // By the words offered, not the stored values: "ask me each time" stores pick: "newest" (F13).
      pick((o) => /\ball\b/i.test(o.label), ALL) ?? pick((o) => /newest|latest/i.test(o.label), newest(stems))
    );
  }
  if (question.id.startsWith("row-")) return pick((o) => optionText(o).includes("{{today"), TODAY);
  return undefined;
}

// Never rules said aloud while recording (N16): "never email the client", "don't touch the archive folder". Only the
// goal is asked before recording, so the Never list started empty and what was said was never enforced. The words after
// never / don't, up to a comma (the reason after it isn't the rule), at least two words; "don't worry", "don't forget"
// and the like are talk, not rules.
const NEVER = /\b(?:never|don'?t|do not|must not|mustn'?t|should not|shouldn'?t)\s+([^,;]+)/i;
const TALK = /^(worry|forget|mind|know|think|care|bother|panic|be|have to|need to|remember)\b/i;
export function neverFromSpeech(said: { text: string }[]): string[] {
  const rules: string[] = [];
  for (const { text } of said) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const rule = NEVER.exec(sentence)?.[1]
        ?.replace(/[.!?]+$/, "")
        .trim();
      if (!rule || rule.split(/\s+/).length < 2 || TALK.test(rule) || rules.includes(rule)) continue;
      rules.push(rule);
    }
  }
  return rules;
}
