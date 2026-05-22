-- DB-level enforcement of hidden_trades.
-- The app-level filterOutHidden can be bypassed in edge cases (e.g. the IBKR
-- manual-fetch route generating an open lot that matches a hidden entry).
-- This trigger silently drops any INSERT into trades that matches a row in
-- hidden_trades, making deletions bulletproof regardless of app code.

CREATE OR REPLACE FUNCTION fn_block_hidden_trades()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM hidden_trades h
    WHERE h.user_id    = NEW.user_id
      AND h.symbol     = NEW.symbol
      AND h.entry_time = NEW.entry_time
      AND (
        (h.exit_time IS NULL AND NEW.exit_time IS NULL)
        OR h.exit_time = NEW.exit_time
      )
  ) THEN
    RETURN NULL;  -- silently drop the insert
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_hidden_trades ON trades;
CREATE TRIGGER trg_block_hidden_trades
  BEFORE INSERT ON trades
  FOR EACH ROW EXECUTE FUNCTION fn_block_hidden_trades();
