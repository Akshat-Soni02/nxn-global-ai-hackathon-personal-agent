// The daemon's API: one table of methods over the service, served on the Unix socket (api.call) and on local HTTP
// (http.ts). Parameters are checked here, so every door gets the same rules.
//
// `start` takes a workflow id from the store, never a file path: a workflow can hold script steps, so the API must not
// run an arbitrary file. The terminal, which runs as the user, may still run a file.
import { Trigger } from "@shadow/core";
import { z } from "zod";
import type { Service } from "./service.ts";

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
} as const;

export type Method = keyof typeof methods;
export const METHODS = Object.keys(methods) as Method[];

export interface Api {
  call(method: string, params: unknown): Promise<unknown>;
}

export function createApi(service: Service): Api {
  return {
    async call(method, params) {
      if (!Object.hasOwn(methods, method)) throw new Error(`no method ${method}`);
      const entry = methods[method as Method];
      const parsed = entry.params.safeParse(params ?? {});
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || method}: ${i.message}`).join("; "));
      }
      return (entry.run as (s: Service, p: unknown) => unknown)(service, parsed.data);
    },
  };
}
