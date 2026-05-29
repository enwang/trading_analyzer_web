import { createClient } from '@/lib/supabase/server'
import { fetchFlexAll } from '@/lib/ibkr/flex'
import { enrichOpenTradesWithStopLosses } from '@/lib/market/stop-loss'
import { createTradeSnapshot } from '@/lib/trade-snapshots'
import { filterOutHidden, loadHiddenTradeKeys } from '@/lib/hidden-trades'
import { NextRequest, NextResponse } from 'next/server'

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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const token: string = body.token?.trim()
    const queryId: string = body.queryId?.trim()

    if (!token || !queryId) {
      return NextResponse.json(
        { error: 'Missing token or queryId' },
        { status: 400 }
      )
    }

    const snapshot = await createTradeSnapshot(supabase, user.id, {
      label: `Before IBKR sync ${new Date().toISOString()}`,
      reason: 'ibkr-sync',
    })

    const { trades, navDaily, navChange } = await fetchFlexAll(token, queryId)

    if (navDaily.length > 0) {
      await supabase.from('account_nav_daily').upsert(
        navDaily.map((r) => ({ ...r, user_id: user.id })),
        { onConflict: 'user_id,report_date' }
      )
    }
    if (navChange.length > 0) {
      await supabase.from('account_nav_change').upsert(
        navChange.map((r) => ({ ...r, user_id: user.id })),
        { onConflict: 'user_id,from_date,to_date' }
      )
    }

    if (!trades.length) {
      return NextResponse.json({
        upserted: 0,
        skipped: 0,
        navDaily: navDaily.length,
        navChange: navChange.length,
        snapshotId: snapshot?.id ?? null,
      })
    }

    let rows: UpsertRow[] = trades.map(t => ({ ...t, user_id: user.id, needs_review: false }))
    const touchedSymbols = [...new Set(rows.map(r => r.symbol))]

    const hiddenKeys = await loadHiddenTradeKeys(supabase, user.id, touchedSymbols)
    rows = filterOutHidden(rows, hiddenKeys)

    if (touchedSymbols.length > 0) {
      const normalizeTs = (t: string | null | undefined) => t ? t.slice(0, 19) : ''

      // Fetch ALL existing trades (open and closed) to preserve manual fields
      const { data: existingRows } = await supabase
        .from('trades')
        .select('symbol, entry_time, exit_time, stop_loss, r_multiple, setup_tag, notes, needs_review, execution_legs')
        .eq('user_id', user.id)
        .in('symbol', touchedSymbols)

      type ExistingRow = { symbol: string; entry_time: string | null; exit_time: string | null; stop_loss: number | null; r_multiple: number | null; setup_tag: string | null; notes: string | null; needs_review: boolean | null; execution_legs: unknown | null }
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
        if (row.r_multiple == null && existing.r_multiple != null) row.r_multiple = existing.r_multiple
        // Preserve manually-corrected execution_legs (and derived shares/pnl) only for trades explicitly flagged for review.
        // Notes alone do not indicate manual leg correction — they are user observations.
        if (existing.needs_review && existing.execution_legs != null) {
          row.execution_legs = existing.execution_legs
          row.shares = computeOpenSharesFromLegs(existing.execution_legs) ?? row.shares
          if (row.exit_time == null) {
            const realized = computeRealizedPnlFromLegs(existing.execution_legs)
            if (realized != null) row.pnl = realized
          }
        }
      }

      const enrichedRows = await enrichOpenTradesWithStopLosses(rows)
      rows.splice(0, rows.length, ...enrichedRows)

      // Delete open rows for:
      // 1. Symbols with a new incoming open position (refresh with latest data)
      // 2. Symbols that had an existing open row AND just got a close but no new open position
      //    (the position closed — e.g. GSAT closed as breakeven)
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
          .eq('user_id', user.id)
          .is('exit_time', null)
          .in('symbol', symbolsToDeleteOpen)
      }
    }

    const { error, data } = await supabase
      .from('trades')
      .upsert(rows, { onConflict: 'user_id,symbol,entry_time,exit_time', ignoreDuplicates: false })
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const upserted = data?.length ?? 0
    const skipped = trades.length - upserted

    // Update last sync date
    await supabase.from('user_settings').upsert(
      {
        user_id: user.id,
        ibkr_token: token,
        ibkr_query_id: queryId,
        ibkr_last_sync: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    return NextResponse.json({ upserted, skipped, snapshotId: snapshot?.id ?? null })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
