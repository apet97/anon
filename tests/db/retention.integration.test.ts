import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import os from "os";
import fs from "fs";
import path from "path";
import { openDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/migrations/migrator";
import { makeAuditLogRepo } from "../../src/db/repos/auditLogRepo";
import { makeConversationsRepo } from "../../src/db/repos/conversationsRepo";
import { makePendingRepliesRepo } from "../../src/db/repos/pendingRepliesRepo";
import { makeRateLimitsRepo } from "../../src/db/repos/rateLimitsRepo";
import { makeTargetLimitsRepo } from "../../src/db/repos/targetLimitsRepo";
import { startRetentionScheduler } from "../../src/services/retention";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

const NINETY_DAYS_SEC = 90 * 24 * 60 * 60;
const TWENTY_FOUR_HOURS_SEC = 24 * 60 * 60;
const RATE_LIMITS_WINDOW_SEC = 60;
const TARGET_LIMITS_WINDOW_SEC = 3600;

const noopLogger = {
  info: (): void => {},
  error: (): void => {},
};

interface TestCtx {
  db: Database.Database;
  tmpPath: string;
}

function bootDb(): TestCtx {
  const tmpPath = path.join(
    os.tmpdir(),
    `anon-retention-test-${Date.now()}-${Math.random()}.db`,
  );
  const db = openDb(tmpPath);
  runMigrations(db, MIGRATIONS_DIR);
  return { db, tmpPath };
}

function teardown(ctx: TestCtx): void {
  try {
    ctx.db.close();
  } catch {
    /* already closed */
  }
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(ctx.tmpPath + ext);
    } catch {
      /* sidecar may not exist */
    }
  }
}

function runRetentionOnce(db: Database.Database, nowMs: number): void {
  const handle = startRetentionScheduler({
    auditLog: makeAuditLogRepo(db),
    conversations: makeConversationsRepo(db),
    pendingReplies: makePendingRepliesRepo(db),
    rateLimits: makeRateLimitsRepo(db),
    targetLimits: makeTargetLimitsRepo(db),
    logger: noopLogger,
    now: () => nowMs,
    // A very large interval prevents the timer from firing again before stop().
    intervalMs: 60 * 60 * 1000,
  });
  handle.stop();
}

describe("retention scheduler integration", () => {
  let ctx: TestCtx;

  beforeEach(() => {
    ctx = bootDb();
  });

  afterEach(() => {
    teardown(ctx);
  });

  it("purges audit_log rows older than 90 days but keeps fresh ones", () => {
    const nowSec = 1_700_000_000;
    const nowMs = nowSec * 1000;
    const insert = ctx.db.prepare(
      "INSERT INTO audit_log (ts, workspace_id, event_type) VALUES (?, ?, ?)",
    );
    insert.run(nowSec - NINETY_DAYS_SEC - 1, "ws-1", "OLD"); // purged
    insert.run(nowSec - NINETY_DAYS_SEC, "ws-1", "BOUNDARY"); // survives (strict <)
    insert.run(nowSec - 1, "ws-1", "FRESH"); // survives

    runRetentionOnce(ctx.db, nowMs);

    const rows = ctx.db
      .prepare("SELECT event_type FROM audit_log ORDER BY ts ASC")
      .all() as Array<{ event_type: string }>;
    const types = rows.map((r) => r.event_type);
    expect(types).not.toContain("OLD");
    expect(types).toEqual(expect.arrayContaining(["BOUNDARY", "FRESH"]));
    expect(rows).toHaveLength(2);
  });

  it("purges conversations older than 90 days but keeps fresh ones", () => {
    const nowSec = 1_700_000_000;
    const nowMs = nowSec * 1000;
    const insert = ctx.db.prepare(
      "INSERT INTO conversations (id, sender_id, recipient_id, created_at) VALUES (?, ?, ?, ?)",
    );
    insert.run("c-old", "s1", "r1", nowSec - NINETY_DAYS_SEC - 1);
    insert.run("c-boundary", "s1", "r1", nowSec - NINETY_DAYS_SEC);
    insert.run("c-fresh", "s1", "r1", nowSec - 1);

    runRetentionOnce(ctx.db, nowMs);

    const rows = ctx.db
      .prepare("SELECT id FROM conversations ORDER BY id ASC")
      .all() as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain("c-old");
    expect(ids).toEqual(expect.arrayContaining(["c-boundary", "c-fresh"]));
    expect(rows).toHaveLength(2);
  });

  it("purges pending_replies older than 24 hours but keeps fresh ones", () => {
    const nowSec = 1_700_000_000;
    const nowMs = nowSec * 1000;
    const insert = ctx.db.prepare(
      "INSERT INTO pending_replies (workspace_id, user_id, conv_id, direction, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "ws-1",
      "u-old",
      "c1",
      "recipient",
      nowSec - TWENTY_FOUR_HOURS_SEC - 1,
      nowSec - TWENTY_FOUR_HOURS_SEC - 1,
    );
    insert.run(
      "ws-1",
      "u-boundary",
      "c2",
      "recipient",
      nowSec - TWENTY_FOUR_HOURS_SEC,
      nowSec - TWENTY_FOUR_HOURS_SEC,
    );
    insert.run("ws-1", "u-fresh", "c3", "sender", nowSec - 1, nowSec - 1);

    runRetentionOnce(ctx.db, nowMs);

    const rows = ctx.db
      .prepare("SELECT user_id FROM pending_replies ORDER BY user_id ASC")
      .all() as Array<{ user_id: string }>;
    const ids = rows.map((r) => r.user_id);
    expect(ids).not.toContain("u-old");
    expect(ids).toEqual(expect.arrayContaining(["u-boundary", "u-fresh"]));
    expect(rows).toHaveLength(2);
  });

  it("purges rate_limits whose window_start is older than 60s but keeps fresh ones", () => {
    const nowSec = 1_700_000_000;
    const nowMs = nowSec * 1000;
    const insert = ctx.db.prepare(
      "INSERT INTO rate_limits (workspace_id, user_id, msg_count, window_start) VALUES (?, ?, ?, ?)",
    );
    insert.run("ws-1", "u-old", 5, nowSec - RATE_LIMITS_WINDOW_SEC - 1);
    insert.run("ws-1", "u-boundary", 5, nowSec - RATE_LIMITS_WINDOW_SEC);
    insert.run("ws-1", "u-fresh", 5, nowSec - 1);

    runRetentionOnce(ctx.db, nowMs);

    const rows = ctx.db
      .prepare("SELECT user_id FROM rate_limits ORDER BY user_id ASC")
      .all() as Array<{ user_id: string }>;
    const ids = rows.map((r) => r.user_id);
    expect(ids).not.toContain("u-old");
    expect(ids).toEqual(expect.arrayContaining(["u-boundary", "u-fresh"]));
    expect(rows).toHaveLength(2);
  });

  it("purges target_limits whose window_start is older than 1h but keeps fresh ones", () => {
    const nowSec = 1_700_000_000;
    const nowMs = nowSec * 1000;
    const insert = ctx.db.prepare(
      "INSERT INTO target_limits (workspace_id, sender_id, target_id, msg_count, window_start) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("ws-1", "s1", "t-old", 5, nowSec - TARGET_LIMITS_WINDOW_SEC - 1);
    insert.run("ws-1", "s1", "t-boundary", 5, nowSec - TARGET_LIMITS_WINDOW_SEC);
    insert.run("ws-1", "s1", "t-fresh", 5, nowSec - 1);

    runRetentionOnce(ctx.db, nowMs);

    const rows = ctx.db
      .prepare("SELECT target_id FROM target_limits ORDER BY target_id ASC")
      .all() as Array<{ target_id: string }>;
    const ids = rows.map((r) => r.target_id);
    expect(ids).not.toContain("t-old");
    expect(ids).toEqual(expect.arrayContaining(["t-boundary", "t-fresh"]));
    expect(rows).toHaveLength(2);
  });
});
