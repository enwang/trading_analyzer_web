'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type OpenTradeForRisk = {
  symbol: string
  side: 'long' | 'short' | null
  shares: number | null
  stopLoss: number | null
}

function fmt(n: number) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtSigned(n: number) {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function AccountSummaryCard({
  accountEquity,
  startEquity,
  netDeposits = 0,
  trades,
}: {
  accountEquity: number | null
  startEquity: number | null
  netDeposits?: number
  trades: OpenTradeForRisk[]
}) {
  const symbols = useMemo(
    () => [...new Set(trades.map((t) => t.symbol.trim().toUpperCase()).filter(Boolean))],
    [trades]
  )
  const [quotes, setQuotes] = useState<Record<string, number | null>>({})
  const [quotesReady, setQuotesReady] = useState(symbols.length === 0)

  useEffect(() => {
    if (symbols.length === 0) {
      setQuotes({})
      setQuotesReady(true)
      return
    }
    let canceled = false
    setQuotesReady(false)
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { quotes?: Record<string, number | null> } | null) => {
        if (!canceled) {
          setQuotes(json?.quotes ?? {})
          setQuotesReady(true)
        }
      })
      .catch(() => {
        if (!canceled) {
          setQuotes({})
          setQuotesReady(true)
        }
      })
    return () => { canceled = true }
  }, [symbols])

  const totalRisk = useMemo(() => {
    let risk = 0
    for (const t of trades) {
      if (!t.side || t.shares == null || t.stopLoss == null) continue
      const price = quotes[t.symbol.trim().toUpperCase()]
      if (price == null) continue
      const riskPerShare = t.side === 'long' ? price - t.stopLoss : t.stopLoss - price
      risk += Math.max(0, riskPerShare * Math.abs(t.shares))
    }
    return risk
  }, [trades, quotes])

  const gain = accountEquity != null && startEquity != null ? accountEquity - startEquity - netDeposits : null
  const floor = accountEquity != null ? accountEquity - totalRisk : null

  return (
    <Card className="h-full gap-2 py-5">
      <CardHeader className="pb-0">
        <CardTitle className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Account Value
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">
          {accountEquity != null ? fmt(accountEquity) : '—'}
        </p>
        {gain != null && (
          <p className={`mt-0.5 text-xs font-medium tabular-nums ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {fmtSigned(gain)}
          </p>
        )}
        <p className="text-muted-foreground mt-0.5 text-xs">
          {quotesReady
            ? `Floor value: ${floor != null ? fmt(floor) : '—'}`
            : 'Floor value: loading…'}
        </p>
      </CardContent>
    </Card>
  )
}
