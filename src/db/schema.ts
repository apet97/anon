/**
 * Initial schema for the 5 tables that already exist in the current
 * production prototype. This is exported as a constant so both the
 * runtime `openDb` and the test helpers can apply it against an
 * in-memory database without any filesystem side effects.
 *
 * The Phase 5 migration runner takes over from this module and tracks
 * applied versions in `schema_migrations`; this file will then become
 * migration `001_initial.sql`.
 */

export const INITIAL_SCHEMA_SQL = `
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
`;
