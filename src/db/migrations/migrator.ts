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
  const files: Array<{ version: string; file: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(MIGRATION_FILE_PATTERN);
    if (!match) continue;
    const version = match[1] as string;
    files.push({ version, file: path.join(dir, entry.name) });
  }
  // Sort numerically so "010" > "009" even in locales where lexicographic != numeric.
  files.sort((a, b) => parseInt(a.version, 10) - parseInt(b.version, 10));
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

  // Guard against out-of-order application: if a discovered version is lower
  // than the highest already-applied version, refuse to run to avoid corrupt state.
  if (alreadyApplied.size > 0) {
    const maxApplied = Math.max(...[...alreadyApplied].map((v) => parseInt(v, 10)));
    for (const { version } of discovered) {
      const vNum = parseInt(version, 10);
      if (vNum < maxApplied && !alreadyApplied.has(version)) {
        throw new Error(
          `[migrator] Out-of-order migration detected: ${version} is missing ` +
          `but ${maxApplied.toString().padStart(3, "0")} has already been applied. ` +
          `Refusing to run to avoid corrupt database state.`,
        );
      }
    }
  }

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
