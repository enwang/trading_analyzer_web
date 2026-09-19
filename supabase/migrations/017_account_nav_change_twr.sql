-- IBKR's official time-weighted return from the Change in NAV Flex section.
ALTER TABLE account_nav_change
ADD COLUMN IF NOT EXISTS twr NUMERIC;
