// The daemon's API: one table of methods over the service, served on the Unix socket (api.call) and on local HTTP
// (http.ts). Parameters are checked here, so every door gets the same rules.
//
// `start` takes a workflow id from the store, never a file path: a workflow can hold script steps, so the API must not
// run an arbitrary file. The terminal, which runs as the user, may still run a file.
//
// Recording (record-control.ts): `recording` is what the Record screen shows; `recordStart` takes the description
// form and starts recording; `recordStop` stops and turns the recording into a workflow (its questions go to the inbox).
import { Edit, type EditInput, Trigger } from "@shadow/core";
import { z } from "zod";
import type { RecordControl } from "./record-control.ts";
import { Consent, RecordForm } from "./recording-store.ts";
import type { Service } from "./service.ts";
import type { AppControl } from "./settings.ts";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "not an id");
const methods = {
  workflows: { params: z.object({}).default({}), run: (s: Service) => s.workflows() },
  workflow: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.workflow(p.id) ?? null },
  runs: {
    params: z
      .object({
        skillId: id.optional(),
        status: z
          .enum(["running", "waiting", "succeeded", "failed", "denied", "nothing_to_do", "cancelled", "interrupted"])
          .optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .default({}),
    run: (s: Service, p: Parameters<Service["runs"]>[0]) => s.runs(p),
  },
  run: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.run(p.id) ?? null },
  inbox: {
    params: z.object({ open: z.boolean().optional() }).default({}),
    run: (s: Service, p: { open?: boolean }) => s.inbox(p),
  },
  usage: { params: z.object({}).default({}), run: (s: Service) => s.usage() },
  health: { params: z.object({}).default({}), run: (s: Service) => s.health() },
  start: {
    params: z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "a workflow id"),
      inputs: z.record(z.string(), z.unknown()).default({}),
    }),
    run: (s: Service, p: { id: string; inputs: Record<string, unknown> }) => s.start(p.id, p.inputs, "manual"),
  },
  // A walk-through (docs/design.md, "7. Test"): a run that stops before every step with its target outlined.
  walk: {
    params: z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "a workflow id"),
      inputs: z.record(z.string(), z.unknown()).default({}),
    }),
    run: (s: Service, p: { id: string; inputs: Record<string, unknown> }) => s.walk(p.id, p.inputs),
  },
  answer: {
    params: z.object({ itemId: id, answer: z.unknown() }),
    run: (s: Service, p: { itemId: string; answer?: unknown }) => {
      s.answer(p.itemId, p.answer);
      return { ok: true };
    },
  },
  cancel: { params: z.object({ runId: id }), run: (s: Service, p: { runId: string }) => s.cancel(p.runId) },
  rollback: { params: z.object({ skillId: id }), run: (s: Service, p: { skillId: string }) => s.rollback(p.skillId) },
  // The workflow lifecycle (lifecycle.ts): its state, going live (the checks run first), pausing, resuming.
  state: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.state(p.id) },
  goLive: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.goLive(p.id) },
  review: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.review(p.id) },
  looksRight: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.looksRight(p.id) },
  pause: {
    params: z.object({ id, reason: z.string().max(200).optional() }),
    run: (s: Service, p: { id: string; reason?: string }) => s.pause(p.id, p.reason),
  },
  resume: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.resume(p.id) },
  // The Frequency: the trigger's `when`, checked against the same schema as a workflow file.
  setTrigger: {
    params: z.object({ id, when: z.array(Trigger).min(1).max(5) }),
    run: (s: Service, p: { id: string; when: unknown[] }) => s.setTrigger(p.id, p.when),
  },
  // The editor (docs/design.md, "6. Edit"): a draft beside the workflow, changed through the same edit operations
  // the agents use, autosaved; undo, redo, discard; publish saves it as the next version.
  draft: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.draft(p.id) },
  editDraft: {
    params: z.object({ id, edits: z.array(Edit).min(1).max(50) }),
    run: (s: Service, p: { id: string; edits: EditInput[] }) => s.editDraft(p.id, p.edits),
  },
  undoDraft: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.undoDraft(p.id) },
  redoDraft: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.redoDraft(p.id) },
  discardDraft: { params: z.object({ id }), run: (s: Service, p: { id: string }) => s.discardDraft(p.id) },
  publishDraft: {
    params: z.object({ id, summary: z.string().max(300).optional() }),
    run: (s: Service, p: { id: string; summary?: string }) => s.publishDraft(p.id, p.summary),
  },
} as const;

const recordMethods = {
  recording: { params: z.object({}).default({}), run: (r: RecordControl) => r.view() },
  recordStart: { params: RecordForm, run: (r: RecordControl, p: RecordForm) => r.start(p) },
  // Answers at once; turning the recording into a workflow goes on (the Record screen follows it on `recording`).
  recordStop: {
    params: z.object({}).default({}),
    run: (r: RecordControl) => {
      const sessionId = r.view().sessionId;
      void r.stop();
      return { sessionId };
    },
  },
  // Throws the recording away: nothing is compiled, its folder is deleted at once.
  recordDiscard: {
    params: z.object({}).default({}),
    run: (r: RecordControl) => {
      const sessionId = r.view().sessionId;
      void r.discard();
      return { sessionId };
    },
  },
} as const;

// Settings and first-run setup (settings.ts): the window's Settings screen and Shadow.app's first-run window.
const appMethods = {
  settings: { params: z.object({}).default({}), run: (a: AppControl) => a.settings() },
  setApiKey: {
    params: z.object({ key: z.string().min(8).max(500) }),
    run: (a: AppControl, p: { key: string }) => a.setApiKey(p.key),
  },
  setConsent: {
    params: z.object({ consent: Consent }),
    run: (a: AppControl, p: { consent: Consent }) => a.setConsent(p.consent),
  },
  checkModel: { params: z.object({}).default({}), run: (a: AppControl) => a.checkModel() },
  memory: { params: z.object({}).default({}), run: (a: AppControl) => a.memory() },
  forget: {
    params: z.object({ id }),
    run: async (a: AppControl, p: { id: string }) => {
      await a.forget(p.id);
      return { ok: true };
    },
  },
  setupChrome: { params: z.object({}).default({}), run: (a: AppControl) => a.setupChrome() },
  // The Shadow account and connected apps (since Oct 25; docs/cloud-architecture.md).
  signIn: { params: z.object({}).default({}), run: (a: AppControl) => a.signIn() },
  signOut: { params: z.object({}).default({}), run: (a: AppControl) => a.signOut() },
  accountUsage: { params: z.object({}).default({}), run: (a: AppControl) => a.accountUsage() },
  connectedApps: { params: z.object({}).default({}), run: (a: AppControl) => a.connectedApps() },
  connectApp: {
    params: z.object({ toolkit: z.string().regex(/^[a-z0-9_]{1,60}$/, "an app's name") }),
    run: (a: AppControl, p: { toolkit: string }) => a.connectApp(p.toolkit),
  },
  disconnectApp: {
    params: z.object({ id: z.string().min(1).max(200) }),
    run: (a: AppControl, p: { id: string }) => a.disconnectApp(p.id),
  },
  appTools: { params: z.object({}).default({}), run: (a: AppControl) => a.appTools() },
  checkApp: {
    params: z.object({ toolkit: z.string().regex(/^[a-z0-9_]{1,60}$/, "an app's name") }),
    run: (a: AppControl, p: { toolkit: string }) => a.checkApp(p.toolkit),
  },
  offerAppAgain: {
    params: z.object({ toolkit: z.string().regex(/^[a-z0-9_]{1,60}$/, "an app's name") }),
    run: (a: AppControl, p: { toolkit: string }) => a.offerAppAgain(p.toolkit),
  },
} as const;

export type Method = keyof typeof methods | keyof typeof recordMethods | keyof typeof appMethods;
export const METHODS = [...Object.keys(methods), ...Object.keys(recordMethods), ...Object.keys(appMethods)] as Method[];

export interface Api {
  call(method: string, params: unknown): Promise<unknown>;
}

export function createApi(service: Service, record?: RecordControl, app?: AppControl): Api {
  return {
    async call(method, params) {
      if (record && Object.hasOwn(recordMethods, method)) {
        const entry = recordMethods[method as keyof typeof recordMethods];
        const parsed = entry.params.safeParse(params ?? {});
        if (!parsed.success) {
          throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || method}: ${i.message}`).join("; "));
        }
        return (entry.run as (r: RecordControl, p: unknown) => unknown)(record, parsed.data);
      }
      if (app && Object.hasOwn(appMethods, method)) {
        const entry = appMethods[method as keyof typeof appMethods];
        const parsed = entry.params.safeParse(params ?? {});
        if (!parsed.success) {
          throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || method}: ${i.message}`).join("; "));
        }
        return (entry.run as (a: AppControl, p: unknown) => unknown)(app, parsed.data);
      }
      if (!Object.hasOwn(methods, method)) throw new Error(`no method ${method}`);
      const entry = methods[method as keyof typeof methods];
      const parsed = entry.params.safeParse(params ?? {});
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || method}: ${i.message}`).join("; "));
      }
      return (entry.run as (s: Service, p: unknown) => unknown)(service, parsed.data);
    },
  };
}
