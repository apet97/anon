import type Database from "better-sqlite3";

export interface BlockedUsersRepo {
  isBlocked(workspaceId: string, userId: string): boolean;
  block(workspaceId: string, userId: string): void;
  unblock(workspaceId: string, userId: string): void;
  deleteForWorkspace(workspaceId: string): number;
}

export function makeBlockedUsersRepo(db: Database.Database): BlockedUsersRepo {
  const isBlockedStmt = db.prepare(
    "SELECT 1 AS hit FROM blocked_users WHERE workspace_id = ? AND user_id = ?",
  );
  const blockStmt = db.prepare(
    "INSERT OR IGNORE INTO blocked_users (workspace_id, user_id) VALUES (?, ?)",
  );
  const unblockStmt = db.prepare(
    "DELETE FROM blocked_users WHERE workspace_id = ? AND user_id = ?",
  );
  const deleteForWorkspaceStmt = db.prepare(
    "DELETE FROM blocked_users WHERE workspace_id = ?",
  );

  return {
    isBlocked(workspaceId, userId) {
      const row = isBlockedStmt.get(workspaceId, userId) as { hit: number } | undefined;
      return row !== undefined;
    },
    block(workspaceId, userId) {
      blockStmt.run(workspaceId, userId);
    },
    unblock(workspaceId, userId) {
      unblockStmt.run(workspaceId, userId);
    },
    deleteForWorkspace(workspaceId) {
      return deleteForWorkspaceStmt.run(workspaceId).changes;
    },
  };
}
