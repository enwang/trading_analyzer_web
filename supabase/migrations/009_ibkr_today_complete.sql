ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ibkr_today_complete_date DATE;
