-- Append-only audit log for sensitive events. Never contains raw
-- message bodies — only IDs, event type, outcome, and a small
-- metadata JSON blob for structural context (see docs/SPEC.md §6).

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL DEFAULT (unixepoch()),
  workspace_id TEXT,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  conv_id TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
