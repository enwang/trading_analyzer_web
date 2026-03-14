-- Add MFE/MAE columns for trade excursion analysis
ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe NUMERIC;  -- Maximum Favorable Excursion ($)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS mae NUMERIC;  -- Maximum Adverse Excursion ($)
