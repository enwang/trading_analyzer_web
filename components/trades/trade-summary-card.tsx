'use client'

import { useEffect, useMemo, useState } from 'react'

import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

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
  needsReview: boolean
  setupTag: string
  notes: string
  source: string
  initialStopLoss: number | null
  initialRMultiple: number | null
  initialMfe: number | null
  initialMae: number | null
  onStopLossSaved?: (stopLoss: number | null, rMultiple: number | null) => void
}

interface PreEntryExtremes {
  entryDateInExchange: string
  exchangeTimeZone: string
  preEntry: {
    low: number
    high: number
  }
}

interface Candle {
  high: number
  low: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function fmtMoney(n: number | null) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const s = `$${abs.toFixed(2)}`
  return n < 0 ? `-${s}` : s
}

function fmtPct(n: number | null) {
  if (n == null) return '—'
  return `${(n * 100).toFixed(2)}%`
}

function computeRiskPerShare(side: Side, entry: number, stop: number) {
  if (side === 'long') return entry - stop
  if (side === 'short') return stop - entry
  return null
}

function computeR(side: Side, entry: number, exit: number, stop: number) {
  const riskPerShare = computeRiskPerShare(side, entry, stop)
  if (riskPerShare == null || riskPerShare <= 0) return null

  const rewardPerShare = side === 'long' ? exit - entry : entry - exit
  return rewardPerShare / riskPerShare
}

function Row({
  label,
  value,
  valueClassName = '',
}: {
  label: string
  value: string | number
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${valueClassName}`}>{value}</span>
    </div>
  )
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

export function TradeSummaryCard({
  tradeId,
  symbol,
  side,
  shares,
  entryTime,
  exitTime,
  entryPrice,
  exitPrice,
  pnl,
  pnlPct,
  needsReview,
  setupTag,
  notes,
  source,
  initialStopLoss,
  initialRMultiple,
  initialMfe,
  initialMae,
  onStopLossSaved,
}: Props) {
  const [stopLossInput, setStopLossInput] = useState(initialStopLoss?.toFixed(2) ?? '')
  const [savedR, setSavedR] = useState<number | null>(initialRMultiple)
  const [markedForReview, setMarkedForReview] = useState<boolean>(needsReview)
  const [error, setError] = useState<string | null>(null)
  const [mfe, setMfe] = useState<number | null>(initialMfe)
  const [mae, setMae] = useState<number | null>(initialMae)
  const [mfePct, setMfePct] = useState<number | null>(null)
  const [maePct, setMaePct] = useState<number | null>(null)
  const [mfeMaeDebug, setMfeMaeDebug] = useState<{ maxHigh: number; minLow: number; interval: string; maxHighTime: string; minLowTime: string } | null>(null)
  const [mfeMaeLoading, setMfeMaeLoading] = useState(false)
  const [lastSavedKey, setLastSavedKey] = useState(
    JSON.stringify({ stopLoss: initialStopLoss, rMultiple: initialRMultiple })
  )

  useEffect(() => {
    if (!entryTime || !symbol) return
    const entryTs = entryTime

    let canceled = false
    async function loadPreEntryExtremes() {
      setError(null)
      try {
        const res = await fetch(
          `/api/market/pre-entry-extremes?symbol=${encodeURIComponent(symbol)}&entryTime=${encodeURIComponent(entryTs)}`
        )
        const json = await res.json()
        if (!res.ok) {
          if (!canceled) setError(json.error ?? 'Failed to load market candle')
          return
        }

        const extremes = json as PreEntryExtremes
        if (canceled) return

        if (!initialStopLoss && side) {
          const candle: Candle = extremes.preEntry
          const suggested = side === 'long' ? round2(candle.low - 0.01) : round2(candle.high + 0.01)
          setStopLossInput((current) => (current.trim() === '' ? suggested.toFixed(2) : current))
        }
      } catch {
        if (!canceled) setError('Failed to load market candle')
      }
    }

    void loadPreEntryExtremes()
    return () => {
      canceled = true
    }
  }, [entryTime, symbol, side, initialStopLoss])

  // Always fetch fresh MFE/MAE from market data so stale stored values are corrected.
  // Display is always from the fresh fetch; DB is updated whenever the value changes.
  useEffect(() => {
    if (!entryTime || !exitTime || !side || entryPrice == null || shares == null) return

    let canceled = false
    async function fetchMfeMae() {
      setMfeMaeLoading(true)
      try {
        const params = new URLSearchParams({
          symbol,
          entryTime: entryTime!,
          exitTime: exitTime!,
          side: side!,
          entryPrice: String(entryPrice),
          shares: String(shares),
        })
        const res = await fetch(`/api/market/mfe-mae?${params}`)
        if (canceled) return
        if (!res.ok) return
        const json = await res.json() as { mfe: number; mae: number; mfePct: number; maePct: number; maxHigh: number; minLow: number; interval: string; maxHighTime: string; minLowTime: string }
        if (canceled) return
        setMfe(json.mfe)
        setMae(json.mae)
        setMfePct(json.mfePct)
        setMaePct(json.maePct)
        setMfeMaeDebug({ maxHigh: json.maxHigh, minLow: json.minLow, interval: json.interval, maxHighTime: json.maxHighTime, minLowTime: json.minLowTime })
        // Persist to DB if value changed
        if (json.mfe !== initialMfe || json.mae !== initialMae) {
          await fetch(`/api/trades/${tradeId}/mfe-mae`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mfe: json.mfe, mae: json.mae }),
          })
        }
      } catch {
        // Non-critical — silently ignore
      } finally {
        if (!canceled) setMfeMaeLoading(false)
      }
    }

    void fetchMfeMae()
    return () => { canceled = true }
  }, [tradeId, symbol, entryTime, exitTime, side, entryPrice, shares])

  const stopLoss = useMemo(() => {
    if (stopLossInput.trim() === '') return null
    const n = Number(stopLossInput)
    return Number.isFinite(n) ? n : null
  }, [stopLossInput])

  const riskPerShare = useMemo(() => {
    if (!side || entryPrice == null || stopLoss == null) return null
    const v = computeRiskPerShare(side, entryPrice, stopLoss)
    if (v == null || v <= 0) return null
    return v
  }, [side, entryPrice, stopLoss])

  const initialRiskAmount = useMemo(() => {
    if (riskPerShare == null || shares == null) return null
    return Math.abs(riskPerShare * shares)
  }, [riskPerShare, shares])

  const initialRiskPct = useMemo(() => {
    if (riskPerShare == null || entryPrice == null || entryPrice === 0) return null
    return Math.abs((riskPerShare / entryPrice) * 100)
  }, [riskPerShare, entryPrice])

  const liveR = useMemo(() => {
    if (!side || entryPrice == null || exitPrice == null || stopLoss == null) return null
    return computeR(side, entryPrice, exitPrice, stopLoss)
  }, [side, entryPrice, exitPrice, stopLoss])

  async function saveReviewState(nextNeedsReview: boolean) {
    setError(null)
    try {
      const res = await fetch(`/api/trades/${tradeId}/journal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupTag,
          notes,
          needsReview: nextNeedsReview,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to save revisit state')
        setMarkedForReview(!nextNeedsReview)
      }
    } catch {
      setError('Failed to save revisit state')
      setMarkedForReview(!nextNeedsReview)
    }
  }

  async function saveRisk(nextStopLoss: number | null, nextR: number | null) {
    setError(null)
    try {
      const res = await fetch(`/api/trades/${tradeId}/risk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopLoss: nextStopLoss, rMultiple: nextR }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to save risk values')
        return
      }
      setSavedR(nextR)
      setLastSavedKey(JSON.stringify({ stopLoss: nextStopLoss, rMultiple: nextR }))
      onStopLossSaved?.(nextStopLoss, nextR)
    } catch {
      setError('Failed to save risk values')
    }
  }

  useEffect(() => {
    if (stopLoss == null) return
    const currentKey = JSON.stringify({ stopLoss, rMultiple: liveR })
    if (currentKey === lastSavedKey) return

    const timer = setTimeout(() => {
      void saveRisk(stopLoss, liveR)
    }, 700)

    return () => clearTimeout(timer)
  }, [stopLoss, liveR, lastSavedKey])

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="text-sm font-medium">Trade Summary</CardTitle>
        <Button
          type="button"
          variant={markedForReview ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            const next = !markedForReview
            setMarkedForReview(next)
            void saveReviewState(next)
          }}
        >
          {markedForReview ? 'Marked for revisit' : 'Mark for revisit'}
        </Button>
      </CardHeader>
      <CardContent>
        <Row
          label="P&L"
          value={fmtMoney(pnl)}
          valueClassName={pnl != null ? (pnl >= 0 ? 'text-emerald-600' : 'text-red-600') : ''}
        />
        <Row
          label="P&L %"
          value={fmtPct(pnlPct)}
          valueClassName={pnlPct != null ? (pnlPct >= 0 ? 'text-emerald-600' : 'text-red-600') : ''}
        />
        <Row label="Revisit Later" value={markedForReview ? 'Yes' : 'No'} valueClassName={markedForReview ? 'text-amber-700' : ''} />
        <Row label="Side" value={side ?? '—'} />
        <Row label="Shares" value={shares ?? '—'} />
        <Row label="Entry Price" value={fmtMoney(entryPrice)} />
        <Row label="Exit Price" value={fmtMoney(exitPrice)} />

        <div className="border-b py-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Stop Loss</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              value={stopLossInput}
              onChange={(e) => setStopLossInput(e.target.value)}
              placeholder="Stop loss"
              className="h-8"
            />
          </div>
          {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
        </div>

        <Row label="Initial Risk" value={initialRiskAmount != null ? fmtMoney(initialRiskAmount) : '—'} />
        <Row label="Initial Risk %" value={initialRiskPct != null ? `${initialRiskPct.toFixed(2)}%` : '—'} />
        <Row label="R Multiple" value={liveR != null ? liveR.toFixed(2) : savedR != null ? savedR.toFixed(2) : '—'} />

        <div className="border-b py-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center text-sm text-muted-foreground">
              MFE
              <InfoTooltip text="Maximum Favorable Excursion — the largest unrealized gain the trade reached from entry to exit." />
            </span>
            <span className="text-sm font-medium text-emerald-600">
              {mfeMaeLoading ? '…' : mfe != null ? `$${mfe.toFixed(2)}${mfePct != null ? ` (${(mfePct * 100).toFixed(1)}%)` : ''}` : '—'}
            </span>
          </div>
          {mfeMaeDebug && entryPrice != null && (
            <div className="mt-0.5 text-right text-[11px] text-muted-foreground/70">
              peak&nbsp;{mfeMaeDebug.maxHigh.toFixed(2)} @ {new Date(mfeMaeDebug.maxHighTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} − entry&nbsp;{entryPrice.toFixed(2)} = {(mfeMaeDebug.maxHigh - entryPrice).toFixed(2)}/sh · {mfeMaeDebug.interval}
            </div>
          )}
        </div>
        <div className="border-b py-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center text-sm text-muted-foreground">
              MAE
              <InfoTooltip text="Maximum Adverse Excursion — the largest unrealized loss the trade experienced from entry to exit." />
            </span>
            <span className="text-sm font-medium text-red-600">
              {mfeMaeLoading ? '…' : mae != null ? `$${mae.toFixed(2)}${maePct != null ? ` (${(maePct * 100).toFixed(1)}%)` : ''}` : '—'}
            </span>
          </div>
          {mfeMaeDebug && entryPrice != null && (
            <div className="mt-0.5 text-right text-[11px] text-muted-foreground/70">
              entry&nbsp;{entryPrice.toFixed(2)} − trough&nbsp;{mfeMaeDebug.minLow.toFixed(2)} @ {new Date(mfeMaeDebug.minLowTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} = {(entryPrice - mfeMaeDebug.minLow).toFixed(2)}/sh · {mfeMaeDebug.interval}
            </div>
          )}
        </div>
        {mfe != null && pnl != null && mfe > 0 && (
          <div className="border-b py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Capture %</span>
              <span className="text-sm font-medium">
                {`${((pnl / mfe) * 100).toFixed(1)}%`}
              </span>
            </div>
          </div>
        )}

        <Row label="Setup Tag" value={setupTag || 'untagged'} />
        <div className="border-b py-2">
          <div className="mb-1 text-sm text-muted-foreground">Notes</div>
          <div className="whitespace-pre-wrap break-words text-sm font-medium">
            {notes.trim() || '—'}
          </div>
        </div>
        <Row label="Source" value={source} />
      </CardContent>
    </Card>
  )
}
