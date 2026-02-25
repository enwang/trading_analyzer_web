'use client'

import { useMemo } from 'react'

import { PnlBar } from '@/components/charts/pnl-bar'

type DailyTrade = {
  symbol: string
  exitTime: string | null
  pnl: number | null
}

function dateInTimeZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function fmtMoneySigned(n: number) {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`
}

export function DailyPnlByTimezone({ trades, height = 240 }: { trades: DailyTrade[]; height?: number }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const data = useMemo(() => {
    const dayMap = new Map<string, { pnl: number; trades: DailyTrade[] }>()

    for (const t of trades) {
      if (!t.exitTime || t.pnl == null) continue
      const date = dateInTimeZone(t.exitTime, timeZone)
      const bucket = dayMap.get(date) ?? { pnl: 0, trades: [] }
      bucket.pnl += t.pnl
      bucket.trades.push(t)
      dayMap.set(date, bucket)
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, bucket]) => ({
        label: date.slice(5),
        value: bucket.pnl,
        href: `/trades?date=${date}&tz=${encodeURIComponent(timeZone)}`,
        hoverTitle: `${date} (${bucket.trades.length} trades)`,
        hoverItems: (() => {
          const items = bucket.trades
            .slice(0, 6)
            .map((x) => `${x.symbol} ${fmtMoneySigned(x.pnl ?? 0)}`)
          if (bucket.trades.length > 6) items.push(`+${bucket.trades.length - 6} more`)
          return items
        })(),
      }))
  }, [trades, timeZone])

  return <PnlBar data={data} height={height} tooltipLabel={`Daily P&L (${timeZone})`} />
}

