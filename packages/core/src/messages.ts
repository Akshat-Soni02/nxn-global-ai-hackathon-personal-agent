// Messages between the Chrome extension and the daemon over native messaging.
// Add new message types here so both sides stay in sync.
import { z } from "zod";
import type { ElementDescriptor } from "./descriptor.ts";
import { Check, Skill } from "./skill.ts";

export const NATIVE_HOST_NAME = "com.taskplayer.daemon";

const base = { id: z.string() };

export const Message = z.discriminatedUnion("type", [
  // Handshake
  z.object({ ...base, type: z.literal("hello"), from: z.enum(["extension", "daemon"]), version: z.string() }),
  z.object({ ...base, type: z.literal("ping") }),
  z.object({ ...base, type: z.literal("pong") }),

  // Record: extension -> daemon
  z.object({ ...base, type: z.literal("record.start"), sessionId: z.string() }),
  z.object({
    ...base,
    type: z.literal("record.event"),
    sessionId: z.string(),
    at: z.number(),
    event: z.string(),
    value: z.string().optional(),
    target: z.custom<ElementDescriptor>().optional(),
  }),
  z.object({ ...base, type: z.literal("record.stop"), sessionId: z.string() }),

  // Replay: daemon -> extension runs one web step, extension replies with the result
  z.object({ ...base, type: z.literal("run.step"), runId: z.string(), skill: Skill, stepId: z.string() }),
  z.object({
    ...base,
    type: z.literal("run.step_result"),
    runId: z.string(),
    stepId: z.string(),
    ok: z.boolean(),
    matchScore: z.number().optional(),
    failedCheck: Check.optional(),
    error: z.string().optional(),
  }),
]);
export type Message = z.infer<typeof Message>;
