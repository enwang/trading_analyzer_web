import { NextResponse } from 'next/server'

import { createTradeSnapshot } from '@/lib/trade-snapshots'
import { createClient } from '@/lib/supabase/server'

type SnapshotPayload = {
  trades?: Array<Record<string, unknown>>
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const beforeRestore = await createTradeSnapshot(supabase, user.id, {
    label: `Before restoring snapshot ${id}`,
    reason: 'restore',
  })

  const { data: snapshot, error: snapshotError } = await supabase
    .from('trade_snapshots')
    .select('payload')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (snapshotError) {
    return NextResponse.json({ error: snapshotError.message }, { status: 404 })
  }

  const payload = snapshot.payload as SnapshotPayload
  const trades = (payload.trades ?? []).map((row) => ({
    ...row,
    user_id: user.id,
  }))

  const { error: deleteError } = await supabase
    .from('trades')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  if (trades.length > 0) {
    const { error: insertError } = await supabase
      .from('trades')
      .insert(trades)

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    restored: trades.length,
    beforeRestoreSnapshotId: beforeRestore?.id ?? null,
  })
}
