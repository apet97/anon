ALTER TABLE conversations ADD COLUMN message_type TEXT NOT NULL DEFAULT 'dm';
ALTER TABLE conversations ADD COLUMN channel_id TEXT;
ALTER TABLE conversations ADD COLUMN thread_root_id TEXT;
