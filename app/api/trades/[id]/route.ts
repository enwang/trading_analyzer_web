import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
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

  // Read the row so we can record an identity in hidden_trades before deletion.
  // Without this, the next IBKR sync would re-create the trade from Flex.
  const { data: trade, error: fetchErr } = await supabase
    .from('trades')
    .select('symbol, entry_time, exit_time')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 400 })
  }

  if (trade && trade.entry_time) {
    const { error: hideErr } = await supabase.from('hidden_trades').upsert(
      {
        user_id: user.id,
        symbol: trade.symbol,
        entry_time: trade.entry_time,
        exit_time: trade.exit_time,
        reason: 'manual delete',
      },
      // Partial unique indexes cover both null/non-null exit_time; ignoreDuplicates
      // avoids a constraint error if the user deletes the same identity twice.
      { ignoreDuplicates: true }
    )
    if (hideErr) {
      return NextResponse.json({ error: hideErr.message }, { status: 400 })
    }
  }

  const { error } = await supabase
    .from('trades')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
