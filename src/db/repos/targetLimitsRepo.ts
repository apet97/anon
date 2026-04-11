import type Database from "better-sqlite3";

export interface TargetLimitRow {
  msg_count: number;
  window_start: number;
}

export interface TargetLimitsRepo {
  get(senderId: string, targetId: string): TargetLimitRow | undefined;
  reset(senderId: string, targetId: string, now: number): void;
  increment(senderId: string, targetId: string): void;
  /**
   * Atomically check-and-increment in a single SQLite transaction.
   * Returns true if the request is allowed (counter incremented or
   * window reset), false if the rate limit is exhausted.
   */
  checkAndIncrement(
    senderId: string,
    targetId: string,
    now: number,
    limit: number,
    windowSecs: number,
  ): boolean;
  /** Delete rows whose window_start is older than windowStartCutoff. */
  purgeOlderThan(windowStartCutoff: number): number;
}

export function makeTargetLimitsRepo(db: Database.Database): TargetLimitsRepo {
  const getStmt = db.prepare(
    "SELECT msg_count, window_start FROM target_limits WHERE sender_id = ? AND target_id = ?",
  );
  const resetStmt = db.prepare(
    "INSERT INTO target_limits (sender_id, target_id, msg_count, window_start) " +
      "VALUES (?, ?, 1, ?) " +
      "ON CONFLICT(sender_id, target_id) DO UPDATE SET msg_count = 1, window_start = excluded.window_start",
  );
  const incrementStmt = db.prepare(
    "UPDATE target_limits SET msg_count = msg_count + 1 WHERE sender_id = ? AND target_id = ?",
  );
  const purgeStmt = db.prepare(
    "DELETE FROM target_limits WHERE window_start < ?",
  );

  const checkAndIncrementFn = db.transaction(
    (
      senderId: string,
      targetId: string,
      now: number,
      limit: number,
      windowSecs: number,
    ): boolean => {
      const row = getStmt.get(senderId, targetId) as TargetLimitRow | undefined;
      if (!row || now - row.window_start > windowSecs) {
        resetStmt.run(senderId, targetId, now);
        return true;
      }
      if (row.msg_count >= limit) return false;
      incrementStmt.run(senderId, targetId);
      return true;
    },
  );

  return {
    get(senderId, targetId) {
      return getStmt.get(senderId, targetId) as TargetLimitRow | undefined;
    },
    reset(senderId, targetId, now) {
      resetStmt.run(senderId, targetId, now);
    },
    increment(senderId, targetId) {
      incrementStmt.run(senderId, targetId);
    },
    checkAndIncrement(senderId, targetId, now, limit, windowSecs) {
      return checkAndIncrementFn(
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
  };
}
