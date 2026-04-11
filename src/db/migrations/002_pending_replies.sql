-- Durable state for open reply modals. Replaces the ephemeral in-memory
-- Map in the 0.0.29 prototype so a process restart mid-modal does not
-- silently drop the user's reply.
--
-- One row per (workspaceId, userId) pair; users can only have one
-- open modal at a time. direction is CHECKed so bad data from a
-- malformed interaction payload is rejected at the SQLite layer.

CREATE TABLE IF NOT EXISTS pending_replies (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conv_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('recipient', 'sender')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_replies_updated_at
  ON pending_replies(updated_at);
