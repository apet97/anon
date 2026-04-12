-- Add workspace_id to all tables that are not yet workspace-scoped.
-- SQLite cannot alter primary keys, so tables whose PK changes use
-- the CREATE-copy-drop-rename pattern.

-- blocked_users: (user_id) → (workspace_id, user_id)
CREATE TABLE blocked_users_new (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  blocked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (workspace_id, user_id)
);
INSERT INTO blocked_users_new (workspace_id, user_id, blocked_at)
  SELECT '', user_id, blocked_at FROM blocked_users;
DROP TABLE blocked_users;
ALTER TABLE blocked_users_new RENAME TO blocked_users;

-- rate_limits: (user_id) → (workspace_id, user_id)
CREATE TABLE rate_limits_new (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (workspace_id, user_id)
);
INSERT INTO rate_limits_new (workspace_id, user_id, msg_count, window_start)
  SELECT '', user_id, msg_count, window_start FROM rate_limits;
DROP TABLE rate_limits;
ALTER TABLE rate_limits_new RENAME TO rate_limits;

-- target_limits: (sender_id, target_id) → (workspace_id, sender_id, target_id)
CREATE TABLE target_limits_new (
  workspace_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (workspace_id, sender_id, target_id)
);
INSERT INTO target_limits_new (workspace_id, sender_id, target_id, msg_count, window_start)
  SELECT '', sender_id, target_id, msg_count, window_start FROM target_limits;
DROP TABLE target_limits;
ALTER TABLE target_limits_new RENAME TO target_limits;

-- config: (key) → (workspace_id, key)
CREATE TABLE config_new (
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);
INSERT INTO config_new (workspace_id, key, value)
  SELECT '', key, value FROM config;
DROP TABLE config;
ALTER TABLE config_new RENAME TO config;

-- conversations: add workspace_id column (PK stays id UUID)
ALTER TABLE conversations ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
