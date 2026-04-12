import type Database from "better-sqlite3";
import {
  checkAndIncrementSlidingWindow,
  type SlidingWindowRow,
} from "./slidingWindow";

export type TargetLimitRow = SlidingWindowRow;

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

  const checkAndIncrementTx = db.transaction(
    (
      workspaceId: string,
      senderId: string,
      targetId: string,
      now: number,
      limit: number,
      windowSecs: number,
    ): boolean =>
      checkAndIncrementSlidingWindow(
        () => getStmt.get(workspaceId, senderId, targetId) as TargetLimitRow | undefined,
        (n) => { resetStmt.run(workspaceId, senderId, targetId, n); },
        () => { incrementStmt.run(workspaceId, senderId, targetId); },
        now, limit, windowSecs,
      ),
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
      return checkAndIncrementTx(workspaceId, senderId, targetId, now, limit, windowSecs);
    },
    purgeOlderThan(windowStartCutoff) {
      return purgeStmt.run(windowStartCutoff).changes;
    },
    deleteForWorkspace(workspaceId) {
      return deleteForWorkspaceStmt.run(workspaceId).changes;
    },
  };
}
