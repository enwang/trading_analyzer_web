import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { usesStopLossFirstSizing } from '@/lib/market/stop-loss'

interface RiskPayload {
  stopLoss: number | null
  currentStopLoss?: number | null
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

  const { data: existingTrade, error: readError } = await supabase
    .from('trades')
    .select('entry_time, current_stop_loss')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 400 })
  }

  const isStaleDefaultRiskSave =
    usesStopLossFirstSizing(existingTrade.entry_time) &&
    payload.stopLoss != null &&
    payload.stopLossLocked !== true &&
    payload.initialRiskAmount == null

  const updatePayload: Record<string, unknown> = {
    stop_loss: isStaleDefaultRiskSave ? null : payload.stopLoss,
    r_multiple: isStaleDefaultRiskSave ? null : payload.rMultiple,
  }
  if ('stopLossLocked' in payload) updatePayload.stop_loss_locked = payload.stopLossLocked
  if ('currentStopLoss' in payload) {
    updatePayload.current_stop_loss = isStaleDefaultRiskSave ? null : payload.currentStopLoss
  } else if (!isStaleDefaultRiskSave && payload.stopLoss != null && existingTrade.current_stop_loss == null) {
    // Initialize live risk from Initial SL once. Future Current SL edits are
    // independent because they send currentStopLoss explicitly.
    updatePayload.current_stop_loss = payload.stopLoss
  }
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
