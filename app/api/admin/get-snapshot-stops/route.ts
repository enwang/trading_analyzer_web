import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Temp admin route: reads the most recent trade snapshot and extracts stop_loss
// values for specified symbols. Hit once, delete after.
// Usage: GET /api/admin/get-snapshot-stops?symbols=ARM,ORCL,COHR
export async function GET(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const url = new URL(request.url)
  const symbolsParam = url.searchParams.get('symbols') ?? ''
  const targetSymbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)

  // Get the most recent snapshots (up to 5)
  const { data: snapshots, error: snapErr } = await supabase
    .from('trade_snapshots')
    .select('id, created_at, label, reason, user_id')
    .order('created_at', { ascending: false })
    .limit(5)

  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })

  const results: Record<string, unknown>[] = []

  for (const snap of snapshots ?? []) {
    const { data: snapData, error: dataErr } = await supabase
      .from('trade_snapshot_rows')
      .select('symbol, entry_time, exit_time, stop_loss, stop_loss_locked')
      .eq('snapshot_id', snap.id)
      .in('symbol', targetSymbols.length > 0 ? targetSymbols : ['__none__'])

    if (dataErr) continue

    const rows = (snapData ?? []).filter(r => r.stop_loss != null || r.stop_loss_locked)
    if (rows.length > 0) {
      results.push({
        snapshot_id: snap.id,
        created_at: snap.created_at,
        label: snap.label,
        rows,
      })
    }
  }

  return NextResponse.json({ results })
}
