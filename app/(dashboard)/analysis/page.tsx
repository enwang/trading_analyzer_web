import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { computeSummary } from '@/lib/metrics'
import { normalizeTradesForDisplay } from '@/lib/trades'
import { DEFAULT_INITIAL_RISK_AMOUNT } from '@/lib/market/stop-loss'
import { AnalysisView } from '@/components/charts/analysis-view'
import { MonthlyRecap } from '@/components/charts/monthly-recap'
import {
  computeMonthlyReturns,
  computeMonthlyStats,
  computeYearlyAverages,
} from '@/lib/monthly-recap'

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

  const [{ data: navRows }, { data: navChangeRows }] = await Promise.all([
    supabase
      .from('account_nav_daily')
      .select('report_date,total')
      .eq('user_id', user!.id)
      .order('report_date', { ascending: true }),
    supabase
      .from('account_nav_change')
      .select('from_date,to_date,deposits_withdrawals')
      .eq('user_id', user!.id),
  ])

  const allTrades = (rows ?? []).map(rowToTrade)
  // Normalized trades used only for summary metric computation
  const trades = normalizeTradesForDisplay(allTrades)
  const summary = computeSummary(trades)

  // Monthly recap: returns from NAV daily, stats from normalized trades.
  const monthlyReturns = computeMonthlyReturns(navRows ?? [], navChangeRows ?? [])
  const monthlyStats = computeMonthlyStats(trades)
  // Pick the latest year that has either trade or NAV activity.
  const yearsWithData = new Set<string>()
  for (const r of monthlyStats) yearsWithData.add(r.monthKey.slice(0, 4))
  for (const r of monthlyReturns.rows) yearsWithData.add(r.monthKey.slice(0, 4))
  const recapYear = [...yearsWithData].sort().pop() ?? String(new Date().getFullYear())
  const yearlyAverages = computeYearlyAverages(trades, recapYear)
  const recapReturns = monthlyReturns.rows.filter((r) => r.monthKey.startsWith(recapYear))
  const recapStats = monthlyStats.filter((r) => r.monthKey.startsWith(recapYear))

  const normalizedClosed = trades.filter((t) => t.outcome !== 'open' && t.pnl != null)
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
      avgHoldWinMin: summary.avgHoldWinMin,
      avgHoldLossMin: summary.avgHoldLossMin,
      payoffRatio: summary.payoffRatio,
      avgWin: summary.avgWin,
      avgLoss: summary.avgLoss,
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
      <MonthlyRecap
        year={recapYear}
        returns={recapReturns}
        stats={recapStats}
        yearly={yearlyAverages}
      />
    </div>
  )
}
