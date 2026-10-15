import { scheduleTradeBackup } from '@/lib/trade-backup'
import { createClient } from '@/lib/supabase/server'
import { fetchFlexAll } from '@/lib/ibkr/flex'
import { preservedPriceScaleForKnownSplit, scalePreservedPrice } from '@/lib/ibkr/stock-splits'
import { createTradeSnapshot, loadLatestTradeSnapshot, loadTradeSnapshotRows } from '@/lib/trade-snapshots'
import { filterOutHidden, loadHiddenTradeKeys } from '@/lib/hidden-trades'
import { usesStopLossFirstSizing } from '@/lib/market/stop-loss'
import { NextRequest, NextResponse } from 'next/server'

type Leg = { action?: string; shares?: number; price?: number; time?: string }

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
  current_stop_loss?: number | null
  r_multiple?: number | null
} & Record<string, unknown>

export async function POST(request: NextRequest) {
  const started = performance.now()
  const timings: Record<string, number> = {}
  async function timed<T>(name: string, task: () => PromiseLike<T>): Promise<T> {
    const start = performance.now()
    try { return await task() }
    finally { timings[name] = (timings[name] ?? 0) + Math.round(performance.now() - start) }
  }
  function respond(body: Record<string, unknown>, status = 200) {
    timings.total = Math.round(performance.now() - started)
    return NextResponse.json({ ...body, timings }, {
      status,
      headers: { 'Server-Timing': Object.entries(timings).map(([name, ms]) => `${name};dur=${ms}`).join(', ') },
    })
  }
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await timed('auth', () => supabase.auth.getUser())

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    let token = typeof body.token === 'string' ? body.token.trim() : ''
    let queryId = typeof body.queryId === 'string' ? body.queryId.trim() : ''
    if (body.token == null && body.queryId == null) {
      const { data: settings, error: settingsError } = await timed('settings', () => supabase
        .from('user_settings')
        .select('ibkr_token, ibkr_query_id')
        .eq('user_id', user.id)
        .single())
      if (settingsError && settingsError.code !== 'PGRST116') throw settingsError
      token = settings?.ibkr_token?.trim() ?? ''
      queryId = settings?.ibkr_query_id?.trim() ?? ''
    }

    if (!token || !queryId) {
      return NextResponse.json(
        { error: body.token == null && body.queryId == null
          ? 'Save IBKR Flex credentials in Import first'
          : 'Missing token or queryId' },
        { status: 400 }
      )
    }

    // Fetching the broker report does not mutate website trades. Both tasks can
    // run together, but the backup must finish before any trade writes start.
    const [{ snapshot, existingRows }, { trades, navDaily, navChange, cashTransactions }] = await Promise.all([
      timed('snapshot', async () => {
        const [existingRows, latestSnapshot] = await Promise.all([
          timed('existing', () => loadTradeSnapshotRows(supabase, user.id)),
          timed('snapshot_lookup', () => loadLatestTradeSnapshot(supabase, user.id)),
        ])
        const snapshot = await timed('snapshot_write', () => createTradeSnapshot(supabase, user.id, {
          label: `Before IBKR sync ${new Date().toISOString()}`,
          reason: 'ibkr-sync',
          trades: existingRows,
          reuseIfUnchanged: true,
          latestSnapshot,
        }))
        return { snapshot, existingRows }
      }),
      timed('broker', () => fetchFlexAll(token, queryId, (name, ms) => { timings[name] = ms })),
    ])
    const touchedSymbols = [...new Set(trades.map(r => r.symbol))]
    // Independent tables and the hidden-trade lookup run concurrently.
    const [hiddenKeys] = await Promise.all([
      timed('hidden', () => loadHiddenTradeKeys(supabase, user.id, touchedSymbols)),
      navDaily.length > 0 ? timed('nav_daily', () => supabase.from('account_nav_daily').upsert(
        navDaily.map(r => ({ ...r, user_id: user.id })),
        { onConflict: 'user_id,report_date' }
      ).throwOnError()) : Promise.resolve(),
      navChange.length > 0 ? timed('nav_change', () => supabase.from('account_nav_change').upsert(
        navChange.map(r => ({ ...r, user_id: user.id })),
        { onConflict: 'user_id,from_date,to_date' }
      ).throwOnError()) : Promise.resolve(),
      cashTransactions.length > 0 ? timed('cash', () => supabase.from('account_cash_transactions').upsert(
        cashTransactions.map(r => ({ ...r, user_id: user.id })),
        { onConflict: 'user_id,transaction_ts,amount' }
      ).throwOnError()) : Promise.resolve(),
    ])

    if (!trades.length) {
      return respond({
        userId: user.id,
        upserted: 0,
        skipped: 0,
        navDaily: navDaily.length,
        navChange: navChange.length,
        snapshotId: snapshot?.id ?? null,
        snapshotReused: snapshot?.reused ?? false,
      })
    }

    let rows: UpsertRow[] = trades.map(t => ({ ...t, user_id: user.id, needs_review: false, stop_loss_locked: false }))
    rows = filterOutHidden(rows, hiddenKeys)

    if (touchedSymbols.length > 0) {
      const normalizeTs = (t: string | null | undefined) => t ? t.slice(0, 19) : ''

      // Reuse the pre-write snapshot rows to preserve manual fields.
      type ExistingRow = (typeof existingRows)[number]
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
        const existing = exactExisting ?? null
        if (row.exit_time != null) row.current_stop_loss = null
        if (!existing) continue
        const preservedPriceScale = preservedPriceScaleForKnownSplit({
          symbol: row.symbol,
          entryTime: row.entry_time,
          existingEntryPrice: existing.entry_price,
          incomingEntryPrice: typeof row.entry_price === 'number' ? row.entry_price : null,
        })
        if (row.setup_tag === 'untagged' && existing.setup_tag) row.setup_tag = existing.setup_tag
        if (!row.notes && existing.notes) row.notes = existing.notes
        if (!row.needs_review && existing.needs_review) row.needs_review = existing.needs_review
        if (row.stop_loss == null && existing.stop_loss != null) row.stop_loss = scalePreservedPrice(existing.stop_loss, preservedPriceScale)
        if (row.exit_time == null && row.current_stop_loss == null && existing.current_stop_loss != null) {
          row.current_stop_loss = scalePreservedPrice(existing.current_stop_loss, preservedPriceScale)
        }
        if (existing.stop_loss_locked) row.stop_loss_locked = true
        if ((row as Record<string, unknown>).initial_risk_amount == null && existing.initial_risk_amount != null) {
          (row as Record<string, unknown>).initial_risk_amount = existing.initial_risk_amount
        }
        if (row.r_multiple == null && existing.r_multiple != null) row.r_multiple = existing.r_multiple
        // Parser legs are authoritative because they are split-adjusted by default.
        // Preserve old manual legs only when the incoming parser row has no legs.
        if (existing.needs_review && existing.execution_legs != null && !row.execution_legs) {
          const dbLegs = parseLegs(existing.execution_legs) ?? []
          const newLegs = parseLegs(row.execution_legs) ?? []
          const dbLegKeys = new Set(dbLegs.map(l => `${l.time}|${l.action}|${l.shares}`))
          const addedLegs = newLegs.filter(
            l => l.action === 'SELL' && !dbLegKeys.has(`${l.time}|${l.action}|${l.shares}`)
          )
          const mergedLegs = addedLegs.length > 0
            ? [...dbLegs, ...addedLegs].sort((a, b) =>
                ((a as { time?: string }).time ?? '') < ((b as { time?: string }).time ?? '') ? -1 : 1
              )
            : dbLegs
          row.execution_legs = mergedLegs
          row.shares = computeOpenSharesFromLegs(mergedLegs) ?? row.shares
          if (row.exit_time == null) {
            const realized = computeRealizedPnlFromLegs(mergedLegs)
            if (realized != null) row.pnl = realized
          }
        }
      }

      // Fallback: if key-matching above didn't copy stop_loss (key mismatch), look for
      // an open DB row for the symbol that has a stop_loss and use it.
      // stop_loss is treated like notes — it's always manually set, never computed.
      // For closed incoming rows, only use this fallback when there is one
      // existing open row for the symbol; closing a position replaces that row.
      // New stop-loss-first trades must also match the open row's entry_time;
      // otherwise an older open position for the same symbol can leak a stale risk.
      for (const row of rows) {
        const rowRecord = row as Record<string, unknown>
        const openSymbolRows = openRowsBySymbol.get(row.symbol) ?? []
        const candidateOpenRows = usesStopLossFirstSizing(row.entry_time)
          ? openSymbolRows.filter(r => normalizeTs(r.entry_time) === normalizeTs(row.entry_time))
          : openSymbolRows
        if (row.exit_time != null && candidateOpenRows.length !== 1) continue
        const rowWithStopLoss = rowRecord.stop_loss == null
          ? candidateOpenRows.find(r => r.stop_loss != null)
          : null
        if (rowWithStopLoss != null) {
          const preservedPriceScale = preservedPriceScaleForKnownSplit({
            symbol: row.symbol,
            entryTime: row.entry_time,
            existingEntryPrice: rowWithStopLoss.entry_price,
            incomingEntryPrice: typeof row.entry_price === 'number' ? row.entry_price : null,
          })
          rowRecord.stop_loss = scalePreservedPrice(rowWithStopLoss.stop_loss ?? null, preservedPriceScale)
          if (rowWithStopLoss.stop_loss_locked) {
            rowRecord.stop_loss_locked = true
          }
          if (rowRecord.initial_risk_amount == null && rowWithStopLoss.initial_risk_amount != null) {
            rowRecord.initial_risk_amount = rowWithStopLoss.initial_risk_amount
          }
        }
        if (row.exit_time == null) {
          const rowWithCurrentStopLoss = rowRecord.current_stop_loss == null
            ? candidateOpenRows.find(r => r.current_stop_loss != null)
            : null
          if (rowWithCurrentStopLoss != null) {
            const preservedPriceScale = preservedPriceScaleForKnownSplit({
              symbol: row.symbol,
              entryTime: row.entry_time,
              existingEntryPrice: rowWithCurrentStopLoss.entry_price,
              incomingEntryPrice: typeof row.entry_price === 'number' ? row.entry_price : null,
            })
            rowRecord.current_stop_loss = scalePreservedPrice(rowWithCurrentStopLoss.current_stop_loss ?? null, preservedPriceScale)
          }
        }
      }

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

      // Clean up stale partial-exit rows: for each incoming open position, delete any
      // existing closed row that shares the same entry_time. These arise when a previous
      // sync had the parser bug (unsorted C-rows), which caused partial exits to be
      // recorded as separate closed rows instead of being absorbed into the open trade.
      // Batched to one delete per symbol (entry_time IN (...)) instead of one per open
      // row — the row sets are disjoint from delete_open (closed vs open), so both run
      // concurrently.
      const entryTimesBySymbol = new Map<string, string[]>()
      for (const openRow of rows.filter(r => r.exit_time == null && r.entry_time)) {
        const symbol = openRow.symbol as string
        const entryTime = openRow.entry_time as string
        const list = entryTimesBySymbol.get(symbol) ?? []
        if (!list.includes(entryTime)) list.push(entryTime)
        entryTimesBySymbol.set(symbol, list)
      }

      await Promise.all([
        symbolsToDeleteOpen.length > 0
          ? timed('delete_open', () => supabase
              .from('trades')
              .delete()
              .eq('user_id', user.id)
              .is('exit_time', null)
              .in('symbol', symbolsToDeleteOpen))
          : Promise.resolve(),
        ...[...entryTimesBySymbol.entries()].map(([symbol, entryTimes]) =>
          timed('delete_partial', () => supabase
            .from('trades')
            .delete()
            .eq('user_id', user.id)
            .eq('symbol', symbol)
            .in('entry_time', entryTimes)
            .not('exit_time', 'is', null))
        ),
      ])
    }

    const { error, data } = await timed('trades_write', () => supabase
      .from('trades')
      .upsert(rows, { onConflict: 'user_id,symbol,entry_time,exit_time', ignoreDuplicates: false })
      .select('id'))
    if (error) return respond({ error: error.message }, 500)
    const upserted = data?.length ?? 0
    const skipped = trades.length - upserted

    await timed('settings_write', () => supabase.from('user_settings').upsert(
      {
        user_id: user.id,
        ibkr_token: token,
        ibkr_query_id: queryId,
        ibkr_last_sync: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    ).throwOnError())

    scheduleTradeBackup(supabase, user.id)
    return respond({ userId: user.id, upserted, skipped, snapshotId: snapshot?.id ?? null, snapshotReused: snapshot?.reused ?? false })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return respond({ error: msg }, 500)
  }
}
