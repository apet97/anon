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
  insert(id: string, workspaceId: string, senderId: string, recipientId: string): void;
  insertChannel(id: string, workspaceId: string, senderId: string, channelId: string, messageType: MessageType, threadRootId?: string): void;
  get(id: string): ConversationRow | undefined;
  updateLastMessage(id: string, message: string): void;
  updateThreadRootId(id: string, threadRootId: string): void;
  purgeOlderThan(unixSec: number): number;
}

export function makeConversationsRepo(db: Database.Database): ConversationsRepo {
  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO conversations (id, workspace_id, sender_id, recipient_id) VALUES (?, ?, ?, ?)",
  );
  const insertChannelStmt = db.prepare(
    "INSERT OR IGNORE INTO conversations (id, workspace_id, sender_id, recipient_id, message_type, channel_id, thread_root_id) VALUES (?, ?, ?, '', ?, ?, ?)",
  );
  const getStmt = db.prepare(
    "SELECT sender_id, recipient_id, last_message, message_type, channel_id, thread_root_id, workspace_id FROM conversations WHERE id = ?",
  );
  const updateLastMessageStmt = db.prepare(
    "UPDATE conversations SET last_message = ? WHERE id = ?",
  );
  const updateThreadRootIdStmt = db.prepare(
    "UPDATE conversations SET thread_root_id = ? WHERE id = ?",
  );
  const purgeStmt = db.prepare(
    "DELETE FROM conversations WHERE created_at < ?",
  );

  return {
    insert(id, workspaceId, senderId, recipientId) {
      insertStmt.run(id, workspaceId, senderId, recipientId);
    },
    insertChannel(id, workspaceId, senderId, channelId, messageType, threadRootId) {
      insertChannelStmt.run(id, workspaceId, senderId, messageType, channelId, threadRootId ?? null);
    },
    get(id) {
      return getStmt.get(id) as ConversationRow | undefined;
    },
    updateLastMessage(id, message) {
      updateLastMessageStmt.run(message, id);
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
