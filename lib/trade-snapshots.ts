import type { SupabaseClient } from '@supabase/supabase-js'

type SnapshotReason = 'manual' | 'ibkr-sync' | 'csv-upload' | 'cleanup' | 'restore'

interface CreateTradeSnapshotOptions {
  label?: string
  reason?: SnapshotReason
}

export async function createTradeSnapshot(
  supabase: SupabaseClient,
  userId: string,
  options: CreateTradeSnapshotOptions = {}
) {
  const { data: trades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (tradesError) throw tradesError

  const rows = trades ?? []
  const now = new Date().toISOString()
  const label = options.label ?? `Trades snapshot ${now}`
  const reason = options.reason ?? 'manual'

  const { data, error } = await supabase
    .from('trade_snapshots')
    .insert({
      user_id: userId,
      label,
      reason,
      trade_count: rows.length,
      payload: {
        version: 1,
        created_at: now,
        trades: rows,
      },
    })
    .select('id, label, reason, trade_count, created_at')
    .single()

  if (error) {
    // Keep destructive/import flows usable until the migration is applied.
    if (
      error.code === '42P01' ||
      error.message.toLowerCase().includes('trade_snapshots')
    ) {
      return null
    }
    throw error
  }

  return data
}

export async function pruneOldSnapshots(
  supabase: SupabaseClient,
  userId: string,
  keepCount = 30
) {
  // Fetch IDs of snapshots beyond the most recent `keepCount`, oldest first
  const { data, error } = await supabase
    .from('trade_snapshots')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(keepCount, 9999)

  if (error || !data?.length) return

  const ids = data.map((r: { id: string }) => r.id)
  await supabase.from('trade_snapshots').delete().in('id', ids)
}
