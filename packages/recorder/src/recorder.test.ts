import { type ActionStep, type ElementDescriptor, isOutward, Skill, type TraceEvent, triggerOf } from "@shadow/core";
import { describe, expect, it, vi } from "vitest";
import { requireApprovals } from "./approvals.ts";
import { compile, extractJson, labelDraft, type Question, stepsForModel } from "./compile.ts";
import { applyAnswer, drill } from "./drill.ts";
import { normalise } from "./normalise.ts";

// Compiled skills are action steps only (an llm step appears after the drill), so tests read them as such.
// steps[0] is the trigger; acts() is the steps after it, so indexes match the recording.
const acts = (skill: Skill) => skill.steps.slice(1) as ActionStep[];
const inputsOf = (skill: Skill) => triggerOf(skill).inputs;

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

describe("normalise", () => {
  it("reopens a page you switched back to in another tab, but not when a page changes its own address", () => {
    n = 0;
    const SHEET = "https://docs.google.com/spreadsheets/d/abc/edit";
    const COMPANY = "https://www.ycombinator.com/companies/noloco";
    const name = { role: "heading", name: "Noloco", tag: "h1", url: COMPANY, fallbacks: [], selectors: { css: "h1" } };
    const cell = { role: "combobox", name: "B3", tag: "div", url: SHEET, fallbacks: [], selectors: { css: "#editor" } };
    const steps = normalise([
      ev("navigate", 0, { tabId: 1, url: SHEET, transition: "typed" }),
      ev("navigate", 5_000, { tabId: 2, url: COMPANY, transition: "typed" }),
      ev("copy", 6_000, { tabId: 2, url: COMPANY, target: name, value: "Noloco" }),
      ev("tab_switch", 7_000, { tabId: 1, url: SHEET }),
      ev("type", 8_000, { tabId: 1, url: `${SHEET}?gid=0`, target: cell, value: "Noloco", pasted: true }),
      // Back on the same tab, the sheet changes its own address: no page to reopen.
      ev("type", 9_000, { tabId: 1, url: `${SHEET}#gid=0`, target: cell, value: "Hi" }),
    ]);
    expect(steps.map((s) => `${s.kind} ${s.url ?? ""}`)).toEqual([
      `navigate ${SHEET}`,
      `navigate ${COMPANY}`,
      `copy ${COMPANY}`,
      `navigate ${SHEET}?gid=0`,
      `type ${SHEET}?gid=0`,
    ]);
  });

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
    expect(acts(skill).map((s) => s.check?.url_matches)).toEqual([
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
    expect(acts(skill).map((s) => [s.action, s.args])).toEqual([
      ["navigate", { url: home }],
      ["navigate", { url: watch }],
      ["click", {}], // "#" is a script, not an address: the link is found and clicked
    ]);
    expect(acts(skill)[1]).toMatchObject({
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
    expect(acts(skill)[0]?.args).toEqual({ url: "https://www.google.com/search?q=docs" });
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
    expect(inputsOf(skill).invoice).toMatchObject({
      type: { type: "file" },
      resolve: { dir: "~/Inbox", glob: "invoice-*.pdf", pick: "newest" },
    });
    expect(acts(skill).map((s) => [s.action, s.args, s.check])).toEqual([
      // the destination ends in "/": a folder for fs.move, which would otherwise rename the file to "Archive"
      ["move", { from: "{{invoice}}", to: "~/Archive/" }, { file_exists: "~/Archive/{{invoice.name}}" }],
      ["rename", { from: "~/Archive/{{invoice.name}}", to: "~/Archive/Sep.pdf" }, { file_exists: "~/Archive/Sep.pdf" }],
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
    expect(inputsOf((await compile(own, {})).skill).scan?.resolve).toMatchObject({ accept: ".pdf,image/png" });
    const none = normalise([ev("file", 0, { target: hiddenInput, file: clip })]);
    expect(inputsOf((await compile(none, {})).skill).video?.resolve).toMatchObject({ accept: "video/*" });
    const doc = normalise([ev("file", 0, { target: hiddenInput, file: { ...clip, name: "invoice-7.pdf", type: "" } })]);
    expect(inputsOf((await compile(doc, {})).skill).invoice?.resolve).toMatchObject({ accept: ".pdf" });
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

  it("becomes a drag step whose target and destination code copies from the recording", async () => {
    const steps = normalise([ev("drag", 0, { target: card, to: done, native: true })]);
    expect(steps.map((s) => s.kind)).toEqual(["navigate", "drag"]);
    const { skill } = await compile(steps);
    expect(acts(skill)[1]).toMatchObject({
      action: "drag",
      target: { role: "listitem", fallbacks: ["#card-a"] },
      args: { to: { role: "region", name: "Done", fallbacks: ["#done-a"] } },
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
    expect(acts(result.skill).map((s) => [s.channel, s.action, s.args, s.output?.name])).toEqual([
      ["web", "navigate", { url: SHEET }, undefined],
      ["web", "extract", { source: "google_sheet" }, "sheet_1"],
      ["data", "pick", { from: "{{sheet_1}}", where: { Date: shown }, column: "Amount" }, "copied_1"],
      ["web", "navigate", { url: PAGE }, undefined],
      ["web", "type", { text: "{{copied_1}}", clear: true }, undefined],
    ]);
    // The copied row was dated the recording day, so the drill offers "today's row" first.
    expect(result.questions[0]).toMatchObject({
      appliesTo: "steps.s3.args.where",
      default: "the row whose Date is that day's date",
    });
    expect(JSON.stringify(result.skill)).not.toContain("Globex"); // only the rule, not the row, is saved
  });

  it("keeps a cheap AI step without asking, and asks only when a run would cost more than a cent", async () => {
    const labels = {
      steps: [
        {
          id: "s3",
          ai: { instruction: "Amount of today's row", output: "number" as const, reason: "dates are free text" },
        },
      ],
    };
    const { base } = await compile(normalise(sheetTrace()), { pricePerMTok: 2 });
    // About a hundred tokens at $2 a million: a fraction of a cent, so it's kept and the agent is told what it costs.
    const cheap = labelDraft(base, labels);
    expect(cheap.ok && cheap.questions).toEqual([]);
    expect(cheap.ok && acts(cheap.skill)[2]).toMatchObject({ type: "llm", instruction: "Amount of today's row" });
    expect(cheap.ok && cheap.kept[0]).toMatch(
      /s3: an AI step on every run, about \$\S+ a run \(under \$0.01: kept without asking\)/,
    );
    // The same step at a price that makes a run cost more than a cent: asked, and the rule stays until answered.
    const dear = labelDraft({ ...base, pricePerMTok: 1_000_000 }, labels);
    expect(dear.ok && dear.questions.map((q) => q.id)).toEqual(["ai-s3"]);
    expect(dear.ok && acts(dear.skill)[2]).toMatchObject({ channel: "data", action: "pick" });
    // With no price known it can't judge, so it asks.
    const unknown = labelDraft({ ...base, pricePerMTok: undefined }, labels);
    expect(unknown.ok && unknown.questions.map((q) => q.id)).toEqual(["ai-s3"]);
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
    expect(acts(result.skill)[1]?.args).toEqual({ text: "{{pasted_amount}}", clear: true });
    expect(result.questions.map((q) => q.appliesTo)).toContain("steps.start.inputs.pasted_amount.default");
    expect(result.warnings.join(" ")).toMatch(/s2: 1 click\(s\) before it landed on a drawn area/);
  });
});

describe("compile", () => {
  it("without a model, saves a valid code-only skill and asks what code can't know", async () => {
    const result = await compile(normalise(uploadTrace()));
    expect(result.model).toBe("none");
    expect(Skill.safeParse(result.skill).success).toBe(true);
    expect(acts(result.skill).map((s) => s.action)).toEqual(["navigate", "upload", "click"]);
    expect(acts(result.skill)[2]?.requires_approval).toBe(true); // "Submit" is risky
    // Targets and values from the recording: the upload's control, and the file as an input.
    expect(acts(result.skill)[1]?.target).toMatchObject({
      role: "button",
      name: "Upload invoice",
      near: "Documents",
      fallbacks: ["input[type=file][name=invoice]", "//section[h2='Documents']//input[@type='file']"],
    });
    expect(acts(result.skill)[1]?.args).toEqual({ file: "{{invoice}}" });
    expect(acts(result.skill)[0]?.args).toEqual({ url: PAGE });
    expect(result.questions.map((q) => q.appliesTo)).toEqual([
      "steps.start.inputs.invoice.resolve",
      "steps.start.inputs.invoice.resolve.dir",
      "description.goal",
    ]);
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
    expect(acts(skill).map((s) => [s.action, s.args])).toEqual([
      ["navigate", { url: PAGE }],
      ["select", { option: "NX-101" }],
      ["type", { text: "38", clear: true }],
    ]);
  });
});

describe("drill", () => {
  const base = async () => (await compile(normalise(uploadTrace()))).skill;

  it("writes answers where they apply, by step id, option number or typed text", async () => {
    let skill = await base();
    const dir = applyAnswer(
      skill,
      { id: "d", text: "Where?", appliesTo: "steps.start.inputs.invoice.resolve.dir" },
      "~/Invoices",
    );
    expect(dir.ok && inputsOf(dir.skill).invoice?.resolve?.dir).toBe("~/Invoices");
    if (dir.ok) skill = dir.skill;
    const approval = applyAnswer(skill, { id: "a", text: "Ask first?", appliesTo: "steps.s3.requires_approval" }, "no");
    expect(approval.ok && acts(approval.skill)[2]?.requires_approval).toBe(false);
    const trigger = applyAnswer(
      skill,
      {
        id: "t",
        text: "When?",
        appliesTo: "steps.start.when",
        options: [
          { label: "manual", value: [{ type: "manual" }] },
          { label: "when a new invoice appears", value: [{ type: "folder_watch", dir: "~/Downloads" }] },
        ],
      },
      "2",
    );
    expect(trigger.ok && triggerOf(trigger.skill).when).toEqual([
      { type: "folder_watch", dir: "~/Downloads", missed: "run_once" },
    ]);
  });

  it("creates the input an answer is about, typed from the answer (the YC recording's lost answers)", async () => {
    const skill = await base();
    const ask = (appliesTo: string, answer: string) => applyAnswer(skill, { id: "q", text: "?", appliesTo }, answer);
    // The trigger by its position, as the first draft wrote it on Oct 14: "5", "Yes", and a text.
    const count = ask("steps.0.inputs.number", "5");
    expect(count.ok && inputsOf(count.skill).number).toEqual({ type: { type: "number" }, default: 5 });
    const skip = ask("steps.start.inputs.skip_existing", "Yes");
    expect(skip.ok && inputsOf(skip.skill).skip_existing).toEqual({ type: { type: "boolean" }, default: true });
    const columns = ask("steps.start.inputs.name_column.default", "B");
    expect(columns.ok && inputsOf(columns.skill).name_column).toEqual({ type: { type: "text" }, default: "B" });
    // An input that exists keeps its type, and the answer becomes its default.
    const typed = applyAnswer(
      count.ok ? count.skill : skill,
      { id: "q", text: "?", appliesTo: "steps.start.inputs.number" },
      "7",
    );
    expect(typed.ok && inputsOf(typed.skill).number).toEqual({ type: { type: "number" }, default: 7 });
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
          appliesTo: "steps.start.inputs.invoice.resolve.dir",
          default: "~/Downloads",
          remember: "fact",
        },
      ],
      { prompter: { ask: async () => "" }, memory: { add } as never },
    );
    expect(inputsOf(result.skill).invoice?.resolve?.dir).toBe("~/Downloads");
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
    const ax = acts(skill).filter((s) => s.channel === "ax");
    expect(ax.map((s) => [s.action, s.args])).toEqual([
      ["open", { app: app.id, name: "TextEdit" }],
      ["set_value", { text: "38" }],
      ["set_value", { text: "{{password}}" }],
      ["key", { app: app.id, key: "s", modifiers: ["cmd"] }],
      ["menu", { app: app.id, path: ["File", "Export As…"] }],
      ["open", { app: app.id, name: "TextEdit" }],
      ["press", {}],
    ]);
    expect(inputsOf(skill).password?.type).toEqual({ type: "secret" });
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
    expect(acts(skill).find((s) => s.action === "set_value")?.args).toEqual({ text: "{{text_for_hours}}" });
    expect(questions.map((q) => q.appliesTo)).toContain("steps.start.inputs.text_for_hours.default");
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
    expect(inputsOf(skill).rushil?.resolve).toEqual({
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
    expect(always.ok && inputsOf(always.skill).rushil?.resolve).toMatchObject({
      glob: "Rushil Jariwala Photo.jpeg",
      ask: false,
    });
  });
});

describe("the description form", () => {
  const form = {
    description: {
      goal: "The month's invoice is uploaded",
      changes: ["the invoice file"],
      constants: ["the vendor portal"],
      never: ["archive anything"],
    },
    when: [{ type: "schedule" as const, cron: "0 9 1 * *", missed: "run_once" as const }],
    // A task recorded again: its Frequency is the user's and stays.
    whenFixed: true,
  };

  it("names the workflow after the goal, and asks no goal question, when there is no model", async () => {
    const result = await compile(normalise(uploadTrace()), { form });
    expect(result.skill.name).toBe("The month's invoice is uploaded");
    expect(result.skill.description.never).toEqual(["archive anything"]);
    expect(result.questions.map((q) => q.id)).not.toContain("intent");
    // The form is the user's: copied as it is, and never asked about.
    expect(result.skill.description).toEqual(form.description);
    expect(triggerOf(result.skill).when).toEqual(form.when);
    expect(result.questions.map((q) => q.appliesTo)).not.toContain("steps.start.when");
    expect(result.questions.map((q) => q.appliesTo)).not.toContain("description.goal");
  });

  it("turns approval on, in code, for steps that send or delete and for steps matching Never", async () => {
    const archive: ElementDescriptor = { ...submitButton, name: "Archive", text: "Archive", attrs: { id: "arc" } };
    const steps = normalise([
      ev("click", 0, { target: archive }),
      ev("click", 1000, { target: { ...submitButton, name: "Send", text: "Send", attrs: { id: "send" } } }),
    ]);
    const { skill } = await compile(steps, { form });
    // The skeleton already asks for approval on "Send"; nothing asks for it on "Archive" yet.
    expect(acts(skill).map((s) => s.requires_approval)).toEqual([false, false, true]);
    const { skill: approved, added } = requireApprovals(skill);
    expect(added).toEqual([acts(skill)[1]?.id]);
    expect(acts(approved).map((s) => s.requires_approval)).toEqual([false, true, true]);
  });

  it("asks before ⌘Enter or Ctrl+Enter, which send in mail and chat, whoever added the step", () => {
    const press = (id: string, modifiers?: string[]) => ({
      id,
      type: "action",
      intent: "press",
      channel: "web",
      action: "press",
      target: { role: "textbox", name: "Message Body" },
      args: { key: "Enter", ...(modifiers ? { modifiers } : {}) },
    });
    const skill = Skill.parse({
      id: "mail",
      version: 1,
      name: "mail",
      description: { goal: "reply" },
      steps: [
        { id: "start", type: "trigger", intent: "by hand" },
        press("s1", ["cmd"]),
        press("s2", ["ctrl"]),
        press("s3", ["shift"]),
        press("s4"),
      ],
    });
    expect(requireApprovals(skill).added).toEqual(["s1", "s2"]);
  });

  it("asks before ⌘Return in a Mac app too: Mail and Outlook send with it", () => {
    const key = (id: string, modifiers: string[]) => ({
      id,
      type: "action",
      intent: id,
      channel: "ax",
      action: "key",
      args: { app: "com.microsoft.Outlook", key: "Return", modifiers },
    });
    const skill = Skill.parse({
      id: "mac",
      version: 1,
      name: "mac",
      description: { goal: "reply" },
      steps: [{ id: "start", type: "trigger", intent: "by hand" }, key("s1", ["cmd"]), key("s2", [])],
    });
    expect(requireApprovals(skill).added).toEqual(["s1"]);
  });
});

describe("old and new traces", () => {
  it("normalise the same when the new events are added: they only add evidence", () => {
    const old = [ev("navigate", 0, { url: PAGE }), ev("click", 1_000, { target: submitButton })];
    const extra = [
      ...old,
      ev("effect", 1_700, { of: "c1", effect: { changed: "small" } }),
      ev("window_focus", 2_000, { windowId: 2 }),
      ev("select_text", 2_500, { value: "x", target: submitButton }),
    ];
    expect(normalise(extra).map((s) => s.kind)).toEqual(normalise(old).map((s) => s.kind));
  });
});

describe("links with ids in their address", () => {
  it("become opening that page, since the address is kept apart from what replay matches", async () => {
    const link = {
      tag: "a",
      url: PAGE,
      role: "link",
      name: "Eventual",
      href: "https://www.ycombinator.com/companies/eventual/jobs/7421",
      fallbacks: [],
      selectors: {},
    };
    const steps = normalise([
      ev("navigate", 0, { url: PAGE }),
      ev("click", 1_000, { target: link }),
      ev("navigate", 1_500, { url: "https://www.ycombinator.com/companies/eventual/jobs/7421", transition: "link" }),
    ]);
    const { skill } = await compile(steps, {});
    expect(acts(skill).map((s) => [s.action, s.args.url])).toContainEqual([
      "navigate",
      "https://www.ycombinator.com/companies/eventual/jobs/7421",
    ]);
  });
});

describe("Move to Trash in Finder", () => {
  it("is a move to the Trash that waits for approval; other deletions are not steps", async () => {
    const finder = { id: "com.apple.finder", name: "Finder" };
    const steps = normalise([
      ev("fs_remove", 500, { path: "/Users/me/Library/Caches/x.db" }), // an app deleting its own file
      { id: "m1", sessionId: "s", at: T0 + 1_000, event: "app_menu", app: finder, menu: ["File", "Move to Trash"] },
      ev("fs_remove", 1_400, { path: "/Users/me/Downloads/OldInstaller-1.2.dmg" }),
    ]);
    expect(steps.map((s) => [s.kind, s.trashed])).toEqual([["fs_move", true]]);
    const { skill } = await compile(steps, {});
    const trash = acts(skill).find((s) => s.channel === "fs");
    expect(trash).toMatchObject({ action: "move", args: { to: "~/.Trash/" } });
    expect(isOutward(trash as ActionStep)).toBe(true); // approval is added by requireApprovals
    expect(trash?.intent).toMatch(/to the Trash/);
  });
});

describe("the compile view", () => {
  it("masks keys and private words in what was typed or copied before the model reads it", () => {
    const steps = normalise([
      ev("navigate", 0, { url: PAGE }),
      ev("copy", 1_000, { value: "sk-proj-abcdefghijklmnopqrstuvwx12345678 for ACME-2231", target: submitButton }),
    ]);
    const view = JSON.stringify(
      stepsForModel(
        steps,
        steps.map(() => []),
        ["ACME-2231"],
      ),
    );
    expect(view).not.toContain("ACME-2231");
    expect(view).not.toContain("sk-proj-abcdefgh");
  });
});
