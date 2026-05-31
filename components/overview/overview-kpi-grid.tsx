'use client'

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
  | { id: string; type: 'kpi'; label: string; value: string; sub?: string; trend?: 'up' | 'down'; href?: string; hoverTitle?: string; hoverItems?: string[] }

const LS_KEY = 'overview-kpi-order'

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

function SortableCard({ card }: { card: CardConfig }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`touch-none select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
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

  const cardMap = new Map(cards.map((c) => [c.id, c]))
  const orderedCards = orderedIds.map((id) => cardMap.get(id)).filter(Boolean) as CardConfig[]

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
