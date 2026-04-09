import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { applySchema } from "../connection";

/**
 * Forward-only migration runner. Reads *.sql files from this
 * directory in version order, applies any that are not yet recorded
 * in schema_migrations, and wraps each migration in a transaction
 * so a failure mid-file rolls back cleanly.
 *
 * Design notes:
 * - Versions are derived from the filename prefix (001_foo.sql
 *   becomes "001"). That keeps ordering simple and matches the
 *   conventional NNN_description.sql pattern used elsewhere.
 * - The migrations directory defaults to __dirname so the built
 *   dist/db/migrations/ folder works identically — the build step
 *   copies .sql files next to their compiled runner, and tests
 *   provide an explicit path for the source tree.
 */

const MIGRATION_FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

function ensureMigrationsTable(db: Database.Database) {
  applySchema(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL DEFAULT (unixepoch())
     )`,
  );
}

function discoverMigrations(dir: string): Array<{ version: string; file: string }> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && MIGRATION_FILE_PATTERN.test(e.name))
    .map((e) => {
      const match = MIGRATION_FILE_PATTERN.exec(e.name)!;
      return { version: match[1], file: path.join(dir, e.name) };
    });
  files.sort((a, b) => a.version.localeCompare(b.version));
  return files;
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

export function runMigrations(
  db: Database.Database,
  migrationsDir: string = __dirname,
): MigrationRunResult {
  ensureMigrationsTable(db);

  const alreadyApplied = new Set(
    (db
      .prepare("SELECT version FROM schema_migrations")
      .all() as Array<{ version: string }>).map((r) => r.version),
  );

  const discovered = discoverMigrations(migrationsDir);
  const applied: string[] = [];
  const skipped: string[] = [];

  const recordStmt = db.prepare(
    "INSERT INTO schema_migrations (version) VALUES (?)",
  );

  for (const { version, file } of discovered) {
    if (alreadyApplied.has(version)) {
      skipped.push(version);
      continue;
    }
    const sql = fs.readFileSync(file, "utf8");
    const tx = db.transaction(() => {
      applySchema(db, sql);
      recordStmt.run(version);
    });
    tx();
    applied.push(version);
  }

  return { applied, skipped };
}

export function getAppliedVersions(db: Database.Database): string[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: string }>;
  return rows.map((r) => r.version);
}
