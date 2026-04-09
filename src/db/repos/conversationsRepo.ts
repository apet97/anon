import type Database from "better-sqlite3";

export interface ConversationRow {
  sender_id: string;
  recipient_id: string;
  last_message: string | null;
}

export interface ConversationsRepo {
  insert(id: string, senderId: string, recipientId: string): void;
  get(id: string): ConversationRow | undefined;
  updateLastMessage(id: string, message: string): void;
}

export function makeConversationsRepo(db: Database.Database): ConversationsRepo {
  const insertStmt = db.prepare(
    "INSERT INTO conversations (id, sender_id, recipient_id) VALUES (?, ?, ?)",
  );
  const getStmt = db.prepare(
    "SELECT sender_id, recipient_id, last_message FROM conversations WHERE id = ?",
  );
  const updateLastMessageStmt = db.prepare(
    "UPDATE conversations SET last_message = ? WHERE id = ?",
  );

  return {
    insert(id, senderId, recipientId) {
      insertStmt.run(id, senderId, recipientId);
    },
    get(id) {
      return getStmt.get(id) as ConversationRow | undefined;
    },
    updateLastMessage(id, message) {
      updateLastMessageStmt.run(message, id);
    },
  };
}
