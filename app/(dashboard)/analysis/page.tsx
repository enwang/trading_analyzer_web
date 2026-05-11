import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { computeSummary } from '@/lib/metrics'
import { normalizeTradesForDisplay } from '@/lib/trades'
import { DEFAULT_INITIAL_RISK_AMOUNT } from '@/lib/market/stop-loss'
import { AnalysisView } from '@/components/charts/analysis-view'

export default async function AnalysisPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rows } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user!.id)
    .order('entry_time', { ascending: true })

  const allTrades = (rows ?? []).map(rowToTrade)
  // Normalized trades used only for summary metric computation
  const trades = normalizeTradesForDisplay(allTrades)
  const summary = computeSummary(trades)

  const normalizedClosed = trades.filter((t) => t.outcome !== 'open' && t.pnl != null)
  const avgHoldTimeMin =
    normalizedClosed.length > 0
      ? normalizedClosed
          .map((t) => t.holdTimeMin)
          .filter((v): v is number => v != null)
          .reduce((s, v, _, arr) => s + v / arr.length, 0)
      : null
  const avgRealizedRMultiple = summary.expectancy / DEFAULT_INITIAL_RISK_AMOUNT

  // Raw (non-aggregated) closed trades for the Trades/Days tabs —
  // each partial exit appears as its own row, sorted exit-date descending
  const rawClosed = allTrades
    .filter((t) => t.exitTime != null && t.outcome !== 'open' && t.pnl != null)
    .sort((a, b) => (b.exitTime! > a.exitTime! ? 1 : b.exitTime! < a.exitTime! ? -1 : 0))

  const data = {
    summaryBase: {
      netPnl: summary.netPnl,
      winPct: summary.winRate * 100,
      profitFactor: summary.profitFactor,
      tradeExpectancy: summary.expectancy,
      avgNetTradePnl: normalizedClosed.length > 0 ? summary.netPnl / normalizedClosed.length : 0,
      avgRealizedRMultiple,
      avgHoldTimeMin,
    },
    closedTrades: rawClosed.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      pnl: t.pnl ?? 0,
      outcome: t.outcome,
      shares: t.shares ?? 0,
      rMultiple: t.rMultiple,
      holdTimeMin: t.holdTimeMin,
    })),
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Analysis</h1>
      <AnalysisView data={data} />
    </div>
  )
}
