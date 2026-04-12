import type Database from "better-sqlite3";

export interface RateLimitRow {
  msg_count: number;
  window_start: number;
}

export interface RateLimitsRepo {
  get(workspaceId: string, userId: string): RateLimitRow | undefined;
  reset(workspaceId: string, userId: string, now: number): void;
  increment(workspaceId: string, userId: string): void;
  checkAndIncrement(
    workspaceId: string,
    userId: string,
    now: number,
    limit: number,
    windowSecs: number,
  ): boolean;
  purgeOlderThan(windowStartCutoff: number): number;
  deleteForWorkspace(workspaceId: string): number;
}

export function makeRateLimitsRepo(db: Database.Database): RateLimitsRepo {
  const getStmt = db.prepare(
    "SELECT msg_count, window_start FROM rate_limits WHERE workspace_id = ? AND user_id = ?",
  );
  const resetStmt = db.prepare(
    "INSERT INTO rate_limits (workspace_id, user_id, msg_count, window_start) " +
      "VALUES (?, ?, 1, ?) " +
      "ON CONFLICT(workspace_id, user_id) DO UPDATE SET msg_count = 1, window_start = excluded.window_start",
  );
  const incrementStmt = db.prepare(
    "UPDATE rate_limits SET msg_count = msg_count + 1 WHERE workspace_id = ? AND user_id = ?",
  );
  const purgeStmt = db.prepare(
    "DELETE FROM rate_limits WHERE window_start < ?",
  );
  const deleteForWorkspaceStmt = db.prepare(
    "DELETE FROM rate_limits WHERE workspace_id = ?",
  );

  const checkAndIncrementFn = db.transaction(
    (workspaceId: string, userId: string, now: number, limit: number, windowSecs: number): boolean => {
      const row = getStmt.get(workspaceId, userId) as RateLimitRow | undefined;
      if (!row || now - row.window_start > windowSecs) {
        resetStmt.run(workspaceId, userId, now);
        return true;
      }
      if (row.msg_count >= limit) return false;
      incrementStmt.run(workspaceId, userId);
      return true;
    },
  );

  return {
    get(workspaceId, userId) {
      return getStmt.get(workspaceId, userId) as RateLimitRow | undefined;
    },
    reset(workspaceId, userId, now) {
      resetStmt.run(workspaceId, userId, now);
    },
    increment(workspaceId, userId) {
      incrementStmt.run(workspaceId, userId);
    },
    checkAndIncrement(workspaceId, userId, now, limit, windowSecs) {
      return checkAndIncrementFn(workspaceId, userId, now, limit, windowSecs) as boolean;
    },
    purgeOlderThan(windowStartCutoff) {
      return purgeStmt.run(windowStartCutoff).changes;
    },
    deleteForWorkspace(workspaceId) {
      return deleteForWorkspaceStmt.run(workspaceId).changes;
    },
  };
}
