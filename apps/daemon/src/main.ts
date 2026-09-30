// Daemon entry point: the always-on process (launched at login later; `pnpm daemon` for now).
// Until the menu bar exists, type commands on stdin: `record`, `stop`, `status`.
import { createInterface } from "node:readline";
import { socketPath } from "@taskplayer/ipc";
import { startDaemon } from "./daemon.ts";

const log = (...args: unknown[]) => console.error("[daemon]", ...args);
const path = socketPath();
const daemon = await startDaemon({ socketPath: path, log });
log("listening on", path);

createInterface({ input: process.stdin }).on("line", (line) => {
  const command = line.trim();
  if (command === "record") daemon.startRecording();
  else if (command === "stop") daemon.stopRecording();
  else if (command === "status") log(`${daemon.extensions.size} extension(s) connected`);
  else if (command) log("commands: record, stop, status");
});

const shutdown = () => daemon.close().then(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
