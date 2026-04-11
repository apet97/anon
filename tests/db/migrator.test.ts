import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runMigrations, getAppliedVersions } from "../../src/db/migrations/migrator";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

function openEmptyDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

describe("migrator.runMigrations", () => {
  it("applies all five migrations to a fresh database", () => {
    const db = openEmptyDb();
    const result = runMigrations(db, MIGRATIONS_DIR);
    expect(result.applied).toEqual(["001", "002", "003", "004", "005", "006"]);
    expect(result.skipped).toEqual([]);

    // Verify every expected table exists
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "audit_log",
        "blocked_users",
        "config",
        "conversations",
        "pending_replies",
        "rate_limits",
        "schema_migrations",
        "target_limits",
        "tokens",
      ]),
    );
  });

  it("is idempotent — a second run applies nothing", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    const second = runMigrations(db, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["001", "002", "003", "004", "005", "006"]);
  });

  it("records every applied version in schema_migrations", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    expect(getAppliedVersions(db)).toEqual(["001", "002", "003", "004", "005", "006"]);
  });

  it("pending_replies has a CHECK constraint on direction", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    expect(() =>
      db
        .prepare(
          "INSERT INTO pending_replies (workspace_id, user_id, conv_id, direction) VALUES (?, ?, ?, ?)",
        )
        .run("ws-1", "u1", "c1", "invalid-direction"),
    ).toThrow(/CHECK|constraint/i);
  });

  it("tokens has a CHECK constraint on token_kind", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    expect(() =>
      db
        .prepare(
          "INSERT INTO tokens (workspace_id, workspace_user_id, token_kind, access_token) VALUES (?, ?, ?, ?)",
        )
        .run("ws-1", "u1", "bogus", "xxx"),
    ).toThrow(/CHECK|constraint/i);
  });

  it("rolls back a failing migration and does not record its version", () => {
    const db = openEmptyDb();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anon-migtest-"));
    try {
      // Copy 001_initial.sql verbatim so schema_migrations machinery exists.
      fs.copyFileSync(
        path.join(MIGRATIONS_DIR, "001_initial.sql"),
        path.join(tmpDir, "001_initial.sql"),
      );
      // 002 contains a valid CREATE followed by a syntax error, exercising
      // the per-migration transaction rollback.
      fs.writeFileSync(
        path.join(tmpDir, "002_bad.sql"),
        "CREATE TABLE test_rollback_table (id TEXT PRIMARY KEY);\nTHIS IS NOT VALID SQL;\n",
      );

      expect(() => runMigrations(db, tmpDir)).toThrow();

      const rows = db
        .prepare("SELECT version FROM schema_migrations")
        .all() as Array<{ version: string }>;
      expect(rows.map((r) => r.version)).not.toContain("002");

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='test_rollback_table'",
        )
        .all();
      expect(tables).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
      db.close();
    }
  });

  it("throws when a lower-version migration is discovered after a higher one was applied", () => {
    const db = openEmptyDb();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anon-migtest-"));
    try {
      fs.copyFileSync(
        path.join(MIGRATIONS_DIR, "001_initial.sql"),
        path.join(tmpDir, "001_initial.sql"),
      );
      fs.writeFileSync(
        path.join(tmpDir, "003_c.sql"),
        "CREATE TABLE test_table_c (id TEXT PRIMARY KEY);\n",
      );
      // First pass: applies 001 and 003 (no 002 yet, so out-of-order check
      // does not fire on this run).
      runMigrations(db, tmpDir);

      // Now drop 002 in between and rerun — the migrator should refuse.
      fs.writeFileSync(
        path.join(tmpDir, "002_b.sql"),
        "CREATE TABLE test_table_b (id TEXT PRIMARY KEY);\n",
      );
      expect(() => runMigrations(db, tmpDir)).toThrow(/[Oo]ut-of-order/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
      db.close();
    }
  });
});
