// The daemon's log (docs/design.md, "Observability"): each line to the terminal as before, and as JSON to a file in
// the log folder (logDir in @shadow/ipc), so a daemon started by macOS, with no terminal, still leaves a trace.
// The file is rotated by size: daemon.log → daemon.1.log → … keeping a few. Runs keep their own detailed logs
// (runs/<id>.jsonl); this one is for the daemon itself.
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export type Level = "info" | "warn" | "error";

export interface Logger {
  // Same shape as console.error, so it can be handed to everything that takes a `log`.
  (...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  file: string;
}

export function createLogger(options: {
  dir: string;
  name?: string;
  component?: string;
  maxBytes?: number;
  keep?: number;
  // Where the human-readable line goes; console.error by default, nothing in tests.
  print?: (line: string) => void;
  now?: () => Date;
}): Logger {
  const name = options.name ?? "daemon";
  const component = options.component ?? name;
  const maxBytes = options.maxBytes ?? 5_000_000;
  const keep = options.keep ?? 3;
  const print = options.print ?? ((line: string) => console.error(line));
  const now = options.now ?? (() => new Date());
  mkdirSync(options.dir, { recursive: true });
  const file = join(options.dir, `${name}.log`);
  const numbered = (n: number) => join(options.dir, `${name}.${n}.log`);
  let size = existsSync(file) ? statSync(file).size : 0;

  const rotate = () => {
    rmSync(numbered(keep), { force: true });
    for (let n = keep - 1; n >= 1; n--) if (existsSync(numbered(n))) renameSync(numbered(n), numbered(n + 1));
    if (existsSync(file)) renameSync(file, numbered(1));
    size = 0;
  };

  const write = (level: Level, args: unknown[]) => {
    const message = args
      .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(a)))
      .join(" ");
    print(`[${component}] ${message}`);
    const line = `${JSON.stringify({ at: now().toISOString(), level, component, message })}\n`;
    try {
      if (size + line.length > maxBytes) rotate();
      appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch {
      // A full disk or a removed folder must not stop the daemon; the line was still printed.
    }
  };

  const log = ((...args: unknown[]) => write("info", args)) as Logger;
  log.warn = (...args) => write("warn", args);
  log.error = (...args) => write("error", args);
  log.file = file;
  return log;
}
