import type Database from "better-sqlite3";

export interface BlockedUsersRepo {
  isBlocked(userId: string): boolean;
  block(userId: string): void;
  unblock(userId: string): void;
}

export function makeBlockedUsersRepo(db: Database.Database): BlockedUsersRepo {
  const isBlockedStmt = db.prepare(
    "SELECT 1 AS hit FROM blocked_users WHERE user_id = ?",
  );
  const blockStmt = db.prepare(
    "INSERT OR IGNORE INTO blocked_users (user_id) VALUES (?)",
  );
  const unblockStmt = db.prepare(
    "DELETE FROM blocked_users WHERE user_id = ?",
  );

  return {
    isBlocked(userId) {
      const row = isBlockedStmt.get(userId) as { hit: number } | undefined;
      return row !== undefined;
    },
    block(userId) {
      blockStmt.run(userId);
    },
    unblock(userId) {
      unblockStmt.run(userId);
    },
  };
}
