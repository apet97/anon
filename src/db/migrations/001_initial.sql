-- Baseline schema. Duplicates the CREATE IF NOT EXISTS statements in
-- src/db/schema.ts so that a fresh database under the migrator is
-- identical to the prototype's existing production database. Once a
-- database is under migrator control the 001_initial row in
-- schema_migrations prevents re-running.

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  last_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS blocked_users (
  user_id TEXT PRIMARY KEY,
  blocked_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT PRIMARY KEY,
  msg_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS target_limits (
  sender_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (sender_id, target_id)
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
