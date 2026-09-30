// Daemon entry point. Chrome launches this as the native messaging host when the extension connects.
// stdout is reserved for native messaging, so log to stderr only.
import { Message } from "@taskplayer/core";
import { connect } from "./native-messaging.ts";

const log = (...args: unknown[]) => console.error("[daemon]", ...args);

const port = connect(process.stdin, process.stdout, (raw) => {
  const parsed = Message.safeParse(raw);
  if (!parsed.success) {
    log("invalid message", parsed.error.issues);
    return;
  }
  const message = parsed.data;
  switch (message.type) {
    case "hello":
      log("extension connected, version", message.version);
      port.send({ id: message.id, type: "hello", from: "daemon", version: "0.0.0" });
      break;
    case "ping":
      port.send({ id: message.id, type: "pong" });
      break;
    default:
      // TODO: route record.* to the recorder and run.step_result to the player.
      log("unhandled", message.type);
  }
});

log("started");
