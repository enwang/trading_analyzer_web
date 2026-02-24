# Debugging Notes

Recurring issues found more than once. One-time mistakes are not tracked here.

---

## IBKR Sync Returns 0 Trades

**Seen:** Multiple times with different root causes.

### Cause A: Partial unique index breaks both `onConflict` and `ignoreDuplicates`
Two interacting problems:
1. Specifying `onConflict: 'user_id,symbol,exit_time,pnl'` on a **partial** index (`WHERE exit_time IS NOT NULL`) raises `there is no unique or exclusion constraint matching the ON CONFLICT specification`.
2. Omitting `onConflict` makes PostgREST fall back to the **primary key** (`id`) as the conflict target. Since `id` is a random UUID, the dedup index is never consulted → re-syncing inserts duplicate rows → `duplicate key value violates unique constraint 'trades_dedup'`.

**Fix:** Replace the partial index with a full unique index (PostgreSQL treats NULL as distinct, so open trades with `exit_time IS NULL` still never conflict), then specify `onConflict` explicitly.

Migration (`002_fix_dedup_index.sql`):
```sql
DROP INDEX IF EXISTS trades_dedup;
CREATE UNIQUE INDEX trades_dedup ON trades(user_id, symbol, exit_time, pnl);
```

Upsert:
```ts
.upsert(rows, { onConflict: 'user_id,symbol,exit_time,pnl', ignoreDuplicates: true })
```

### Cause B: IBKR Flex "Warn" status returns status XML, not trade data
When IBKR returns `<Status>Warn</Status>`, the response body is a status envelope, not the actual `<FlexStatements>` data. Must fetch the data URL from the `<Url>` tag inside the Warn response.

**Fix:** On Warn status, extract `<Url>` and re-fetch from it. Only return if response starts with `<FlexStatements` or `<FlexQueryResponse`, otherwise keep polling.

---

## Trades Merged Incorrectly (Wrong Trade Count)

**Seen:** Multiple GOOG trades across different dates collapsed into one row.

**Root cause:** `mergePartialFills` grouped by `symbol|entry_time` only. When `OpenDateTime` is empty in the IBKR CSV, all C-rows for the same symbol fall back to the same O-row date as their `entry_time`, causing unrelated trades to be merged.

**Fix:** Group by `symbol|entryDate` (date portion of entry_time, no exit date).
All C-rows for the same position share the same O-row fallback entry date, even when the position is unwound over multiple exit days. Using exit date instead incorrectly splits a multi-day unwind into N separate rows.
Verified with mytrade.csv: MRNA (1 buy → 2 exit days → 1 row), TTMI (1 buy → 4 exit days → 1 row).
```ts
const entryDate = t.entry_time?.slice(0, 10) ?? 'unknown'
const pk = `${t.symbol}|${entryDate}`
```

**Also:** `appendOpenPositions` partial-close branch was converting a C-row into an "open" row (corrupting the closed trade and losing P&L data). Fix: keep all C-rows as closed trades and push a *new* open row with the remaining share count and weighted-average entry price from the O-rows.

---

## Entry Price Shows Higher Than Expected

**Seen:** GOOG showing $316 when user bought at $314.62.

**Explanation (not a bug):** Entry price is derived from `CostBasis / shares` from the IBKR Flex C-row. `CostBasis` reflects IBKR's **FIFO cost** — if the user holds pre-2026 lots at a higher price, those get consumed first, making the blended entry price higher than the most recent purchase.

This is technically correct for P&L and tax purposes. The discrepancy is expected when the user has older lots not visible in the Flex query date range.
