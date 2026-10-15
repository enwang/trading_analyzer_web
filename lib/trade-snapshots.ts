import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TradeRow } from '@/types/trade'

type SnapshotReason = 'manual' | 'ibkr-sync' | 'csv-upload' | 'cleanup' | 'restore' | 'automatic'

interface CreateTradeSnapshotOptions {
  label?: string
  reason?: SnapshotReason
  /** Reuse rows already read for this user before any mutations. */
  trades?: TradeRow[]
  reuseIfUnchanged?: boolean
  latestSnapshot?: TradeSnapshotMetadata | null
}

export interface TradeSnapshotMetadata {
  id: string
  label: string
  reason: string
  trade_count: number
  created_at: string
  fingerprint: string | null
}

// JSONB key order and query row order do not indicate a data change. Include
// every stored field, including journal/risk fields and nested execution legs.
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, canonicalValue(object[key])]))
  }
  return value
}

export function tradeSnapshotFingerprint(rows: TradeRow[]): string {
  const normalized = rows.map(row => JSON.stringify(canonicalValue(row))).sort()
  return createHash('sha256').update(`[${normalized.join(',')}]`).digest('hex')
}

export async function loadTradeSnapshotRows(supabase: SupabaseClient, userId: string): Promise<TradeRow[]> {
  const rows: TradeRow[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('trades').select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as TradeRow[]
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

export async function loadLatestTradeSnapshot(supabase: SupabaseClient, userId: string): Promise<TradeSnapshotMetadata | null> {
  // Read only metadata and the digest, never download the full backup payload.
  const { data, error } = await supabase.from('trade_snapshots')
    .select('id, label, reason, trade_count, created_at, fingerprint:payload->>fingerprint')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return null
    throw error
  }
  return data as TradeSnapshotMetadata | null
}

export async function createTradeSnapshot(
  supabase: SupabaseClient,
  userId: string,
  options: CreateTradeSnapshotOptions = {}
) {
  const [rows, latest] = await Promise.all([
    options.trades ?? loadTradeSnapshotRows(supabase, userId),
    options.reuseIfUnchanged
      ? (options.latestSnapshot === undefined ? loadLatestTradeSnapshot(supabase, userId) : options.latestSnapshot)
      : null,
  ])
  const fingerprint = tradeSnapshotFingerprint(rows)
  if (latest?.fingerprint === fingerprint) return { ...latest, reused: true }

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
        fingerprint,
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

  return { ...data, reused: false }
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
