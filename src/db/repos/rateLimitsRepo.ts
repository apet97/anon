import type Database from "better-sqlite3";

export interface RateLimitRow {
  msg_count: number;
  window_start: number;
}

export interface RateLimitsRepo {
  get(userId: string): RateLimitRow | undefined;
  reset(userId: string, now: number): void;
  increment(userId: string): void;
  /**
   * Atomically check-and-increment in a single SQLite transaction.
   * Returns true if the request is allowed (counter incremented or
   * window reset), false if the rate limit is exhausted.
   */
  checkAndIncrement(
    userId: string,
    now: number,
    limit: number,
    windowSecs: number,
  ): boolean;
  /** Delete rows whose window_start is older than windowStartCutoff. */
  purgeOlderThan(windowStartCutoff: number): number;
}

export function makeRateLimitsRepo(db: Database.Database): RateLimitsRepo {
  const getStmt = db.prepare(
    "SELECT msg_count, window_start FROM rate_limits WHERE user_id = ?",
  );
  const resetStmt = db.prepare(
    "INSERT INTO rate_limits (user_id, msg_count, window_start) " +
      "VALUES (?, 1, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET msg_count = 1, window_start = excluded.window_start",
  );
  const incrementStmt = db.prepare(
    "UPDATE rate_limits SET msg_count = msg_count + 1 WHERE user_id = ?",
  );
  const purgeStmt = db.prepare(
    "DELETE FROM rate_limits WHERE window_start < ?",
  );

  const checkAndIncrementFn = db.transaction(
    (userId: string, now: number, limit: number, windowSecs: number): boolean => {
      const row = getStmt.get(userId) as RateLimitRow | undefined;
      if (!row || now - row.window_start > windowSecs) {
        resetStmt.run(userId, now);
        return true;
      }
      if (row.msg_count >= limit) return false;
      incrementStmt.run(userId);
      return true;
    },
  );

  return {
    get(userId) {
      return getStmt.get(userId) as RateLimitRow | undefined;
    },
    reset(userId, now) {
      resetStmt.run(userId, now);
    },
    increment(userId) {
      incrementStmt.run(userId);
    },
    checkAndIncrement(userId, now, limit, windowSecs) {
      return checkAndIncrementFn(userId, now, limit, windowSecs) as boolean;
    },
    purgeOlderThan(windowStartCutoff) {
      return purgeStmt.run(windowStartCutoff).changes;
    },
  };
}
