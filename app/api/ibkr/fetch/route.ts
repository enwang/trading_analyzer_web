import { createClient } from '@/lib/supabase/server'
import { fetchFlexTrades } from '@/lib/ibkr/flex'
import { NextRequest, NextResponse } from 'next/server'

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

    const trades = await fetchFlexTrades(token, queryId)

    if (!trades.length) {
      return NextResponse.json({ upserted: 0, skipped: 0 })
    }

    const rows = trades.map(t => ({ ...t, user_id: user.id }))

    // Open positions (exit_time IS NULL) have no unique constraint match because
    // NULL != NULL in PostgreSQL indexes, so they accumulate on every sync.
    // Delete stale open rows for these symbols before upserting.
    const openSymbols = [...new Set(rows.filter(r => !r.exit_time).map(r => r.symbol))]
    if (openSymbols.length > 0) {
      await supabase
        .from('trades')
        .delete()
        .eq('user_id', user.id)
        .is('exit_time', null)
        .in('symbol', openSymbols)
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

    return NextResponse.json({ upserted, skipped })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
