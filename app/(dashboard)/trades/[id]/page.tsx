import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUserId } from '@/lib/auth/user'
import { rowToTrade } from '@/types/trade'
import { Badge } from '@/components/ui/badge'
import { BackToTradesButton } from '@/components/trades/back-to-trades-button'
import { TradeDetailTabs } from '@/components/trades/trade-detail-tabs'
import { TradeChart } from '@/components/trades/trade-chart'

function outcomeClass(outcome: string | null) {
  if (outcome === 'win') return 'text-emerald-700 border-emerald-200 bg-emerald-100'
  if (outcome === 'loss') return 'text-red-700 border-red-200 bg-red-100'
  return ''
}

type ExecutionLeg = {
  action?: string | null
  time?: string | null
  price?: number | string | null
  shares?: number | string | null
}

type RecoverableTradeRow = {
  id: string
  symbol: string
  side?: string | null
  execution_legs?: ExecutionLeg[] | null
}

function normalizeLegTime(time: string | null | undefined) {
  if (!time) return ''
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return time.slice(0, 19)
  return d.toISOString().slice(0, 19)
}

function normalizeLegNumber(value: number | string | null | undefined) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(6) : ''
}

function legKey(leg: ExecutionLeg) {
  return [
    (leg.action ?? '').toUpperCase(),
    normalizeLegTime(leg.time),
    normalizeLegNumber(leg.price),
    normalizeLegNumber(leg.shares),
  ].join('|')
}

function containsExecutionLegs(candidate: ExecutionLeg[] | null | undefined, target: ExecutionLeg[] | null | undefined) {
  if (!candidate?.length || !target?.length) return false
  const counts = new Map<string, number>()
  for (const leg of candidate) {
    const key = legKey(leg)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const leg of target) {
    const key = legKey(leg)
    const count = counts.get(key) ?? 0
    if (count <= 0) return false
    counts.set(key, count - 1)
  }
  return true
}

async function findRecoverableTradeId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  missingId: string
) {
  const { data: snapshots } = await supabase
    .from('trade_snapshots')
    .select('payload')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)

  const snapshotRows = snapshots ?? []
  for (const snapshot of snapshotRows) {
    const trades = Array.isArray(snapshot.payload?.trades)
      ? snapshot.payload.trades as RecoverableTradeRow[]
      : []
    const missingTrade = trades.find((trade) => trade.id === missingId)
    if (!missingTrade) continue

    const { data: currentRows } = await supabase
      .from('trades')
      .select('id, symbol, side, execution_legs')
      .eq('user_id', userId)
      .eq('symbol', missingTrade.symbol)

    const candidates = (currentRows ?? []) as RecoverableTradeRow[]
    const match = candidates.find((candidate) =>
      candidate.id !== missingId
      && (candidate.side ?? null) === (missingTrade.side ?? null)
      && containsExecutionLegs(candidate.execution_legs, missingTrade.execution_legs)
    )

    return match?.id ?? null
  }

  return null
}

export default async function TradeDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string; date?: string; sort?: string; dir?: string; from?: string; r?: string; q?: string; symbol?: string; tz?: string }>
}) {
  const { id } = await params
  const { view, date, sort, dir, from, r: rParam, q, symbol, tz } = await searchParams
  const fromOverview = from === 'overview'
  const safeView = view === 'all' || view === 'win' || view === 'loss' || view === 'open' || view === 'marked' || view === 'lastweek'
    ? view
    : null
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  const safeQ = q && /^[A-Za-z0-9.^-]{1,20}$/.test(q) ? q.toUpperCase() : null
  const safeSymbol = symbol && /^[A-Za-z0-9.^-]{1,10}$/.test(symbol) ? symbol.toUpperCase() : null
  const safeTz = tz && /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(tz) ? tz : null
  const backParams = new URLSearchParams()
  if (safeView) backParams.set('view', safeView)
  if (safeDate) backParams.set('date', safeDate)
  if (safeQ) backParams.set('q', safeQ)
  if (safeSymbol) backParams.set('symbol', safeSymbol)
  if (safeTz) backParams.set('tz', safeTz)
  if (sort) backParams.set('sort', sort)
  if (dir === 'asc' || dir === 'desc') backParams.set('dir', dir)
  const backHref = fromOverview
    ? '/overview'
    : (backParams.toString() ? `/trades?${backParams.toString()}` : '/trades')
  const supabase = await createClient()
  const userId = await getAuthenticatedUserId()

  const { data: row } = await supabase
    .from('trades')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!row) {
    const recoveredId = await findRecoverableTradeId(supabase, userId, id)
    if (recoveredId) {
      const params = new URLSearchParams()
      if (safeView) params.set('view', safeView)
      if (safeDate) params.set('date', safeDate)
      if (safeQ) params.set('q', safeQ)
      if (safeSymbol) params.set('symbol', safeSymbol)
      if (safeTz) params.set('tz', safeTz)
      if (sort) params.set('sort', sort)
      if (dir === 'asc' || dir === 'desc') params.set('dir', dir)
      if (rParam != null) params.set('r', rParam)
      redirect(`/trades/${recoveredId}${params.toString() ? `?${params.toString()}` : ''}`)
    }
    notFound()
  }

  const trade = rowToTrade(row)
  const passedR = rParam != null ? Number(rParam) : null
  const initialRMultiple = (passedR != null && Number.isFinite(passedR)) ? passedR : trade.rMultiple

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackToTradesButton href={backHref} />
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
          needsReview={trade.needsReview}
          setupTag={trade.setupTag}
          notes={trade.notes}
          source={trade.source}
          initialStopLoss={trade.stopLoss}
          initialRMultiple={initialRMultiple}
          initialRiskAmount={trade.initialRiskAmount}
          initialMfe={trade.mfe}
          initialMae={trade.mae}
          executionLegs={trade.executionLegs}
        />

        <TradeChart
          symbol={trade.symbol}
          entryTime={trade.entryTime}
          exitTime={trade.exitTime}
          side={trade.side}
          entryPrice={trade.entryPrice}
          exitPrice={trade.exitPrice}
          executionLegs={trade.executionLegs}
        />
      </div>
    </div>
  )
}
