import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { normalizeTradingNotes, validTradingNotes } from '@/lib/trading-notes'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('user_settings')
    .select('trading_notes, trading_notes_updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    notes: normalizeTradingNotes(data?.trading_notes),
    updatedAt: data?.trading_notes_updated_at ?? null,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json().catch(() => null)
  if (!validTradingNotes(payload?.notes)) {
    return NextResponse.json({ error: 'Invalid trading notes' }, { status: 400 })
  }

  const updatedAt = new Date().toISOString()
  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: user.id,
      trading_notes: payload.notes,
      trading_notes_updated_at: updatedAt,
    },
    { onConflict: 'user_id' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updatedAt })
}
