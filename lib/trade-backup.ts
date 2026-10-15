import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { createTradeSnapshot, pruneOldSnapshots } from '@/lib/trade-snapshots'

/** Prepare a recoverable copy after a successful save without delaying its response. */
export function scheduleTradeBackup(supabase: SupabaseClient, userId: string) {
  after(async () => {
    try {
      const snapshot = await createTradeSnapshot(supabase, userId, {
        reason: 'automatic',
        label: `Automatic backup ${new Date().toISOString()}`,
        reuseIfUnchanged: true,
      })
      if (snapshot && !snapshot.reused) await pruneOldSnapshots(supabase, userId)
    } catch {
      // Sync independently verifies its current rows against the persisted digest
      // and falls back to a foreground backup when this preparation did not finish.
      console.error('Automatic trade backup failed; next Sync will verify its backup again')
    }
  })
}
