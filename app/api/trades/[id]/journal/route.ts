import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

interface JournalPayload {
  setupTag: string
  notes: string
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const payload = (await request.json()) as JournalPayload

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('trades')
    .update({
      setup_tag: (payload.setupTag ?? '').trim() || 'untagged',
      notes: payload.notes ?? '',
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
