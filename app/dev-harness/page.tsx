import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BackToTradesButton } from '@/components/trades/back-to-trades-button'
import { TradeDetailTabs } from '@/components/trades/trade-detail-tabs'
import { TradeChart } from '@/components/trades/trade-chart'
import type { ExecutionLeg } from '@/types/trade'

// Dev-only layout harness: renders the trade-detail page composition with
// fixture data so mobile layouts can be screenshot-tested at any viewport
// without logging in. Disabled unless ENABLE_DEV_HARNESS=1 is set in the
// server environment (never set on Vercel), in which case it 404s.
export const dynamic = 'force-dynamic'

const LEGS: ExecutionLeg[] = [
  { time: '2026-10-14T13:45:00.000Z', action: 'BUY', shares: 500, price: 213.25 },
  { time: '2026-10-14T14:02:00.000Z', action: 'BUY', shares: 750, price: 213.88 },
  { time: '2026-10-15T15:20:00.000Z', action: 'SELL', shares: 400, price: 220.2 },
  { time: '2026-10-15T17:41:00.000Z', action: 'SELL', shares: 500, price: 221.87 },
  { time: '2026-10-15T17:58:00.000Z', action: 'SELL', shares: 350, price: 221.55 },
]

export default function DevHarnessPage() {
  if (process.env.ENABLE_DEV_HARNESS !== '1') notFound()

  return (
    <div className="min-h-screen bg-background p-4 text-foreground md:p-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BackToTradesButton href="/trades" label="Back to Analysis" />
            <h1 className="truncate text-xl font-semibold">NVDA Trade Details</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="https://www.tradingview.com/chart/?symbol=NVDA" target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Open in TradingView
              </a>
            </Button>
            <Badge>Winner</Badge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <TradeDetailTabs
            tradeId="fixture"
            symbol="NVDA"
            side="long"
            shares={1250}
            entryTime="2026-10-14T13:45:00.000Z"
            exitTime="2026-10-15T17:58:00.000Z"
            entryPrice={213.25}
            exitPrice={221.87}
            pnl={14525}
            pnlPct={0.0885}
            holdTimeMin={1693}
            needsReview={false}
            setupTag="breakout"
            notes="Fixture note for layout testing."
            source="ibkr"
            initialStopLoss={208.4}
            initialRMultiple={2.35}
            initialRiskAmount={6062.5}
            initialMfe={0.112}
            initialMae={-0.021}
            executionLegs={LEGS}
          />

          <TradeChart
            symbol="NVDA"
            entryTime="2026-10-14T13:45:00.000Z"
            exitTime="2026-10-15T17:58:00.000Z"
            side="long"
            entryPrice={213.25}
            exitPrice={221.87}
            initialStopLoss={208.4}
            executionLegs={LEGS}
          />
        </div>
      </div>
    </div>
  )
}
