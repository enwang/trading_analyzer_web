import { createClient } from '@supabase/supabase-js'
import { fetchFlexAll } from '@/lib/ibkr/flex'
import { enrichOpenTradesWithStopLosses } from '@/lib/market/stop-loss'
import { createTradeSnapshot, pruneOldSnapshots } from '@/lib/trade-snapshots'
import { filterOutHidden, loadHiddenTradeKeys } from '@/lib/hidden-trades'
import { NextResponse } from 'next/server'

type Leg = { action?: string; shares?: number; price?: number }

function parseLegs(legs: unknown): Leg[] | null {
  if (!Array.isArray(legs) || legs.length === 0) return null
  return legs.filter((l): l is Leg => !!l && typeof l === 'object')
}

function computeOpenSharesFromLegs(legs: unknown): number | null {
  const parsed = parseLegs(legs)
  if (!parsed) return null
  let net = 0
  for (const leg of parsed) {
    if (typeof leg.shares !== 'number') continue
    if (leg.action === 'BUY') net += leg.shares
    else if (leg.action === 'SELL') net -= leg.shares
  }
  return Math.abs(net)
}

// Realized P&L from partial closes, assuming a long position with weighted-avg buy basis
function computeRealizedPnlFromLegs(legs: unknown): number | null {
  const parsed = parseLegs(legs)
  if (!parsed) return null
  let totalBuyShares = 0
  let totalBuyCost = 0
  for (const leg of parsed) {
    if (leg.action !== 'BUY' || typeof leg.shares !== 'number' || typeof leg.price !== 'number') continue
    totalBuyShares += leg.shares
    totalBuyCost += leg.shares * leg.price
  }
  if (totalBuyShares <= 0) return null
  const avgBuy = totalBuyCost / totalBuyShares
  let pnl = 0
  for (const leg of parsed) {
    if (leg.action !== 'SELL' || typeof leg.shares !== 'number' || typeof leg.price !== 'number') continue
    pnl += (leg.price - avgBuy) * leg.shares
  }
  return pnl
}

type UpsertRow = {
  user_id: string
  symbol: string
  entry_time: string | null
  exit_time: string | null
  side: string | null
  setup_tag: string
  notes?: string | null
  needs_review?: boolean | null
  stop_loss?: number | null
  r_multiple?: number | null
} & Record<string, unknown>

export async function GET(request: Request) {
  // Vercel sends Authorization: Bearer <CRON_SECRET> on scheduled invocations
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service role bypasses RLS so we can read all users' settings
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: settings, error } = await supabase
    .from('user_settings')
    .select('user_id, ibkr_token, ibkr_query_id, ibkr_today_complete_date')
    .not('ibkr_token', 'is', null)
    .not('ibkr_query_id', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const todayPt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const ptHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  )
  // After 4 AM PT, treat the prior trading day as complete even if we never
  // saw any rows (no-trade days, holidays, etc.) so we stop hourly retries.
  const giveUp = ptHour >= 4 && ptHour < 17

  const results = []

  for (const s of settings ?? []) {
    try {
      if (s.ibkr_today_complete_date === todayPt) {
        results.push({ user_id: s.user_id, skipped: 'today already complete' })
        continue
      }

      const snapshot = await createTradeSnapshot(supabase, s.user_id, {
        label: `Before scheduled sync ${new Date().toISOString()}`,
        reason: 'ibkr-sync',
      })
      await pruneOldSnapshots(supabase, s.user_id)
      const { trades, navDaily, navChange, cashTransactions } = await fetchFlexAll(s.ibkr_token, s.ibkr_query_id)

      if (navDaily.length > 0) {
        await supabase.from('account_nav_daily').upsert(
          navDaily.map((r) => ({ ...r, user_id: s.user_id })),
          { onConflict: 'user_id,report_date' }
        )
      }
      if (navChange.length > 0) {
        await supabase.from('account_nav_change').upsert(
          navChange.map((r) => ({ ...r, user_id: s.user_id })),
          { onConflict: 'user_id,from_date,to_date' }
        )
      }
      if (cashTransactions.length > 0) {
        await supabase.from('account_cash_transactions').upsert(
          cashTransactions.map((r) => ({ ...r, user_id: s.user_id })),
          { onConflict: 'user_id,transaction_ts,amount' }
        )
      }

      let upserted = 0
      if (trades.length) {
        let rows: UpsertRow[] = trades.map(t => ({ ...t, user_id: s.user_id, needs_review: false }))
        const touchedSymbols = [...new Set(rows.map(r => r.symbol))]

        const hiddenKeys = await loadHiddenTradeKeys(supabase, s.user_id, touchedSymbols)
        rows = filterOutHidden(rows, hiddenKeys)

        if (touchedSymbols.length > 0) {
          const normalizeTs = (t: string | null | undefined) => t ? t.slice(0, 19) : ''

          // Fetch ALL existing trades (open and closed) to preserve manual fields
          const { data: existingRows } = await supabase
            .from('trades')
            .select('symbol, entry_time, exit_time, side, stop_loss, stop_loss_locked, r_multiple, setup_tag, notes, needs_review, execution_legs, pnl, initial_risk_amount')
            .eq('user_id', s.user_id)
            .in('symbol', touchedSymbols)

          type ExistingRow = { symbol: string; entry_time: string | null; exit_time: string | null; side: string | null; stop_loss: number | null; stop_loss_locked: boolean | null; r_multiple: number | null; setup_tag: string | null; notes: string | null; needs_review: boolean | null; execution_legs: unknown | null; pnl: number | null; initial_risk_amount: number | null }
          const openRowsBySymbol = new Map<string, ExistingRow[]>()
          for (const existing of existingRows ?? []) {
            if (existing.exit_time != null) continue
            const list = openRowsBySymbol.get(existing.symbol) ?? []
            list.push(existing)
            openRowsBySymbol.set(existing.symbol, list)
          }

          // Closed trades: keyed by symbol|entry_time|exit_time.
          // Open trades: keyed by symbol|entry_time so add-on lots can keep separate metadata.
          const byKey = new Map<string, ExistingRow>(
            (existingRows ?? []).map((r) => {
              const key = r.exit_time
                ? `${r.symbol}|${normalizeTs(r.entry_time)}|${normalizeTs(r.exit_time)}`
                : `${r.symbol}|${normalizeTs(r.entry_time)}`
              return [key, r] as const
            })
          )

          for (const row of rows) {
            const key = row.exit_time
              ? `${row.symbol}|${normalizeTs(row.entry_time)}|${normalizeTs(row.exit_time)}`
              : `${row.symbol}|${normalizeTs(row.entry_time)}`
            const exactExisting = byKey.get(key)
            const symbolOpenRows = openRowsBySymbol.get(row.symbol) ?? []
            const existing = exactExisting ?? (row.exit_time == null && symbolOpenRows.length === 1 ? symbolOpenRows[0] : null)
            if (!existing) continue
            if (row.setup_tag === 'untagged' && existing.setup_tag) row.setup_tag = existing.setup_tag
            if (!row.notes && existing.notes) row.notes = existing.notes
            if (!row.needs_review && existing.needs_review) row.needs_review = existing.needs_review
            if (row.stop_loss == null && existing.stop_loss != null) row.stop_loss = existing.stop_loss
            if (existing.stop_loss_locked) row.stop_loss_locked = true
            if (row.r_multiple == null && existing.r_multiple != null) row.r_multiple = existing.r_multiple
            if ((row as Record<string, unknown>).initial_risk_amount == null && existing.initial_risk_amount != null) {
              (row as Record<string, unknown>).initial_risk_amount = existing.initial_risk_amount
            }
            // Preserve manually-corrected execution_legs (and derived shares/pnl) for trades flagged for review or with notes
            if ((existing.needs_review || existing.notes) && existing.execution_legs != null) {
              row.execution_legs = existing.execution_legs
              row.shares = computeOpenSharesFromLegs(existing.execution_legs) ?? row.shares
              if (row.exit_time == null) {
                const realized = computeRealizedPnlFromLegs(existing.execution_legs)
                if (realized != null) row.pnl = realized
              }
            }
          }

          // Pass existing DB rows as context so add-on detection sees all open trades,
          // not just those returned in the current IBKR sync window.
          const rowEntryKeys = new Set(rows.filter(r => r.exit_time == null).map(r => `${r.symbol}|${normalizeTs(r.entry_time)}`))
          const contextRows = (existingRows ?? []).filter(r =>
            r.exit_time == null && !rowEntryKeys.has(`${r.symbol}|${normalizeTs(r.entry_time)}`)
          )
          const enrichedRows = await enrichOpenTradesWithStopLosses(rows, contextRows)
          rows.splice(0, rows.length, ...enrichedRows)

          // Delete open rows for symbols with new open data OR symbols that just closed.
          const symbolsWithNewOpenSet = new Set(rows.filter(r => r.exit_time == null).map(r => r.symbol))
          const symbolsWithExistingOpen = new Set((existingRows ?? []).filter(r => r.exit_time == null).map(r => r.symbol))
          const symbolsThatJustClosed = [...new Set(
            rows.filter(r => r.exit_time != null && symbolsWithExistingOpen.has(r.symbol) && !symbolsWithNewOpenSet.has(r.symbol)).map(r => r.symbol)
          )]
          const symbolsToDeleteOpen = [...new Set([...symbolsWithNewOpenSet, ...symbolsThatJustClosed])]
          if (symbolsToDeleteOpen.length > 0) {
            await supabase
              .from('trades')
              .delete()
              .eq('user_id', s.user_id)
              .is('exit_time', null)
              .in('symbol', symbolsToDeleteOpen)
          }
        }

        const { data, error: upsertErr } = await supabase
          .from('trades')
          .upsert(rows, { onConflict: 'user_id,symbol,entry_time,exit_time', ignoreDuplicates: false })
          .select('id')

        if (upsertErr) throw new Error(upsertErr.message)
        upserted = data?.length ?? 0
      }

      const tradeDateInPt = (iso: string | null | undefined) =>
        iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) : null
      const sawTodayData = trades.some(
        (t) => tradeDateInPt(t.entry_time) === todayPt || tradeDateInPt(t.exit_time) === todayPt
      )
      const completeForToday = sawTodayData || giveUp

      const settingsUpdate: Record<string, unknown> = {
        ibkr_last_sync: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      }
      if (completeForToday) settingsUpdate.ibkr_today_complete_date = todayPt
      await supabase
        .from('user_settings')
        .update(settingsUpdate)
        .eq('user_id', s.user_id)

      results.push({
        user_id: s.user_id,
        upserted,
        skipped: trades.length - upserted,
        snapshotId: snapshot?.id ?? null,
        completeForToday,
        sawTodayData,
      })
    } catch (e) {
      results.push({
        user_id: s.user_id,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}
