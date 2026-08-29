ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS trades_column_order JSONB;
