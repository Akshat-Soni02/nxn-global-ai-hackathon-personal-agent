// The App action form (R4.4): a field for each argument a connected tool takes, from its schema, and a picker for the
// documents the workflow works in, instead of a box of raw JSON.
import { Skill } from "@shadow/core";
import { describe, expect, it } from "vitest";
import { argumentFields, argumentsOf, documentsIn } from "./app-form.ts";

const APPEND = {
  type: "object",
  properties: {
    range: { type: "string", description: "A1 notation, e.g. Sheet1!A:C" },
    values: { type: "array", items: { type: "array" }, description: "2D array of values" },
    spreadsheetId: { type: "string" },
    valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"] },
    includeValuesInResponse: { type: "boolean" },
    majorDimension: { type: "string", enum: ["ROWS", "COLUMNS"] },
    limit: { type: "integer" },
    extra: { type: "object" },
  },
  required: ["spreadsheetId", "range", "valueInputOption", "values"],
};

describe("the App action form (R4.4)", () => {
  it("makes a field of the right kind for each argument, the required ones first", () => {
    const fields = argumentFields(APPEND);
    expect(fields.slice(0, 4).map((f) => [f.name, f.kind, f.required])).toEqual([
      ["spreadsheetId", "document", true],
      ["range", "text", true],
      ["valueInputOption", "choice", true],
      ["values", "rows", true],
    ]);
    expect(fields.find((f) => f.name === "valueInputOption")?.choices).toEqual(["RAW", "USER_ENTERED"]);
    expect(fields.find((f) => f.name === "includeValuesInResponse")?.kind).toBe("yes/no");
    expect(fields.find((f) => f.name === "limit")?.kind).toBe("number");
    expect(fields.find((f) => f.name === "extra")?.kind).toBe("json");
  });

  it("turns what was filled in into the tool's arguments, and says what is missing or wrong", () => {
    const fields = argumentFields(APPEND);
    const args = argumentsOf(fields, {
      "arg.spreadsheetId": "1AbCdEfGhIjKlMnOpQrStUv",
      "arg.range": "Sheet1!A:C",
      "arg.valueInputOption": "USER_ENTERED",
      "arg.values": "{{today|D MMM}} | {{job.title}}\n | second row",
      "arg.limit": "5",
      "arg.includeValuesInResponse": "yes",
    });
    expect(args).toEqual({
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUv",
      range: "Sheet1!A:C",
      valueInputOption: "USER_ENTERED",
      values: [
        ["{{today|D MMM}}", "{{job.title}}"],
        ["", "second row"],
      ],
      limit: 5,
      includeValuesInResponse: true,
    });
    expect(argumentsOf(fields, { "arg.range": "A:C" })).toMatch(/spreadsheetId/);
    expect(argumentsOf(fields, { ...filled(), "arg.limit": "five" })).toMatch(/limit is a number/);
    expect(argumentsOf(fields, { ...filled(), "arg.extra": "{ nope" })).toMatch(/extra is JSON/);
  });

  it("offers the documents the workflow works in, by the step that opened each", () => {
    const skill = Skill.parse({
      id: "w",
      name: "w",
      version: 1,
      description: { goal: "g" },
      steps: [
        { id: "start", type: "trigger", intent: "t" },
        {
          id: "s1",
          type: "action",
          intent: "open the KPI sheet",
          channel: "web",
          action: "navigate",
          tab: "KPI Sheet",
          args: { url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit#gid=0" },
        },
        {
          id: "s2",
          type: "action",
          intent: "open the notes",
          channel: "web",
          action: "navigate",
          args: { url: "https://docs.google.com/document/d/9ZyXwVuTsRqPoNmLkJiH/edit" },
        },
        {
          id: "s3",
          type: "action",
          intent: "open hn",
          channel: "web",
          action: "navigate",
          args: { url: "https://news.ycombinator.com" },
        },
      ],
    });
    expect(documentsIn(skill)).toEqual([
      { id: "1AbCdEfGhIjKlMnOpQrStUv", label: "KPI Sheet (the sheet s1 opens)" },
      { id: "9ZyXwVuTsRqPoNmLkJiH", label: "the document s2 opens" },
    ]);
  });
});

function filled(): Record<string, string> {
  return {
    "arg.spreadsheetId": "1AbCdEfGhIjKlMnOpQrStUv",
    "arg.range": "A:C",
    "arg.valueInputOption": "RAW",
    "arg.values": "a | b",
  };
}
