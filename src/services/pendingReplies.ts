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
 * Phase 5 replaces this in-memory implementation with a SQLite-backed
 * store so the modal flow survives a process restart. Both
 * implementations share this interface.
 */
export type ReplyDirection = "recipient" | "sender";

export interface PendingReply {
  convId: string;
  direction: ReplyDirection;
}

export interface PendingRepliesService {
  set(userId: string, pending: PendingReply): Promise<void>;
  get(userId: string): Promise<PendingReply | undefined>;
  delete(userId: string): Promise<void>;
}

/**
 * In-memory implementation used by the pre-Phase-5 code path. Exists
 * only so that the modular refactor in Phase 3/4 can proceed without
 * a behaviour change. See `makeSqlitePendingRepliesService` for the
 * durable implementation introduced in Phase 5.
 */
export function makeInMemoryPendingRepliesService(): PendingRepliesService {
  const state = new Map<string, PendingReply>();
  return {
    async set(userId, pending) {
      state.set(userId, pending);
    },
    async get(userId) {
      return state.get(userId);
    },
    async delete(userId) {
      state.delete(userId);
    },
  };
}
