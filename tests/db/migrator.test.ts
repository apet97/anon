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
  it("applies all migrations to a fresh database", () => {
    const db = openEmptyDb();
    const result = runMigrations(db, MIGRATIONS_DIR);
    expect(result.applied).toEqual(["001", "002", "003", "004", "005", "006", "007", "008"]);
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
    expect(second.skipped).toEqual(["001", "002", "003", "004", "005", "006", "007", "008"]);
  });

  it("records every applied version in schema_migrations", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    expect(getAppliedVersions(db)).toEqual(["001", "002", "003", "004", "005", "006", "007", "008"]);
  });

  // H-6 regression: migration 008 enforces message_type via CHECK constraint.
  it("conversations has a CHECK constraint on message_type", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    expect(() =>
      db
        .prepare(
          "INSERT INTO conversations (id, workspace_id, sender_id, recipient_id, message_type) " +
            "VALUES (?, ?, ?, ?, ?)",
        )
        .run("c1", "ws-1", "s1", "r1", "bogus"),
    ).toThrow(/CHECK|constraint/i);
  });

  // H-6 regression: the three legal values still accept.
  it("conversations accepts dm, channel and thread as message_type", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    const stmt = db.prepare(
      "INSERT INTO conversations (id, workspace_id, sender_id, recipient_id, message_type) " +
        "VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run("c-dm", "ws-1", "s1", "r1", "dm");
    stmt.run("c-ch", "ws-1", "s1", "", "channel");
    stmt.run("c-th", "ws-1", "s1", "", "thread");
    const rows = db
      .prepare("SELECT message_type FROM conversations ORDER BY id")
      .all() as Array<{ message_type: string }>;
    expect(rows.map((r) => r.message_type).sort()).toEqual(["channel", "dm", "thread"]);
  });

  // M-8 regression: migration 005 created idx_conversations_created_at. When
  // 008 rebuilds the conversations table, the index must be recreated or the
  // retention range-DELETE falls back to a table scan.
  it("preserves idx_conversations_created_at across the 008 rebuild", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversations'",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toContain("idx_conversations_created_at");
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
