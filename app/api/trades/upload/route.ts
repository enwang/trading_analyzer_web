import { createClient } from '@/lib/supabase/server'
import { parseFlexCsv } from '@/lib/ibkr/flex'
import { enrichOpenTradesWithStopLosses } from '@/lib/market/stop-loss'
import { createTradeSnapshot } from '@/lib/trade-snapshots'
import { NextRequest, NextResponse } from 'next/server'

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

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const csvText = await file.text()
    const snapshot = await createTradeSnapshot(supabase, user.id, {
      label: `Before CSV upload ${new Date().toISOString()}`,
      reason: 'csv-upload',
    })
    const trades = parseFlexCsv(csvText)

    if (!trades.length) {
      return NextResponse.json({ upserted: 0, skipped: 0, snapshotId: snapshot?.id ?? null })
    }

    const rows: UpsertRow[] = trades.map(t => ({ ...t, user_id: user.id, needs_review: false }))

    const touchedSymbols = [...new Set(rows.map(r => r.symbol))]
    if (touchedSymbols.length > 0) {
      const normalizeTs = (t: string | null | undefined) => t ? t.slice(0, 19) : ''

      // Fetch ALL existing trades for touched symbols (open and closed) to preserve manual fields
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
        // Preserve manually-corrected execution_legs for trades flagged for review or with notes
        if ((existing.needs_review || existing.notes) && existing.execution_legs != null) {
          row.execution_legs = existing.execution_legs
        }
      }

      const enrichedRows = await enrichOpenTradesWithStopLosses(rows)
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

    return NextResponse.json({ upserted, skipped, snapshotId: snapshot?.id ?? null })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
