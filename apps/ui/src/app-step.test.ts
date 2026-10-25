import { describe, expect, it } from "vitest";
import { appStep } from "./WorkflowTree.tsx";

describe("a connected app's step in plain words", () => {
  it("names the app and what the tool does", () => {
    expect(appStep("GOOGLESHEETS_BATCH_UPDATE")).toEqual({ app: "Google Sheets", does: "batch update" });
    expect(appStep("GMAIL_SEND_EMAIL")).toEqual({ app: "Gmail", does: "send email" });
    expect(appStep("TRELLO_ADD_CARD")).toEqual({ app: "app", does: "trello add card" });
  });
});
