-- H-6: enforce conversations.message_type at the schema level so a writer
-- bug or a rogue SQL INSERT cannot land a value outside the TypeScript
-- MessageType union. Also an opportunity to pin every column NOT NULL that
-- the runtime already expects, without tightening the existing 007 shape.
--
-- SQLite cannot ALTER a column to add a CHECK constraint in-place, so we
-- follow the standard CREATE-copy-drop-rename pattern used by 007.
--
-- The previous PK (id TEXT PRIMARY KEY) is preserved; C-3 keeps callers
-- passing workspaceId to repo.get(), and a follow-up migration can add a
-- composite PK if we decide to lock cross-workspace lookups at the schema
-- level too.

CREATE TABLE conversations_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '',
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  last_message TEXT,
  message_type TEXT NOT NULL DEFAULT 'dm'
    CHECK (message_type IN ('dm', 'channel', 'thread')),
  channel_id TEXT,
  thread_root_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO conversations_new (
  id, workspace_id, sender_id, recipient_id, last_message,
  message_type, channel_id, thread_root_id, created_at
)
SELECT
  id, workspace_id, sender_id, recipient_id, last_message,
  message_type, channel_id, thread_root_id, created_at
FROM conversations;

DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;

-- Recreate the retention range-DELETE index from migration 005. Dropping
-- the table above implicitly drops its indexes.
CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON conversations(created_at);
