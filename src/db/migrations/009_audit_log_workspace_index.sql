-- Composite index for workspace-scoped audit log queries.
-- The query() method filters by workspace_id frequently; without this
-- index every query is a full table scan (audit_log can hold 90 days
-- of rows). The (workspace_id, ts DESC) ordering matches the ORDER BY
-- in auditLogRepo.query() and supports both workspace-only and
-- workspace + event_type + ts-range lookups via the leading column.

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_ts
  ON audit_log(workspace_id, ts DESC);
