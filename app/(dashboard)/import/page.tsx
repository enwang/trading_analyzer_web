'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, RefreshCw, Save, RotateCcw } from 'lucide-react'

interface Settings {
  ibkr_token: string
  ibkr_query_id: string
  ibkr_last_sync: string | null
}

interface Snapshot {
  id: string
  label: string
  reason: string
  trade_count: number
  created_at: string
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function ImportPage() {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [token, setToken] = useState('')
  const [queryId, setQueryId] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)

  const [savingSettings, setSavingSettings] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [settingsMsg, setSettingsMsg] = useState('')
  const [syncMsg, setSyncMsg] = useState('')
  const [uploadMsg, setUploadMsg] = useState('')

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loadingSnaps, setLoadingSnaps] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreMsg, setRestoreMsg] = useState('')

  useEffect(() => {
    async function loadSettings() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('user_settings')
        .select('ibkr_token,ibkr_query_id,ibkr_last_sync')
        .eq('user_id', user.id)
        .single()
      if (data) {
        const s = data as Settings
        setToken(s.ibkr_token ?? '')
        setQueryId(s.ibkr_query_id ?? '')
        setLastSync(s.ibkr_last_sync ?? null)
      }
    }
    loadSettings()
    loadSnapshots()
  }, [])

  async function loadSnapshots() {
    setLoadingSnaps(true)
    try {
      const res = await fetch('/api/snapshots')
      if (res.ok) {
        const json = await res.json()
        setSnapshots(json.snapshots ?? [])
      }
    } finally {
      setLoadingSnaps(false)
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    setSettingsMsg('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSettingsMsg('Not authenticated'); setSavingSettings(false); return }
    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id,
      ibkr_token: token,
      ibkr_query_id: queryId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    setSettingsMsg(error ? `Error: ${error.message}` : 'Credentials saved.')
    setSavingSettings(false)
  }

  async function syncIbkr() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/ibkr/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, queryId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSyncMsg(`Error: ${json.error ?? res.statusText}`)
      } else {
        setSyncMsg(`Synced ${json.upserted} trades (${json.skipped} skipped).`)
        setLastSync(new Date().toISOString().slice(0, 10))
        await loadSnapshots()
      }
    } catch (e: unknown) {
      setSyncMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  async function uploadCsv() {
    const file = fileRef.current?.files?.[0]
    if (!file) { setUploadMsg('Please select a file.'); return }
    setUploading(true)
    setUploadMsg('')
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/trades/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) {
        setUploadMsg(`Error: ${json.error ?? res.statusText}`)
      } else {
        setUploadMsg(`Imported ${json.upserted} trades (${json.skipped} skipped).`)
        if (fileRef.current) fileRef.current.value = ''
        await loadSnapshots()
      }
    } catch (e: unknown) {
      setUploadMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  async function restoreSnapshot(snap: Snapshot) {
    const confirmed = window.confirm(
      `Restore ${snap.trade_count} trades from "${fmtTs(snap.created_at)}"?\n\nA safety snapshot of your current trades will be saved first.`
    )
    if (!confirmed) return
    setRestoringId(snap.id)
    setRestoreMsg('')
    try {
      const res = await fetch('/api/snapshots/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: snap.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setRestoreMsg(`Error: ${json.error ?? res.statusText}`)
      } else {
        setRestoreMsg(`Restored ${json.restored} trades from "${json.fromSnapshot}".`)
        await loadSnapshots()
      }
    } catch (e: unknown) {
      setRestoreMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Import Trades</h1>

      {/* IBKR Flex Web Service */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">IBKR Flex Web Service</CardTitle>
          <CardDescription>
            Fetch trades directly from Interactive Brokers using your Flex Query credentials.
            Auto-sync retries nightly across the 8 PM to 11 PM ET window.
            {lastSync && (
              <span className="ml-2 text-xs text-muted-foreground">
                Last sync: {lastSync}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Flex Token</label>
            <Input
              type="password"
              placeholder="Your IBKR Flex token"
              value={token}
              onChange={e => setToken(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Query ID</label>
            <Input
              placeholder="Flex Query ID"
              value={queryId}
              onChange={e => setQueryId(e.target.value)}
            />
          </div>
          {settingsMsg && (
            <p className={`text-sm ${settingsMsg.startsWith('Error') ? 'text-red-500' : 'text-emerald-600'}`}>
              {settingsMsg}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={saveSettings}
              disabled={savingSettings}
            >
              <Save className="size-4" />
              {savingSettings ? 'Saving…' : 'Save credentials'}
            </Button>
            <Button
              size="sm"
              onClick={syncIbkr}
              disabled={syncing || !token || !queryId}
            >
              <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
          {syncMsg && (
            <p className={`text-sm ${syncMsg.startsWith('Error') ? 'text-red-500' : 'text-emerald-600'}`}>
              {syncMsg}
            </p>
          )}
        </CardContent>
      </Card>

      {/* CSV Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload IBKR Flex CSV</CardTitle>
          <CardDescription>
            Upload a CSV file exported from the IBKR Flex Query system.
            Trades are de-duplicated automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
          />
          {uploadMsg && (
            <p className={`text-sm ${uploadMsg.startsWith('Error') ? 'text-red-500' : 'text-emerald-600'}`}>
              {uploadMsg}
            </p>
          )}
          <Button size="sm" onClick={uploadCsv} disabled={uploading}>
            <Upload className="size-4" />
            {uploading ? 'Uploading…' : 'Upload CSV'}
          </Button>
        </CardContent>
      </Card>

      {/* Snapshots */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Snapshots</CardTitle>
          <CardDescription>
            A snapshot is saved automatically before every sync or upload. Restore any point to recover your trades.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {restoreMsg && (
            <p className={`text-sm mb-3 ${restoreMsg.startsWith('Error') ? 'text-red-500' : 'text-emerald-600'}`}>
              {restoreMsg}
            </p>
          )}
          {loadingSnaps ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snapshots yet. One will be created on your next sync.</p>
          ) : (
            <div className="divide-y divide-border rounded-md border text-sm">
              {snapshots.map(snap => (
                <div key={snap.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-medium tabular-nums">{fmtTs(snap.created_at)}</span>
                    <span className="ml-2 text-muted-foreground">{snap.trade_count} trades</span>
                    {snap.reason === 'restore' && (
                      <span className="ml-2 text-xs text-amber-600">pre-restore</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-7 px-2 text-xs"
                    disabled={restoringId === snap.id}
                    onClick={() => restoreSnapshot(snap)}
                  >
                    <RotateCcw className="size-3" />
                    {restoringId === snap.id ? 'Restoring…' : 'Restore'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
