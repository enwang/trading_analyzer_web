import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TradeDetailTabs } from '@/components/trades/trade-detail-tabs'
import { TradeChart } from '@/components/trades/trade-chart'

function outcomeClass(outcome: string | null) {
  if (outcome === 'win') return 'text-emerald-700 border-emerald-200 bg-emerald-100'
  if (outcome === 'loss') return 'text-red-700 border-red-200 bg-red-100'
  return ''
}

export default async function TradeDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string; date?: string; sort?: string; dir?: string; from?: string }>
}) {
  const { id } = await params
  const { view, date, sort, dir, from } = await searchParams
  const fromOverview = from === 'overview'
  const safeView = view === 'all' || view === 'win' || view === 'loss' || view === 'open'
    ? view
    : null
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  const backParams = new URLSearchParams()
  if (safeView) backParams.set('view', safeView)
  if (safeDate) backParams.set('date', safeDate)
  if (sort) backParams.set('sort', sort)
  if (dir === 'asc' || dir === 'desc') backParams.set('dir', dir)
  const backHref = fromOverview
    ? '/overview'
    : (backParams.toString() ? `/trades?${backParams.toString()}` : '/trades')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: row } = await supabase
    .from('trades')
    .select('*')
    .eq('id', id)
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!row) notFound()

  const trade = rowToTrade(row)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={backHref}>
              <ArrowLeft className="size-4" />
              Back to Trades
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">
            {trade.symbol} Trade Details
          </h1>
        </div>
        <Badge className={outcomeClass(trade.outcome)}>{trade.outcome ?? '—'}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <TradeDetailTabs
          tradeId={trade.id}
          symbol={trade.symbol}
          side={trade.side}
          shares={trade.shares}
          entryTime={trade.entryTime}
          exitTime={trade.exitTime}
          entryPrice={trade.entryPrice}
          exitPrice={trade.exitPrice}
          pnl={trade.pnl}
          pnlPct={trade.pnlPct}
          holdTimeMin={trade.holdTimeMin}
          setupTag={trade.setupTag}
          source={trade.source}
          initialStopLoss={trade.stopLoss}
          initialRMultiple={trade.rMultiple}
          executionLegs={trade.executionLegs}
        />

        <TradeChart
          symbol={trade.symbol}
          entryTime={trade.entryTime}
          exitTime={trade.exitTime}
          side={trade.side}
          entryPrice={trade.entryPrice}
          exitPrice={trade.exitPrice}
        />
      </div>
    </div>
  )
}
