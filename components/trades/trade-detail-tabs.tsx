'use client'

import { useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LocalTime } from '@/components/ui/local-time'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TradeSummaryCard } from '@/components/trades/trade-summary-card'
import { TradeAiAnalyzer } from '@/components/trades/trade-ai-analyzer'
import type { ExecutionLeg } from '@/types/trade'

type Side = 'long' | 'short' | null

interface Props {
  tradeId: string
  symbol: string
  side: Side
  shares: number | null
  entryTime: string | null
  exitTime: string | null
  entryPrice: number | null
  exitPrice: number | null
  pnl: number | null
  pnlPct: number | null
  holdTimeMin: number | null
  needsReview: boolean
  setupTag: string
  notes: string
  source: string
  initialStopLoss: number | null
  initialRMultiple: number | null
  initialMfe: number | null
  initialMae: number | null
  executionLegs: ExecutionLeg[] | null
}

function formatDuration(min: number | null) {
  if (min == null) return '—'
  if (min < 60) return `${min.toFixed(2)} min`
  const totalMinutes = Math.round(min)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  return `${hours}h ${minutes}m`
}

function openingAction(side: Side): 'BUY' | 'SELL' | null {
  if (side === 'long') return 'BUY'
  if (side === 'short') return 'SELL'
  return null
}

function signedQty(action: 'BUY' | 'SELL', shares: number) {
  return action === 'SELL' ? -shares : shares
}

function perFillGrossPnl(
  leg: ExecutionLeg,
  side: Side,
  entryPrice: number | null
): number | null {
  if (!side || entryPrice == null) return null
  const openAction = openingAction(side)
  if (!openAction) return null
  if (leg.action === openAction) return 0
  if (side === 'long') return (leg.price - entryPrice) * leg.shares
  return (entryPrice - leg.price) * leg.shares
}

function mergeExecutionLegs(legs: ExecutionLeg[] | null): ExecutionLeg[] {
  if (!legs || legs.length === 0) return []
  const buckets = new Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; weightedCost: number; sortTs: number }>()
  for (const leg of legs) {
    const ts = Date.parse(leg.time)
    const minuteBucket = Number.isNaN(ts) ? leg.time : String(Math.floor(ts / 60000))
    const key = `${minuteBucket}|${leg.action}`
    const existing = buckets.get(key) ?? {
      time: leg.time,
      action: leg.action,
      shares: 0,
      weightedCost: 0,
      sortTs: Number.isNaN(ts) ? 0 : ts,
    }
    existing.shares += leg.shares
    existing.weightedCost += leg.price * leg.shares
    if (!Number.isNaN(ts) && (existing.sortTs === 0 || ts < existing.sortTs)) {
      existing.sortTs = ts
      existing.time = leg.time
    }
    buckets.set(key, existing)
  }
  return Array.from(buckets.values())
    .map((b) => ({
      time: b.time,
      action: b.action,
      shares: b.shares,
      price: b.shares > 0 ? b.weightedCost / b.shares : 0,
    }))
    .sort((a, b) => {
      const ta = Date.parse(a.time)
      const tb = Date.parse(b.time)
      if (Number.isNaN(ta) || Number.isNaN(tb)) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
      return ta - tb
    })
}

function fmtPrice(n: number | null) {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function computeR(side: Side, entry: number, exit: number, stop: number): number | null {
  const risk = side === 'long' ? entry - stop : stop - entry
  if (risk <= 0) return null
  const reward = side === 'long' ? exit - entry : entry - exit
  return reward / risk
}

export function TradeDetailTabs(props: Props) {
  const [activeTab, setActiveTab] = useState<'summary' | 'executions' | 'ai'>('summary')
  const mergedExecutionLegs = mergeExecutionLegs(props.executionLegs)

  const [liveStopLoss, setLiveStopLoss] = useState<number | null>(props.initialStopLoss)
  const [liveRMultiple, setLiveRMultiple] = useState<number | null>(props.initialRMultiple)

  const displayR = liveRMultiple ?? (
    props.side && props.entryPrice != null && props.exitPrice != null && liveStopLoss != null
      ? computeR(props.side, props.entryPrice, props.exitPrice, liveStopLoss)
      : null
  )

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'summary' | 'executions' | 'ai')} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="executions">Executions</TabsTrigger>
        <TabsTrigger value="ai">AI Analyze</TabsTrigger>
      </TabsList>

      <TabsContent value="summary">
        <TradeSummaryCard
          tradeId={props.tradeId}
          symbol={props.symbol}
          side={props.side}
          shares={props.shares}
          entryTime={props.entryTime}
          exitTime={props.exitTime}
          entryPrice={props.entryPrice}
          exitPrice={props.exitPrice}
          pnl={props.pnl}
          pnlPct={props.pnlPct}
          needsReview={props.needsReview}
          setupTag={props.setupTag}
          notes={props.notes}
          source={props.source}
          initialStopLoss={props.initialStopLoss}
          initialRMultiple={props.initialRMultiple}
          initialMfe={props.initialMfe}
          initialMae={props.initialMae}
          onStopLossSaved={(sl, r) => { setLiveStopLoss(sl); setLiveRMultiple(r) }}
        />
      </TabsContent>

      <TabsContent value="executions">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Execution Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-xs text-muted-foreground">Direction</div>
              <div className="text-sm font-medium capitalize">{props.side ?? '—'}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-xs text-muted-foreground">Entry Time</div>
              <LocalTime date={props.entryTime} className="font-mono text-sm" />
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-xs text-muted-foreground">Exit Time</div>
              <LocalTime date={props.exitTime} className="font-mono text-sm" />
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-xs text-muted-foreground">Duration</div>
              <div className="text-sm font-medium">
                {formatDuration(props.holdTimeMin)}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-xs text-muted-foreground">Stop Loss</div>
              <div className="text-sm font-medium text-red-600">
                {fmtPrice(liveStopLoss)}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-1 text-xs text-muted-foreground">R Multiple</div>
              <div className={`text-sm font-medium ${displayR != null ? (displayR >= 0 ? 'text-emerald-600' : 'text-red-600') : ''}`}>
                {displayR != null ? displayR.toFixed(2) : '—'}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="mb-2 text-xs text-muted-foreground">Executions (every fill)</div>
              {mergedExecutionLegs.length > 0 ? (
                <div className="overflow-hidden rounded-md border">
                  <div className="grid grid-cols-[1.4fr_0.7fr_0.8fr_0.8fr_1fr] bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <span>Date/Time</span>
                    <span>Action</span>
                    <span className="text-right">Price</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Gross P&L</span>
                  </div>
                  {mergedExecutionLegs.map((leg, i) => {
                    const gross = perFillGrossPnl(leg, props.side, props.entryPrice)
                    const qty = signedQty(leg.action, leg.shares)
                    return (
                      <div key={`${leg.time}-${leg.action}-${i}`} className="grid grid-cols-[1.4fr_0.7fr_0.8fr_0.8fr_1fr] items-center border-t px-2 py-1.5 text-xs">
                        <LocalTime date={leg.time} className="font-mono text-muted-foreground" />
                        <span className={leg.action === 'BUY' ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>
                          {leg.action}
                        </span>
                        <span className="text-right">${leg.price.toFixed(4)}</span>
                        <span className="text-right">{qty > 0 ? `+${qty}` : `${qty}`}</span>
                        <span className={`text-right ${gross != null && gross > 0 ? 'text-emerald-700' : gross != null && gross < 0 ? 'text-red-700' : ''}`}>
                          {gross != null ? `${gross >= 0 ? '+' : ''}$${gross.toFixed(2)}` : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No execution legs available yet for this trade.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ai">
        {activeTab === 'ai' && <TradeAiAnalyzer tradeId={props.tradeId} />}
      </TabsContent>
    </Tabs>
  )
}
