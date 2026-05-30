-- Per-transaction deposit/withdrawal records (from IBKR DepositsWithdrawals section)
-- Gives us exact dates for cash flows, needed for daily TWR computation.
CREATE TABLE IF NOT EXISTS account_cash_transactions (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id      TEXT,
  currency        TEXT,
  transaction_ts  TIMESTAMPTZ NOT NULL,
  type            TEXT,
  amount          NUMERIC NOT NULL,
  description     TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, transaction_ts, amount)
);

ALTER TABLE account_cash_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_cash_transactions" ON account_cash_transactions FOR ALL USING (auth.uid() = user_id);
