'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { findMisspellings, getSpellChecker, type Misspelling, type SpellChecker } from '@/lib/spell-check'

interface Props {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
  title?: string
  rows?: number
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>
  onFocus?: React.FocusEventHandler<HTMLTextAreaElement>
}

// Classes to strip from the mirror div: sizing (absolute inset-0 handles that)
// and border/ring/rounded (mirror is invisible — textarea provides the visible frame).
const STRIP_RE = /^(h-|min-h-|max-h-|w-|min-w-|max-w-|resize|focus:h-|focus:max-h-|focus:overflow|border|rounded|ring|outline|shadow)/

export function SpellCheckTextarea({ value, onChange, className = '', ...rest }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const checkerRef = useRef<SpellChecker | null>(null)
  const [misspellings, setMisspellings] = useState<Misspelling[]>([])
  const [tooltip, setTooltip] = useState<{ m: Misspelling; x: number; y: number } | null>(null)

  // Build mirror className: keep typography/spacing/border but strip sizing
  const mirrorClassName = className.split(' ').filter(c => !STRIP_RE.test(c)).join(' ')

  // Load checker lazily on first render
  useEffect(() => {
    let canceled = false
    getSpellChecker().then((c) => {
      if (canceled) return
      checkerRef.current = c
      setMisspellings(findMisspellings(value, c))
    })
    return () => { canceled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-check whenever value changes (once checker is ready)
  useEffect(() => {
    if (!checkerRef.current) return
    setMisspellings(findMisspellings(value, checkerRef.current))
  }, [value])

  // Sync mirror div scroll with textarea
  const syncScroll = useCallback(() => {
    if (taRef.current && mirrorRef.current) {
      mirrorRef.current.scrollTop = taRef.current.scrollTop
      mirrorRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }, [])

  // Detect which misspelled word the mouse is over
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (misspellings.length === 0) { setTooltip(null); return }

    const mirror = mirrorRef.current
    if (!mirror) { setTooltip(null); return }

    // Temporarily swap pointer-events: disable on textarea, enable on mirror,
    // so caretRangeFromPoint hits the mirror div's actual text nodes.
    const ta = e.currentTarget
    ta.style.pointerEvents = 'none'
    mirror.style.pointerEvents = 'auto'

    let charIndex: number | null = null

    const getGlobalOffset = (node: Node, offset: number): number | null => {
      const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT)
      let global = 0
      let n: Text | null
      while ((n = walker.nextNode() as Text | null)) {
        if (n === node) return global + offset
        global += n.length
      }
      return null
    }

    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY)
      if (range?.startContainer.nodeType === Node.TEXT_NODE && mirror.contains(range.startContainer)) {
        charIndex = getGlobalOffset(range.startContainer, range.startOffset)
      }
    } else {
      const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      }
      const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY)
      if (pos?.offsetNode.nodeType === Node.TEXT_NODE && mirror.contains(pos.offsetNode)) {
        charIndex = getGlobalOffset(pos.offsetNode, pos.offset)
      }
    }

    mirror.style.pointerEvents = ''
    ta.style.pointerEvents = ''

    if (charIndex == null) { setTooltip(null); return }

    const hit = misspellings.find((m) => charIndex! >= m.start && charIndex! < m.end)
    if (hit) {
      setTooltip({ m: hit, x: e.clientX, y: e.clientY })
    } else {
      setTooltip(null)
    }
  }, [misspellings])

  // Replace a misspelled word with a suggestion
  const applySuggestion = useCallback((m: Misspelling, suggestion: string) => {
    const next = value.slice(0, m.start) + suggestion + value.slice(m.end)
    onChange(next)
    setTooltip(null)
    taRef.current?.focus()
  }, [value, onChange])

  // Render mirror div content: plain text with red-underlined spans for misspellings
  const renderMirror = () => {
    if (misspellings.length === 0) return <>{value}</>
    const parts: React.ReactNode[] = []
    let last = 0
    for (const m of misspellings) {
      if (m.start > last) parts.push(<span key={`t${last}`}>{value.slice(last, m.start)}</span>)
      parts.push(
        <span
          key={`m${m.start}`}
          style={{ textDecoration: 'underline wavy #ef4444', textDecorationSkipInk: 'none' }}
        >
          {value.slice(m.start, m.end)}
        </span>
      )
      last = m.end
    }
    if (last < value.length) parts.push(<span key={`t${last}`}>{value.slice(last)}</span>)
    return <>{parts}</>
  }

  return (
    <div className="relative" style={{ lineHeight: 0 }}>
      {/* Mirror div: absolutely fills container, shows wavy underlines behind textarea */}
      <div
        ref={mirrorRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words ${mirrorClassName}`}
        style={{ color: 'transparent', zIndex: 0 }}
      >
        {/* Trailing space keeps height stable when text ends with newline */}
        {renderMirror()}{' '}
      </div>

      {/* Textarea: transparent background so mirror shows through */}
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        className={`relative ${className}`}
        style={{ background: 'transparent', zIndex: 1 }}
        spellCheck={false}
        {...rest}
      />

      {/* Suggestion tooltip */}
      {tooltip && tooltip.m.suggestions.length > 0 && (
        <div
          className="fixed z-[9999] rounded-md border bg-white shadow-lg py-1 text-xs"
          style={{ left: tooltip.x, top: tooltip.y + 18 }}
          onMouseLeave={() => setTooltip(null)}
        >
          {tooltip.m.suggestions.map((s) => (
            <button
              key={s}
              className="block w-full px-3 py-1 text-left hover:bg-muted/60"
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(tooltip.m, s) }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
