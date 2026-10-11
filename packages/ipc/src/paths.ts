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

// Where the always-on daemon listens and the native host connects. Overridable for tests.
export function socketPath(env: Record<string, string | undefined> = process.env): string {
  const path = env.SHADOW_SOCKET ?? join(APP_SUPPORT_DIR, "daemon.sock");
  // macOS rejects Unix socket paths over 103 bytes with an unhelpful EINVAL.
  if (Buffer.byteLength(path) > 103) {
    throw new Error(`socket path is ${Buffer.byteLength(path)} bytes, macOS allows 103: ${path}. Set SHADOW_SOCKET.`);
  }
  return path;
}
