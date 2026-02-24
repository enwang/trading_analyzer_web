-- Replace dedup key based on pnl with stable trade identity key.
-- Rationale: pnl can change when parser logic changes (e.g., FIFO -> fill-based),
-- so using pnl in unique index prevents updates and leaves stale rows.

DROP INDEX IF EXISTS trades_dedup;

CREATE UNIQUE INDEX trades_dedup
ON trades(user_id, symbol, entry_time, exit_time);
