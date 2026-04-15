import type Database from "better-sqlite3";

export type MessageType = "dm" | "channel" | "thread";

export interface ConversationRow {
  sender_id: string;
  recipient_id: string;
  last_message: string | null;
  message_type: MessageType;
  channel_id: string | null;
  thread_root_id: string | null;
  workspace_id: string;
}

export interface ConversationsRepo {
  insert(
    id: string,
    workspaceId: string,
    senderId: string,
    recipientId: string,
    lastMessage: string,
  ): void;
  insertChannel(
    id: string,
    workspaceId: string,
    senderId: string,
    channelId: string,
    messageType: MessageType,
    lastMessage: string,
    threadRootId?: string,
  ): void;
  /**
   * Scoped read. A caller in `ws-A` can never observe a row from `ws-B`
   * even if it guesses the convId (finding C-3). The SQL `AND workspace_id = ?`
   * is the enforcement point; the composite-PK migration is a separate
   * follow-up so this layer stays backwards-compatible with the current
   * schema shape.
   */
  get(workspaceId: string, id: string): ConversationRow | undefined;
  updateThreadRootId(id: string, threadRootId: string): void;
  purgeOlderThan(unixSec: number): number;
}

export function makeConversationsRepo(db: Database.Database): ConversationsRepo {
  // `last_message` is captured inline at insert time so callers never issue
  // a separate UPDATE that could silently hit zero rows. See finding C-1.
  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO conversations (id, workspace_id, sender_id, recipient_id, last_message) VALUES (?, ?, ?, ?, ?)",
  );
  const insertChannelStmt = db.prepare(
    "INSERT OR IGNORE INTO conversations (id, workspace_id, sender_id, recipient_id, message_type, channel_id, thread_root_id, last_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const getStmt = db.prepare(
    "SELECT sender_id, recipient_id, last_message, message_type, channel_id, thread_root_id, workspace_id FROM conversations WHERE id = ? AND workspace_id = ?",
  );
  const updateThreadRootIdStmt = db.prepare(
    "UPDATE conversations SET thread_root_id = ? WHERE id = ?",
  );
  const purgeStmt = db.prepare(
    "DELETE FROM conversations WHERE created_at < ?",
  );

  return {
    insert(id, workspaceId, senderId, recipientId, lastMessage) {
      insertStmt.run(id, workspaceId, senderId, recipientId, lastMessage);
    },
    insertChannel(id, workspaceId, senderId, channelId, messageType, lastMessage, threadRootId) {
      insertChannelStmt.run(
        id,
        workspaceId,
        senderId,
        "",
        messageType,
        channelId,
        threadRootId ?? null,
        lastMessage,
      );
    },
    get(workspaceId, id) {
      return getStmt.get(id, workspaceId) as ConversationRow | undefined;
    },
    updateThreadRootId(id, threadRootId) {
      updateThreadRootIdStmt.run(threadRootId, id);
    },
    purgeOlderThan(unixSec) {
      const result = purgeStmt.run(unixSec);
      return result.changes;
    },
  };
}
