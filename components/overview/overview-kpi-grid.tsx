'use client'

import type React from 'react'
import { useEffect, useState, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { KpiCard } from '@/components/kpi/kpi-card'
import { OpenPnlCard } from '@/components/overview/open-pnl-card'
import { OpenRiskCard } from '@/components/overview/open-risk-card'
import { AccountSummaryCard } from '@/components/overview/account-summary-card'

type OpenTradeForRisk = { symbol: string; side: 'long' | 'short' | null; shares: number | null; stopLoss: number | null }
type OpenTrade = { symbol: string; side: 'long' | 'short' | null; shares: number | null; entryPrice: number | null; realizedPnl: number | null }

export type CardConfig =
  | { id: string; type: 'account-summary'; accountEquity: number | null; startEquity: number | null; netDeposits: number; trades: OpenTradeForRisk[] }
  | { id: string; type: 'open-pnl'; trades: OpenTrade[] }
  | { id: string; type: 'open-risk'; trades: OpenTradeForRisk[]; accountEquity: number | null }
  | { id: string; type: 'kpi'; label: React.ReactNode; value: React.ReactNode; sub?: string; trend?: 'up' | 'down'; href?: string; hoverTitle?: string; hoverItems?: string[]; hideOnMobile?: boolean }

const LS_KEY = 'overview-kpi-order'

// Fixed card order for touch devices, captured from Wilson's phone layout
// (Oct 18, 2026) after he arranged it there. Touch devices always use this
// order and ignore any locally stored one; desktop keeps its own stored
// order and drag-reorder. largest-win/largest-loss sit at the end — they
// are hidden on phone widths anyway (hideOnMobile).
const MOBILE_CARD_ORDER = [
  'account-summary',
  'net-pnl',
  'open-pnl',
  'open-risk',
  'avg-win-loss',
  'profit-factor',
  'win-rate',
  'expectancy',
  'avg-win-loss-values',
  'trades',
  'largest-win',
  'largest-loss',
]

function renderCard(card: CardConfig) {
  switch (card.type) {
    case 'account-summary':
      return <AccountSummaryCard accountEquity={card.accountEquity} startEquity={card.startEquity} netDeposits={card.netDeposits} trades={card.trades} />
    case 'open-pnl':
      return <OpenPnlCard trades={card.trades} />
    case 'open-risk':
      return <OpenRiskCard trades={card.trades} accountEquity={card.accountEquity} />
    case 'kpi':
      return <KpiCard label={card.label} value={card.value} sub={card.sub} trend={card.trend} href={card.href} hoverTitle={card.hoverTitle} hoverItems={card.hoverItems} />
  }
}

// Cards flagged hideOnMobile are display:none below the sm breakpoint
// (phone portrait) and shown normally at sm and up, desktop included.
function hideOnMobileClass(card: CardConfig) {
  return card.type === 'kpi' && card.hideOnMobile ? 'hidden sm:block' : undefined
}

function SortableCard({ card }: { card: CardConfig }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`touch-none select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${hideOnMobileClass(card) ?? ''}`}
    >
      {renderCard(card)}
    </div>
  )
}

export function OverviewKpiGrid({ cards }: { cards: CardConfig[] }) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => cards.map((c) => c.id))

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as string[]
      if (!Array.isArray(saved) || saved.length === 0) return
      const allIds = cards.map((c) => c.id)
      // Keep saved order, append any new IDs not in saved list
      const reordered = [
        ...saved.filter((id) => allIds.includes(id)),
        ...allIds.filter((id) => !saved.includes(id)),
      ]
      setOrderedIds(reordered)
    } catch {
      // ignore parse errors
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback((ids: string[]) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedIds((ids) => {
      const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
      save(next)
      return next
    })
  }

  // Drag-reorder is enabled only on fine-pointer (mouse) devices. On touch
  // devices the drag sensors (touch-none) hijack scroll gestures and kept
  // scrambling the cards by accident, so touch gets a plain grid — the saved
  // order is still displayed, it just can't be changed by dragging there.
  const [dragEnabled, setDragEnabled] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)')
    setDragEnabled(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setDragEnabled(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const cardMap = new Map(cards.map((c) => [c.id, c]))
  const orderedCards = orderedIds.map((id) => cardMap.get(id)).filter(Boolean) as CardConfig[]

  if (!dragEnabled) {
    const mobileCards = [...cards].sort((a, b) => {
      const ia = MOBILE_CARD_ORDER.indexOf(a.id)
      const ib = MOBILE_CARD_ORDER.indexOf(b.id)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {mobileCards.map((card) => (
          <div key={card.id} className={hideOnMobileClass(card)}>{renderCard(card)}</div>
        ))}
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {orderedCards.map((card) => (
            <SortableCard key={card.id} card={card} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
