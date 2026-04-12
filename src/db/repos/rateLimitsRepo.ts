import type Database from "better-sqlite3";
import {
  checkAndIncrementSlidingWindow,
  type SlidingWindowRow,
} from "./slidingWindow";

export type RateLimitRow = SlidingWindowRow;

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

  const checkAndIncrementTx = db.transaction(
    (workspaceId: string, userId: string, now: number, limit: number, windowSecs: number): boolean =>
      checkAndIncrementSlidingWindow(
        () => getStmt.get(workspaceId, userId) as RateLimitRow | undefined,
        (n) => { resetStmt.run(workspaceId, userId, n); },
        () => { incrementStmt.run(workspaceId, userId); },
        now, limit, windowSecs,
      ),
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
      return checkAndIncrementTx(workspaceId, userId, now, limit, windowSecs);
    },
    purgeOlderThan(windowStartCutoff) {
      return purgeStmt.run(windowStartCutoff).changes;
    },
    deleteForWorkspace(workspaceId) {
      return deleteForWorkspaceStmt.run(workspaceId).changes;
    },
  };
}
