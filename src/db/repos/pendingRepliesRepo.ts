import type Database from "better-sqlite3";
import type { ReplyDirection } from "../../services/pendingReplies";

export interface PendingReplyRow {
  workspace_id: string;
  user_id: string;
  conv_id: string;
  direction: ReplyDirection;
  created_at: number;
  updated_at: number;
}

export interface PendingRepliesRepo {
  upsert(args: {
    workspaceId: string;
    userId: string;
    convId: string;
    direction: ReplyDirection;
  }): void;
  get(workspaceId: string, userId: string): PendingReplyRow | undefined;
  delete(workspaceId: string, userId: string): void;
  deleteForWorkspace(workspaceId: string): number;
  purgeOlderThan(unixSec: number): number;
}

export function makePendingRepliesRepo(db: Database.Database): PendingRepliesRepo {
  const upsertStmt = db.prepare(
    "INSERT INTO pending_replies (workspace_id, user_id, conv_id, direction) " +
      "VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(workspace_id, user_id) DO UPDATE SET " +
      "  conv_id = excluded.conv_id, " +
      "  direction = excluded.direction, " +
      "  updated_at = unixepoch()",
  );
  const getStmt = db.prepare(
    "SELECT workspace_id, user_id, conv_id, direction, created_at, updated_at " +
      "FROM pending_replies WHERE workspace_id = ? AND user_id = ?",
  );
  const deleteStmt = db.prepare(
    "DELETE FROM pending_replies WHERE workspace_id = ? AND user_id = ?",
  );
  const deleteWorkspaceStmt = db.prepare(
    "DELETE FROM pending_replies WHERE workspace_id = ?",
  );
  const purgeStmt = db.prepare(
    "DELETE FROM pending_replies WHERE updated_at < ?",
  );

  return {
    upsert({ workspaceId, userId, convId, direction }) {
      upsertStmt.run(workspaceId, userId, convId, direction);
    },
    get(workspaceId, userId) {
      return getStmt.get(workspaceId, userId) as PendingReplyRow | undefined;
    },
    delete(workspaceId, userId) {
      deleteStmt.run(workspaceId, userId);
    },
    deleteForWorkspace(workspaceId) {
      const result = deleteWorkspaceStmt.run(workspaceId);
      return result.changes;
    },
    purgeOlderThan(unixSec) {
      const result = purgeStmt.run(unixSec);
      return result.changes;
    },
  };
}
