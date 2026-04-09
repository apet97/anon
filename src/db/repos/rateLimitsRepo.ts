import type Database from "better-sqlite3";

export interface RateLimitRow {
  msg_count: number;
  window_start: number;
}

export interface RateLimitsRepo {
  get(userId: string): RateLimitRow | undefined;
  reset(userId: string, now: number): void;
  increment(userId: string): void;
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
  };
}
