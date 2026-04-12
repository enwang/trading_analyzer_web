import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

interface JournalPayload {
  setupTag: string
  notes: string
  needsReview?: boolean
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

  const updateFields: Record<string, unknown> = {
    setup_tag: (payload.setupTag ?? '').trim() || 'untagged',
    notes: payload.notes ?? '',
  }
  if (payload.needsReview !== undefined) {
    updateFields.needs_review = Boolean(payload.needsReview)
  }

  const { error } = await supabase
    .from('trades')
    .update(updateFields)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
