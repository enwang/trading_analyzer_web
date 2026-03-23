import { createClient } from '@supabase/supabase-js'
import { fetchFlexTrades } from '@/lib/ibkr/flex'
import { enrichOpenTradesWithStopLosses } from '@/lib/market/stop-loss'
import { NextResponse } from 'next/server'

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
    .select('user_id, ibkr_token, ibkr_query_id')
    .not('ibkr_token', 'is', null)
    .not('ibkr_query_id', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = []

  for (const s of settings ?? []) {
    try {
      const trades = await fetchFlexTrades(s.ibkr_token, s.ibkr_query_id)

      let upserted = 0
      if (trades.length) {
        const rows: UpsertRow[] = trades.map(t => ({ ...t, user_id: s.user_id }))
        const touchedSymbols = [...new Set(rows.map(r => r.symbol))]

        if (touchedSymbols.length > 0) {
          const { data: existingOpenRows } = await supabase
            .from('trades')
            .select('symbol, entry_time, stop_loss, r_multiple, setup_tag, notes, needs_review')
            .eq('user_id', s.user_id)
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

          // Remove all stale open rows for touched symbols, then reinsert current open rows.
          await supabase
            .from('trades')
            .delete()
            .eq('user_id', s.user_id)
            .is('exit_time', null)
            .in('symbol', touchedSymbols)
        }

        const { data, error: upsertErr } = await supabase
          .from('trades')
          .upsert(rows, { onConflict: 'user_id,symbol,entry_time,exit_time', ignoreDuplicates: false })
          .select('id')

        if (upsertErr) throw new Error(upsertErr.message)
        upserted = data?.length ?? 0
      }

      await supabase
        .from('user_settings')
        .update({
          ibkr_last_sync: new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', s.user_id)

      results.push({ user_id: s.user_id, upserted, skipped: trades.length - upserted })
    } catch (e) {
      results.push({
        user_id: s.user_id,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}
