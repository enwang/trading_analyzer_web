ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS trading_notes JSONB NOT NULL DEFAULT '{"entryRules":"","sellRules":"","reviewNotes":""}'::jsonb;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS trading_notes_updated_at TIMESTAMPTZ;
