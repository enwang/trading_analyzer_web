import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/snapshots — list the 30 most recent snapshots
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('trade_snapshots')
    .select('id, label, reason, trade_count, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ snapshots: data })
}
