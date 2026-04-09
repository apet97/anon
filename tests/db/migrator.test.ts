import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as path from "path";
import { runMigrations, getAppliedVersions } from "../../src/db/migrations/migrator";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

function openEmptyDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

describe("migrator.runMigrations", () => {
  it("applies all four migrations to a fresh database", () => {
    const db = openEmptyDb();
    const result = runMigrations(db, MIGRATIONS_DIR);
    expect(result.applied).toEqual(["001", "002", "003", "004"]);
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
    expect(second.skipped).toEqual(["001", "002", "003", "004"]);
  });

  it("records every applied version in schema_migrations", () => {
    const db = openEmptyDb();
    runMigrations(db, MIGRATIONS_DIR);
    expect(getAppliedVersions(db)).toEqual(["001", "002", "003", "004"]);
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
});
