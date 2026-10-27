// The daemon's own records, in shadow.db in its data folder (docs/design.md, "The daemon as a service"):
// - runs: one row per run, the index the window lists runs from. The run's steps stay in runs/<id>.jsonl.
// - inbox: everything that waits for the user. Saved, not held in memory, so it survives a daemon restart; any client
//   can answer an item, and the first answer wins.
// A waiting run keeps its checkpoint (the version it ran, where it stopped, its variables) on its row, so it can go on
// later from there.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Checkpoint, InboxItem, InboxKind, RunRow, RunState } from "./types.ts";

export type { Checkpoint, InboxItem, InboxKind, RunRow, RunState } from "./types.ts";

export interface Store {
  startRun(run: Pick<RunRow, "id" | "skillId" | "version" | "trigger" | "startedAt">): RunRow;
  updateRun(id: string, patch: Partial<Omit<RunRow, "id">>): RunRow;
  getRun(id: string): RunRow | undefined;
  listRuns(options?: { skillId?: string; status?: RunState; limit?: number }): RunRow[];
  // At startup: runs left "running" by a daemon that stopped become "interrupted". Returns their ids.
  interruptRunning(now?: number): string[];
  // Runs that ended before `cutoff` (never one going or waiting), and their inbox items: forgotten. Their ids.
  deleteRunsEndedBefore(cutoff: number): string[];
  addItem(item: Omit<InboxItem, "id" | "createdAt" | "answeredAt" | "answer">, at?: number): InboxItem;
  getItem(id: string): InboxItem | undefined;
  listItems(options?: { open?: boolean; runId?: string; limit?: number }): InboxItem[];
  // Records the answer if the item is still open. False when it was already answered (the first answer wins).
  answerItem(id: string, answer: unknown, now?: number): boolean;
  // Model spend of the runs started since `since` (epoch ms).
  spentSince(since: number): number;
  // Triggers: when a schedule last fired (or was passed over), by workflow and trigger key.
  getMark(skillId: string, key: string): number | undefined;
  setMark(skillId: string, key: string, at: number): void;
  // Triggers: files that already started a run (or were passed over), so none starts two.
  seenFile(skillId: string, key: string): boolean;
  markFile(skillId: string, key: string, at: number): void;
  close(): void;
}

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version INTEGER NOT NULL, trigger TEXT NOT NULL,
      status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, failed_step TEXT, error TEXT,
      repaired INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, checkpoint TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_by_skill ON runs (skill_id, started_at);
    CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, run_id TEXT, skill_id TEXT, path TEXT, title TEXT NOT NULL,
      detail TEXT NOT NULL, created_at INTEGER NOT NULL, answered_at INTEGER, answer TEXT
    );
    CREATE INDEX IF NOT EXISTS inbox_open ON inbox (answered_at, created_at);
    CREATE TABLE IF NOT EXISTS trigger_marks (
      skill_id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (skill_id, key)
    );
    CREATE TABLE IF NOT EXISTS trigger_files (
      skill_id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (skill_id, key)
    );
  `);

  const getRun = (id: string) => {
    const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? toRun(row) : undefined;
  };
  const getItem = (id: string) => {
    const row = db.prepare("SELECT * FROM inbox WHERE id = ?").get(id);
    return row ? toItem(row) : undefined;
  };

  return {
    startRun(run) {
      db.prepare(
        "INSERT INTO runs (id, skill_id, version, trigger, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)",
      ).run(run.id, run.skillId, run.version, run.trigger, run.startedAt);
      return getRun(run.id) as RunRow;
    },
    updateRun(id, patch) {
      // A field left out stays as it is. failedStep, error and checkpoint given as undefined are cleared (a run that
      // waited at a step and then succeeded has no failed step).
      const clearable = (key: "failedStep" | "error") => (key in patch ? (patch[key] ?? null) : undefined);
      const columns: Record<string, unknown> = {
        skill_id: patch.skillId,
        version: patch.version,
        trigger: patch.trigger,
        status: patch.status,
        started_at: patch.startedAt,
        ended_at: patch.endedAt,
        failed_step: clearable("failedStep"),
        error: clearable("error"),
        repaired: patch.repaired === undefined ? undefined : patch.repaired ? 1 : 0,
        cost_usd: patch.costUsd,
        checkpoint: "checkpoint" in patch ? (patch.checkpoint ? JSON.stringify(patch.checkpoint) : null) : undefined,
      };
      const set = Object.entries(columns).filter(([, v]) => v !== undefined);
      if (set.length > 0) {
        db.prepare(`UPDATE runs SET ${set.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
          ...(set.map(([, v]) => v) as (string | number | null)[]),
          id,
        );
      }
      const run = getRun(id);
      if (!run) throw new Error(`no run ${id}`);
      return run;
    },
    getRun,
    listRuns(options = {}) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (options.skillId) {
        where.push("skill_id = ?");
        params.push(options.skillId);
      }
      if (options.status) {
        where.push("status = ?");
        params.push(options.status);
      }
      const sql = `SELECT * FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                   ORDER BY started_at DESC LIMIT ?`;
      return db
        .prepare(sql)
        .all(...params, options.limit ?? 50)
        .map(toRun);
    },
    deleteRunsEndedBefore(cutoff) {
      const ids = db
        .prepare(
          "SELECT id FROM runs WHERE ended_at IS NOT NULL AND ended_at < ? AND status NOT IN ('running', 'waiting')",
        )
        .all(cutoff)
        .map((r) => String(r.id));
      for (const id of ids) {
        db.prepare("DELETE FROM inbox WHERE run_id = ?").run(id);
        db.prepare("DELETE FROM runs WHERE id = ?").run(id);
      }
      return ids;
    },
    interruptRunning(now = Date.now()) {
      const ids = db
        .prepare("SELECT id FROM runs WHERE status = 'running'")
        .all()
        .map((r) => String(r.id));
      db.prepare(
        "UPDATE runs SET status = 'interrupted', ended_at = ?, error = 'the daemon stopped during this run' WHERE status = 'running'",
      ).run(now);
      return ids;
    },
    addItem(item, at = Date.now()) {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO inbox (id, kind, run_id, skill_id, path, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        item.kind,
        item.runId ?? null,
        item.skillId ?? null,
        item.path ?? null,
        item.title,
        JSON.stringify(item.detail),
        at,
      );
      return getItem(id) as InboxItem;
    },
    getItem,
    listItems(options = {}) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (options.open) where.push("answered_at IS NULL");
      if (options.runId) {
        where.push("run_id = ?");
        params.push(options.runId);
      }
      const sql = `SELECT * FROM inbox ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                   ORDER BY created_at DESC LIMIT ?`;
      return db
        .prepare(sql)
        .all(...params, options.limit ?? 100)
        .map(toItem);
    },
    answerItem(id, answer, now = Date.now()) {
      const result = db
        .prepare("UPDATE inbox SET answered_at = ?, answer = ? WHERE id = ? AND answered_at IS NULL")
        .run(now, JSON.stringify(answer ?? null), id);
      return Number(result.changes) === 1;
    },
    spentSince(since) {
      const row = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM runs WHERE started_at >= ?").get(since);
      return Number(row?.spent ?? 0);
    },
    getMark(skillId, key) {
      const row = db.prepare("SELECT at FROM trigger_marks WHERE skill_id = ? AND key = ?").get(skillId, key);
      return row ? Number(row.at) : undefined;
    },
    setMark(skillId, key, at) {
      db.prepare(
        "INSERT INTO trigger_marks (skill_id, key, at) VALUES (?, ?, ?) ON CONFLICT (skill_id, key) DO UPDATE SET at = ?",
      ).run(skillId, key, at, at);
    },
    seenFile(skillId, key) {
      return db.prepare("SELECT 1 FROM trigger_files WHERE skill_id = ? AND key = ?").get(skillId, key) !== undefined;
    },
    markFile(skillId, key, at) {
      db.prepare("INSERT OR IGNORE INTO trigger_files (skill_id, key, at) VALUES (?, ?, ?)").run(skillId, key, at);
    },
    close: () => db.close(),
  };
}

type Row = Record<string, unknown>;
const optional = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

function toRun(row: Row): RunRow {
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    version: Number(row.version),
    trigger: String(row.trigger),
    status: row.status as RunState,
    startedAt: Number(row.started_at),
    endedAt: optional<number>(row.ended_at),
    failedStep: optional<string>(row.failed_step),
    error: optional<string>(row.error),
    repaired: Number(row.repaired) === 1,
    costUsd: Number(row.cost_usd),
    checkpoint: row.checkpoint ? (JSON.parse(String(row.checkpoint)) as Checkpoint) : undefined,
  };
}

function toItem(row: Row): InboxItem {
  return {
    id: String(row.id),
    kind: row.kind as InboxKind,
    runId: optional<string>(row.run_id),
    skillId: optional<string>(row.skill_id),
    path: optional<string>(row.path),
    title: String(row.title),
    detail: JSON.parse(String(row.detail)) as Record<string, unknown>,
    createdAt: Number(row.created_at),
    answeredAt: optional<number>(row.answered_at),
    answer: row.answer === null || row.answer === undefined ? undefined : JSON.parse(String(row.answer)),
  };
}
