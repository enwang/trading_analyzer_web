'use client'

import { useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LocalTime } from '@/components/ui/local-time'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TradeAiAnalyzer } from '@/components/trades/trade-ai-analyzer'
import { DEFAULT_INITIAL_RISK_AMOUNT, suggestedStopLossFromRisk } from '@/lib/market/stop-loss'
import { riskSharesForTrade } from '@/lib/trades'
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
  initialRiskAmount: number | null
  initialMfe: number | null
  initialMae: number | null
  executionLegs: ExecutionLeg[] | null
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  return `${n < 0 ? '-' : ''}$${abs.toFixed(2)}`
}

function fmtPct(n: number | null) {
  if (n == null) return '—'
  return `${(n * 100).toFixed(2)}%`
}

function formatDuration(min: number | null) {
  if (min == null) return '—'
  if (min < 60) return `${min.toFixed(0)}m`
  const totalMinutes = Math.round(min)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  return `${hours}h ${minutes}m`
}

function computeRiskPerShare(side: Side, entry: number, stop: number) {
  if (side === 'long') return entry - stop
  if (side === 'short') return stop - entry
  return null
}

function computeR(side: Side, entry: number, exit: number, stop: number) {
  const rps = computeRiskPerShare(side, entry, stop)
  if (rps == null || rps <= 0) return null
  return (side === 'long' ? exit - entry : entry - exit) / rps
}

function openingAction(side: Side): 'BUY' | 'SELL' | null {
  if (side === 'long') return 'BUY'
  if (side === 'short') return 'SELL'
  return null
}

function signedQty(action: 'BUY' | 'SELL', shares: number) {
  return action === 'SELL' ? -shares : shares
}

function perFillGrossPnl(leg: ExecutionLeg, side: Side, entryPrice: number | null) {
  if (!side || entryPrice == null) return null
  const oa = openingAction(side)
  if (!oa) return null
  if (leg.action === oa) return 0
  if (side === 'long') return (leg.price - entryPrice) * leg.shares
  return (entryPrice - leg.price) * leg.shares
}

function mergeExecutionLegs(legs: ExecutionLeg[] | null): ExecutionLeg[] {
  if (!legs || legs.length === 0) return []
  const buckets = new Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; weightedCost: number; sortTs: number }>()
  for (const leg of legs) {
    const ts = Date.parse(leg.time)
    const bucket = Number.isNaN(ts) ? leg.time : String(Math.floor(ts / 60000))
    const key = `${bucket}|${leg.action}`
    const ex = buckets.get(key) ?? { time: leg.time, action: leg.action, shares: 0, weightedCost: 0, sortTs: Number.isNaN(ts) ? 0 : ts }
    ex.shares += leg.shares
    ex.weightedCost += leg.price * leg.shares
    if (!Number.isNaN(ts) && (ex.sortTs === 0 || ts < ex.sortTs)) { ex.sortTs = ts; ex.time = leg.time }
    buckets.set(key, ex)
  }
  return Array.from(buckets.values())
    .map((b) => ({ time: b.time, action: b.action, shares: b.shares, price: b.shares > 0 ? b.weightedCost / b.shares : 0 }))
    .sort((a, b) => { const ta = Date.parse(a.time); const tb = Date.parse(b.time); if (Number.isNaN(ta) || Number.isNaN(tb)) return a.time < b.time ? -1 : 1; return ta - tb })
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex items-center">
      <Info className="h-3 w-3 cursor-help text-muted-foreground/60" />
      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-1.5 w-56 -translate-y-1/2 rounded-md bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  )
}

function KpiCell({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold leading-tight">{children}</span>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b py-1.5 last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium">{children}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>
}

// ── main component ────────────────────────────────────────────────────────────

export function TradeDetailTabs(props: Props) {
  const {
    tradeId, symbol, side, shares, entryTime, exitTime,
    entryPrice, exitPrice, pnl, pnlPct, holdTimeMin,
    needsReview, setupTag, notes, source,
    initialStopLoss, initialRMultiple, initialRiskAmount,
    initialMfe, initialMae, executionLegs,
  } = props

  // ── review state ──────────────────────────────────────────────────────────
  const [markedForReview, setMarkedForReview] = useState(needsReview)
  const [reviewError, setReviewError] = useState<string | null>(null)

  async function toggleReview() {
    const next = !markedForReview
    setMarkedForReview(next)
    setReviewError(null)
    try {
      const res = await fetch(`/api/trades/${tradeId}/journal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupTag, notes, needsReview: next }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setReviewError(json.error ?? 'Failed to save')
        setMarkedForReview(!next)
      }
    } catch {
      setReviewError('Failed to save')
      setMarkedForReview(!next)
    }
  }

  // ── risk / stop-loss state ────────────────────────────────────────────────
  const riskShares = useMemo(
    () => riskSharesForTrade({ side, shares, exitTime, outcome: null, executionLegs }),
    [side, shares, exitTime, executionLegs]
  )
  const [initialRiskInput, setInitialRiskInput] = useState(
    () => (initialRiskAmount ?? DEFAULT_INITIAL_RISK_AMOUNT).toFixed(2)
  )
  const [savedR, setSavedR] = useState<number | null>(initialRMultiple)
  const [riskError, setRiskError] = useState<string | null>(null)
  const [lastSavedKey, setLastSavedKey] = useState(
    JSON.stringify({ stopLoss: initialStopLoss, rMultiple: initialRMultiple })
  )

  const parsedInitialRisk = useMemo(() => {
    const n = Number(initialRiskInput.trim())
    return Number.isFinite(n) && n > 0 ? n : null
  }, [initialRiskInput])

  const stopLoss = useMemo(
    () => (parsedInitialRisk == null ? null : suggestedStopLossFromRisk(side, entryPrice, riskShares, parsedInitialRisk)),
    [side, entryPrice, riskShares, parsedInitialRisk]
  )

  const initialRiskPct = useMemo(() => {
    if (!side || entryPrice == null || stopLoss == null || entryPrice === 0) return null
    const rps = computeRiskPerShare(side, entryPrice, stopLoss)
    if (rps == null || rps <= 0) return null
    return Math.abs((rps / entryPrice) * 100)
  }, [side, entryPrice, stopLoss])

  const liveR = useMemo(
    () => (!side || entryPrice == null || exitPrice == null || stopLoss == null ? null : computeR(side, entryPrice, exitPrice, stopLoss)),
    [side, entryPrice, exitPrice, stopLoss]
  )

  async function saveRisk(nextStopLoss: number | null, nextR: number | null, nextInitialRisk?: number | null) {
    setRiskError(null)
    try {
      const res = await fetch(`/api/trades/${tradeId}/risk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stopLoss: nextStopLoss,
          rMultiple: nextR,
          ...(nextInitialRisk !== undefined ? { initialRiskAmount: nextInitialRisk } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setRiskError(json.error ?? 'Failed to save risk'); return }
      setSavedR(nextR)
      setLastSavedKey(JSON.stringify({ stopLoss: nextStopLoss, rMultiple: nextR }))
    } catch {
      setRiskError('Failed to save risk')
    }
  }

  useEffect(() => {
    if (stopLoss == null) return
    const currentKey = JSON.stringify({ stopLoss, rMultiple: liveR })
    if (currentKey === lastSavedKey) return
    const timer = setTimeout(() => { void saveRisk(stopLoss, liveR, parsedInitialRisk) }, 700)
    return () => clearTimeout(timer)
  }, [stopLoss, liveR, lastSavedKey, parsedInitialRisk])

  // ── MFE / MAE state ───────────────────────────────────────────────────────
  const [mfe, setMfe] = useState<number | null>(initialMfe)
  const [mae, setMae] = useState<number | null>(initialMae)
  const [mfePct, setMfePct] = useState<number | null>(null)
  const [maePct, setMaePct] = useState<number | null>(null)
  const [mfeMaeDebug, setMfeMaeDebug] = useState<{ maxHigh: number; minLow: number; interval: string; maxHighTime: string; minLowTime: string } | null>(null)
  const [mfeMaeLoading, setMfeMaeLoading] = useState(false)

  useEffect(() => {
    if (exitTime != null) return
    if (!entryTime || !side || entryPrice == null || shares == null) return
    let canceled = false
    async function fetchMfeMae() {
      setMfeMaeLoading(true)
      try {
        const params = new URLSearchParams({ symbol, entryTime: entryTime!, exitTime: new Date().toISOString(), side: side!, entryPrice: String(entryPrice), shares: String(shares) })
        const res = await fetch(`/api/market/mfe-mae?${params}`)
        if (canceled || !res.ok) return
        const json = await res.json() as { mfe: number; mae: number; mfePct: number; maePct: number; maxHigh: number; minLow: number; interval: string; maxHighTime: string; minLowTime: string }
        if (canceled) return
        setMfe(json.mfe); setMae(json.mae); setMfePct(json.mfePct); setMaePct(json.maePct)
        setMfeMaeDebug({ maxHigh: json.maxHigh, minLow: json.minLow, interval: json.interval, maxHighTime: json.maxHighTime, minLowTime: json.minLowTime })
        if (json.mfe !== initialMfe || json.mae !== initialMae) {
          await fetch(`/api/trades/${tradeId}/mfe-mae`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfe: json.mfe, mae: json.mae }) })
        }
      } catch { /* non-critical */ } finally { if (!canceled) setMfeMaeLoading(false) }
    }
    void fetchMfeMae()
    return () => { canceled = true }
  }, [tradeId, symbol, entryTime, side, entryPrice, shares])

  // ── open-trade live R ─────────────────────────────────────────────────────
  const [openTradeR, setOpenTradeR] = useState<number | null>(null)

  useEffect(() => {
    if (exitTime != null) return
    if (!side || entryPrice == null || parsedInitialRisk == null || parsedInitialRisk <= 0) return
    const absShares = Math.abs(shares ?? 0)
    if (absShares === 0) return
    let canceled = false
    async function fetchR() {
      const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbol)}`)
      if (canceled || !res.ok) return
      const json = await res.json() as { quotes: Record<string, number | null> }
      const price = json.quotes?.[symbol.trim().toUpperCase()] ?? null
      if (price == null || canceled) return
      const unrealized = side === 'long' ? (price - entryPrice!) * absShares : (entryPrice! - price) * absShares
      const r = ((pnl ?? 0) + unrealized) / parsedInitialRisk!
      if (Number.isFinite(r)) setOpenTradeR(r)
    }
    void fetchR()
    return () => { canceled = true }
  }, [exitTime, symbol, side, entryPrice, shares, pnl, parsedInitialRisk])

  // ── derived display values ────────────────────────────────────────────────
  const displayR = exitTime == null
    ? ((openTradeR ?? savedR) != null ? (openTradeR ?? savedR)!.toFixed(2) : '—')
    : (savedR != null ? savedR.toFixed(2) : '—')

  const captureDisplay = mfe != null && pnl != null && mfe > 0
    ? `${((pnl / mfe) * 100).toFixed(1)}%`
    : null

  const mergedLegs = mergeExecutionLegs(executionLegs)

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <Tabs defaultValue="trade" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="trade">Trade</TabsTrigger>
        <TabsTrigger value="ai">AI Analyze</TabsTrigger>
      </TabsList>

      <TabsContent value="trade">
        <Card>
          <CardContent className="p-4">

            {/* Header: P&L + revisit button */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className={`text-xl font-bold ${pnl != null ? (pnl >= 0 ? 'text-emerald-600' : 'text-red-600') : ''}`}>
                  {fmtMoney(pnl)}
                </div>
                <div className={`text-xs ${pnlPct != null ? (pnlPct >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-muted-foreground'}`}>
                  {fmtPct(pnlPct)}
                </div>
              </div>
              <Button
                type="button"
                variant={markedForReview ? 'default' : 'outline'}
                size="sm"
                onClick={() => { void toggleReview() }}
              >
                {markedForReview ? 'Marked for revisit' : 'Mark for revisit'}
              </Button>
            </div>
            {reviewError && <div className="mt-1 text-xs text-red-700">{reviewError}</div>}

            {/* KPI strip: R | MFE | MAE | Capture */}
            <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg border bg-muted/30 px-3 py-2">
              <KpiCell label="R">{displayR}</KpiCell>
              <KpiCell label="MFE" className="text-emerald-600">
                {mfeMaeLoading ? '…' : mfe != null ? `$${mfe.toFixed(0)}` : '—'}
              </KpiCell>
              <KpiCell label="MAE" className="text-red-600">
                {mfeMaeLoading ? '…' : mae != null ? `$${mae.toFixed(0)}` : '—'}
              </KpiCell>
              <KpiCell label="Capture">
                {captureDisplay ?? '—'}
              </KpiCell>
            </div>

            {/* Trade details */}
            <SectionTitle>Trade</SectionTitle>
            <div className="rounded-md border px-3 py-1">
              <Row label="Direction"><span className="capitalize">{side ?? '—'}</span></Row>
              <Row label="Shares">{shares ?? '—'}</Row>
              <Row label="Entry">
                <span className="flex flex-col items-end gap-0.5">
                  <span>{fmtMoney(entryPrice)}</span>
                  <LocalTime date={entryTime} className="font-mono text-[11px] text-muted-foreground" />
                </span>
              </Row>
              <Row label="Exit">
                {exitPrice != null ? (
                  <span className="flex flex-col items-end gap-0.5">
                    <span>{fmtMoney(exitPrice)}</span>
                    <LocalTime date={exitTime} className="font-mono text-[11px] text-muted-foreground" />
                  </span>
                ) : '—'}
              </Row>
              <Row label="Duration">{formatDuration(holdTimeMin)}</Row>
              <Row label="Source">{source}</Row>
            </div>

            {/* Risk */}
            <SectionTitle>Risk</SectionTitle>
            <div className="rounded-md border px-3 py-2">
              <div className="mb-2 flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">Initial Risk</span>
                <Input
                  type="number"
                  step="0.01"
                  value={initialRiskInput}
                  onChange={(e) => setInitialRiskInput(e.target.value)}
                  className="h-7 w-24 text-xs"
                />
                <span className="ml-auto text-xs text-muted-foreground">
                  {initialRiskPct != null ? `${initialRiskPct.toFixed(2)}%` : '—'}
                </span>
              </div>
              {riskError && <div className="mb-1 text-xs text-red-700">{riskError}</div>}

              {/* MFE row */}
              <div className="border-t pt-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center text-xs text-muted-foreground">
                    MFE<InfoTooltip text="Maximum Favorable Excursion — largest unrealized gain from entry to exit." />
                  </span>
                  <span className="text-xs font-medium text-emerald-600">
                    {mfeMaeLoading ? '…' : mfe != null ? `$${mfe.toFixed(2)}${mfePct != null ? ` (${(mfePct * 100).toFixed(1)}%)` : ''}` : '—'}
                  </span>
                </div>
                {mfeMaeDebug && entryPrice != null && (
                  <div className="mt-0.5 text-right text-[10px] text-muted-foreground/60">
                    peak {mfeMaeDebug.maxHigh.toFixed(2)} @ {new Date(mfeMaeDebug.maxHighTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {mfeMaeDebug.interval}
                  </div>
                )}
              </div>

              {/* MAE row */}
              <div className="border-t pt-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center text-xs text-muted-foreground">
                    MAE<InfoTooltip text="Maximum Adverse Excursion — largest unrealized loss from entry to exit." />
                  </span>
                  <span className="text-xs font-medium text-red-600">
                    {mfeMaeLoading ? '…' : mae != null ? `$${mae.toFixed(2)}${maePct != null ? ` (${(maePct * 100).toFixed(1)}%)` : ''}` : '—'}
                  </span>
                </div>
                {mfeMaeDebug && entryPrice != null && (
                  <div className="mt-0.5 text-right text-[10px] text-muted-foreground/60">
                    trough {mfeMaeDebug.minLow.toFixed(2)} @ {new Date(mfeMaeDebug.minLowTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {mfeMaeDebug.interval}
                  </div>
                )}
              </div>
            </div>

            {/* Setup & Notes */}
            <SectionTitle>Setup & Notes</SectionTitle>
            <div className="rounded-md border px-3 py-1">
              <Row label="Setup"><span className="capitalize">{setupTag === 'untagged' ? 'None' : setupTag}</span></Row>
              {notes.trim() && (
                <div className="border-t py-2">
                  <div className="whitespace-pre-wrap break-words text-xs">{notes.trim()}</div>
                </div>
              )}
            </div>

            {/* Executions */}
            <SectionTitle>Executions</SectionTitle>
            {mergedLegs.length > 0 ? (
              <div className="overflow-hidden rounded-md border">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  <span>Time</span>
                  <span className="px-2">Action</span>
                  <span className="px-2 text-right">Price</span>
                  <span className="px-2 text-right">Qty</span>
                  <span className="text-right">P&L</span>
                </div>
                {mergedLegs.map((leg, i) => {
                  const gross = perFillGrossPnl(leg, side, entryPrice)
                  const qty = signedQty(leg.action, leg.shares)
                  return (
                    <div key={`${leg.time}-${leg.action}-${i}`} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center border-t px-2 py-1.5 text-[11px]">
                      <LocalTime date={leg.time} className="font-mono text-muted-foreground" />
                      <span className={`px-2 font-medium ${leg.action === 'BUY' ? 'text-emerald-700' : 'text-red-700'}`}>{leg.action}</span>
                      <span className="px-2 text-right">${leg.price.toFixed(2)}</span>
                      <span className="px-2 text-right">{qty > 0 ? `+${qty}` : `${qty}`}</span>
                      <span className={`text-right ${gross != null && gross > 0 ? 'text-emerald-700' : gross != null && gross < 0 ? 'text-red-700' : ''}`}>
                        {gross != null ? `${gross >= 0 ? '+' : ''}$${gross.toFixed(2)}` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">No execution data available.</div>
            )}

          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ai">
        <TradeAiAnalyzer tradeId={tradeId} />
      </TabsContent>
    </Tabs>
  )
}
