'use client'

import { useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type OpenTradeForRisk = {
  symbol: string
  side: 'long' | 'short' | null
  shares: number | null
  stopLoss: number | null
}

export function OpenRiskCard({
  trades,
  accountEquity,
}: {
  trades: OpenTradeForRisk[]
  accountEquity: number | null
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

    return () => {
      canceled = true
    }
  }, [symbols])

  const { totalRisk, tradesWithStops } = useMemo(() => {
    let risk = 0
    let withStops = 0
    for (const t of trades) {
      if (!t.side || t.shares == null || t.stopLoss == null) continue
      withStops++
      const price = quotes[t.symbol.trim().toUpperCase()]
      if (price == null) continue
      const riskPerShare = t.side === 'long' ? price - t.stopLoss : t.stopLoss - price
      risk += Math.max(0, riskPerShare * Math.abs(t.shares))
    }
    return { totalRisk: risk, tradesWithStops: withStops }
  }, [trades, quotes])

  const riskPct =
    accountEquity != null && accountEquity > 0 ? (totalRisk / accountEquity) * 100 : null

  return (
    <Card className="h-full gap-2 py-5">
      <CardHeader className="pb-0">
        <CardTitle className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Open Risk
        </CardTitle>
      </CardHeader>
      <CardContent>
        {quotesReady ? (
          <>
            <p className="text-2xl font-bold tabular-nums text-red-600">
              ${totalRisk.toFixed(2)}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {riskPct != null
                ? `${riskPct.toFixed(1)}% of account`
                : 'Account equity unavailable'}
            </p>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-2xl font-bold tabular-nums">—</p>
            <p className="text-muted-foreground mt-0.5 text-xs">Loading quotes…</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
