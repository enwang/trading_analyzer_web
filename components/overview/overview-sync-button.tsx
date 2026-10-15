'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatLocalStopSync, syncLocalOpenStopOrders } from '@/lib/ibkr/local-stop-sync'

export function OverviewSyncButton() {
  const router = useRouter()
  const [timings, setTimings] = useState<Record<string, number> | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [stopMessage, setStopMessage] = useState<string | null>(null)

  async function syncNow() {
    const started = performance.now()
    setTimings(null)
    setSyncing(true)
    setMessage(null)
    setStopMessage(null)
    try {
      const res = await fetch('/api/ibkr/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      setTimings({ ...json.timings, client_total: Math.round(performance.now() - started) })
      if (!res.ok) {
        setMessage(json?.error ?? 'Sync failed')
        return
      }

      const tradeMessage = `Synced ${json.upserted} trades (${json.skipped} skipped)`
      setMessage(tradeMessage)
      setSyncing(false)
      router.refresh()
      if (json.userId) window.setTimeout(() => {
        setStopMessage('Syncing open stops in background…')
        void syncLocalOpenStopOrders(json.userId).then(stopSync => {
          setStopMessage(formatLocalStopSync(stopSync))
          if (stopSync.available && stopSync.updated > 0) router.refresh()
        })
      }, 0)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1" data-sync-timings={timings ? JSON.stringify(timings) : undefined}>
      <div className="flex gap-2">
        <Button size="sm" onClick={syncNow} disabled={syncing}>
          <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
      {message && <div className="text-xs text-muted-foreground">{message}</div>}
      {stopMessage && <div className="text-xs text-muted-foreground">{stopMessage}</div>}
    </div>
  )
}
