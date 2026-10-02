// Messages between the Chrome extension and the daemon.
// Path: extension <-native messaging-> apps/native-host <-Unix socket-> daemon. The native host forwards bytes unchanged.
// Only the extension can open this connection (Chrome launches the native host), so it connects on startup and
// keeps the port open; the daemon can then send to it at any time. Add new message types here so both sides stay in sync.
import { z } from "zod";
import type { ElementDescriptor } from "./descriptor.ts";
import { Check, Step } from "./skill.ts";

export const NATIVE_HOST_NAME = "com.taskplayer.daemon";
// Fixed by the "key" in apps/extension/manifest.json, so the native host manifest can allow exactly this extension.
export const EXTENSION_ID = "eloljjdiofhdlhoankjbhfeihjankikk";

const base = { id: z.string() };

export const Message = z.discriminatedUnion("type", [
  // Handshake: extension sends hello on connect, daemon replies with hello
  z.object({ ...base, type: z.literal("hello"), from: z.enum(["extension", "daemon"]), version: z.string() }),
  z.object({ ...base, type: z.literal("ping") }),
  z.object({ ...base, type: z.literal("pong") }),

  // native host -> extension: the daemon is not running, so nothing can be forwarded. Extension retries later.
  z.object({ ...base, type: z.literal("daemon.offline"), reason: z.string() }),

  // Record: the daemon owns the session (started from the menu bar), and also watches the filesystem itself.
  // daemon -> extension: start/stop capturing web events for this session
  z.object({ ...base, type: z.literal("record.start"), sessionId: z.string() }),
  z.object({ ...base, type: z.literal("record.stop"), sessionId: z.string() }),
  // extension -> daemon: one captured web event
  z.object({
    ...base,
    type: z.literal("record.event"),
    sessionId: z.string(),
    at: z.number(),
    event: z.string(),
    value: z.string().optional(),
    target: z.custom<ElementDescriptor>().optional(),
  }),

  // Replay: the daemon runs the skill; web work goes to the extension. Replies reuse the request's id.
  // daemon -> extension: run one web step (templates already resolved) in the automation window
  z.object({ ...base, type: z.literal("run.step"), runId: z.string(), step: Step }),
  z.object({
    ...base,
    type: z.literal("run.step_result"),
    runId: z.string(),
    stepId: z.string(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    matchScore: z.number().optional(),
    matchedBy: z.array(z.string()).optional(),
    failedCheck: Check.optional(),
    error: z.string().optional(),
  }),
  // daemon -> extension: wait for a page check (used by a skill's success list)
  z.object({ ...base, type: z.literal("run.check"), runId: z.string(), check: Check, timeoutMs: z.number() }),
  z.object({ ...base, type: z.literal("run.check_result"), runId: z.string(), ok: z.boolean() }),
  // daemon -> extension: the run is over; detach the debugger
  z.object({ ...base, type: z.literal("run.end"), runId: z.string() }),
]);
export type Message = z.infer<typeof Message>;
