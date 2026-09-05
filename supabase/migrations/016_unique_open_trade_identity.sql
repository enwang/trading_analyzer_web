DROP INDEX IF EXISTS trades_dedup;

CREATE UNIQUE INDEX trades_dedup
ON trades(user_id, symbol, entry_time, exit_time)
NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS trades_open_identity_dedup
ON trades(user_id, symbol, entry_time)
WHERE exit_time IS NULL;
