// The whole loop on a scratch daemon, with a scripted model and stand-in channels: the form -> events over the
// socket -> Stop compiles and the design agent reads it -> the editor's draft -> go live -> a run in which the cheap
// ladder repairs a changed page (a new version by debug) and Submit waits for an approval, answered over local HTTP
// like the window does -> Record again, saved as the next version of the same workflow.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionStep, isAction, triggerOf } from "@shadow/core";
import { createDecoder, encode } from "@shadow/ipc";
import { fakeLlm } from "@shadow/llm";
import type { RunDeps } from "@shadow/player";
import { createRepairer, runWithRecovery } from "@shadow/player/repair";
import { scriptedDesigner } from "@shadow/recorder";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "./api.ts";
import { type Daemon, startDaemon } from "./daemon.ts";
import { type HttpApi, startHttp } from "./http.ts";
import { readState } from "./lifecycle.ts";
import { finishRecording } from "./record.ts";
import { createRecordControl } from "./record-control.ts";
import { createService, type Execute } from "./service.ts";
import { loadSkill, saveSkill, versions } from "./skill-store.ts";
import { openStore } from "./store.ts";

const temp = () => mkdtempSync(join(tmpdir(), "shadow-e2e-"));
const PAGE = "http://localhost:5173/upload.html";
const upload = {
  tag: "input",
  url: PAGE,
  role: "button",
  name: "Upload invoice",
  near: "Documents",
  fallbacks: [],
  selectors: { css: "input[type=file][name=invoice]" },
};
const submit = {
  tag: "button",
  url: PAGE,
  role: "button",
  name: "Submit",
  fallbacks: [],
  selectors: { css: "#submit" },
};
const documents = {
  tag: "button",
  url: PAGE,
  role: "tab",
  name: "Documents",
  fallbacks: [],
  selectors: { css: "#docs" },
};

const until = async (ready: () => boolean) => {
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ready()).toBe(true);
};

type Reply = { status: number; body: string };
function send(port: number, path: string, init: { headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: init.headers }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

let daemon: Daemon | undefined;
let http: HttpApi | undefined;
afterEach(async () => {
  await http?.close();
  daemon?.close();
  http = daemon = undefined;
});

describe("the whole loop on a scratch daemon", () => {
  it("form -> record -> design -> edit -> go live -> run (repair, approval over HTTP) -> record again", async () => {
    const home = temp();
    const socketPath = join(temp(), "d.sock");
    daemon = await startDaemon({ socketPath, dataDir: home, watchDirs: [], drainMs: 50 });

    // The model, scripted: design agent v2 writes a quiet task model, then finishes at once (native tools).
    const llm = fakeLlm(scriptedDesigner());
    const log = () => {};
    let saved: { skill: { id: string } } | undefined;
    const control = createRecordControl({
      dataDir: home,
      daemon,
      ask: async () => "",
      finish: async (sessionId) => {
        saved = await finishRecording(sessionId, {
          dataDir: home,
          llm,
          prompter: { ask: async () => "" },
          log,
          design: { protocol: "tools" },
        });
        return saved;
      },
      log,
    });

    // 1-2 Describe and record: the extension connects, the form is sent, events arrive over the socket.
    const received: { type: string }[] = [];
    const ext = connect(socketPath);
    ext.on(
      "data",
      createDecoder((m) => received.push(m as { type: string })),
    );
    ext.write(encode({ id: "1", type: "hello", from: "extension", version: "test" }));
    const form = {
      goal: "This week's invoice is in the portal",
      changes: ["the invoice file"],
      constants: [],
      never: ["pay"],
      when: [{ type: "schedule" as const, cron: "0 9 * * 1", missed: "run_once" as const }],
      consent: { screen: false, microphone: false, pictures: false },
    };
    const record = async (events: (id: string, at: number, body: object) => void) => {
      // The Documents tab well before the file input's click, or it would count as the click that opened the dialog.
      events("e0", 200, { event: "click", target: documents });
      events("e1", 2000, { event: "click", target: upload });
      events("e2", 6000, {
        event: "file",
        target: upload,
        file: { name: "invoice-0923.pdf", size: 10, type: "application/pdf" },
      });
      events("e3", 9000, { event: "click", target: submit });
      return control.stop();
    };
    const eventsOf = (sessionId: string) => (id: string, at: number, body: object) =>
      ext.write(
        encode({
          id: `${sessionId}-${id}`,
          type: "record.event",
          sessionId,
          at,
          tabId: 1,
          frameId: 0,
          url: PAGE,
          ...body,
        }),
      );

    const first = control.start(form);
    await until(() => received.filter((m) => m.type === "record.start").length === 1);
    expect((await record(eventsOf(first.sessionId))).sessionId).toBe(first.sessionId);

    // 3-5 Compile and the design agent ran on the model; the workflow is v1, by record, with the form's Frequency.
    const id = saved?.skill.id as string;
    expect(id).toMatch(/^upload-invoice-[a-z0-9]{6}$/);
    const v1 = loadSkill(home, id);
    expect(v1).toMatchObject({ version: 1, description: { goal: form.goal, never: ["pay"] } });
    expect(v1?.history.map((h) => h.by)).toEqual(["record"]);
    expect(v1?.steps.filter(isAction).map((s) => s.action)).toEqual(["navigate", "click", "upload", "click"]);
    expect(triggerOf(v1 as NonNullable<typeof v1>).when).toEqual(form.when);
    expect(llm.requests.length).toBeGreaterThanOrEqual(1); // the design agent, the only AI call
    expect(readState(home, id).state).toBe("draft");

    // The service: the real interpreter with recovery (the cheap ladder; no model, so no repair agent), stand-in
    // channels, and the API on local HTTP. The Documents tab is not found the first time it is looked for (a step
    // that leaves no mark: a try of an outward step would wait for an approval nobody can give during a run).
    const attempts: string[] = [];
    const execute: Execute = (skill, leg) => {
      const web = async (step: ActionStep) => {
        attempts.push(step.target?.name ?? step.action);
        if (step.target?.name === "Documents" && attempts.filter((a) => a === "Documents").length === 1) {
          return { ok: false, error: "target not found", matchScore: 0 };
        }
        return { ok: true };
      };
      const ok = async () => ({ ok: true });
      const deps: RunDeps = {
        web,
        fs: ok,
        script: ok,
        fileExists: async () => true,
        webCheck: async () => true,
        approve: leg.hooks.approve,
        ask: leg.hooks.ask,
        walk: leg.walk ? leg.hooks.walk : undefined,
        log: leg.log,
      };
      return runWithRecovery(skill, deps, {
        runId: leg.runId,
        inputs: leg.provided,
        resume: leg.resume,
        recovery: {
          repairer: createRepairer(),
          saveVersion: (repaired) => saveSkill(home, repaired).skill,
          waitForUser: leg.hooks.waitForUser,
          retryAfterMs: [1],
          sleep: async () => {},
        },
      });
    };
    const service = createService({ dataDir: home, store: openStore(join(home, "shadow.db")), execute });
    http = await startHttp({ api: createApi(service), subscribe: service.subscribe, infoFile: join(home, "api.json") });

    // 6 Edit: a draft beside the workflow; what Submit is for, reworded; saved as v2 by the user. (Approval on Submit
    // was forced on by code when the recording was saved: it sends something.)
    const submitStep = v1?.steps.find((s) => isAction(s) && s.target?.name === "Submit") as ActionStep;
    expect(submitStep.requires_approval).toBe(true);
    service.draft(id);
    const edited = service.editDraft(id, [
      { op: "set", step: submitStep.id, field: "intent", value: "Submit the invoice, once a person has looked" },
    ]);
    expect(edited.changes).toHaveLength(1);
    expect(service.publishDraft(id, "reworded Submit")).toEqual({ version: 2 });
    const v2 = loadSkill(home, id) as NonNullable<ReturnType<typeof loadSkill>>;
    expect(v2.history.at(-1)).toMatchObject({ version: 2, by: "user" });
    expect((v2.steps.find((s) => s.id === submitStep.id) as ActionStep).intent).toBe(
      "Submit the invoice, once a person has looked",
    );

    // Go live: the Frequency from the form is the trigger, so the checks pass.
    expect(service.goLive(id).state).toBe("live");

    // 8-9 Run, by hand, with this time's file: the Documents tab is missing (drift), the ladder waits longer and
    // the step works (v3 by debug, no model), then Submit waits for approval in the inbox.
    const pdf = join(temp(), "invoice-1013.pdf");
    writeFileSync(pdf, "pdf");
    const inputs = Object.fromEntries(
      Object.keys(triggerOf(v1 as NonNullable<typeof v1>).inputs ?? {}).map((k) => [k, pdf]),
    );
    const run = service.start(id, inputs);
    await service.idle();
    expect(service.runs()[0]).toMatchObject({ id: run.id, status: "waiting", repaired: true });
    expect(versions(home, id)).toEqual([1, 2, 3]);
    expect(loadSkill(home, id)?.history.at(-1)).toMatchObject({ version: 3, by: "debug" });
    const [item] = service.inbox({ open: true });
    expect(item).toMatchObject({ kind: "approval", runId: run.id, path: submitStep.id });
    expect(attempts).toEqual(["navigate", "Documents", "Documents", "Upload invoice"]);

    // The approval answered over local HTTP, with the token from api.json, as the window does.
    const info = JSON.parse(readFileSync(join(home, "api.json"), "utf8")) as { port: number; token: string };
    const answered = await send(info.port, "/api/answer", {
      headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
      body: JSON.stringify({ itemId: item?.id, answer: "approve" }),
    });
    expect(answered.status).toBe(200);
    await service.idle();
    expect(service.runs()[0]).toMatchObject({ id: run.id, status: "succeeded", failedStep: undefined });
    expect(attempts).toEqual(["navigate", "Documents", "Documents", "Upload invoice", "Submit"]);
    // What is left in the inbox: the repair to review (v3, by the ladder, no model). The approval is answered.
    expect(service.inbox({ open: true })).toMatchObject([
      { kind: "repaired", runId: run.id, path: "s2", detail: { version: 3, by: "ladder" } },
    ]);

    // 10 Record again: the same task recorded anew is v4 of this workflow; its id, name and live state stay.
    const before = llm.requests.length;
    const again = control.start({ ...form, goal: "The invoice is in the portal, with its PO number", again: id });
    await until(() => received.filter((m) => m.type === "record.start").length === 2);
    expect((await record(eventsOf(again.sessionId))).sessionId).toBe(again.sessionId);
    ext.end();
    expect(llm.requests.length).toBeGreaterThan(before);
    expect(versions(home, id)).toEqual([1, 2, 3, 4]);
    const v4 = loadSkill(home, id);
    expect(v4).toMatchObject({
      id,
      version: 4,
      name: v1?.name,
      description: { goal: "The invoice is in the portal, with its PO number" },
    });
    expect(v4?.history.map((h) => h.by)).toEqual(["record", "user", "debug", "record"]);
    expect(readState(home, id).state).toBe("live");
    expect(service.workflows().find((w) => w.id === id)?.versions).toEqual([1, 2, 3, 4]);
  });
});
