'use client'

import { useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type Side = 'long' | 'short' | null

interface Props {
  tradeId: string
  symbol: string
  side: Side
  shares: number | null
  entryTime: string | null
  entryPrice: number | null
  exitPrice: number | null
  pnl: number | null
  pnlPct: number | null
  setupTag: string
  source: string
  initialStopLoss: number | null
  initialRMultiple: number | null
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

export function TradeSummaryCard({
  tradeId,
  symbol,
  side,
  shares,
  entryTime,
  entryPrice,
  exitPrice,
  pnl,
  pnlPct,
  setupTag,
  source,
  initialStopLoss,
  initialRMultiple,
  onStopLossSaved,
}: Props) {
  const [stopLossInput, setStopLossInput] = useState(initialStopLoss?.toFixed(2) ?? '')
  const [savedR, setSavedR] = useState<number | null>(initialRMultiple)
  const [error, setError] = useState<string | null>(null)
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
      <CardHeader>
        <CardTitle className="text-sm font-medium">Trade Summary</CardTitle>
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
        <Row label="Setup Tag" value={setupTag || 'untagged'} />
        <Row label="Source" value={source} />
      </CardContent>
    </Card>
  )
}
