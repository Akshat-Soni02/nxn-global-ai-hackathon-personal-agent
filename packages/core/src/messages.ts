// Messages between the Chrome extension and the daemon.
// Path: extension <-native messaging-> apps/native-host <-Unix socket-> daemon. The native host forwards bytes unchanged.
// Only the extension can open this connection (Chrome launches the native host), so it connects on startup and
// keeps the port open; the daemon can then send to it at any time. Add new message types here so both sides stay in sync.
import { z } from "zod";
import { ActionStep, Check, Locator } from "./skill.ts";
import { TraceEvent } from "./trace.ts";

export const NATIVE_HOST_NAME = "com.shadow.daemon";
// Fixed by the "key" in apps/extension/manifest.json, so the native host manifest can allow exactly this extension.
export const EXTENSION_ID = "eloljjdiofhdlhoankjbhfeihjankikk";

const base = { id: z.string() };

export const Message = z.discriminatedUnion("type", [
  // Handshake: extension (and Shadow.app, "mac") send hello on connect, daemon replies with hello.
  // mac also says whether macOS lets it use the Accessibility API (trusted).
  z.object({
    ...base,
    type: z.literal("hello"),
    from: z.enum(["extension", "daemon", "mac"]),
    version: z.string(),
    trusted: z.boolean().optional(),
  }),
  z.object({ ...base, type: z.literal("ping") }),
  z.object({ ...base, type: z.literal("pong") }),

  // native host -> extension: the daemon is not running, so nothing can be forwarded. Extension retries later.
  z.object({ ...base, type: z.literal("daemon.offline"), reason: z.string() }),

  // Record: the daemon owns the session (started from the menu bar), and also watches the filesystem itself.
  // daemon -> extension: start/stop capturing web events for this session. startedAt drives the button's timer.
  // consent: what the description form allowed (a screenshot per step, the microphone); dir: the recording's folder,
  // where Shadow.app saves its window screenshots and audio.
  z.object({
    ...base,
    type: z.literal("record.start"),
    sessionId: z.string(),
    startedAt: z.number().optional(),
    consent: z.object({ screen: z.boolean(), microphone: z.boolean(), pictures: z.boolean().optional() }).optional(),
    dir: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal("record.stop"), sessionId: z.string() }),
  // extension -> daemon: the Record / Stop button (floating in the page, or the toolbar icon). The daemon still owns
  // the session: it handles this exactly like a typed `record` / `stop`, and answers with record.start / record.stop.
  z.object({ ...base, type: z.literal("record.command"), command: z.enum(["start", "stop"]) }),
  // daemon -> extension and Shadow.app: what happens after stop, shown on the button (questions wait in the inbox).
  // "form": Record was pressed; Shadow.app opens its window on the description form, and recording starts once the
  // form is sent.
  z.object({
    ...base,
    type: z.literal("record.status"),
    phase: z.enum(["compiling", "question", "saved", "empty", "failed", "busy", "replay", "form"]),
    text: z.string(),
  }),
  // extension -> daemon: one captured web or browser event. The fields are the trace format (trace.ts), so an
  // unknown event kind is rejected here instead of reaching the compiler.
  TraceEvent.extend({ type: z.literal("record.event") }),
  // extension or Shadow.app -> daemon: a screenshot taken right after an event, only when the form allowed it. From
  // Chrome the picture itself (a JPEG data URL) and the boxes of password and card fields to black out (in the
  // picture's pixels); from Shadow.app the file it saved in the recording's folder. The daemon reads its words on
  // the Mac and keeps only the masked words (apps/daemon/src/screen.ts).
  z.object({
    ...base,
    type: z.literal("record.shot"),
    sessionId: z.string(),
    eventId: z.string(),
    at: z.number(),
    image: z.string().max(20_000_000).optional(),
    path: z.string().optional(),
    masks: z
      .array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }))
      .max(200)
      .optional(),
  }),

  // daemon -> extension: whether Shadow.app's floating button is on screen (Chrome then hides its own).
  z.object({ ...base, type: z.literal("desktop.button"), present: z.boolean() }),
  // mac -> daemon: Accessibility was allowed or taken away while the app was running.
  z.object({ ...base, type: z.literal("mac.trusted"), trusted: z.boolean() }),
  // mac -> daemon: a folder a Finder window shows while you record. One outside the watched folders (an external
  // drive, /Users/Shared) is watched from then on, so a file you move there is recorded.
  z.object({ ...base, type: z.literal("watch.folder"), path: z.string() }),

  // Replay: the daemon runs the skill; web work goes to the extension, ax work to Shadow.app (same messages).
  // Replies reuse the request's id.
  // daemon -> extension: run one web step (templates already resolved) in the automation window
  // Only action steps go to the browser: the daemon runs llm and control steps itself.
  z.object({ ...base, type: z.literal("run.step"), runId: z.string(), step: ActionStep }),
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
  // daemon -> extension: look at or safely probe the automation tab while a paused run is repaired (PageOp in
  // packages/player/src/web/inspect.ts: outline, find, inspect, signals, click, press, scroll, back, navigate, wait).
  // The daemon's repair guard has already allowed it.
  z.object({ ...base, type: z.literal("page.op"), runId: z.string(), op: z.record(z.string(), z.unknown()) }),
  z.object({
    ...base,
    type: z.literal("page.op_result"),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
  // daemon -> extension: the run is over; detach the debugger
  z.object({ ...base, type: z.literal("run.end"), runId: z.string() }),
  // daemon -> Shadow.app: a walk-through shows where an ax step would act (Highlight.swift), acting on nothing.
  z.object({ ...base, type: z.literal("ax.highlight"), target: Locator }),
  z.object({ ...base, type: z.literal("ax.highlight_result"), ok: z.boolean(), error: z.string().optional() }),
  // daemon -> Shadow.app: a picture of the frontmost app's window, saved to `path` (needs Screen Recording), for the
  // repair agent's describe_screen. The daemon masks it before anything else sees it (apps/daemon/src/describe.ts).
  z.object({ ...base, type: z.literal("mac.screenshot"), path: z.string() }),
  z.object({ ...base, type: z.literal("mac.screenshot_result"), ok: z.boolean(), error: z.string().optional() }),

  // The daemon's API (apps/daemon/src/api.ts), for any client on the socket (Shadow.app, tools). Replies reuse the id.
  z.object({ ...base, type: z.literal("api.call"), method: z.string(), params: z.unknown().optional() }),
  z.object({
    ...base,
    type: z.literal("api.result"),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
  // client -> daemon: send me events (runs, steps, inbox) from now on, as api.event.
  z.object({ ...base, type: z.literal("api.subscribe") }),
  z.object({ ...base, type: z.literal("api.event"), event: z.unknown() }),
]);
export type Message = z.infer<typeof Message>;
