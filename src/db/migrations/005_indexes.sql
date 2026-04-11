-- Performance indexes for retention purge range-delete queries.
--
-- Note: rate_limits, target_limits, and blocked_users already have
-- implicit B-tree indexes via their PRIMARY KEY declarations, covering
-- all point-lookup hot paths. These additional indexes speed up the
-- range-DELETE statements run by the retention scheduler every 6 hours.

CREATE INDEX IF NOT EXISTS idx_conversations_created_at
  ON conversations(created_at);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON rate_limits(window_start);

CREATE INDEX IF NOT EXISTS idx_target_limits_window_start
  ON target_limits(window_start);
