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

**Seen:** GOOG showing $316.41 when user bought at $314.62.

**Root cause:** Entry price was derived from `CostBasis / shares` on the **C-row**. `CostBasis` on a C-row reflects which **historical FIFO lot was consumed**, not the price of the current position. When you hold pre-2026 GOOG lots (at e.g. $320–$324, outside this Flex query's date range), IBKR FIFO consumes those oldest lots first on every sale — even when you've since opened and closed a separate position at $314.62. The Jan-9/Jan-20/Feb-5 C-rows used pre-2026 lots at $320.46; the Feb-12 C-rows used pre-2026 lots at $324.15 and $315.55, giving a weighted avg of $316.41 instead of $314.62. The fact that the Jan-2 position was fully closed by Feb-5 is irrelevant — the pre-2026 lots are what's driving the discrepancy.

**Fix:** Build `openPriceMap` from O-rows (`TradePrice` × `Quantity`) and use it to override `entry_price` after `mergePartialFills`. Fall back to CostBasis only if no matching O-row is found.
```ts
// In parseCsv — accumulate actual fill price from O-rows
const fillPrice = parseNum(col(row, 't. price', 'tradeprice', 'price')) ?? 0
const existing = openPriceMap.get(mapKey) ?? { totalShares: 0, totalCost: 0 }
existing.totalShares += qty
existing.totalCost += fillPrice * qty
openPriceMap.set(mapKey, existing)

// After mergePartialFills — override with O-row weighted avg
const oPrice = openPriceMap.get(`${t.symbol}|${entryDate}`)
if (oPrice && oPrice.totalShares > 0) {
  t.entry_price = oPrice.totalCost / oPrice.totalShares
  t.pnl_pct = ...
}
```
Verified: GOOG Feb-12 now shows $314.62.
