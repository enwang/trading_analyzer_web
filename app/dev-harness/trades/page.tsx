import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { TradesTable } from '@/components/trades/trades-table'
import type { Trade } from '@/types/trade'

// Dev-only harness for the trades list: renders the real dashboard shell
// (mobile top bar + drawer) and the real TradesTable with fixture trades so
// the mobile list layout can be screenshot-tested without logging in.
// Disabled unless ENABLE_DEV_HARNESS=1 (never set on Vercel), else 404.
export const dynamic = 'force-dynamic'

function fixture(partial: Partial<Trade> & { id: string; symbol: string }): Trade {
  return {
    userId: 'fixture',
    entryTime: null,
    exitTime: null,
    side: 'long',
    shares: null,
    entryPrice: null,
    exitPrice: null,
    pnl: null,
    pnlPct: null,
    outcome: null,
    holdDays: null,
    holdTimeMin: null,
    hourOfDay: null,
    dayOfWeek: null,
    stopLoss: null,
    currentStopLoss: null,
    stopLossLocked: false,
    initialRiskAmount: null,
    rMultiple: null,
    needsReview: false,
    setupTag: 'untagged',
    notes: '',
    executionLegs: null,
    mfe: null,
    mae: null,
    source: 'ibkr',
    createdAt: '2026-10-19T00:00:00.000Z',
    ...partial,
  }
}

const TRADES: Trade[] = [
  fixture({
    id: 'fx1',
    symbol: 'NVDA',
    side: 'long',
    entryTime: '2026-10-14T13:45:00.000Z',
    exitTime: '2026-10-15T17:58:00.000Z',
    shares: 1250,
    entryPrice: 213.25,
    exitPrice: 221.87,
    pnl: 10775.0,
    pnlPct: 0.0404,
    outcome: 'win',
    holdDays: 1,
    holdTimeMin: 1693,
    stopLoss: 208.4,
    rMultiple: 1.78,
    setupTag: 'breakout',
  }),
  fixture({
    id: 'fx2',
    symbol: 'MRNA',
    side: 'long',
    entryTime: '2026-10-16T14:03:00.000Z',
    exitTime: null,
    shares: 300,
    entryPrice: 143.7,
    exitPrice: null,
    pnl: -612.0,
    pnlPct: null,
    outcome: 'open',
    holdDays: null,
    holdTimeMin: null,
    stopLoss: 137.03,
    currentStopLoss: 141.08,
    rMultiple: null,
    setupTag: 'pullback',
  }),
  fixture({
    id: 'fx3',
    symbol: 'PLTR',
    side: 'short',
    entryTime: '2026-09-10T14:12:00.000Z',
    exitTime: '2026-09-10T17:40:00.000Z',
    shares: 600,
    entryPrice: 168.8,
    exitPrice: 165.75,
    pnl: 1830.0,
    pnlPct: 0.0181,
    outcome: 'win',
    holdDays: 0,
    holdTimeMin: 208,
    stopLoss: 165.8,
    rMultiple: 1.02,
    needsReview: true,
  }),
  fixture({
    id: 'fx4',
    symbol: 'SNDK',
    side: 'long',
    entryTime: '2026-09-23T15:30:00.000Z',
    exitTime: '2026-09-25T16:05:00.000Z',
    shares: 200,
    entryPrice: 812.4,
    exitPrice: 768.15,
    pnl: -8850.0,
    pnlPct: -0.0545,
    outcome: 'loss',
    holdDays: 2,
    holdTimeMin: 2915,
    stopLoss: 790.0,
    rMultiple: -1.97,
  }),
  fixture({
    id: 'fx5',
    symbol: 'AVGO',
    side: 'long',
    entryTime: '2026-10-07T13:52:00.000Z',
    exitTime: '2026-10-09T19:41:00.000Z',
    shares: 450,
    entryPrice: 342.18,
    exitPrice: 358.92,
    pnl: 7533.0,
    pnlPct: 0.0489,
    outcome: 'win',
    holdDays: 2,
    holdTimeMin: 3229,
    stopLoss: 331.5,
    rMultiple: 1.57,
    setupTag: 'breakout',
  }),
]

export default function DevHarnessTradesPage() {
  if (process.env.ENABLE_DEV_HARNESS !== '1') notFound()

  return (
    <DashboardShell>
      <Suspense fallback={null}>
        <TradesTable trades={TRADES} accountEquity={527631.19} />
      </Suspense>
    </DashboardShell>
  )
}
