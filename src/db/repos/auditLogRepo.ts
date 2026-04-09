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

export interface AuditLogRepo {
  record(entry: AuditLogEntry): void;
  listRecent(limit: number): AuditLogRow[];
}

export function makeAuditLogRepo(db: Database.Database): AuditLogRepo {
  const insertStmt = db.prepare(
    "INSERT INTO audit_log (workspace_id, event_type, actor_id, target_id, conv_id, metadata_json) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  );
  const recentStmt = db.prepare(
    "SELECT id, ts, workspace_id, event_type, actor_id, target_id, conv_id, metadata_json " +
      "FROM audit_log ORDER BY id DESC LIMIT ?",
  );

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
  };
}
