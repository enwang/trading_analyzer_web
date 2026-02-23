-- Trading Analyzer — initial schema

CREATE TABLE IF NOT EXISTS trades (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol        TEXT NOT NULL,
  entry_time    TIMESTAMPTZ,
  exit_time     TIMESTAMPTZ,
  side          TEXT,
  shares        NUMERIC,
  entry_price   NUMERIC,
  exit_price    NUMERIC,
  pnl           NUMERIC,
  pnl_pct       NUMERIC,
  outcome       TEXT,          -- win | loss | breakeven | open
  hold_days     NUMERIC,
  hold_time_min NUMERIC,
  hour_of_day   INTEGER,
  day_of_week   TEXT,
  r_multiple    NUMERIC,
  setup_tag     TEXT DEFAULT 'untagged',
  source        TEXT DEFAULT 'ibkr',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Natural deduplication key (same trade = same user, symbol, exit time, pnl)
CREATE UNIQUE INDEX IF NOT EXISTS trades_dedup ON trades(user_id, symbol, exit_time, pnl)
  WHERE exit_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS trades_user_entry ON trades(user_id, entry_time DESC);
CREATE INDEX IF NOT EXISTS trades_user_symbol ON trades(user_id, symbol);
CREATE INDEX IF NOT EXISTS trades_user_outcome ON trades(user_id, outcome);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_trades" ON trades FOR ALL USING (auth.uid() = user_id);

-- User settings (IBKR credentials, preferences)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  ibkr_token     TEXT,
  ibkr_query_id  TEXT,
  ibkr_last_sync DATE,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_settings" ON user_settings FOR ALL USING (auth.uid() = user_id);
