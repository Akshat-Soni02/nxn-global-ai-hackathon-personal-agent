import type { InboxItem } from "@shadow/daemon/src/types.ts";
import { describe, expect, it } from "vitest";
import { questionsFor } from "./questions.ts";

const item = (id: string, kind: string, sessionId?: string) =>
  ({ id, kind, title: id, detail: sessionId ? { sessionId } : {}, createdAt: 0 }) as unknown as InboxItem;

describe("the Record screen's questions", () => {
  it("are this recording's, plus ones from no recording (the form from the terminal), newest last", () => {
    const items = [
      item("a", "question", "rec-1"),
      item("b", "question", "rec-2"),
      item("c", "question"),
      item("d", "approval", "rec-1"),
    ];
    expect(questionsFor(items, "rec-1").map((i) => i.id)).toEqual(["c", "a"]);
  });
});
