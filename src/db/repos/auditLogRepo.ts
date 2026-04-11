import type Database from "better-sqlite3";

export interface AuditLogEntry {
  workspaceId?: string;
  eventType: string;
  actorId?: string;
  targetId?: string;
  convId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: number;
  ts: number;
  workspace_id: string | null;
  event_type: string;
  actor_id: string | null;
  target_id: string | null;
  conv_id: string | null;
  metadata_json: string | null;
}

export interface AuditLogQuery {
  eventType?: string;
  workspaceId?: string;
  /** Inclusive lower bound on ts (unix seconds). */
  sinceSec?: number;
  /** Exclusive upper bound on ts (unix seconds). */
  untilSec?: number;
  /** Defaults to 100, capped at 1000. */
  limit?: number;
}

export interface AuditLogRepo {
  record(entry: AuditLogEntry): void;
  listRecent(limit: number): AuditLogRow[];
  query(filter: AuditLogQuery): AuditLogRow[];
  purgeOlderThan(unixSec: number): number;
}

const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 1000;

export function makeAuditLogRepo(db: Database.Database): AuditLogRepo {
  const insertStmt = db.prepare(
    "INSERT INTO audit_log (workspace_id, event_type, actor_id, target_id, conv_id, metadata_json) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  );
  const recentStmt = db.prepare(
    "SELECT id, ts, workspace_id, event_type, actor_id, target_id, conv_id, metadata_json " +
      "FROM audit_log ORDER BY id DESC LIMIT ?",
  );
  const purgeStmt = db.prepare("DELETE FROM audit_log WHERE ts < ?");
  const queryStmtCache = new Map<string, Database.Statement>();

  return {
    record(entry) {
      insertStmt.run(
        entry.workspaceId ?? null,
        entry.eventType,
        entry.actorId ?? null,
        entry.targetId ?? null,
        entry.convId ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      );
    },
    listRecent(limit) {
      return recentStmt.all(limit) as AuditLogRow[];
    },
    query(filter) {
      // Build a dynamic WHERE clause from only the non-undefined filter
      // keys. All values flow through parameterized placeholders — never
      // string-interpolated — so SQL injection is structurally impossible.
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.eventType !== undefined) {
        clauses.push("event_type = ?");
        params.push(filter.eventType);
      }
      if (filter.workspaceId !== undefined) {
        clauses.push("workspace_id = ?");
        params.push(filter.workspaceId);
      }
      if (filter.sinceSec !== undefined) {
        clauses.push("ts >= ?");
        params.push(filter.sinceSec);
      }
      if (filter.untilSec !== undefined) {
        clauses.push("ts < ?");
        params.push(filter.untilSec);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const requested = filter.limit ?? DEFAULT_QUERY_LIMIT;
      const limit = Math.min(Math.max(requested, 0), MAX_QUERY_LIMIT);
      const sql =
        "SELECT id, ts, workspace_id, event_type, actor_id, target_id, conv_id, metadata_json " +
        `FROM audit_log ${where} ORDER BY ts DESC, id DESC LIMIT ?`;
      params.push(limit);
      let stmt = queryStmtCache.get(sql);
      if (!stmt) {
        stmt = db.prepare(sql);
        queryStmtCache.set(sql, stmt);
      }
      return stmt.all(...params) as AuditLogRow[];
    },
    purgeOlderThan(unixSec) {
      const result = purgeStmt.run(unixSec);
      return result.changes;
    },
  };
}
