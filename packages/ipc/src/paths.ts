import { homedir } from "node:os";
import { join } from "node:path";

export const APP_SUPPORT_DIR = join(homedir(), "Library", "Application Support", "TaskPlayer");

// Where the daemon keeps traces/, skills/ and memory.db. Overridable for tests (TASKPLAYER_HOME).
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return env.TASKPLAYER_HOME ?? APP_SUPPORT_DIR;
}

// Where the always-on daemon listens and the native host connects. Overridable for tests.
export function socketPath(env: Record<string, string | undefined> = process.env): string {
  const path = env.TASKPLAYER_SOCKET ?? join(APP_SUPPORT_DIR, "daemon.sock");
  // macOS rejects Unix socket paths over 103 bytes with an unhelpful EINVAL.
  if (Buffer.byteLength(path) > 103) {
    throw new Error(
      `socket path is ${Buffer.byteLength(path)} bytes, macOS allows 103: ${path}. Set TASKPLAYER_SOCKET.`,
    );
  }
  return path;
}
