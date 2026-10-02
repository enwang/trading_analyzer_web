import { TradingNotesEditor } from '@/components/notes/trading-notes-editor'
import { getAuthenticatedUserId } from '@/lib/auth/user'
import { createClient } from '@/lib/supabase/server'
import { normalizeTradingNotes } from '@/lib/trading-notes'

export default async function NotesPage() {
  const supabase = await createClient()
  const userId = await getAuthenticatedUserId()
  const { data } = await supabase
    .from('user_settings')
    .select('trading_notes, trading_notes_updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  return (
    <TradingNotesEditor
      initialNotes={normalizeTradingNotes(data?.trading_notes)}
      initialUpdatedAt={data?.trading_notes_updated_at ?? null}
    />
  )
}
