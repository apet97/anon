import type { PendingRepliesRepo } from "../db/repos/pendingRepliesRepo";

/**
 * Ephemeral state for in-flight reply modals.
 *
 * Direction semantics:
 * - `"recipient"` means the pending reply is being composed BY the
 *   recipient of an anonymous message — the target of the reply is
 *   the original sender.
 * - `"sender"` means the pending reply is being composed BY the
 *   original sender in response to an anonymous reply — the target
 *   is the recipient.
 *
 * Storage is keyed by (workspaceId, userId) because the same user id
 * can exist in multiple workspaces for a single bot install and the
 * SQLite `pending_replies` table uses that composite primary key.
 */
export type ReplyDirection = "recipient" | "sender";

export interface PendingReply {
  convId: string;
  direction: ReplyDirection;
}

export interface PendingRepliesService {
  set(
    workspaceId: string,
    userId: string,
    pending: PendingReply,
  ): Promise<void>;
  get(workspaceId: string, userId: string): Promise<PendingReply | undefined>;
  delete(workspaceId: string, userId: string): Promise<void>;
}

/**
 * In-memory implementation. Used by tests that don't need to
 * exercise the SQLite layer and as a fallback for environments
 * where the migrator has not yet been run.
 */
export function makeInMemoryPendingRepliesService(): PendingRepliesService {
  const state = new Map<string, PendingReply>();
  const key = (workspaceId: string, userId: string) => `${workspaceId}:${userId}`;
  return {
    async set(workspaceId, userId, pending) {
      state.set(key(workspaceId, userId), pending);
    },
    async get(workspaceId, userId) {
      return state.get(key(workspaceId, userId));
    },
    async delete(workspaceId, userId) {
      state.delete(key(workspaceId, userId));
    },
  };
}

/**
 * SQLite-backed implementation. Uses the `pending_replies` table
 * from migration 002 so the modal flow survives process restarts.
 */
export function makeSqlitePendingRepliesService(
  repo: PendingRepliesRepo,
): PendingRepliesService {
  return {
    async set(workspaceId, userId, pending) {
      repo.upsert({
        workspaceId,
        userId,
        convId: pending.convId,
        direction: pending.direction,
      });
    },
    async get(workspaceId, userId) {
      const row = repo.get(workspaceId, userId);
      if (!row) return undefined;
      return { convId: row.conv_id, direction: row.direction };
    },
    async delete(workspaceId, userId) {
      repo.delete(workspaceId, userId);
    },
  };
}
