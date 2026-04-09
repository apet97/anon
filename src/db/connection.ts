import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { INITIAL_SCHEMA_SQL } from "./schema";

/**
 * Open a SQLite connection at the given path, enable WAL journaling,
 * and ensure the initial schema is present. Used by the runtime
 * bootstrap in `main.ts`.
 *
 * Tests should prefer `openInMemoryDb()` so they never touch the
 * filesystem.
 */
export function openDb(dbPath: string): Database.Database {
  const absolute = path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath);
  const dir = path.dirname(absolute);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(absolute);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db, INITIAL_SCHEMA_SQL);
  // Legacy compatibility: upgrade from the pre-last_message schema.
  try {
    applySchema(db, "ALTER TABLE conversations ADD COLUMN last_message TEXT");
  } catch {
    // Column already exists; ignore.
  }
  return db;
}

/**
 * Open a fresh in-memory database with the initial schema applied.
 * Every call returns an independent database so tests remain isolated.
 */
export function openInMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applySchema(db, INITIAL_SCHEMA_SQL);
  return db;
}

/**
 * Wrapper that forwards multi-statement SQL to the better-sqlite3
 * DDL executor. Isolated here so the rest of the codebase never has
 * to touch that raw method directly.
 */
export function applySchema(db: Database.Database, sql: string): void {
  (db as unknown as { exec: (sql: string) => void }).exec(sql);
}
