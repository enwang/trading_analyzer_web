import { NextResponse } from 'next/server'

import { dedupeTradeRowsForCleanup, pickTradeMetadata } from '@/lib/trades'
import { createClient } from '@/lib/supabase/server'
import { rowToTrade, type TradeRow } from '@/types/trade'

export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: rows, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const allRows = (rows ?? []) as TradeRow[]
    const trades = allRows.map(rowToTrade)
    const groups = dedupeTradeRowsForCleanup(trades)

    let deleted = 0
    let cleanedGroups = 0

    for (const group of groups) {
      if (group.removeIds.length === 0) continue
      const rowGroup = allRows.filter((row) => row.id === group.keep.id || group.removeIds.includes(row.id))
      const metadata = pickTradeMetadata(rowGroup.map(rowToTrade), group.keep)
      const mergedTrade = group.merged

      const updatePayload = {
        entry_time: mergedTrade.entryTime,
        exit_time: mergedTrade.exitTime,
        side: mergedTrade.side,
        shares: mergedTrade.shares,
        entry_price: mergedTrade.entryPrice,
        exit_price: mergedTrade.exitPrice,
        pnl: mergedTrade.pnl,
        pnl_pct: mergedTrade.pnlPct,
        outcome: mergedTrade.outcome,
        hold_days: mergedTrade.holdDays,
        hold_time_min: mergedTrade.holdTimeMin,
        hour_of_day: mergedTrade.hourOfDay,
        day_of_week: mergedTrade.dayOfWeek,
        execution_legs: mergedTrade.executionLegs,
        needs_review: metadata.needsReview,
        setup_tag: metadata.setupTag,
        notes: metadata.notes,
        stop_loss: metadata.stopLoss,
        r_multiple: mergedTrade.rMultiple ?? metadata.rMultiple,
      }

      const { error: updateError } = await supabase
        .from('trades')
        .update(updatePayload)
        .eq('id', group.keep.id)
        .eq('user_id', user.id)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      if (group.removeIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('trades')
          .delete()
          .eq('user_id', user.id)
          .in('id', group.removeIds)

        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 })
        }
      }

      deleted += group.removeIds.length
      cleanedGroups += 1
    }

    return NextResponse.json({ deleted, groups: cleanedGroups })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
