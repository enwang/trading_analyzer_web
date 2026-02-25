import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { computeSummary } from '@/lib/metrics'
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

  const trades = (rows ?? []).map(rowToTrade)
  const closed = trades
    .filter((t) => t.outcome !== 'open' && t.pnl != null)
    .sort((a, b) => {
      const ta = a.exitTime ?? a.entryTime ?? ''
      const tb = b.exitTime ?? b.entryTime ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })
  const summary = computeSummary(trades)
  const avgHoldTimeMin =
    closed.length > 0
      ? closed
          .map((t) => t.holdTimeMin)
          .filter((v): v is number => v != null)
          .reduce((s, v, _, arr) => s + v / arr.length, 0)
      : null
  const avgRealizedRMultiple = (() => {
    const rs = closed.map((t) => t.rMultiple).filter((v): v is number => v != null)
    return rs.length > 0 ? rs.reduce((s, v) => s + v, 0) / rs.length : 0
  })()

  const data = {
    summaryBase: {
      netPnl: summary.netPnl,
      winPct: summary.winRate * 100,
      profitFactor: summary.profitFactor,
      tradeExpectancy: summary.expectancy,
      avgNetTradePnl: closed.length > 0 ? summary.netPnl / closed.length : 0,
      avgRealizedRMultiple,
      avgHoldTimeMin,
    },
    closedTrades: closed.map((t) => ({
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
