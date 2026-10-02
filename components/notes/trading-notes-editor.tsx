'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpenCheck, Check, LogIn, LogOut, NotebookText, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TradingNotes } from '@/lib/trading-notes'

type NotesKey = keyof TradingNotes
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const TAB_CONFIG: Array<{ key: NotesKey; label: string; icon: typeof LogIn }> = [
  { key: 'entryRules', label: 'Entry Rules', icon: LogIn },
  { key: 'sellRules', label: 'Sell Rules', icon: LogOut },
  { key: 'reviewNotes', label: 'Review Notes', icon: NotebookText },
]

function serialize(notes: TradingNotes) {
  return JSON.stringify(notes)
}

function savedTimeLabel(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function TradingNotesEditor({
  initialNotes,
  initialUpdatedAt,
}: {
  initialNotes: TradingNotes
  initialUpdatedAt: string | null
}) {
  const [notes, setNotes] = useState(initialNotes)
  const [activeTab, setActiveTab] = useState<NotesKey>('entryRules')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const notesRef = useRef(notes)
  const savedRef = useRef(serialize(initialNotes))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const queuedRef = useRef(false)

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  const persist = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null

    const snapshot = notesRef.current
    const serialized = serialize(snapshot)
    if (serialized === savedRef.current) return
    if (savingRef.current) {
      queuedRef.current = true
      return
    }

    savingRef.current = true
    setSaveState('saving')
    let saved = false
    try {
      const response = await fetch('/api/user-settings/trading-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: snapshot }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error ?? 'Could not save notes')
      savedRef.current = serialized
      saved = true
      setUpdatedAt(result.updatedAt ?? new Date().toISOString())
      setSaveState('saved')
    } catch {
      setSaveState('error')
    } finally {
      savingRef.current = false
      if (queuedRef.current || (saved && serialize(notesRef.current) !== savedRef.current)) {
        queuedRef.current = false
        void persist()
      }
    }
  }, [])

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaveState('dirty')
    timerRef.current = setTimeout(() => void persist(), 700)
  }, [persist])

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void persist()
      }
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => {
      window.removeEventListener('keydown', handleSaveShortcut)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [persist])

  function updateNote(key: NotesKey, value: string) {
    setNotes((current) => {
      const next = { ...current, [key]: value }
      notesRef.current = next
      return next
    })
    scheduleSave()
  }

  const savedLabel = savedTimeLabel(updatedAt)
  const statusLabel = saveState === 'saving'
    ? 'Saving…'
    : saveState === 'error'
      ? 'Save failed'
      : saveState === 'dirty'
        ? 'Unsaved changes'
      : saveState === 'saved'
        ? 'Saved'
        : savedLabel
          ? `Saved ${savedLabel}`
          : 'Not saved yet'

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <BookOpenCheck className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Trading Notes</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className={saveState === 'error' ? 'text-xs text-red-500' : 'text-xs text-muted-foreground'}>
            {saveState === 'saved' && <Check className="mr-1 inline size-3.5" />}
            {statusLabel}
          </span>
          <Button size="sm" variant="outline" onClick={() => void persist()} disabled={saveState === 'saving'}>
            <Save className="size-4" />
            Save
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as NotesKey)}
        className="mt-4 flex flex-1 flex-col"
      >
        <TabsList variant="line" className="border-b">
          {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
            <TabsTrigger key={key} value={key} className="px-3">
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_CONFIG.map(({ key, label }) => (
          <TabsContent key={key} value={key} className="mt-4 flex flex-1">
            <textarea
              aria-label={label}
              value={notes[key]}
              onChange={(event) => updateNote(key, event.target.value)}
              onBlur={() => void persist()}
              className="min-h-[calc(100vh-13rem)] w-full resize-none rounded-md border bg-background px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
              spellCheck={false}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
