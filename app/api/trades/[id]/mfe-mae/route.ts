import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

interface MfeMaePayload {
  mfe: number | null
  mae: number | null
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const payload = (await request.json()) as MfeMaePayload

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('trades')
    .update({ mfe: payload.mfe, mae: payload.mae })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
