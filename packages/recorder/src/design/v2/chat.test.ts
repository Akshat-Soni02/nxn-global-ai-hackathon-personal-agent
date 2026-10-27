// The chat box (R6.1): the design agent changes a saved workflow from one sentence, with the same file tools and checks
// as when it designs one, and no recording. Scripted model, no spend.
import { findStep, Skill } from "@shadow/core";
import { fakeLlm } from "@shadow/llm";
import { describe, expect, it } from "vitest";
import { changeByChat } from "./chat.ts";
import { scriptedDesigner } from "./fake.ts";

const skill = Skill.parse({
  id: "kpi",
  name: "KPI to the sheet",
  version: 4,
  description: { goal: "today's numbers into the KPI sheet" },
  steps: [
    { id: "start", type: "trigger", intent: "by hand", inputs: {} },
    {
      id: "s1",
      type: "action",
      intent: "open the inbox",
      channel: "web",
      action: "navigate",
      args: { url: "https://mail.example.com/inbox" },
    },
    {
      id: "s2",
      type: "action",
      intent: "type the date",
      channel: "web",
      action: "type",
      target: { role: "textbox", name: "Date", fallbacks: [] },
      args: { text: "19 Oct" },
    },
  ],
});
const call = (name: string, args: unknown) => ({ toolCalls: [{ name, arguments: args }] });

describe("changing a workflow from a sentence (R6.1)", () => {
  it("makes the change the sentence asks for, through the file tools, and says what it did", async () => {
    const llm = fakeLlm(
      scriptedDesigner([
        call("edit_workflow", {
          edits: [{ old: '"text": "19 Oct"', new: '"text": "{{today|D MMM}}"' }],
          why: "they want today's date",
        }),
        call("done", { summary: "It types today's date instead of 19 Oct", rules: [] }),
      ]),
    );
    const out = await changeByChat({ skill, message: "type today's date, not 19 Oct", llm, protocol: "tools" });
    expect(out.changed).toBe(true);
    expect(out.summary).toBe("It types today's date instead of 19 Oct");
    expect(findStep(out.skill, "s2")).toMatchObject({ args: { text: "{{today|D MMM}}" } });
    // The sentence and the workflow are what it was given.
    const asked = JSON.stringify(llm.requests[0]);
    expect(asked).toContain("type today's date, not 19 Oct");
    expect(asked).toContain("19 Oct");
  });

  it("says nothing changed when the agent changed nothing", async () => {
    const llm = fakeLlm(scriptedDesigner([call("done", { summary: "Nothing to change", rules: [] })]));
    const out = await changeByChat({ skill, message: "is it fine?", llm, protocol: "tools" });
    expect(out.changed).toBe(false);
    expect(out.skill).toEqual(skill);
  });
});
