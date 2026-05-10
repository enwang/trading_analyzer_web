'use client'

import { useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type OpenTradeForPnl = {
  symbol: string
  side: 'long' | 'short' | null
  shares: number | null
  entryPrice: number | null
  realizedPnl: number | null
}

function fmtMoneySigned(n: number) {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`
}

function valueClass(n: number) {
  if (n > 0) return 'text-emerald-600'
  if (n < 0) return 'text-red-600'
  return ''
}

export function OpenPnlCard({ trades }: { trades: OpenTradeForPnl[] }) {
  const symbols = useMemo(
    () => [...new Set(trades.map((t) => t.symbol.trim().toUpperCase()).filter(Boolean))],
    [trades]
  )
  const [quotes, setQuotes] = useState<Record<string, number | null>>({})

  useEffect(() => {
    if (symbols.length === 0) {
      setQuotes({})
      return
    }

    let canceled = false
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((json: { quotes?: Record<string, number | null> } | null) => {
        if (!canceled) setQuotes(json?.quotes ?? {})
      })
      .catch(() => {
        if (!canceled) setQuotes({})
      })

    return () => {
      canceled = true
    }
  }, [symbols])

  const partialGains = trades.reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0)
  let priced = 0
  const unrealized = trades.reduce((sum, t) => {
    const price = quotes[t.symbol.trim().toUpperCase()]
    if (!t.side || t.entryPrice == null || t.shares == null || price == null) return sum
    priced += 1
    return sum + (t.side === 'long'
      ? (price - t.entryPrice) * t.shares
      : (t.entryPrice - price) * t.shares)
  }, 0)
  const total = unrealized + partialGains

  return (
    <Card className="h-full gap-2 py-5">
      <CardHeader className="pb-0">
        <CardTitle className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Open P&L
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold tabular-nums ${valueClass(total)}`}>
          {fmtMoneySigned(total)}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Unrealized {fmtMoneySigned(unrealized)} · Partial {fmtMoneySigned(partialGains)}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">{priced}/{trades.length} open priced</p>
      </CardContent>
    </Card>
  )
}
