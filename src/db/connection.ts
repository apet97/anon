import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { runMigrations } from "./migrations/migrator";

/**
 * Resolve the default migrations directory. At runtime this module lives at
 * `dist/db/connection.js` and the migrations ship next to it as
 * `dist/db/migrations/*.sql` (the build step copies them). In source/test
 * mode `__dirname` points at `src/db/`. Callers may override via the second
 * arg.
 */
function defaultMigrationsDir(): string {
  return path.resolve(__dirname, "migrations");
}

/**
 * Open a SQLite connection at the given path, enable WAL + pragmas, and
 * run every pending migration so the schema is up to date. There is no
 * separate "initial schema" constant anymore — the migrator is the single
 * source of truth (finding M-8).
 */
export function openDb(
  dbPath: string,
  migrationsDir: string = defaultMigrationsDir(),
): Database.Database {
  // dbPath is operator-controlled (loadConfig -> env DATABASE_PATH, validated
  // at boot). better-sqlite3 resolves relative paths against process.cwd()
  // itself, so we only need path.dirname for the mkdir.
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("journal_size_limit = 10485760"); // 10 MB WAL cap
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrationsDir);
  return db;
}

/**
 * Open a fresh in-memory database with every migration applied. Every
 * call returns an independent database so tests stay isolated.
 */
export function openInMemoryDb(
  migrationsDir: string = defaultMigrationsDir(),
): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrationsDir);
  return db;
}

/**
 * Multi-statement SQL executor. Isolated here so the rest of the codebase
 * never has to touch better-sqlite3's raw DDL runner directly. The
 * migrator imports this to apply *.sql files.
 */
export function applySchema(db: Database.Database, sql: string): void {
  const runner = db as unknown as { exec: (s: string) => void };
  runner.exec(sql);
}
