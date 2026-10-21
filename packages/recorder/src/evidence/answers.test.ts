import { describe, expect, it } from "vitest";
import type { Question } from "../compile.ts";
import { answerFromEvidence } from "./answers.ts";

const said = (...texts: string[]) => ({ goal: "Upload this month's invoice", said: texts.map((text) => ({ text })) });

describe("questions the recording answers", () => {
  const file: Question = {
    id: "file-s2",
    text: "Which file next time?",
    appliesTo: "steps.start.inputs.invoice.resolve.pick",
    options: [
      { label: "the newest one", value: "newest" },
      { label: "all of them", value: "all" },
    ],
  };

  it("answers which file from what was said, with the words it came from", () => {
    expect(answerFromEvidence(file, said("I always upload all the reports in that folder."))).toEqual({
      answer: "all of them",
      quote: "I always upload all the reports in that folder.",
    });
    expect(answerFromEvidence(file, said("Take the latest one."))?.answer).toBe("the newest one");
    expect(answerFromEvidence(file, said("Then I click upload."))).toBeUndefined();
  });

  it("takes 'the newest' as an answer only when it is said of the files, never of an email", () => {
    const mail = { goal: "Reply to the latest client email with the price list attached", said: [] };
    expect(answerFromEvidence(file, mail)).toBeUndefined();
    expect(answerFromEvidence(file, said("Open the most recent message first."))).toBeUndefined();
    expect(answerFromEvidence(file, said("I take the most recent invoice from Downloads."))?.answer).toBe(
      "the newest one",
    );
  });

  it("answers which row from 'today'", () => {
    const row: Question = {
      id: "row-s3",
      text: "Which row next time?",
      appliesTo: "steps.s3.args.where",
      options: [
        { label: "today's row", value: { Date: "{{today}}" } },
        { label: "this row", value: { Date: "19 Oct" } },
      ],
    };
    expect(answerFromEvidence(row, said("I always take today's row"))?.answer).toBe("today's row");
  });
});
