import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import * as path from "path";
import { runMigrations } from "../../src/db/migrations/migrator";
import {
  makeAuditLogRepo,
  type AuditLogRepo,
} from "../../src/db/repos/auditLogRepo";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

interface Seed {
  ts: number;
  workspaceId: string | null;
  eventType: string;
  actorId?: string;
  targetId?: string;
}

const seeds: Seed[] = [
  { ts: 1000, workspaceId: "ws-1", eventType: "SEND", actorId: "a1", targetId: "t1" },
  { ts: 1100, workspaceId: "ws-1", eventType: "BLOCK", actorId: "a1", targetId: "t2" },
  { ts: 1200, workspaceId: "ws-1", eventType: "UNBLOCK", actorId: "a1", targetId: "t2" },
  { ts: 1300, workspaceId: "ws-2", eventType: "SEND", actorId: "a2", targetId: "t3" },
  { ts: 1400, workspaceId: "ws-2", eventType: "REPORT", actorId: "a3", targetId: "a2" },
  { ts: 1500, workspaceId: "ws-2", eventType: "REPORT", actorId: "a4", targetId: "a2" },
  { ts: 1600, workspaceId: null, eventType: "STARTUP" },
  { ts: 1700, workspaceId: "ws-3", eventType: "APP_UNINSTALLED", actorId: "a5" },
];

const openTestDb = (): { db: Database.Database; repo: AuditLogRepo } => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS_DIR);
  const insert = db.prepare(
    "INSERT INTO audit_log (ts, workspace_id, event_type, actor_id, target_id, conv_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const s of seeds) {
    insert.run(
      s.ts,
      s.workspaceId,
      s.eventType,
      s.actorId ?? null,
      s.targetId ?? null,
      null,
      null,
    );
  }
  const repo = makeAuditLogRepo(db);
  return { db, repo };
};

describe("auditLogRepo.query", () => {
  let db: Database.Database;
  let repo: AuditLogRepo;

  beforeEach(() => {
    ({ db, repo } = openTestDb());
  });

  it("filters by eventType", () => {
    const rows = repo.query({ eventType: "REPORT" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.event_type === "REPORT")).toBe(true);
  });

  it("filters by workspaceId", () => {
    const rows = repo.query({ workspaceId: "ws-2" });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.workspace_id === "ws-2")).toBe(true);
  });

  it("filters by sinceSec (inclusive lower bound)", () => {
    const rows = repo.query({ sinceSec: 1400 });
    expect(rows.map((r) => r.ts).sort()).toEqual([1400, 1500, 1600, 1700]);
  });

  it("filters by untilSec (exclusive upper bound)", () => {
    const rows = repo.query({ untilSec: 1200 });
    expect(rows.map((r) => r.ts).sort()).toEqual([1000, 1100]);
  });

  it("filters by a half-open sinceSec+untilSec window", () => {
    const rows = repo.query({ sinceSec: 1200, untilSec: 1500 });
    expect(rows.map((r) => r.ts).sort()).toEqual([1200, 1300, 1400]);
  });

  it("combines eventType + workspaceId", () => {
    const rows = repo.query({ eventType: "REPORT", workspaceId: "ws-2" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.event_type === "REPORT")).toBe(true);
    expect(rows.every((r) => r.workspace_id === "ws-2")).toBe(true);
  });

  it("respects limit and orders newest first", () => {
    const rows = repo.query({ limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ts).toBe(1700);
    expect(rows[1]!.ts).toBe(1600);
  });

  it("returns all rows with empty filter up to default limit", () => {
    const rows = repo.query({});
    expect(rows).toHaveLength(seeds.length);
    // Newest-first ordering
    expect(rows[0]!.ts).toBe(1700);
    expect(rows[rows.length - 1]!.ts).toBe(1000);
    db.close();
  });

  it("caps an absurd limit at the safety ceiling", () => {
    // Should not throw and should not exceed the internal cap.
    const rows = repo.query({ limit: 100000 });
    expect(rows.length).toBeLessThanOrEqual(1000);
    expect(rows.length).toBe(seeds.length);
  });
});
