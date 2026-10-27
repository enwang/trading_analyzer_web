import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { AnalysisView } from '@/components/charts/analysis-view'

// Dev-only layout harness: renders the real AnalysisView with fixture data
// (wide money values, many trades, several months) so the Analysis tab's
// mobile layout can be screenshot-tested at any viewport without logging in.
// Disabled unless ENABLE_DEV_HARNESS=1 (never set on Vercel) → 404s.
export const dynamic = 'force-dynamic'

type FixtureTrade = {
  id: string
  symbol: string
  entryTime: string
  exitTime: string
  pnl: number
  pnlPct: number
  outcome: 'win' | 'loss' | 'breakeven'
  shares: number
  rMultiple: number
  holdTimeMin: number
}

const SYMBOLS = ['NVDA', 'AVGO', 'MRVL', 'SNDK', 'MU', 'ARM', 'TSM', 'AMD', 'SMCI', 'PLTR', 'COIN', 'MSTR']
const PNLS = [12345.67, -8234.5, 3210.25, -1950.75, 15420.0, -12340.99, 890.4, -640.2, 2210.1, -3120.6, 5430.75, -4210.3, 0, 7650.2, -9870.45]

function buildTrades(): FixtureTrade[] {
  const trades: FixtureTrade[] = []
  let n = 0
  for (let month = 8; month <= 10; month++) {
    for (let day = 2; day <= 26; day += 2) {
      const pnl = PNLS[n % PNLS.length]
      const symbol = SYMBOLS[n % SYMBOLS.length]
      const mm = String(month).padStart(2, '0')
      const dd = String(day).padStart(2, '0')
      trades.push({
        id: `fixture-${n}`,
        symbol,
        entryTime: `2026-${mm}-${dd}T14:32:00.000Z`,
        exitTime: `2026-${mm}-${dd}T19:45:00.000Z`,
        pnl,
        pnlPct: pnl / 150000,
        outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
        shares: 1250 + (n % 5) * 375,
        rMultiple: pnl / 2000,
        holdTimeMin: 313 + (n % 7) * 145,
      })
      n++
    }
  }
  return trades
}

export default function DevHarnessAnalysisPage() {
  if (process.env.ENABLE_DEV_HARNESS !== '1') notFound()

  const trades = buildTrades()
  const closed = trades.map((t) => ({ ...t }))
  const months = [
    { monthKey: '2026-08', monthLabel: 'Aug 26' },
    { monthKey: '2026-09', monthLabel: 'Sep 26' },
    { monthKey: '2026-10', monthLabel: 'Oct 26' },
  ]

  const data = {
    summaryBase: {
      netPnl: 48213.55,
      winPct: 54.2,
      profitFactor: 1.87,
      tradeExpectancy: 1234.56,
      avgNetTradePnl: 1234.56,
      avgRealizedRMultiple: 0.62,
      avgHoldWinMin: 4320,
      avgHoldLossMin: 2880,
      payoffRatio: 1.62,
      avgWin: 8234.12,
      avgLoss: -5123.45,
    },
    closedTrades: closed,
    summaryClosedTrades: closed,
    monthlyRecap: {
      year: '2026',
      returns: months.map((m, i) => ({
        monthKey: m.monthKey,
        monthLabel: m.monthLabel,
        startingNav: 812345 + i * 40000,
        endingNav: 852345 + i * 40000,
        depositsWithdrawals: i === 0 ? 50000 : 0,
        monthReturnPct: 4.93 - i * 2.1,
        cumulativeReturnPct: 12.34 - i * 3.2,
      })),
      stats: months.map((m, i) => ({
        monthKey: m.monthKey,
        monthLabel: m.monthLabel,
        avgGainPct: 8.42,
        avgLossPct: 4.21,
        avgWin: 8234,
        avgLoss: -5123,
        winPct: 54.2,
        lossPct: 45.8,
        wins: 13 + i,
        losses: 11,
        trades: 24 + i,
        largestGainPct: 32.56,
        largestLossPct: 12.34,
        avgDaysGain: 3.21,
        avgDaysLoss: 2.14,
      })),
      yearly: {
        year: '2026',
        avgGainPct: 8.42,
        avgLossPct: 4.21,
        avgWin: 8234,
        avgLoss: -5123,
        winPct: 54.2,
        lossPct: 45.8,
        wins: 41,
        losses: 35,
        trades: 76,
        largestGainPct: 32.56,
        largestLossPct: 12.34,
        avgDaysGain: 3.21,
        avgDaysLoss: 2.14,
      },
    },
  }

  return (
    <div className="min-h-screen bg-background p-4 text-foreground md:p-6">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Analysis</h1>
        <Suspense fallback={null}>
          <AnalysisView data={data} />
        </Suspense>
      </div>
    </div>
  )
}
