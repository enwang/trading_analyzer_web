# Claude Code — Project Rules

## Trade Parser: Always Test Against mytrade.csv

**Trades are the most critical data in this app. Any change to `lib/ibkr/flex.ts` MUST be verified against `mytrade.csv` before being considered correct.**

Run this verification before every parser change:
```bash
node debug-dupes.mjs           # check for duplicate dedup keys
node -e "                      # quick group simulation (see scripts below)
```

### Known-good expected output (as of 2026-02-23)

| Symbol | Expected rows | Notes |
|--------|--------------|-------|
| MRNA | 1 closed (1600 shares) | 1 buy Jan 28, sells Jan 29 + Jan 30 — multi-day unwind = 1 trade |
| TTMI | 1 closed (800 shares) | 1 buy Jan 26, sells Jan 27/28/Feb2/Feb5 — 1 trade |
| ASML | 1 open (30 shares) | 50 sold Feb 5, 30 still open — suppress closed partial |
| CRS | 1 open (100 shares) | 20 sold Feb 13, 100 still open — suppress closed partial |
| HSAI | 1 open (500 shares) | 500 sold, 500 still open — suppress closed partial |
| GDS | 1 open (1500 shares) | Never sold, fully open |
| GOOG | 2 closed (400 each) | Jan-2 position group + Feb-12 day trade |

### Key design decisions (do not revert without testing)

1. **Merge key: `symbol|entryDate`** — Groups all C-rows for the same position together, regardless of how many exit days there are. Exit date in the key would split multi-day position unwinds incorrectly.

2. **`appendOpenPositions` partial-close**: Adds a NEW open row (does NOT modify existing closed trades). Preserves the closed trade's P&L record.

3. **Dedup index is non-partial** (`supabase/migrations/002_fix_dedup_index.sql`): Replaced `WHERE exit_time IS NOT NULL` partial index with a full unique index so `onConflict` can be specified in upsert calls.

4. **Upsert uses explicit `onConflict`**: `.upsert(rows, { onConflict: 'user_id,symbol,exit_time,pnl', ignoreDuplicates: true })`

## After Parser Fixes: Delete Stale DB Rows

When the parser logic changes (different merge keys = different pnl values per row), old rows from previous syncs stay in the DB because their dedup keys differ. Always tell the user to delete all trades and re-sync after a parser fix:

```sql
-- Run in Supabase SQL Editor
DELETE FROM trades WHERE user_id = '<user_id>';
```

## Stack

- Next.js 15 (App Router) + TypeScript
- Supabase (auth + Postgres DB)
- Deployed on Vercel (Hobby plan)
- IBKR Flex Query as trade data source (CSV format, primary path)
