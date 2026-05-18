-- Per-day account NAV (from IBKR Net Asset Value (NAV) in Base section)
CREATE TABLE IF NOT EXISTS account_nav_daily (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  account_id  TEXT,
  currency    TEXT,
  total       NUMERIC,
  total_long  NUMERIC,
  total_short NUMERIC,
  raw         JSONB,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, report_date)
);

ALTER TABLE account_nav_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_nav_daily" ON account_nav_daily FOR ALL USING (auth.uid() = user_id);

-- Per-period NAV change with attribution (from IBKR ChangeInNAV section)
CREATE TABLE IF NOT EXISTS account_nav_change (
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_date            DATE NOT NULL,
  to_date              DATE NOT NULL,
  account_id           TEXT,
  currency             TEXT,
  starting_value       NUMERIC,
  ending_value         NUMERIC,
  mtm                  NUMERIC,
  deposits_withdrawals NUMERIC,
  interest             NUMERIC,
  dividends            NUMERIC,
  commissions          NUMERIC,
  other_fees           NUMERIC,
  raw                  JSONB,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, from_date, to_date)
);

ALTER TABLE account_nav_change ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_nav_change" ON account_nav_change FOR ALL USING (auth.uid() = user_id);
