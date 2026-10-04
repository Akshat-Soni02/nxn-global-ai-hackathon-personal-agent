// MemoryStore on Node's built-in SQLite (node:sqlite) with FTS5 full-text search: no native module to build.
// Lives in the daemon's data folder as memory.db. The compiler reads it before asking the model; the drill writes to it.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MemoryEntry, MemoryKind, MemoryStore } from "./index.ts";

export interface SqliteMemory extends MemoryStore {
  close(): void;
}

export function openMemory(path: string): SqliteMemory {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, skill_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, text);
  `);

  const transaction = (fn: () => void) => {
    db.exec("BEGIN");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    async add(entry) {
      const existing = db
        .prepare("SELECT * FROM memory WHERE kind = ? AND text = ? AND skill_id IS ?")
        .get(entry.kind, entry.text, entry.skillId ?? null);
      if (existing) return toEntry(existing);
      const full: MemoryEntry = { ...entry, id: randomUUID(), createdAt: Date.now() };
      transaction(() => {
        db.prepare("INSERT INTO memory (id, kind, text, skill_id, created_at) VALUES (?, ?, ?, ?, ?)").run(
          full.id,
          full.kind,
          full.text,
          full.skillId ?? null,
          full.createdAt,
        );
        db.prepare("INSERT INTO memory_fts (id, text) VALUES (?, ?)").run(full.id, full.text);
      });
      return full;
    },
    async search(query, options = {}) {
      const match = ftsQuery(query);
      if (!match) return [];
      const bySkill = options.skillId ? "AND m.skill_id = ?" : "";
      const params = options.skillId ? [match, options.skillId] : [match];
      const rows = db
        .prepare(
          `SELECT m.* FROM memory_fts JOIN memory m ON m.id = memory_fts.id
           WHERE memory_fts MATCH ? ${bySkill} ORDER BY rank LIMIT ?`,
        )
        .all(...params, options.limit ?? 5);
      return rows.map(toEntry);
    },
    async list(options = {}) {
      const rows = options.skillId
        ? db.prepare("SELECT * FROM memory WHERE skill_id = ? ORDER BY created_at").all(options.skillId)
        : db.prepare("SELECT * FROM memory ORDER BY created_at").all();
      return rows.map(toEntry);
    },
    async remove(id) {
      transaction(() => {
        db.prepare("DELETE FROM memory WHERE id = ?").run(id);
        db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
      });
    },
    close: () => db.close(),
  };
}

// FTS5 reads - : " ( ) * and AND/OR/NOT as query syntax, so free text would throw or mean something else.
// Quote every word and OR them: any text becomes a safe "share some words" query, ranked by bm25.
export function ftsQuery(text: string): string | undefined {
  const words = [...new Set((text.match(/[\p{L}\p{N}_]+/gu) ?? []).map((w) => w.toLowerCase()))].slice(0, 32);
  return words.length > 0 ? words.map((w) => `"${w}"`).join(" OR ") : undefined;
}

function toEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: String(row.id),
    kind: row.kind as MemoryKind,
    text: String(row.text),
    createdAt: Number(row.created_at),
    ...(row.skill_id ? { skillId: String(row.skill_id) } : {}),
  };
}
