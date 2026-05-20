import type { SupabaseClient } from '@supabase/supabase-js'

export interface HiddenTradeKeyRow {
  symbol: string
  entry_time: string | null
  exit_time: string | null
}

function normalizeTs(t: string | null | undefined): string {
  return t ? t.slice(0, 19) : ''
}

export function hiddenTradeKey(row: HiddenTradeKeyRow): string {
  return `${row.symbol}|${normalizeTs(row.entry_time)}|${normalizeTs(row.exit_time)}`
}

export async function loadHiddenTradeKeys(
  supabase: SupabaseClient,
  userId: string,
  symbols: string[]
): Promise<Set<string>> {
  if (symbols.length === 0) return new Set()
  const { data, error } = await supabase
    .from('hidden_trades')
    .select('symbol, entry_time, exit_time')
    .eq('user_id', userId)
    .in('symbol', symbols)
  if (error) throw new Error(`hidden_trades load failed: ${error.message}`)
  const keys = new Set<string>()
  for (const r of (data ?? []) as HiddenTradeKeyRow[]) keys.add(hiddenTradeKey(r))
  return keys
}

export function filterOutHidden<T extends HiddenTradeKeyRow>(
  rows: T[],
  hidden: Set<string>
): T[] {
  if (hidden.size === 0) return rows
  return rows.filter((r) => !hidden.has(hiddenTradeKey(r)))
}
