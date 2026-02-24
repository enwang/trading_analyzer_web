-- Replace partial unique index with a full unique index.
-- Rationale: partial indexes (WHERE clause) cannot be referenced by name in ON CONFLICT,
-- and PostgREST requires a non-partial index to honour `on_conflict` column resolution.
-- PostgreSQL treats NULL as DISTINCT in unique indexes, so open trades (exit_time IS NULL)
-- will never conflict with each other — the WHERE guard was redundant.

DROP INDEX IF EXISTS trades_dedup;

CREATE UNIQUE INDEX trades_dedup ON trades(user_id, symbol, exit_time, pnl);
