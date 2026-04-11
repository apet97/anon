-- SQLite-backed CredentialsStore. Stores both bot and user tokens
-- per workspace. workspace_user_id is an empty string for bot rows
-- because SQLite primary keys cannot contain NULLs — the empty
-- string is a sentinel so the PK stays well-defined.

CREATE TABLE IF NOT EXISTS tokens (
  workspace_id TEXT NOT NULL,
  workspace_user_id TEXT NOT NULL DEFAULT '',
  token_kind TEXT NOT NULL CHECK (token_kind IN ('bot', 'user')),
  bot_user_id TEXT,
  access_token TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (workspace_id, workspace_user_id, token_kind)
);

CREATE INDEX IF NOT EXISTS idx_tokens_workspace ON tokens(workspace_id);
