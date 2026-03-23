import { createClient } from '@/lib/supabase/server'
import { parseFlexCsv } from '@/lib/ibkr/flex'
import { enrichOpenTradesWithStopLosses } from '@/lib/market/stop-loss'
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
    const trades = parseFlexCsv(csvText)

    if (!trades.length) {
      return NextResponse.json({ upserted: 0, skipped: 0 })
    }

    const rows: UpsertRow[] = trades.map(t => ({ ...t, user_id: user.id }))

    const touchedSymbols = [...new Set(rows.map(r => r.symbol))]
    if (touchedSymbols.length > 0) {
      const { data: existingOpenRows } = await supabase
        .from('trades')
        .select('symbol, entry_time, stop_loss, r_multiple, setup_tag, notes, needs_review')
        .eq('user_id', user.id)
        .is('exit_time', null)
        .in('symbol', touchedSymbols)

      const openByKey = new Map<string, { symbol: string; entry_time: string | null; stop_loss: number | null; r_multiple: number | null; setup_tag: string | null; notes: string | null; needs_review: boolean | null }>(
        (existingOpenRows ?? []).map((r) => [`${r.symbol}|${r.entry_time ?? ''}`, r] as const)
      )

      for (const row of rows) {
        const key = `${row.symbol}|${row.entry_time ?? ''}`
        const existing = openByKey.get(key)
        if (!existing) continue
        if (row.setup_tag === 'untagged' && existing.setup_tag) row.setup_tag = existing.setup_tag
        if (!row.notes && existing.notes) row.notes = existing.notes
        if (!row.needs_review && existing.needs_review) row.needs_review = existing.needs_review
        if (row.stop_loss == null && existing.stop_loss != null) row.stop_loss = existing.stop_loss
        if (row.r_multiple == null && existing.r_multiple != null) row.r_multiple = existing.r_multiple
      }

      const enrichedRows = await enrichOpenTradesWithStopLosses(rows)
      rows.splice(0, rows.length, ...enrichedRows)

      await supabase
        .from('trades')
        .delete()
        .eq('user_id', user.id)
        .is('exit_time', null)
        .in('symbol', touchedSymbols)
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

    return NextResponse.json({ upserted, skipped })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
