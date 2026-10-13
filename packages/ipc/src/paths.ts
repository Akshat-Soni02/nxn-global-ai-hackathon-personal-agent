import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_SUPPORT_DIR = join(homedir(), "Library", "Application Support", "Shadow");
// Where data lived before the product was renamed from Task Player to Shadow (Oct 11, 2026).
export const LEGACY_APP_SUPPORT_DIR = join(homedir(), "Library", "Application Support", "TaskPlayer");

// Moves the old data folder to the new name, once: only when the old one exists and the new one doesn't, so it never
// overwrites anything. Returns whether it moved.
export function migrateLegacyDataDir(from = LEGACY_APP_SUPPORT_DIR, to = APP_SUPPORT_DIR): boolean {
  if (!existsSync(from) || existsSync(to)) return false;
  renameSync(from, to);
  return true;
}

// Where the daemon keeps traces/, skills/ and memory.db. Overridable for tests (SHADOW_HOME).
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  return env.SHADOW_HOME ?? APP_SUPPORT_DIR;
}

// The packaged app's bundle (Shadow.app), when the daemon runs from inside it: its launcher sets SHADOW_BUNDLE
// (scripts/package.ts). Undefined in development, where the daemon runs from the repo.
export function bundlePath(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.SHADOW_BUNDLE || undefined;
}

// Where the daemon and the app write their logs: ~/Library/Logs/Shadow, which Console.app shows. With SHADOW_HOME set
// (tests, trial runs) inside that folder instead, so they don't mix into the real logs. SHADOW_LOG_DIR overrides both.
export function logDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SHADOW_LOG_DIR) return env.SHADOW_LOG_DIR;
  if (env.SHADOW_HOME) return join(env.SHADOW_HOME, "logs");
  return join(homedir(), "Library", "Logs", "Shadow");
}

// Where the always-on daemon listens and the native host connects. Overridable for tests.
export function socketPath(env: Record<string, string | undefined> = process.env): string {
  const path = env.SHADOW_SOCKET ?? join(APP_SUPPORT_DIR, "daemon.sock");
  // macOS rejects Unix socket paths over 103 bytes with an unhelpful EINVAL.
  if (Buffer.byteLength(path) > 103) {
    throw new Error(`socket path is ${Buffer.byteLength(path)} bytes, macOS allows 103: ${path}. Set SHADOW_SOCKET.`);
  }
  return path;
}
