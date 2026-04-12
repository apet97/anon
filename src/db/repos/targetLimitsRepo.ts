import type Database from "better-sqlite3";

export interface TargetLimitRow {
  msg_count: number;
  window_start: number;
}

export interface TargetLimitsRepo {
  get(workspaceId: string, senderId: string, targetId: string): TargetLimitRow | undefined;
  reset(workspaceId: string, senderId: string, targetId: string, now: number): void;
  increment(workspaceId: string, senderId: string, targetId: string): void;
  checkAndIncrement(
    workspaceId: string,
    senderId: string,
    targetId: string,
    now: number,
    limit: number,
    windowSecs: number,
  ): boolean;
  purgeOlderThan(windowStartCutoff: number): number;
  deleteForWorkspace(workspaceId: string): number;
}

export function makeTargetLimitsRepo(db: Database.Database): TargetLimitsRepo {
  const getStmt = db.prepare(
    "SELECT msg_count, window_start FROM target_limits WHERE workspace_id = ? AND sender_id = ? AND target_id = ?",
  );
  const resetStmt = db.prepare(
    "INSERT INTO target_limits (workspace_id, sender_id, target_id, msg_count, window_start) " +
      "VALUES (?, ?, ?, 1, ?) " +
      "ON CONFLICT(workspace_id, sender_id, target_id) DO UPDATE SET msg_count = 1, window_start = excluded.window_start",
  );
  const incrementStmt = db.prepare(
    "UPDATE target_limits SET msg_count = msg_count + 1 WHERE workspace_id = ? AND sender_id = ? AND target_id = ?",
  );
  const purgeStmt = db.prepare(
    "DELETE FROM target_limits WHERE window_start < ?",
  );
  const deleteForWorkspaceStmt = db.prepare(
    "DELETE FROM target_limits WHERE workspace_id = ?",
  );

  const checkAndIncrementFn = db.transaction(
    (
      workspaceId: string,
      senderId: string,
      targetId: string,
      now: number,
      limit: number,
      windowSecs: number,
    ): boolean => {
      const row = getStmt.get(workspaceId, senderId, targetId) as TargetLimitRow | undefined;
      if (!row || now - row.window_start > windowSecs) {
        resetStmt.run(workspaceId, senderId, targetId, now);
        return true;
      }
      if (row.msg_count >= limit) return false;
      incrementStmt.run(workspaceId, senderId, targetId);
      return true;
    },
  );

  return {
    get(workspaceId, senderId, targetId) {
      return getStmt.get(workspaceId, senderId, targetId) as TargetLimitRow | undefined;
    },
    reset(workspaceId, senderId, targetId, now) {
      resetStmt.run(workspaceId, senderId, targetId, now);
    },
    increment(workspaceId, senderId, targetId) {
      incrementStmt.run(workspaceId, senderId, targetId);
    },
    checkAndIncrement(workspaceId, senderId, targetId, now, limit, windowSecs) {
      return checkAndIncrementFn(
        workspaceId,
        senderId,
        targetId,
        now,
        limit,
        windowSecs,
      ) as boolean;
    },
    purgeOlderThan(windowStartCutoff) {
      return purgeStmt.run(windowStartCutoff).changes;
    },
    deleteForWorkspace(workspaceId) {
      return deleteForWorkspaceStmt.run(workspaceId).changes;
    },
  };
}
