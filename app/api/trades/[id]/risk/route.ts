import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

interface RiskPayload {
  stopLoss: number | null
  rMultiple: number | null
  initialRiskAmount?: number | null
  stopLossLocked?: boolean
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const payload = (await request.json()) as RiskPayload

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const updatePayload: Record<string, unknown> = {
    stop_loss: payload.stopLoss,
    r_multiple: payload.rMultiple,
  }
  if ('stopLossLocked' in payload) updatePayload.stop_loss_locked = payload.stopLossLocked
  if ('initialRiskAmount' in payload) updatePayload.initial_risk_amount = payload.initialRiskAmount

  const { error } = await supabase
    .from('trades')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
