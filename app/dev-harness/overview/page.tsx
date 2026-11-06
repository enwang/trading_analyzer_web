import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { OverviewContent } from '@/components/overview/overview-content'
import type { Trade } from '@/types/trade'

// Dev-only harness for the Overview tab: renders the real OverviewContent
// with fixture trades so the KPI-follows-chart-window behavior can be
// screenshot/DOM-tested at any viewport without logging in.
// Fixture math (closed trades):
//   Sep 2026 exits: +1000 (win), -500 (loss), +2000 (win)
//     -> 3 trades, 2W/1L, win rate 66.7%, net +$2,500, PF 6.00
//   Oct 2026 exits: -100 (loss), -300 (loss)
//     -> 2 trades, 0W/2L, win rate 0.0%, net -$400, PF 0.00
//   All: 5 trades, 2W/3L, win rate 40.0%, net +$2,100, PF 3.33
// One open trade (pnl -612) must stay out of the window stats at all times.
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
    id: 'sep1', symbol: 'AAA',
    entryTime: '2026-09-08T14:00:00.000Z', exitTime: '2026-09-09T15:00:00.000Z',
    shares: 100, entryPrice: 100, exitPrice: 105,
    pnl: 1000, pnlPct: 0.05, outcome: 'win', holdDays: 1, holdTimeMin: 1500,
  }),
  fixture({
    id: 'sep2', symbol: 'BBB',
    entryTime: '2026-09-15T14:00:00.000Z', exitTime: '2026-09-16T15:00:00.000Z',
    shares: 100, entryPrice: 200, exitPrice: 195,
    pnl: -500, pnlPct: -0.025, outcome: 'loss', holdDays: 1, holdTimeMin: 1500,
  }),
  fixture({
    id: 'sep3', symbol: 'CCC',
    entryTime: '2026-09-22T14:00:00.000Z', exitTime: '2026-09-23T15:00:00.000Z',
    shares: 100, entryPrice: 200, exitPrice: 220,
    pnl: 2000, pnlPct: 0.10, outcome: 'win', holdDays: 1, holdTimeMin: 1500,
  }),
  fixture({
    id: 'oct1', symbol: 'DDD',
    entryTime: '2026-10-06T14:00:00.000Z', exitTime: '2026-10-07T15:00:00.000Z',
    shares: 100, entryPrice: 100, exitPrice: 99,
    pnl: -100, pnlPct: -0.01, outcome: 'loss', holdDays: 1, holdTimeMin: 1500,
  }),
  fixture({
    id: 'oct2', symbol: 'EEE',
    entryTime: '2026-10-20T14:00:00.000Z', exitTime: '2026-10-21T15:00:00.000Z',
    shares: 100, entryPrice: 100, exitPrice: 97,
    pnl: -300, pnlPct: -0.03, outcome: 'loss', holdDays: 1, holdTimeMin: 1500,
  }),
  fixture({
    id: 'open1', symbol: 'FFF',
    entryTime: '2026-10-28T14:00:00.000Z', exitTime: null,
    shares: 300, entryPrice: 143.7, exitPrice: null,
    pnl: -612, pnlPct: null, outcome: 'open', stopLoss: 137.03,
  }),
]

const NAV = [
  { report_date: '2026-08-31', total: 100000 },
  { report_date: '2026-09-15', total: 101200 },
  { report_date: '2026-09-30', total: 102500 },
  { report_date: '2026-10-15', total: 102300 },
  { report_date: '2026-10-31', total: 102100 },
]

export default function DevHarnessOverviewPage() {
  if (process.env.ENABLE_DEV_HARNESS !== '1') notFound()

  return (
    <DashboardShell>
      <Suspense fallback={null}>
        <OverviewContent
          trades={TRADES}
          navData={NAV}
          navChanges={[]}
          cashDeposits={[]}
          spyReturns={[]}
          qqqReturns={[]}
          soxxReturns={[]}
          arkkReturns={[]}
          brkbReturns={[]}
        />
      </Suspense>
    </DashboardShell>
  )
}
