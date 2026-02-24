import { createClient } from '@supabase/supabase-js'
import { fetchFlexTrades } from '@/lib/ibkr/flex'
import { NextResponse } from 'next/server'

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
        const rows = trades.map(t => ({ ...t, user_id: s.user_id }))

        // Delete stale open-position rows before upserting (NULL != NULL in PG unique index)
        const openSymbols = [...new Set(rows.filter(r => !r.exit_time).map(r => r.symbol))]
        if (openSymbols.length > 0) {
          await supabase
            .from('trades')
            .delete()
            .eq('user_id', s.user_id)
            .is('exit_time', null)
            .in('symbol', openSymbols)
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
