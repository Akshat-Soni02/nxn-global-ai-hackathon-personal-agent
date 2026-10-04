// Persistent memory: facts, preferences, run context and site notes, stored locally in the daemon.
// See "Memory" in the design doc. Never stores secrets.

export type MemoryKind = "fact" | "preference" | "run_context" | "site_note";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  skillId?: string;
  createdAt: number;
}

export interface MemoryStore {
  add(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry>;
  // Full-text search, used to pick what goes into an LLM prompt.
  search(query: string, options?: { skillId?: string; limit?: number }): Promise<MemoryEntry[]>;
  list(options?: { skillId?: string }): Promise<MemoryEntry[]>;
  remove(id: string): Promise<void>;
}

// SQLite + FTS5 implementation, used by the daemon: memory.db in its data folder.
export { openMemory, type SqliteMemory } from "./sqlite.ts";
