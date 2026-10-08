import { type ElementDescriptor, Skill, type TraceEvent } from "@taskplayer/core";
import { describe, expect, it, vi } from "vitest";
import { type Chat, compile, extractJson, type Question, settleDataSteps } from "./compile.ts";
import { applyAnswer, drill } from "./drill.ts";
import { normalise } from "./normalise.ts";

const PAGE = "http://localhost:5173/upload.html";
const T0 = 1_790_812_800_000;

// What describeElement produces on fixtures/pages/upload.html (checked in apps/extension/src/capture.test.ts).
const uploadInput: ElementDescriptor = {
  tag: "input",
  url: PAGE,
  role: "button",
  name: "Upload invoice",
  label: "Upload invoice",
  near: "Documents",
  attrs: { type: "file", name: "invoice" },
  fallbacks: [],
  selectors: { css: "input[type=file][name=invoice]", xpath: "//section[h2='Documents']//input[@type='file']" },
};
const submitButton: ElementDescriptor = {
  tag: "button",
  url: PAGE,
  role: "button",
  name: "Submit",
  text: "Submit",
  near: "Documents",
  attrs: { id: "submit", type: "button" },
  fallbacks: [],
  selectors: { css: "#submit", xpath: "//section[h2='Documents']//button[@type='button']" },
};

let n = 0;
const ev = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `e${++n}`,
  sessionId: "s-1",
  at: T0 + at,
  event,
  tabId: 1,
  frameId: 0,
  url: PAGE,
  ...extra,
});

// You were already on the page: click "Upload invoice", pick the file in the macOS dialog, press Submit.
const uploadTrace = (): TraceEvent[] => {
  n = 0;
  return [
    ev("click", 0, { target: uploadInput }),
    ev("file", 5_000, {
      target: uploadInput,
      file: { name: "invoice-0923.pdf", size: 48_213, type: "application/pdf" },
    }),
    ev("click", 8_000, { target: submitButton }),
  ];
};

// What Nemotron is asked to add on top of the skeleton.
const goodAnswer = {
  id: "upload-invoice",
  intent: "Upload the newest invoice PDF to the vendor portal",
  inputs: {
    invoice: {
      type: "file",
      description: "Newest invoice PDF in Downloads",
      resolve: { dir: "~/Downloads", glob: "invoice-*.pdf", pick: "newest" },
    },
  },
  triggers: [{ type: "folder_watch", dir: "~/Downloads", glob: "invoice-*.pdf" }],
  success: [{ text_visible: "Upload complete" }],
  steps: [
    { id: "s1", intent: "Open the portal's uploads page" },
    { id: "s2", intent: "Attach the invoice", check: { text_visible: "{{inputs.invoice.name}}" } },
    { id: "s3", intent: "Submit the upload", on_fail: { retries: 2, fallback: "agent" } },
  ],
  questions: [],
};
const replies =
  (...answers: string[]): Chat =>
  async () =>
    answers.shift() ?? "{}";

describe("normalise", () => {
  it("turns the upload demonstration into the three steps of the example skill", () => {
    const steps = normalise(uploadTrace());
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "upload", "click"]);
    expect(steps[0]?.url).toBe(PAGE); // starting page added: the recording began on it
    expect(steps[1]?.events).toEqual(["e1", "e2"]); // the dialog-opening click and the pick are one upload
    expect(steps[1]?.candidate).toMatchObject({ kind: "file", glob: "invoice-*.pdf" });
  });

  it("merges typing, drops focus clicks, keeps secrets out", () => {
    const hours = {
      ...uploadInput,
      role: "spinbutton",
      name: "Hours",
      selectors: { css: "input[type=number][name=hours]" },
    };
    const pass = { ...uploadInput, role: "textbox", name: "Password", selectors: { css: "input[type=password]" } };
    const steps = normalise([
      ev("click", 0, { target: hours }),
      ev("type", 100, { target: hours, value: "3" }),
      ev("type", 200, { target: hours, value: "38" }),
      ev("type", 300, { target: pass, secret: true }),
    ]);
    expect(steps.map((s) => [s.kind, s.value])).toEqual([
      ["navigate", undefined],
      ["type", "38"],
      ["type", undefined],
    ]);
    expect(steps[1]?.candidate?.kind).toBe("number");
    expect(steps[2]?.secret).toBe(true);
  });

  it("makes a navigation caused by a click that click's destination, and a typed URL its own step", () => {
    const link = { ...submitButton, role: "link", name: "Billing", selectors: { css: "a[href='/billing']" } };
    const steps = normalise([
      ev("navigate", 0, { url: "https://portal.example/", transition: "typed" }),
      ev("click", 1_000, { target: link, url: "https://portal.example/" }),
      ev("navigate", 1_400, { url: "https://portal.example/billing", transition: "link" }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "click"]);
    expect(steps[1]?.navigatesTo).toBe("https://portal.example/billing");
  });

  it("checks the page a click leads to by its name, not by the map position or ids of that one visit", async () => {
    const place =
      "https://www.google.com/maps/place/The+Rameshwaram+Cafe+Pune/@18.5629189,73.9159205,945m/data=!3m2!1e3!4b1";
    const route = "https://www.google.com/maps/dir/18.5809595,73.7354437/The+Rameshwaram+Cafe+Pune/@18.57,73.82,13z";
    const doc = "https://docs.google.com/document/d/1YBEtjYmbo_T7iWVx5de37OxoQ2kZ/edit";
    const link = (name: string) => ({ ...submitButton, role: "link", name, url: "https://www.google.com/maps" });
    const steps = normalise([
      ev("navigate", 0, { url: "https://www.google.com/maps/@18.57,73.73,3782m/data=!3m1!1e3", transition: "typed" }),
      ev("click", 5_000, { url: "https://www.google.com/maps", target: link("Rameshwaram Cafe") }),
      ev("navigate", 5_500, { url: place, transition: "link" }),
      ev("click", 9_000, { url: place, target: link("Directions") }),
      ev("navigate", 9_500, { url: route, transition: "link" }),
      ev("click", 13_000, { url: route, target: link("Open doc") }),
      ev("navigate", 13_500, { url: doc, transition: "link" }),
    ]);
    const { skill } = await compile(steps, {});
    expect(skill.steps.map((s) => s.check?.url_matches)).toEqual([
      "/maps/",
      "/maps/place/The+Rameshwaram+Cafe+Pune/",
      "/maps/dir/",
      "/document/d/",
    ]);
  });

  it("opens where a link took you instead of finding the link again (feeds and previews change)", async () => {
    const home = "https://www.youtube.com/";
    const watch = "https://www.youtube.com/watch?v=sldH1dKWu78&list=RDsldH1dKWu78";
    const preview = {
      ...submitButton,
      tag: "a",
      role: "link",
      name: "Akcent - Stay with Me (Lyrics)",
      text: "Tap to unmute",
      url: home,
      attrs: { id: "media-container-link", href: "/watch?v=sldH1dKWu78&list=RDsldH1dKWu78&pp=oAcB" },
    };
    const scripted = { ...preview, name: "Menu", text: "Menu", attrs: { href: "#" } };
    const steps = normalise([
      ev("navigate", 0, { url: home, transition: "typed" }),
      ev("click", 5_000, { url: home, target: preview }),
      ev("navigate", 5_400, { url: watch, transition: "link" }),
      ev("click", 9_000, { url: watch, target: scripted }),
      ev("navigate", 9_300, { url: "https://www.youtube.com/feed/library", transition: "link" }),
    ]);
    const { skill } = await compile(steps, {});
    expect(skill.steps.map((s) => [s.action, s.args])).toEqual([
      ["navigate", { url: home }],
      ["navigate", { url: watch }],
      ["click", {}], // "#" is a script, not an address: the link is found and clicked
    ]);
    expect(skill.steps[1]).toMatchObject({
      intent: "Open 'Akcent - Stay with Me (Lyrics)'",
      check: { url_matches: "/watch" },
    });
  });

  it("starts from the page you went to, not a new tab page replay can't open", async () => {
    const result = { ...submitButton, url: "https://www.google.com/search?q=docs", name: "Google Docs", role: "link" };
    const steps = normalise([
      ev("tab_open", 0, { url: "chrome://newtab/" }),
      ev("navigate", 100, {
        url: "chrome-extension://jlmpjdjjbgclbocgajdjefcidcncaied/index.html",
        transition: "typed",
      }),
      ev("navigate", 1_500, { url: "https://www.google.com/search?q=docs", transition: "generated" }),
      ev("click", 4_000, { url: result.url, target: result }),
    ]);
    expect(steps.map((s) => [s.kind, s.url])).toEqual([
      ["navigate", "https://www.google.com/search?q=docs"],
      ["click", "https://www.google.com/search?q=docs"],
    ]);
    const { skill } = await compile(steps, {});
    expect(skill.steps[0]?.args).toEqual({ url: "https://www.google.com/search?q=docs" });
  });

  it("links a download to the file later uploaded, and records Finder moves", () => {
    const steps = normalise([
      ev("click", 0, { target: submitButton }),
      ev("download", 500, { path: "/Users/me/Downloads/invoice-1001.pdf" }),
      ev("fs_create", 600, { path: "/Users/me/Downloads/invoice-1001.pdf" }),
      ev("fs_move", 2_000, { path: "/Users/me/Downloads/a.pdf", toPath: "/Users/me/Documents/a.pdf" }),
      ev("click", 3_000, { target: uploadInput }),
      ev("file", 4_000, { target: uploadInput, file: { name: "invoice-1001.pdf", size: 1, type: "application/pdf" } }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "click", "fs_move", "upload"]);
    expect(steps[1]?.produces).toEqual(["/Users/me/Downloads/invoice-1001.pdf"]);
    expect(steps[3]?.candidate?.dir).toBe("/Users/me/Downloads");
  });

  it("moves next month's file too: a Finder move and rename find the newest file like the one you moved", async () => {
    const steps = normalise([
      ev("fs_move", 0, { path: "/Users/me/Inbox/invoice-0923.pdf", toPath: "/Users/me/Archive/invoice-0923.pdf" }),
      ev("fs_rename", 1_000, { path: "/Users/me/Archive/invoice-0923.pdf", toPath: "/Users/me/Archive/Sep.pdf" }),
    ]);
    const { skill } = await compile(steps, {});
    expect(skill.inputs.invoice).toMatchObject({
      type: "file",
      resolve: { dir: "~/Inbox", glob: "invoice-*.pdf", pick: "newest" },
    });
    expect(skill.steps.map((s) => [s.action, s.args, s.check])).toEqual([
      // the destination ends in "/": a folder for fs.move, which would otherwise rename the file to "Archive"
      ["move", { from: "{{inputs.invoice}}", to: "~/Archive/" }, { file_exists: "~/Archive/{{inputs.invoice.name}}" }],
      [
        "rename",
        { from: "~/Archive/{{inputs.invoice.name}}", to: "~/Archive/Sep.pdf" },
        { file_exists: "~/Archive/Sep.pdf" },
      ],
    ]);
  });
});

describe("uploads however the file got there", () => {
  const hiddenInput: ElementDescriptor = {
    tag: "input",
    url: PAGE,
    attrs: { type: "file", name: "video" },
    fallbacks: [],
    selectors: { css: "input[type=file][name=video]" },
  };
  const selectFiles = { ...submitButton, name: "Select files", text: "Select files", selectors: { css: "#select" } };
  const clip = { name: "video-0001.mp4", size: 10, type: "video/mp4", path: "/Users/me/Movies/video-0001.mp4" };

  it("folds your click, the page's own click on its hidden input, and the pick into one upload", () => {
    const steps = normalise([
      ev("click", 0, { target: selectFiles }),
      ev("click", 20, { target: hiddenInput }), // the page's script: input.click()
      ev("file", 4_000, { target: hiddenInput, file: clip }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "upload"]);
    expect(steps[1]?.target?.selectors.css).toBe("input[type=file][name=video]"); // findable: the input itself
    expect(steps[1]?.candidate).toMatchObject({ dir: "/Users/me/Movies", glob: "video-*.mp4" });
  });

  it("targets the button you clicked when the input sits in a shadow root", () => {
    const shadowInput = { ...hiddenInput, shadowPath: ["x-uploader"], selectors: { css: "div > input" } };
    const shadowButton = { ...selectFiles, shadowPath: ["x-uploader"], selectors: { css: "div > button" } };
    const steps = normalise([
      ev("click", 0, { target: shadowButton }),
      ev("click", 20, { target: shadowInput }),
      ev("file", 4_000, { target: shadowInput, file: clip }),
    ]);
    expect(steps[1]?.target?.name).toBe("Select files");
  });

  it("keeps the kinds of file the page's input takes, else the kind you uploaded, for the check before a run", async () => {
    const own = normalise([
      ev("file", 0, {
        target: hiddenInput,
        file: { ...clip, name: "scan.png", type: "image/png" },
        accept: ".pdf,image/png",
      }),
    ]);
    expect((await compile(own, {})).skill.inputs.scan?.resolve).toMatchObject({ accept: ".pdf,image/png" });
    const none = normalise([ev("file", 0, { target: hiddenInput, file: clip })]);
    expect((await compile(none, {})).skill.inputs.video?.resolve).toMatchObject({ accept: "video/*" });
    const doc = normalise([ev("file", 0, { target: hiddenInput, file: { ...clip, name: "invoice-7.pdf", type: "" } })]);
    expect((await compile(doc, {})).skill.inputs.invoice?.resolve).toMatchObject({ accept: ".pdf" });
  });

  it("turns a drop from Finder into an upload onto the drop zone", () => {
    const zone = { tag: "div", url: PAGE, name: "Drop files here", fallbacks: [], selectors: { css: "#dropzone" } };
    const files = [clip, { ...clip, name: "video-0002.mp4" }];
    const steps = normalise([ev("drop", 0, { target: zone, file: clip, files })]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "upload"]);
    expect(steps[1]?.files).toHaveLength(2);
  });
});

describe("drag inside a page", () => {
  const card: ElementDescriptor = {
    tag: "li",
    url: PAGE,
    role: "listitem",
    text: "Write report",
    attrs: { id: "card-a" },
    fallbacks: [],
    selectors: { css: "#card-a" },
  };
  const done: ElementDescriptor = {
    tag: "section",
    url: PAGE,
    role: "region",
    name: "Done",
    attrs: { id: "done-a" },
    fallbacks: [],
    selectors: { css: "#done-a" },
  };

  it("becomes a drag step whose destination code copies from the recording", async () => {
    const trace = [ev("drag", 0, { target: card, to: done, native: true })];
    const steps = normalise(trace);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "drag"]);
    const moved = {
      steps: [{ id: "s2", intent: "Mark the report done", args: { to: { role: "region", name: "Archive" } } }],
    };
    const { skill } = await compile(steps, { chat: replies(JSON.stringify(moved)) });
    expect(skill.steps[1]).toMatchObject({
      action: "drag",
      intent: "Mark the report done",
      target: { role: "listitem", fallbacks: ["#card-a"] },
      args: { to: { role: "region", name: "Done", fallbacks: ["#done-a"] } }, // not the model's "Archive"
    });
  });
});

describe("copy, paste and drawn apps", () => {
  const SHEET = "https://docs.google.com/spreadsheets/d/abc/edit#gid=0";
  const canvas: ElementDescriptor = { tag: "canvas", url: SHEET, fallbacks: [], selectors: { css: "#grid" } };
  const amount: ElementDescriptor = {
    tag: "input",
    url: PAGE,
    role: "textbox",
    name: "Amount",
    fallbacks: [],
    selectors: { css: "input[name=amount]" },
  };
  const today = new Date(T0);
  const shown = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
  const sheetTrace = () => [
    ev("click", 0, { target: canvas, url: SHEET, drawn: true }),
    ev("copy", 500, {
      target: canvas,
      url: SHEET,
      value: "1,234",
      drawn: true,
      context: {
        sheet: SHEET,
        header: ["Date", "Client", "Amount"],
        row: { Date: shown, Client: "Globex", Amount: "1,234" },
        column: "Amount",
        rows: 3,
      },
    }),
    ev("navigate", 2_000, { url: PAGE, transition: "typed" }),
    ev("paste", 3_000, { target: amount, pasted: true }),
    ev("type", 3_100, { target: amount, pasted: true }),
  ];

  it("turns a sheet copy into read rows + a rule, and the paste into {{vars}}", async () => {
    const result = await compile(normalise(sheetTrace()));
    expect(result.skill.steps.map((s) => [s.channel, s.action, s.args, s.save_as])).toEqual([
      ["web", "navigate", { url: SHEET }, undefined],
      ["web", "extract", { source: "google_sheet" }, "sheet_1"],
      ["data", "pick", { from: "{{vars.sheet_1}}", where: { Date: shown }, column: "Amount" }, "copied_1"],
      ["web", "navigate", { url: PAGE }, undefined],
      ["web", "type", { text: "{{vars.copied_1}}", clear: true }, undefined],
    ]);
    // The copied row was dated the recording day, so the drill offers "today's row" first.
    expect(result.questions[0]).toMatchObject({
      appliesTo: "steps.s3.args.where",
      default: "the row whose Date is that day's date",
    });
    expect(JSON.stringify(result.skill)).not.toContain("Globex"); // only the rule, not the row, is saved
  });

  it("makes a per-run AI step only with a reason, shows its cost, and can go back to the rule", async () => {
    const answer = {
      steps: [
        { id: "s3", ai: { instruction: "Amount of today's row", output: "number", reason: "dates are free text" } },
      ],
    };
    const result = await compile(normalise(sheetTrace()), { chat: replies(JSON.stringify(answer)), pricePerMTok: 2 });
    expect(result.skill.steps[2]?.action).toBe("ai");
    expect(result.questions[0]?.text).toMatch(
      /s3 asks the model on every run, about \d+ tokens .*Why: dates are free text/,
    );
    expect(result.questions[1]?.appliesTo).toBe("steps.s3.args.rule.where");
    const declined = settleDataSteps({
      ...result.skill,
      steps: result.skill.steps.map((s) => (s.id === "s3" ? { ...s, args: { ...s.args, mode: "pick" } } : s)),
    });
    expect(declined.steps[2]).toMatchObject({
      action: "pick",
      args: { from: "{{vars.sheet_1}}", where: { Date: shown }, column: "Amount" },
    });
    const kept = settleDataSteps(result.skill);
    expect(kept.steps[2]?.args).toEqual({
      instruction: "Amount of today's row",
      from: "{{vars.sheet_1}}",
      output: "number",
    });
  });

  it("folds the click that selected text into the copy", () => {
    const heading: ElementDescriptor = {
      tag: "h1",
      url: PAGE,
      role: "heading",
      name: "Vendor portal",
      fallbacks: [],
      selectors: { css: "h1" },
    };
    const steps = normalise([
      ev("click", 0, { target: heading }),
      ev("copy", 800, { target: heading, value: "Vendor portal" }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "copy"]);
  });

  it("asks for a value pasted from outside the recording, and reports unexplained drawn clicks", async () => {
    const result = await compile(
      normalise([ev("click", 0, { target: canvas, drawn: true }), ev("type", 1_000, { target: amount, pasted: true })]),
    );
    expect(result.skill.steps[1]?.args).toEqual({ text: "{{inputs.pasted_amount}}", clear: true });
    expect(result.questions.map((q) => q.appliesTo)).toContain("inputs.pasted_amount.default");
    expect(result.warnings.join(" ")).toMatch(/s2: 1 click\(s\) before it landed on a drawn area/);
  });
});

describe("compile", () => {
  it("without a model, saves a valid code-only skill and asks what code can't know", async () => {
    const result = await compile(normalise(uploadTrace()));
    expect(result.model).toBe("none");
    expect(Skill.safeParse(result.skill).success).toBe(true);
    expect(result.skill.steps.map((s) => s.action)).toEqual(["navigate", "upload", "click"]);
    expect(result.skill.steps[2]?.requires_approval).toBe(true); // "Submit" is risky
    expect(result.questions.map((q) => q.appliesTo)).toEqual([
      "inputs.invoice.resolve",
      "inputs.invoice.resolve.dir",
      "intent",
    ]);
  });

  it("merges a model answer by step id: words from the model, targets from the recording", async () => {
    const reply = `<think>The user uploaded an invoice.</think>\n\`\`\`json\n${JSON.stringify(goodAnswer)}\n\`\`\``;
    const { skill, model, attempts } = await compile(normalise(uploadTrace()), { chat: replies(reply) });
    expect([model, attempts]).toEqual(["nemotron", 1]);
    expect(skill.steps.map((s) => [s.action, s.intent])).toEqual([
      ["navigate", "Open the portal's uploads page"],
      ["upload", "Attach the invoice"],
      ["click", "Submit the upload"],
    ]);
    expect(skill.steps[1]?.target).toMatchObject({
      role: "button",
      name: "Upload invoice",
      near: "Documents",
      fallbacks: ["input[type=file][name=invoice]", "//section[h2='Documents']//input[@type='file']"],
    });
    expect(skill.steps[1]?.args).toEqual({ file: "{{inputs.invoice}}" });
    expect(skill.steps[0]?.args).toEqual({ url: PAGE });
    expect(skill.steps[2]?.requires_approval).toBe(true);
    expect(skill.inputs).toEqual(goodAnswer.inputs);
    expect(skill.success).toEqual(goodAnswer.success);
  });

  it("sends schema errors back and accepts the corrected answer", async () => {
    const chat = vi.fn(replies(JSON.stringify({ ...goodAnswer, id: "Upload Invoice!" }), JSON.stringify(goodAnswer)));
    const result = await compile(normalise(uploadTrace()), { chat });
    expect(result.attempts).toBe(2);
    expect(chat.mock.calls[1]?.[0].at(-1)?.content).toMatch(/That JSON was rejected:[\s\S]*id/);
  });

  it("rejects templates that name an undeclared input", async () => {
    const typo = { ...goodAnswer, steps: [{ id: "s2", check: { text_visible: "{{inputs.invoce.name}}" } }] };
    const chat = vi.fn(replies(JSON.stringify(typo), JSON.stringify(goodAnswer)));
    const result = await compile(normalise(uploadTrace()), { chat });
    expect(chat.mock.calls[1]?.[0].at(-1)?.content).toMatch(/inputs\.invoce, which is not declared/);
    expect(result.attempts).toBe(2);
  });

  it("never lets the model remove an approval or leave the recorded site", async () => {
    const sneaky = {
      ...goodAnswer,
      steps: [
        { id: "s1", args: { url: "https://evil.example/upload" } },
        { id: "s3", requires_approval: false },
      ],
    };
    const { skill } = await compile(normalise(uploadTrace()), { chat: replies(JSON.stringify(sneaky)) });
    expect(skill.steps[0]?.args.url).toBe(PAGE);
    expect(skill.steps[2]?.requires_approval).toBe(true);
  });

  it("keeps the code-only skill when the model is unreachable or never valid", async () => {
    const down = await compile(normalise(uploadTrace()), {
      chat: async () => {
        throw new Error("503");
      },
    });
    expect([down.model, down.warnings[0]]).toEqual(["none", "Model call failed: 503"]);
    const junk = await compile(normalise(uploadTrace()), { chat: replies("no json", "still none", "nope") });
    expect([junk.model, junk.attempts]).toEqual(["none", 3]);
  });

  it("extracts JSON from think blocks and fences", () => {
    expect(extractJson('<think>{"no": 1}</think> here: ```json\n{"ok": true}\n```')).toEqual({ ok: true });
  });
});

describe("contract with the player (packages/core/src/skill.ts args table)", () => {
  const field = (name: string, role: string, css: string): ElementDescriptor => ({
    tag: "input",
    url: PAGE,
    role,
    name,
    fallbacks: [],
    selectors: { css },
  });
  const project = { ...field("Project", "combobox", "select[name=project]"), tag: "select" };
  const hours = field("Hours", "spinbutton", "input[name=hours]");
  const formTrace = () => [
    ev("select", 0, { target: project, value: "NX-101" }),
    ev("type", 1_000, { target: hours, value: "38" }),
  ];

  it("writes select as {option} and type as {text, clear}", async () => {
    const { skill } = await compile(normalise(formTrace()));
    expect(skill.steps.map((s) => [s.action, s.args])).toEqual([
      ["navigate", { url: PAGE }],
      ["select", { option: "NX-101" }],
      ["type", { text: "38", clear: true }],
    ]);
  });

  it("keeps a typed value as the default of the input the model makes from it", async () => {
    const answer = {
      inputs: { hours: { type: "number", description: "Hours worked this week" } },
      steps: [{ id: "s3", args: { text: "{{inputs.hours}}" } }],
    };
    const { skill } = await compile(normalise(formTrace()), { chat: replies(JSON.stringify(answer)) });
    expect(skill.inputs.hours).toEqual({ type: "number", description: "Hours worked this week", default: 38 });
    expect(skill.steps[2]?.args).toEqual({ text: "{{inputs.hours}}", clear: true });
  });

  it("accepts {{vars.x}} only after the step that saves it", async () => {
    const early = {
      steps: [
        { id: "s2", args: { option: "{{vars.code}}" } },
        { id: "s3", save_as: "code" },
      ],
    };
    const late = {
      steps: [
        { id: "s2", save_as: "code" },
        { id: "s3", args: { text: "{{vars.code}}" } },
      ],
    };
    const chat = vi.fn(replies(JSON.stringify(early), JSON.stringify(late)));
    const result = await compile(normalise(formTrace()), { chat });
    expect(chat.mock.calls[1]?.[0].at(-1)?.content).toMatch(
      /s2: \{\{vars\.code\}\} is used before any earlier step saves it/,
    );
    expect([result.attempts, result.skill.steps[1]?.save_as, result.skill.steps[2]?.args.text]).toEqual([
      2,
      "code",
      "{{vars.code}}",
    ]);
  });
});

describe("drill", () => {
  const base = async () => (await compile(normalise(uploadTrace()))).skill;

  it("writes answers where they apply, by step id, option number or typed text", async () => {
    let skill = await base();
    const dir = applyAnswer(skill, { id: "d", text: "Where?", appliesTo: "inputs.invoice.resolve.dir" }, "~/Invoices");
    expect(dir.ok && dir.skill.inputs.invoice?.resolve?.dir).toBe("~/Invoices");
    if (dir.ok) skill = dir.skill;
    const approval = applyAnswer(skill, { id: "a", text: "Ask first?", appliesTo: "steps.s3.requires_approval" }, "no");
    expect(approval.ok && approval.skill.steps[2]?.requires_approval).toBe(false);
    const trigger = applyAnswer(
      skill,
      {
        id: "t",
        text: "When?",
        appliesTo: "triggers",
        options: [
          { label: "manual", value: [{ type: "manual" }] },
          { label: "when a new invoice appears", value: [{ type: "folder_watch", dir: "~/Downloads" }] },
        ],
      },
      "2",
    );
    expect(trigger.ok && trigger.skill.triggers).toEqual([{ type: "folder_watch", dir: "~/Downloads" }]);
  });

  it("refuses answers that would change a target or break the schema", async () => {
    const skill = await base();
    expect(applyAnswer(skill, { id: "x", text: "?", appliesTo: "steps.s2.target.name" }, "Other").ok).toBe(false);
    expect(applyAnswer(skill, { id: "y", text: "?", appliesTo: "id" }, "Not A Slug").ok).toBe(false);
  });

  it("takes defaults on Enter and remembers lasting answers", async () => {
    const add = vi.fn(async (entry: object) => ({ ...entry, id: "m1", createdAt: 0 }));
    const result = await drill(
      await base(),
      [
        {
          id: "d",
          text: "Where do invoices arrive?",
          appliesTo: "inputs.invoice.resolve.dir",
          default: "~/Downloads",
          remember: "fact",
        },
      ],
      { prompter: { ask: async () => "" }, memory: { add } as never },
    );
    expect(result.skill.inputs.invoice?.resolve?.dir).toBe("~/Downloads");
    expect(add).toHaveBeenCalledWith({
      kind: "fact",
      text: "Where do invoices arrive? ~/Downloads",
      skillId: "upload-invoice",
    });
  });
});

describe("Mac apps (Accessibility)", () => {
  const app = { id: "com.apple.TextEdit", name: "TextEdit" };
  const mac = (event: TraceEvent["event"], at: number, extra: Partial<TraceEvent> = {}) =>
    ev(event, at, { tabId: undefined, frameId: undefined, url: undefined, app, ...extra });
  const field = {
    app: app.id,
    appName: "TextEdit",
    role: "AXTextField",
    label: "Hours",
    path: ["AXWindow", "AXTextField"],
  };
  const password = { app: app.id, role: "AXTextField", subrole: "AXSecureTextField", title: "Password" };

  it("becomes ax steps: an open before the app's first step, values not keys, menus by path", async () => {
    const steps = normalise([
      ev("click", 0, { target: submitButton }),
      mac("app_activate", 1_000),
      mac("app_click", 1_500, { element: { app: app.id, role: "AXGroup" } }), // a click on nothing in particular
      mac("app_click", 2_000, { element: field }), // only put the cursor in the field
      mac("app_type", 2_500, { element: field, value: "38" }),
      mac("app_type", 3_000, { element: password, secret: true }),
      mac("app_key", 3_500, { value: "s", modifiers: ["cmd"] }),
      mac("app_menu", 4_000, { menu: ["File", "Export As…"] }),
      ev("click", 5_000, { target: submitButton }),
      mac("app_click", 6_000, { element: { app: app.id, role: "AXButton", title: "Move to Trash" } }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual([
      "navigate",
      "click",
      "app_open",
      "app_type",
      "app_type",
      "app_key",
      "app_menu",
      "click",
      "app_open", // back from Chrome: the app is brought forward again
      "app_press",
    ]);
    const { skill } = await compile(steps, {});
    const ax = skill.steps.filter((s) => s.channel === "ax");
    expect(ax.map((s) => [s.action, s.args])).toEqual([
      ["open", { app: app.id, name: "TextEdit" }],
      ["set_value", { text: "38" }],
      ["set_value", { text: "{{inputs.password}}" }],
      ["key", { app: app.id, key: "s", modifiers: ["cmd"] }],
      ["menu", { app: app.id, path: ["File", "Export As…"] }],
      ["open", { app: app.id, name: "TextEdit" }],
      ["press", {}],
    ]);
    expect(skill.inputs.password?.type).toBe("secret");
    // Found again by role and label, never by position.
    expect(ax[1]?.target).toMatchObject({
      role: "AXTextField",
      label: "Hours",
      attrs: { app: app.id, path: "AXWindow > AXTextField" },
    });
    // Moving to the Trash waits for your OK.
    expect(ax.at(-1)?.requires_approval).toBe(true);
  });

  it("records Finder by what it did to the file, so next month's file is moved, not last month's row clicked", () => {
    const finder = { id: "com.apple.finder", name: "Finder" };
    const row = { app: finder.id, role: "AXRow", title: "invoice-0923.pdf" };
    const steps = normalise([
      mac("app_activate", 0, { app: finder }),
      mac("app_click", 500, { app: finder, element: row }),
      ev("fs_move", 1_000, { path: "/Users/me/Inbox/invoice-0923.pdf", toPath: "/Users/me/Archive/invoice-0923.pdf" }),
      mac("app_key", 1_500, { app: finder, value: "Return" }),
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["fs_move"]);
  });

  it("asks for a pasted value instead of keeping it", async () => {
    const steps = normalise([mac("app_type", 0, { element: field, pasted: true })]);
    const { skill, questions } = await compile(steps, {});
    expect(skill.steps.find((s) => s.action === "set_value")?.args).toEqual({ text: "{{inputs.text_for_hours}}" });
    expect(questions.map((q) => q.appliesTo)).toContain("inputs.text_for_hours.default");
  });
});

describe("which file a skill uses next time", () => {
  it("asks each run by default, and offers the newest of its kind or always this file", async () => {
    // A name with no numbers: "the newest like it" can only mean "the newest of its type".
    const steps = normalise([
      ev("fs_move", 0, {
        path: "/Users/me/Downloads/Rushil Jariwala Photo.jpeg",
        toPath: "/Users/me/Desktop/rushil/Rushil Jariwala Photo.jpeg",
      }),
    ]);
    const { skill, questions } = await compile(steps, {});
    // A photo: next time any image will do, and nothing else.
    expect(skill.inputs.rushil?.resolve).toEqual({
      dir: "~/Downloads",
      glob: "*.jpeg",
      pick: "newest",
      ask: true,
      accept: "image/*",
    });
    const question = questions.find((q) => q.id === "file-rushil");
    expect(question?.options?.map((o) => o.label)).toEqual([
      "ask me each time I run it",
      "the newest *.jpeg in ~/Downloads",
      "always Rushil Jariwala Photo.jpeg",
    ]);
    expect(question?.default).toBe("ask me each time I run it");
    const always = applyAnswer(skill, question as Question, "3");
    expect(always.ok && always.skill.inputs.rushil?.resolve).toMatchObject({
      glob: "Rushil Jariwala Photo.jpeg",
      ask: false,
    });
  });
});
