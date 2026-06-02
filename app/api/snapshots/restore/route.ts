import { createClient } from '@/lib/supabase/server'
import { createTradeSnapshot } from '@/lib/trade-snapshots'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/snapshots/restore — restore trades from a snapshot
// Body: { snapshotId: string }
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { snapshotId } = await request.json()
  if (!snapshotId) return NextResponse.json({ error: 'Missing snapshotId' }, { status: 400 })

  // Load the requested snapshot (RLS ensures it belongs to this user)
  const { data: snap, error: snapErr } = await supabase
    .from('trade_snapshots')
    .select('payload, label, trade_count')
    .eq('id', snapshotId)
    .eq('user_id', user.id)
    .single()

  if (snapErr || !snap) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })

  const payload = snap.payload as { version: number; trades: Record<string, unknown>[] }
  if (!Array.isArray(payload?.trades)) {
    return NextResponse.json({ error: 'Snapshot payload missing trades array' }, { status: 400 })
  }

  // Take a safety snapshot of the current state before overwriting
  await createTradeSnapshot(supabase, user.id, {
    label: `Before restore from "${snap.label}"`,
    reason: 'restore',
  })

  // Delete all current trades for this user, then re-insert from snapshot
  const { error: delErr } = await supabase
    .from('trades')
    .delete()
    .eq('user_id', user.id)

  if (delErr) return NextResponse.json({ error: `Delete failed: ${delErr.message}` }, { status: 500 })

  if (payload.trades.length > 0) {
    const { error: insertErr } = await supabase
      .from('trades')
      .insert(payload.trades)

    if (insertErr) return NextResponse.json({ error: `Insert failed: ${insertErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    restored: payload.trades.length,
    fromSnapshot: snap.label,
  })
}
