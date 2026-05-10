import { NextResponse } from 'next/server'

import { createTradeSnapshot } from '@/lib/trade-snapshots'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('trade_snapshots')
    .select('id, label, reason, trade_count, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ snapshots: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { label?: string }
  const snapshot = await createTradeSnapshot(supabase, user.id, {
    label: body.label,
    reason: 'manual',
  })

  if (!snapshot) {
    return NextResponse.json(
      { error: 'trade_snapshots table is missing. Apply migration 008_trade_snapshots.sql first.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ snapshot })
}
