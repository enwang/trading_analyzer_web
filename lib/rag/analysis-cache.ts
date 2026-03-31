import type { SupabaseClient } from '@supabase/supabase-js'

export function simpleHash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export async function getCachedAnalysis<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  userId: string,
  cacheKey: string,
): Promise<T | null> {
  const { data } = await supabase
    .from('analysis_cache')
    .select('value')
    .eq('user_id', userId)
    .eq('cache_key', cacheKey)
    .single()
  return data ? (data.value as T) : null
}

export async function setCachedAnalysis<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  userId: string,
  cacheKey: string,
  value: T,
): Promise<void> {
  await supabase
    .from('analysis_cache')
    .upsert(
      { user_id: userId, cache_key: cacheKey, value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,cache_key' },
    )
}
