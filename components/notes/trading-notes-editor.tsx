'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  BookOpenCheck,
  Check,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  LogIn,
  LogOut,
  Minus,
  NotebookText,
  Quote,
  Redo2,
  Save,
  Strikethrough,
  Undo2,
} from 'lucide-react'

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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function editorContent(value: string) {
  if (!value) return ''
  if (/<(?:p|h[1-6]|ul|ol|li|blockquote|pre|hr|br)\b/i.test(value)) return value

  const content: string[] = []
  let listType: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (!listType) return
    content.push(`</${listType}>`)
    listType = null
  }

  for (const line of value.split('\n')) {
    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/)
    const bullet = line.match(/^\s*[•*-]\s+(.+)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    const quote = line.match(/^\s*>\s+(.+)$/)

    if (bullet || numbered) {
      const nextListType = bullet ? 'ul' : 'ol'
      if (listType !== nextListType) {
        closeList()
        content.push(`<${nextListType}>`)
        listType = nextListType
      }
      content.push(`<li><p>${escapeHtml((bullet ?? numbered)?.[1] ?? '')}</p></li>`)
      continue
    }

    if (!line.trim() && listType) continue
    closeList()

    if (heading) {
      const level = heading[1].length
      content.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`)
    } else if (quote) {
      content.push(`<blockquote><p>${escapeHtml(quote[1])}</p></blockquote>`)
    } else {
      content.push(`<p>${line ? escapeHtml(line) : '<br>'}</p>`)
    }
  }

  closeList()
  return content.join('')
}

function ToolbarButton({
  active = false,
  disabled = false,
  label,
  onClick,
  children,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={active ? 'bg-accent text-accent-foreground' : undefined}
    >
      {children}
    </Button>
  )
}

function NotesToolbar({ editor }: { editor: Editor }) {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const update = () => forceUpdate((value) => value + 1)
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-0.5 border-b bg-muted/25 px-2 py-1" role="toolbar" aria-label="Text formatting">
      <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code2 className="size-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <ToolbarButton label="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="size-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

      <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className="size-4" />
      </ToolbarButton>
    </div>
  )
}

function RichNotesEditor({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
    ],
    content: editorContent(value),
    editorProps: {
      attributes: {
        'aria-label': label,
        class: 'trading-notes-editor min-h-[calc(100vh-16rem)] px-4 py-3 text-sm leading-6 outline-none',
      },
    },
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getHTML()),
    onBlur,
  })

  useEffect(() => {
    if (!editor) return
    const nextContent = editorContent(value)
    if (editor.getHTML() !== nextContent) editor.commands.setContent(nextContent, { emitUpdate: false })
  }, [editor, value])

  if (!editor) return <div className="min-h-[calc(100vh-13rem)] rounded-md border" />

  return (
    <div className="min-h-[calc(100vh-13rem)] w-full overflow-hidden rounded-md border bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
      <NotesToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
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
            <RichNotesEditor
              label={label}
              value={notes[key]}
              onChange={(value) => updateNote(key, value)}
              onBlur={() => void persist()}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
