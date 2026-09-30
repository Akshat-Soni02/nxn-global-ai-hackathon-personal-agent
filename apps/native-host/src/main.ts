// Native messaging host. Chrome launches a fresh copy of this every time the extension calls connectNative,
// so it cannot be the always-on daemon itself. It only forwards bytes between Chrome (stdin/stdout) and the
// daemon's Unix socket; both sides use the same length-prefixed framing, so no parsing is needed here.
// stdout belongs to Chrome: log to stderr only (Chrome shows it when launched with --enable-logging).
import { connect } from "node:net";
import { encode, socketPath } from "@taskplayer/ipc";

const path = socketPath();
const log = (...args: unknown[]) => console.error("[native-host]", ...args);

const socket = connect(path);
let connected = false;

socket.once("connect", () => {
  connected = true;
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});

socket.once("error", (error: NodeJS.ErrnoException) => {
  if (!connected) {
    // Daemon not running. Tell the extension, then exit so it can retry later.
    log("daemon unreachable at", path, error.code);
    const offline = { id: "native-host", type: "daemon.offline", reason: error.code ?? error.message };
    process.stdout.write(encode(offline), () => process.exit(0));
    return;
  }
  log("socket error", error.message);
  process.exit(1);
});

// Either side closing ends the bridge.
socket.once("close", () => process.exit(0));
process.stdin.once("end", () => socket.end());
