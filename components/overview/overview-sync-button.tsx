'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

export function OverviewSyncButton() {
  const router = useRouter()
  const supabase = createClient()
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function syncNow() {
    setSyncing(true)
    setMessage(null)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setMessage('Not authenticated')
        return
      }

      const { data } = await supabase
        .from('user_settings')
        .select('ibkr_token, ibkr_query_id')
        .eq('user_id', user.id)
        .single()

      const token = data?.ibkr_token?.trim()
      const queryId = data?.ibkr_query_id?.trim()

      if (!token || !queryId) {
        setMessage('Save IBKR Flex credentials in Import first')
        return
      }

      const res = await fetch('/api/ibkr/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, queryId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessage(json?.error ?? 'Sync failed')
        return
      }

      setMessage(`Synced ${json.upserted} trades (${json.skipped} skipped)`)
      router.refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" onClick={syncNow} disabled={syncing}>
          <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
      {message && <div className="text-xs text-muted-foreground">{message}</div>}
    </div>
  )
}
