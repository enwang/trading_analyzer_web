import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchPreEntryExtremes, suggestedStopLoss } from '@/lib/market/stop-loss'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all trades missing a stop loss
  const { data: rows, error } = await supabase
    .from('trades')
    .select('id, symbol, entry_time, side, entry_price, shares, pnl')
    .eq('user_id', user.id)
    .is('stop_loss', null)
    .not('entry_time', 'is', null)
    .not('side', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ backfilled: 0 })
  }

  let backfilled = 0

  for (const row of rows) {
    try {
      const preEntry = await fetchPreEntryExtremes(row.symbol, row.entry_time!)
      if (!preEntry) continue

      const stopLoss = suggestedStopLoss(row.side, preEntry)
      if (stopLoss == null) continue

      // Compute R multiple: pnl / total initial risk
      let rMultiple: number | null = null
      if (row.entry_price != null && row.shares != null && row.pnl != null) {
        const riskPerShare = row.side === 'long'
          ? row.entry_price - stopLoss
          : stopLoss - row.entry_price
        const totalRisk = Math.abs(riskPerShare * row.shares)
        if (totalRisk > 0) {
          rMultiple = row.pnl / totalRisk
        }
      }

      const { error: updateError } = await supabase
        .from('trades')
        .update({ stop_loss: stopLoss, r_multiple: rMultiple })
        .eq('id', row.id)
        .eq('user_id', user.id)

      if (!updateError) backfilled++
    } catch {
      // skip individual failures
    }
  }

  return NextResponse.json({ backfilled })
}
