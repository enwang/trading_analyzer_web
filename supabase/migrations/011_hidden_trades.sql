-- Soft-delete table for trades the user has manually removed. The IBKR sync
-- consults this list and skips re-creating any matching row, so deletions
-- persist across sync runs.
--
-- Identity is (user_id, symbol, entry_time, exit_time). exit_time is NULL for
-- open trades, matched via a partial unique index.

CREATE TABLE IF NOT EXISTS hidden_trades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  entry_time  TIMESTAMPTZ NOT NULL,
  exit_time   TIMESTAMPTZ,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS hidden_trades_open_uniq
  ON hidden_trades(user_id, symbol, entry_time)
  WHERE exit_time IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hidden_trades_closed_uniq
  ON hidden_trades(user_id, symbol, entry_time, exit_time)
  WHERE exit_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS hidden_trades_user_symbol_idx
  ON hidden_trades(user_id, symbol);

ALTER TABLE hidden_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_hidden_trades" ON hidden_trades FOR ALL USING (auth.uid() = user_id);
